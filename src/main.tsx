import React, { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { TaskToolbar } from './components/TaskToolbar';

type Status = 'open' | 'in progress' | 'complete';
type Priority = 'all' | 'low' | 'medium' | 'high';
type Sort = 'none' | 'pri-asc' | 'pri-desc';

function mountToolbar() {
  const el = document.getElementById('task-toolbar-root');
  if (!el) return;
  const root = createRoot(el);

  const App: React.FC = () => {
    const [statuses, setStatuses] = useState<Set<Status>>(new Set(['open','in progress','complete']));
    const [priority, setPriority] = useState<Priority>('all');
    const [sort, setSort] = useState<Sort>('none');
    const [search, setSearch] = useState('');
    const [assignee, setAssignee] = useState<string>('me');
    const [userOptions, setUserOptions] = useState<string[]>([]);

    // Hydrate from external state (assignee included) for My Tasks toolbar
    useEffect(() => {
      const handler = (e: any) => {
        const d = (e && e.detail) || {};
        if (Array.isArray(d.statuses)) setStatuses(new Set(d.statuses as Status[]));
        if (d.priority) setPriority(d.priority as Priority);
        if (d.sort) setSort(d.sort as Sort);
        if (typeof d.search === 'string') setSearch(d.search);
        if (typeof d.assignee === 'string') setAssignee(d.assignee);
      };
      document.addEventListener('userToolbar:hydrate', handler);
      return () => document.removeEventListener('userToolbar:hydrate', handler);
    }, []);

    // Receive user list for Assignee options
    useEffect(() => {
      const handler = (e: any) => {
        const d = (e && e.detail) || {};
        if (Array.isArray(d.users)) setUserOptions(d.users as string[]);
      };
      document.addEventListener('userToolbar:users', handler);
      return () => document.removeEventListener('userToolbar:users', handler);
    }, []);
    
    const [assignee, setAssignee] = useState<string>('me');
    const [userOptions, setUserOptions] = useState<string[]>([]);

    useEffect(() => {
      const handler = (e: any) => {
        const d = (e && e.detail) || {};
        if (Array.isArray(d.statuses)) setStatuses(new Set(d.statuses as Status[]));
        if (d.priority) setPriority(d.priority as Priority);
        if (d.sort) setSort(d.sort as Sort);
        if (typeof d.search === 'string') setSearch(d.search);
        if (typeof d.assignee === 'string') setAssignee(d.assignee);
      };
      document.addEventListener('userToolbar:hydrate', handler);
      return () => document.removeEventListener('userToolbar:hydrate', handler);
    }, []);

    useEffect(() => {
      const handler = (e: any) => {
        const d = (e && e.detail) || {};
        if (Array.isArray(d.users)) setUserOptions(d.users as string[]);
      };
      document.addEventListener('userToolbar:users', handler);
      return () => document.removeEventListener('userToolbar:users', handler);
    }, []);

    // Hydrate from external state when opening a user page
    useEffect(() => {
      const handler = (e: any) => {
        const d = (e && e.detail) || {};
        if (Array.isArray(d.statuses)) setStatuses(new Set(d.statuses as Status[]));
        if (d.priority) setPriority(d.priority as Priority);
        if (d.sort) setSort(d.sort as Sort);
        if (typeof d.search === 'string') setSearch(d.search);
      };
      document.addEventListener('userToolbar:hydrate', handler);
      return () => document.removeEventListener('userToolbar:hydrate', handler);
    }, []);

    const toggleStatus = (s: Status) => {
      setStatuses(prev => {
        const next = new Set(prev);
        if (next.has(s)) next.delete(s); else next.add(s);
        dispatch('taskToolbar:status', { statuses: Array.from(next) });
        return next;
      });
    };

    const onPriorityChange = (p: Priority) => {
      setPriority(p);
      dispatch('taskToolbar:priority', { priority: p });
    };

    const onSortChange = (s: Sort) => {
      setSort(s);
      dispatch('taskToolbar:sort', { sort: s });
    };

    const onClear = () => {
      const next = new Set<Status>(['open','in progress','complete']);
      setStatuses(next);
      setPriority('all');
      setSort('none');
      setSearch('');
      dispatch('taskToolbar:clear', {});
    };

    const onSearchChange = (q: string) => {
      setSearch(q);
      dispatch('taskToolbar:search', { query: q });
    };

    const selected = useMemo(() => statuses, [statuses]);

    return (
      <TaskToolbar
        selectedStatuses={selected}
        onToggleStatus={toggleStatus}
        priority={priority}
        onPriorityChange={onPriorityChange}
        sort={sort}
        onSortChange={onSortChange}
        onClear={onClear}
        search={search}
        onSearchChange={onSearchChange}
      />
    );
  };

  root.render(<App />);
}

function dispatch(type: string, detail: any) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

mountToolbar();

// Mount a similar toolbar on the User page, with its own event namespace
function mountUserToolbar() {
  const el = document.getElementById('user-toolbar-root');
  if (!el) return;
  const root = createRoot(el);

  const App: React.FC = () => {
    const [statuses, setStatuses] = useState<Set<Status>>(new Set(['open','in progress','complete']));
    const [priority, setPriority] = useState<Priority>('all');
    const [sort, setSort] = useState<Sort>('none');
    const [search, setSearch] = useState('');

    const toggleStatus = (s: Status) => {
      setStatuses(prev => {
        const next = new Set(prev);
        if (next.has(s)) next.delete(s); else next.add(s);
        dispatch('userToolbar:status', { statuses: Array.from(next) });
        return next;
      });
    };
    const onPriorityChange = (p: Priority) => { setPriority(p); dispatch('userToolbar:priority', { priority: p }); };
    const onSortChange = (s: Sort) => { setSort(s); dispatch('userToolbar:sort', { sort: s }); };
    const onClear = () => {
      const next = new Set<Status>(['open','in progress','complete']);
      setStatuses(next); setPriority('all'); setSort('none'); setSearch('');
      dispatch('userToolbar:clear', {});
    };
    const onSearchChange = (q: string) => { setSearch(q); dispatch('userToolbar:search', { query: q }); };
    const onAssigneeChange = (a: string) => { setAssignee(a); dispatch('userToolbar:assignee', { assignee: a }); };

    const selected = useMemo(() => statuses, [statuses]);
    const debug = (() => { try { return new URL(window.location.href).searchParams.get('debug') === '1'; } catch { return false; } })();
    useEffect(() => {
      if (!debug) return;
      console.log('[MyTasksToolbar] mounted', { assignee, users: userOptions });
    }, [debug]);
    return (
      <>
        <TaskToolbar
          selectedStatuses={selected}
          onToggleStatus={toggleStatus}
          priority={priority}
          onPriorityChange={onPriorityChange}
          sort={sort}
          onSortChange={onSortChange}
          onClear={onClear}
          search={search}
          onSearchChange={onSearchChange}
          assignee={assignee}
          assigneeOptions={userOptions}
          onAssigneeChange={onAssigneeChange}
        />
        {debug && (
          <div style={{marginTop:'6px', padding:'6px 8px', border:'1px dashed #c7d2fe', borderRadius:'8px', background:'#eef2ff', color:'#1e3a8a', fontSize:'12px'}}>
            Debug: My Tasks toolbar mounted — assignee: <strong>{assignee}</strong>; users: {userOptions.length}
          </div>
        )}
      </>
    );
  };

  root.render(<App />);
}

mountUserToolbar();
