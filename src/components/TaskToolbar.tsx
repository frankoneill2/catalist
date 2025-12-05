import React from 'react';

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
}) => {
  return (
    <div className="c-toolbar" role="region" aria-label="Task filters">
      {/* Status segmented multi-select */}
      <div className="c-segments" role="group" aria-label="Filter by status">
        {statusDefs.map((s, idx) => {
          const pressed = selectedStatuses.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggleStatus(s.key)}
              className={[
                'c-chip',
                pressed ? 'c-chip--active' : 'c-chip--inactive',
                idx !== statusDefs.length - 1 ? 'c-chip--sep' : '',
              ].join(' ')}
            >
              <span className="sr-only">Status:</span>
              {s.label}
            </button>
          );
        })}
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

      {/* Search */}
      {onSearchChange && (
        <label className="c-field c-field--grow" aria-label="Search tasks">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="c-input"
          />
        </label>
      )}

      {/* Clear */}
      <button type="button" onClick={onClear} className="c-btn">
        Clear
      </button>
    </div>
  );
};

export default TaskToolbar;
