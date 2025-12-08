My Tasks — Assignee Filter (Design + Implementation Notes)

Overview
- Goal: Let users view tasks in My Tasks by assignee with options: Me, All, Unassigned, or a specific user.
- Constraints: Keep the experience fast (realtime, parallel decrypt, cached results), preserve existing Status/Priority/Sort/Search filters, and avoid breaking the Table or Case views.

What Was Implemented
- UI (React toolbar)
  - src/components/TaskToolbar.tsx: Added optional Assignee select props: `assignee`, `assigneeOptions`, and `onAssigneeChange`.
  - src/main.tsx (mountUserToolbar):
    - Added local state for `assignee` and `userOptions` (user list).
    - Listens for:
      - `userToolbar:hydrate` → hydrates statuses/priority/sort/search plus the current `assignee`.
      - `userToolbar:users` → receives the dynamic list of users for the Assignee dropdown.
    - Dispatches `userToolbar:assignee` when the Assignee selection changes.
    - Added a small debug banner behind `?debug=1` to verify mount on GitHub Pages.

- Data + Realtime (vanilla JS)
  - script.js:
    - State: `currentAssigneeFilter` ('me' | 'all' | 'unassigned' | 'name:<user>') and cache keyed by `assigneeKey()` instead of username only.
    - Query: `startRealtimeUserTasks()` now builds a Firestore collection‑group query based on the assignee filter:
      - Me → `where('assignee','==', username)`
      - All → no `where` (entire tasks group)
      - Unassigned → `where('assignee','==', null)`
      - Specific user → `where('assignee','==', name)`
    - Still decrypts task text/status in parallel and groups by `caseId`, then fetches/decrypts only the needed case titles (also in parallel).
    - Event wiring:
      - Listens for `userToolbar:assignee` → updates state, persists, tries cache, restarts listener.
      - `startRealtimeUsers()` dispatches `userToolbar:users` whenever the live users list changes.
    - Header: `setUserHeader()` renders “All tasks”, “Unassigned tasks”, or “<name>’s tasks”.
    - Cache: `userTasksCacheByKey` (keyed by current assignee selection) to render instantly when the user toggles filters back and forth.

Performance Characteristics
- Realtime updates via a single collection‑group `onSnapshot` instead of N+1 per‑case queries.
- Parallel WebCrypto decrypt for tasks and case titles.
- Client‑side filtering (status/priority/search/sort) occurs after grouping.
- In‑memory cache provides instant re-display when returning to a selection.

Known Issues Encountered
- GitHub Pages 404 for `/src/main.tsx`:
  - Root cause: `index.html` loads the source module (`/src/main.tsx`) which only exists during local dev with Vite. On GitHub Pages, you must deploy the built assets in `dist/` and serve the processed `index.html` that references `assets/index-*.js`.
  - Fix (deployment): Run `npm run build` and publish the `dist/` folder to GitHub Pages. Ensure `vite.config.ts` base is `/catalist/` (it is). Don’t serve the source files directly.

- WebCrypto OperationError during decrypt in My Tasks (All/Unassigned):
  - Cause: Some legacy/partial docs do not have valid `textCipher/textIv` and/or `statusCipher/statusIv` (12‑byte IV required). The collection‑group query now reaches those older docs, so decrypt throws.
  - Mitigation (proposed): Before decrypting, check both cipher and that IV is an Array of length 12; skip (and log once) if invalid. Optionally surface an admin-only invalid‑tasks list behind `?debug=1`.

Debugging Aids
- Added a small debug banner for My Tasks (`?debug=1` query param) that prints a confirmation and the current assignee/users count; also logs to console: `[MyTasksToolbar] mounted`.

What Remains To Finish
1) Defensive decrypt guards in `startRealtimeUserTasks()` to skip invalid docs and silence OperationError spam.
2) GitHub Pages deployment pipeline: publish the built `dist/` (not `src/`) so the React toolbar assets load in production.
3) Optional polish: Place the Assignee control first in the toolbar, rename label (“Who”), and persist the last selection globally rather than per‑user page if desired.

How To Test Locally
1) `npm install` (if needed) → `npm run build` → `npm run preview` (or `vite preview`).
2) Open My Tasks:
   - Assignee: toggle Me/All/Unassigned/specific names.
   - Confirm realtime updates and filters (status/priority/search/sort) work on top.
   - Use `?debug=1` to show the debug banner.

How To Deploy To GitHub Pages
1) Build: `npm run build` (Vite outputs to `dist/`).
2) Publish: serve the contents of `dist/` under the `/catalist/` path (Vite base is already set).
3) Ensure the Pages site points to `dist/` (e.g., use an actions workflow or manual publish) so it loads `assets/index-*.js` instead of `/src/main.tsx`.

Rollback / Safety
- The Assignee feature paths are scoped to My Tasks (toolbar and `startRealtimeUserTasks()`); Table and Case flows are unaffected.
- The cache and header logic are additive. Removing the feature is as simple as reverting changes in `src/components/TaskToolbar.tsx`, `src/main.tsx`, and the related blocks in `script.js`.

