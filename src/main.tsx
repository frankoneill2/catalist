import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initSentry } from './sentry';
import { TaskToolbar } from './components/TaskToolbar';
import './auth/firebase';
import './auth/groupContext';
import './auth/dataAudit';
import { AuthGate } from './auth/AuthGate';
import { AuthErrorBoundary } from './auth/components/ErrorBoundary';
import { SecurityPanel } from './auth/components/SecurityPanel';
import { GroupSwitcher } from './auth/components/GroupSwitcher';
import { AcceptInviteModal } from './auth/components/AcceptInviteModal';
import { readPendingInviteToken, rememberPendingInviteToken } from './auth/invites';
import { auth } from './auth/firebase';
import { registerOpenSecurityPanel } from './auth/index';
import type { User } from 'firebase/auth';

// Init error tracking as the very first thing so we capture errors from the
// rest of bootstrapping (including script.js, which runs after this module).
initSentry();

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

    // Hydrate from external state when opening a case
    useEffect(() => {
      const handler = (e: any) => {
        const d = (e && e.detail) || {};
        if (Array.isArray(d.statuses)) setStatuses(new Set(d.statuses as Status[]));
        if (d.priority) setPriority(d.priority as Priority);
        if (d.sort) setSort(d.sort as Sort);
        if (typeof d.search === 'string') setSearch(d.search);
      };
      document.addEventListener('taskToolbar:hydrate', handler);
      return () => document.removeEventListener('taskToolbar:hydrate', handler);
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

mountUserToolbar();

// --- Auth gate ---
//
// The auth gate is a full-screen overlay that blocks the rest of the app until
// the user is signed in (with email verified, MFA enrolled, and PIN unlocked
// where applicable). On success it dispatches `auth:ready` so script.js can
// proceed with its existing passphrase prompt.

function mountAuthGate() {
  const el = document.getElementById('auth-gate');
  if (!el) {
    console.warn('[auth] no #auth-gate mount point');
    return;
  }
  const root = createRoot(el);

  const Wrapper: React.FC = () => {
    const [showPanel, setShowPanel] = useState(false);
    const [user, setUser] = useState<User | null>(auth.currentUser);
    const [appRevealed, setAppRevealed] = useState(false);
    const [pendingInvite, setPendingInvite] = useState<string | null>(null);

    useEffect(() => {
      registerOpenSecurityPanel(() => setShowPanel(true));
    }, []);

    // Capture an invite token from the URL on first paint and stash it in
    // sessionStorage. The auth gate may push the user through the sign-in /
    // 2FA / PIN dance; the token survives that detour and gets surfaced as
    // a modal once they reach the app.
    useEffect(() => {
      const token = readPendingInviteToken();
      if (token) {
        rememberPendingInviteToken(token);
        setPendingInvite(token);
      }
    }, []);

    // Once the auth gate finishes (appRevealed=true), the gate may have
    // already auto-claimed the pending invite as part of its enterReady
    // routing — in which case sessionStorage is now empty and we should
    // drop the modal so it doesn't try to re-accept an already-used token.
    useEffect(() => {
      if (!appRevealed) return;
      if (!readPendingInviteToken()) setPendingInvite(null);
    }, [appRevealed]);

    const onReady = useCallback((u: User) => {
      setUser(u);
      if (!appRevealed) {
        setAppRevealed(true);
        document.body.classList.add('auth-ready');
        document.dispatchEvent(new CustomEvent('auth:ready', { detail: { uid: u.uid, displayName: u.displayName, email: u.email } }));
      }
    }, [appRevealed]);

    return (
      <AuthErrorBoundary>
        <AuthGate onReady={onReady} />
        {showPanel && user ? (
          <SecurityPanel user={user} onClose={() => setShowPanel(false)} />
        ) : null}
        {appRevealed && user && pendingInvite ? (
          <AcceptInviteModal
            user={user}
            token={pendingInvite}
            onClose={() => setPendingInvite(null)}
          />
        ) : null}
      </AuthErrorBoundary>
    );
  };

  root.render(<Wrapper />);
}

mountAuthGate();

// Group switcher mounts in the topbar slot. Stays empty until the user is
// signed in; observes auth state directly so it picks up sign-in / sign-out
// without main.tsx having to coordinate.
function mountGroupSwitcher() {
  const el = document.getElementById('group-switcher-root');
  if (!el) return;
  const root = createRoot(el);

  const Wrapper: React.FC = () => {
    const [user, setUser] = useState<User | null>(auth.currentUser);
    useEffect(() => auth.onAuthStateChanged((u) => setUser(u)), []);
    if (!user || user.isAnonymous) return null;
    return <GroupSwitcher user={user} />;
  };

  root.render(<Wrapper />);
}

mountGroupSwitcher();
