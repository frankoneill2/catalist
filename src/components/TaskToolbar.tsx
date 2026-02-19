import React, { useEffect, useRef, useState } from 'react';

type Status = 'open' | 'in progress' | 'complete';
type Priority = 'all' | 'low' | 'medium' | 'high';
type Sort = 'none' | 'pri-asc' | 'pri-desc';

export interface TaskToolbarProps {
  selectedStatuses: Set<Status>;
  onToggleStatus: (status: Status) => void;

  priority: Priority;
  onPriorityChange: (p: Priority) => void;

  sort: Sort;
  onSortChange: (s: Sort) => void;

  onClear: () => void;

  search?: string;
  onSearchChange?: (q: string) => void;

  // Optional assignee control (My Tasks only)
  assignee?: string; // 'all' | 'me' | 'unassigned' | 'name:<user>'
  assigneeOptions?: string[]; // list of usernames to show
  onAssigneeChange?: (a: string) => void;
}

const statusDefs: { key: Status; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in progress', label: 'In progress' },
  { key: 'complete', label: 'Complete' },
];

export const TaskToolbar: React.FC<TaskToolbarProps> = ({
  selectedStatuses,
  onToggleStatus,
  priority,
  onPriorityChange,
  sort,
  onSortChange,
  onClear,
  search,
  onSearchChange,
  assignee,
  assigneeOptions,
  onAssigneeChange,
}) => {
  const statusRef = useRef<HTMLDivElement | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!statusRef.current) return;
      if (!statusRef.current.contains(e.target as Node)) setStatusOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, []);

  const statusSummary = (() => {
    const all = ['open', 'in progress', 'complete'] as Status[];
    const selected = all.filter(s => selectedStatuses.has(s));
    if (selected.length === all.length) return 'All';
    if (selected.length === 0) return 'None';
    return selected.map(s => s === 'open' ? 'Open' : s === 'in progress' ? 'In progress' : 'Complete').join(', ');
  })();

  return (
    <div className="c-toolbar c-toolbar--stack" role="region" aria-label="Task filters">
      <div className="c-row c-row--center">
        {/* Assignee select (optional) */}
        {onAssigneeChange && (
          <label className="c-field" aria-label="Assignee">
            <span className="sr-only sm:not-sr-only">Assignee</span>
            <div className="c-select c-select--wide">
              <select value={assignee || 'me'} onChange={(e) => onAssigneeChange(e.target.value)}>
                <option value="me">Me</option>
                <option value="all">All</option>
                <option value="unassigned">Unassigned</option>
                {Array.isArray(assigneeOptions) && assigneeOptions.map(u => (
                  <option key={u} value={`name:${u}`}>{u}</option>
                ))}
              </select>
              <svg aria-hidden className="c-caret" width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.207l3.71-3.976a.75.75 0 111.1 1.02l-4.25 4.55a.75.75 0 01-1.1 0l-4.25-4.55a.75.75 0 01.02-1.06z"/></svg>
            </div>
          </label>
        )}
        {/* Status multi-select dropdown */}
        <div className="c-field" ref={statusRef} aria-label="Status">
          <div className="c-select c-select--multi">
            <button
              type="button"
              className="c-select-btn"
              aria-haspopup="listbox"
              aria-expanded={statusOpen}
              onClick={() => setStatusOpen(o => !o)}
            >
              Status: {statusSummary}
              <svg aria-hidden className="c-caret" width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.207l3.71-3.976a.75.75 0 111.1 1.02l-4.25 4.55a.75.75 0 01-1.1 0l-4.25-4.55a.75.75 0 01.02-1.06z"/></svg>
            </button>
            {statusOpen && (
              <div role="listbox" className="c-menu">
                {statusDefs.map(s => {
                  const checked = selectedStatuses.has(s.key);
                  return (
                    <label key={s.key} className="c-menu-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleStatus(s.key)}
                      />
                      <span>{s.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Priority select */}
        <label className="c-field" aria-label="Priority">
          <span className="sr-only sm:not-sr-only">Priority</span>
          <div className="c-select">
            <select value={priority} onChange={(e) => onPriorityChange(e.target.value as Priority)}>
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <svg aria-hidden className="c-caret" width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.207l3.71-3.976a.75.75 0 111.1 1.02l-4.25 4.55a.75.75 0 01-1.1 0l-4.25-4.55a.75.75 0 01.02-1.06z"/></svg>
          </div>
        </label>

        {/* Sort select */}
        <label className="c-field" aria-label="Sort">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <div className="c-select c-select--wide">
            <select value={sort} onChange={(e) => onSortChange(e.target.value as Sort)}>
              <option value="none">None</option>
              <option value="pri-desc">Priority high → low</option>
              <option value="pri-asc">Priority low → high</option>
            </select>
            <svg aria-hidden className="c-caret" width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.207l3.71-3.976a.75.75 0 111.1 1.02l-4.25 4.55a.75.75 0 01-1.1 0l-4.25-4.55a.75.75 0 01.02-1.06z"/></svg>
          </div>
        </label>
      </div>

      {onSearchChange && (
        <div className="c-row">
          <label className="c-field c-field--grow" aria-label="Search tasks">
            <span className="sr-only">Search</span>
            <div className="c-search">
              <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search…"
                className="c-input c-input--search"
              />
              {!!search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="c-clear"
                  onClick={() => onSearchChange('')}
                >
                  ×
                </button>
              )}
            </div>
          </label>
        </div>
      )}
    </div>
  );
};

export default TaskToolbar;
