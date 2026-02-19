// script.js (ES module)

// --- Firebase: import from the CDN (no npm needed)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, updateDoc, doc, query, orderBy, serverTimestamp, getDocs, setDoc, collectionGroup, where, getDoc, limit
} from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

// --- Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBo5a6Uxk1vJwS8WqFnccjSnNOOXreOhcg",
  authDomain: "catalist-1.firebaseapp.com",
  projectId: "catalist-1",
  storageBucket: "catalist-1.firebasestorage.app",
  messagingSenderId: "843924921323",
  appId: "1:843924921323:web:0e7a847f8cd70db55f57ae",
  measurementId: "G-6NZEC4ED4C",
};

// --- Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- State and DOM refs
let key, username;
let caseListSection, caseListEl, caseForm, caseInput, caseLocationSel;
let caseDetailEl, caseTitleEl, backBtn;
let taskForm, taskInput, taskListEl;
let taskAssigneeEl, taskPriorityEl, composerOptsEl;
let noteForm, noteInput, notesListEl;
let colAInput, colBInput, colCInput, colDInput, colEInput, colFInput; // A–F headers
let colABody, colBBody, colCBody, colDBody, colEBody; // A–E bodies
let notesTasksList, notesTasksForm, notesTasksInput; // Notes embedded tasks
let tableSection, tableRoot; // Table view
let updatesSection, updatesListEl; // Updates feed
let updatesToolbarEl, updatesUserFilterEl, updatesSearchEl, updatesLoadMoreBtn;
let wardNotesPrintBtn;
// Tag controls
let filterLocationSel, filterConsultantSel, sortByTagSel, clearTagFiltersBtn;
let tabOverviewBtn, tabWardNotesBtn;
let wardNotesSection, wardNotesListEl;
let newWardNoteBtn;
let unsubWardNotes = null;
let userDetailEl, userTitleEl, userTaskListEl, userBackBtn;
let brandHome;
let currentCaseId = null;
let collapseAll = false; // global state for compact tasks on case list
let hideAllComments = false; // global show/hide comments on case list
let backTarget = 'list'; // 'table' | 'list' | 'user'
let tableScrollY = 0; // restore scroll after closing case
let currentUserPageName = null;
let unsubTasks = null;
let unsubNotes = null;
let unsubNotesTasks = null; // unsubscribe for embedded tasks inside Notes (section F)
let unsubCaseDoc = null;
let unsubTable = null;
let unsubUpdates = null;
let updatesLastDoc = null; // pagination
let updatesItems = []; // processed, decrypted items
let updatesCache = new Map(); // id -> processed item
let updatesUserFilter = '';
let updatesSearch = '';
// Keep the last cases snapshot docs for instant client-side filtering/sorting
let lastCasesDocs = null; // Array of document snapshots
let renderTableFromDocs = null; // function(docsArray)
let tableTaskUnsubs = new Map(); // per-case tasks listeners in table
let pendingDischargeCaseIds = new Set(); // keep discharged rows in active table until navigation/refresh
let showDischargedCases = false;
let unsubUsers = null;
let unsubLocations = null;
let usersCache = [];
let locationsCache = [];
let unsubUserTasks = [];
let pendingTableSnap = null; // defer table rerender while editing
let tableRebuildPending = false;
let pendingFocusTaskId = null; // when navigating from case list to a specific task
// In-session compact order for case list preview: caseId -> [taskIds]
let compactOrderByCase = new Map();
// Toolbar filters for case tasks
let toolbarStatuses = new Set(['open','in progress','complete']);
let toolbarPriority = 'all';
let toolbarSort = 'none';
let toolbarSearch = '';
let currentCaseTasks = [];
let currentTaskOrder = null;
// User page state for rendering/filtering
let userPerCase = new Map(); // caseId -> [{ taskId, text, status }]
let userCaseTitles = new Map(); // caseId -> title
let currentUserFilter = 'all';
let userFilterEl; // legacy single-select (no longer used)
let currentUserStatusSet = new Set(['open', 'in progress', 'complete']);
let currentUserPriorityFilter = 'all';
let currentUserSort = 'none';
// Cache user tasks per username to reuse between tab switches
// Cache My Tasks by assignee filter key (me|all|unassigned|name:<user>)
let userTasksCacheByKey = new Map(); // key -> { perCase: Map, titles: Map }
let currentAssigneeFilter = 'me'; // 'me' | 'all' | 'unassigned' | 'name:<user>'
// Edit locks to prevent list rerenders while typing
let caseTasksEditing = false;
let caseTasksRebuildPending = false;
let userTasksEditing = false;
let userTasksRebuildPending = false;
let currentUserSearch = '';
let userStatusEls = [];
let userPriorityFilterEl, userSortEl;
let userFilterByName = new Map(); // username -> { statuses: [...], priority: 'all'|'high'|'medium'|'low', sort: 'none'|'pri-asc'|'pri-desc' }
let headerClockEl, sessionUserChipEl;
let quickNewCaseBtn, quickWardNotesBtn, quickShortcutsBtn;
let metricVisibleCasesEl, metricOpenTasksEl, metricProgressTasksEl, metricCompleteTasksEl, metricUsersEl, metricLocationsEl;
let metricsThroughputEl, metricsUpdatedEl;
let headerClockTimer = null;
let workspaceEnhancementsBound = false;
let shortcutsOpen = false;
let unsubDashboardTasks = null;
let dashboardSnapshotSeq = 0;
const dashboardTaskStatusByPath = new Map();
const dashboardStats = {
  visibleCases: 0,
  openTasks: 0,
  progressTasks: 0,
  completeTasks: 0,
  users: 0,
  locations: 0,
};

const TASK_ASSIGNMENT = {
  OPEN: 'open',
  PENDING: 'pending_acceptance',
  ACCEPTED: 'accepted',
};

// Gentle cell background colors for table cells
const CELL_COLORS = [
  '#fef3c7', // amber-100
  '#fde68a', // amber-200
  '#dcfce7', // green-100
  '#bbf7d0', // green-200
  '#dbeafe', // blue-100
  '#bfdbfe', // blue-200
  '#e0e7ff', // indigo-100
  '#ddd6fe', // violet-200
  '#fae8ff', // fuchsia-100
  '#fee2e2', // red-100
  '#ffe4e6', // rose-100
  '#f3e8ff', // purple-100
];

// Toggle for whether to show cell color affordance on hover
let showCellColor = true;
function setCellColorEnabled(on) {
  showCellColor = !!on;
  const sec = document.getElementById('table-section');
  if (sec) sec.classList.toggle('cell-color-disabled', !on);
  try { localStorage.setItem('table.showCellColor', on ? '1' : '0'); } catch {}
  if (!on) {
    const existing = document.querySelector('.color-panel');
    if (existing) existing.remove();
  }
}

// Cache decrypted section bodies to avoid repeated decrypts: Map(caseId -> Map(letter -> string))
const cellBodyCache = new Map();
function cacheBody(caseId, letter, text) {
  if (!cellBodyCache.has(caseId)) cellBodyCache.set(caseId, new Map());
  cellBodyCache.get(caseId).set(letter, text);
}
function getCachedBody(caseId, letter) {
  return (cellBodyCache.get(caseId) || new Map()).get(letter);
}

// Tags caches
let tagsByType = new Map(); // type -> [{id, name, order}]
let subtagsByParent = new Map(); // parentTagId -> [{id, name, order, type}]
let tagsReady = false;
let activeTagFilters = { location: new Set(), consultant: new Set(), room: new Set() };
let activeTagSort = 'none';
let activeTagSortDir = 'asc'; // 'asc' | 'desc' for segmented control

function encodeSet(set) { return Array.from(set || []).join(','); }
function decodeSet(s) { return new Set((s || '').split(',').map(x=>x.trim()).filter(Boolean)); }
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const next = el.scrollHeight;
  if (next) el.style.height = `${next}px`;
}

function placeCaret(el, atEnd = true) {
  if (!el) return;
  try {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
}

function placeCaretAtEnd(el) { placeCaret(el, true); }
function placeCaretAtStart(el) { placeCaret(el, false); }

function normalizeTaskAssignmentState(data = {}) {
  const raw = data && data.assignmentState;
  if (raw === TASK_ASSIGNMENT.OPEN || raw === TASK_ASSIGNMENT.PENDING || raw === TASK_ASSIGNMENT.ACCEPTED) return raw;
  return data && data.assignee ? TASK_ASSIGNMENT.ACCEPTED : TASK_ASSIGNMENT.OPEN;
}

function isTaskPendingAcceptance(data = {}) {
  return !!(data && data.assignee) && normalizeTaskAssignmentState(data) === TASK_ASSIGNMENT.PENDING;
}

function isTaskOpenForTeam(data = {}) {
  return !data?.assignee && normalizeTaskAssignmentState(data) === TASK_ASSIGNMENT.OPEN;
}

function isTaskAcceptedAssignment(data = {}) {
  const state = normalizeTaskAssignmentState(data);
  return state === TASK_ASSIGNMENT.ACCEPTED || (!!data?.assignee && state !== TASK_ASSIGNMENT.PENDING);
}

function taskAssignmentStatusLabel(data = {}) {
  if (isTaskPendingAcceptance(data)) return `Awaiting ${data.assignee} acceptance`;
  if (isTaskOpenForTeam(data)) return 'Open task';
  return '';
}

function buildTaskCreationPayload({ textCipher, textIv, statusCipher, statusIv, assignee = null, priority = null }) {
  const nextAssignee = assignee || null;
  const isPending = !!nextAssignee;
  return {
    textCipher,
    textIv,
    statusCipher,
    statusIv,
    createdAt: serverTimestamp(),
    username: username || null,
    assignee: nextAssignee,
    priority: priority || null,
    assignmentState: isPending ? TASK_ASSIGNMENT.PENDING : TASK_ASSIGNMENT.OPEN,
    assignedBy: isPending ? (username || null) : null,
    assignedAt: isPending ? serverTimestamp() : null,
    acceptedBy: null,
    acceptedAt: null,
  };
}

function buildTaskAssignmentPatch(nextAssignee) {
  const assignee = nextAssignee || null;
  if (!assignee) {
    return {
      assignee: null,
      assignmentState: TASK_ASSIGNMENT.OPEN,
      assignedBy: null,
      assignedAt: null,
      acceptedBy: null,
      acceptedAt: null,
    };
  }
  return {
    assignee,
    assignmentState: TASK_ASSIGNMENT.PENDING,
    assignedBy: username || null,
    assignedAt: serverTimestamp(),
    acceptedBy: null,
    acceptedAt: null,
  };
}

async function updateTaskAssignment(caseId, taskId, nextAssignee, opts = {}) {
  const { caseTitle = null, taskText = null } = opts || {};
  const patch = buildTaskAssignmentPatch(nextAssignee);
  await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), patch);
  if (nextAssignee) {
    try {
      const payload = { type: 'task_assigned', caseId, taskId, caseTitle: caseTitle || undefined, assignee: nextAssignee };
      if (taskText) {
        const tEnc = await encryptText(taskText);
        payload.taskTextCipher = tEnc.cipher;
        payload.taskTextIv = tEnc.iv;
      }
      await logUpdate(payload);
    } catch {}
  } else {
    try {
      const payload = { type: 'task_reopened', caseId, taskId, caseTitle: caseTitle || undefined };
      if (taskText) {
        const tEnc = await encryptText(taskText);
        payload.taskTextCipher = tEnc.cipher;
        payload.taskTextIv = tEnc.iv;
      }
      await logUpdate(payload);
    } catch {}
  }
  if (nextAssignee) showToast(`Assigned to ${nextAssignee}. Awaiting acceptance.`);
  else showToast('Task moved to open tasks.');
}

async function acceptTaskAssignment(caseId, taskId, opts = {}) {
  const { caseTitle = null, taskText = null } = opts || {};
  await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), {
    assignmentState: TASK_ASSIGNMENT.ACCEPTED,
    acceptedBy: username || null,
    acceptedAt: serverTimestamp(),
  });
  try {
    const payload = { type: 'task_assignment_accepted', caseId, taskId, caseTitle: caseTitle || undefined, assignee: username || null };
    if (taskText) {
      const tEnc = await encryptText(taskText);
      payload.taskTextCipher = tEnc.cipher;
      payload.taskTextIv = tEnc.iv;
    }
    await logUpdate(payload);
  } catch {}
}

async function declineTaskAssignment(caseId, taskId, opts = {}) {
  const { caseTitle = null, taskText = null } = opts || {};
  await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), {
    assignee: null,
    assignmentState: TASK_ASSIGNMENT.OPEN,
    assignedBy: null,
    assignedAt: null,
    acceptedBy: null,
    acceptedAt: null,
  });
  try {
    const payload = { type: 'task_assignment_declined', caseId, taskId, caseTitle: caseTitle || undefined, assignee: username || null };
    if (taskText) {
      const tEnc = await encryptText(taskText);
      payload.taskTextCipher = tEnc.cipher;
      payload.taskTextIv = tEnc.iv;
    }
    await logUpdate(payload);
  } catch {}
}

function isCaseDischarged(data = {}) {
  return !!data?.dischargedAt;
}

function clearPendingDischargeState() {
  if (!pendingDischargeCaseIds.size) return;
  pendingDischargeCaseIds.clear();
  if (tableSection && !tableSection.hidden && lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
}

let tableStickyOffsetCache = -1;
let tableStickyOffsetFrame = 0;

function updateTableStickyOffset() {
  const topbar = document.querySelector('.topbar');
  const next = topbar ? Math.max(0, Math.ceil(topbar.getBoundingClientRect().bottom)) : 0;
  if (next === tableStickyOffsetCache) return;
  tableStickyOffsetCache = next;
  document.documentElement.style.setProperty('--table-sticky-offset', `${next}px`);
}

function scheduleTableStickyOffsetUpdate() {
  if (tableStickyOffsetFrame) return;
  tableStickyOffsetFrame = window.requestAnimationFrame(() => {
    tableStickyOffsetFrame = 0;
    updateTableStickyOffset();
  });
}

function saveTagFilterState() {
  try {
    // localStorage
    localStorage.setItem('table.filters.location', encodeSet(activeTagFilters.location));
    localStorage.setItem('table.filters.consultant', encodeSet(activeTagFilters.consultant));
    localStorage.setItem('table.filters.room', encodeSet(activeTagFilters.room));
    localStorage.setItem('table.sort.key', activeTagSort || 'none');
    localStorage.setItem('table.sort.dir', activeTagSortDir || 'asc');
  } catch {}
  try {
    // URL query params
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const setOrDel = (k, v) => { if (v) params.set(k, v); else params.delete(k); };
    setOrDel('loc', encodeSet(activeTagFilters.location));
    setOrDel('cons', encodeSet(activeTagFilters.consultant));
    setOrDel('room', encodeSet(activeTagFilters.room));
    setOrDel('sort', activeTagSort && activeTagSort !== 'none' ? activeTagSort : '');
    setOrDel('dir', activeTagSortDir && activeTagSort !== 'none' ? activeTagSortDir : '');
    const next = url.toString();
    window.history.replaceState(null, '', next);
  } catch {}
}

function loadTagFilterState() {
  // Priority: URL -> localStorage -> defaults
  try {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    const loc = p.get('loc'); const cons = p.get('cons'); const room = p.get('room');
    const sortKey = p.get('sort'); const dir = p.get('dir');
    if (loc || cons || room || sortKey) {
      if (loc) activeTagFilters.location = decodeSet(loc);
      if (cons) activeTagFilters.consultant = decodeSet(cons);
      if (room) activeTagFilters.room = decodeSet(room);
      if (sortKey) activeTagSort = sortKey;
      if (dir) activeTagSortDir = dir;
      return;
    }
  } catch {}
  try {
    activeTagFilters.location = decodeSet(localStorage.getItem('table.filters.location'));
    activeTagFilters.consultant = decodeSet(localStorage.getItem('table.filters.consultant'));
    activeTagFilters.room = decodeSet(localStorage.getItem('table.filters.room'));
    activeTagSort = localStorage.getItem('table.sort.key') || 'none';
    activeTagSortDir = localStorage.getItem('table.sort.dir') || 'asc';
  } catch {}
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

function setWorkspaceOverviewVisible(visible) {
  const panel = document.getElementById('workspace-overview');
  if (!panel) return;
  panel.hidden = !visible;
}

function updateSessionUserBadge(name = username) {
  if (!sessionUserChipEl) return;
  const label = (name || '').trim();
  sessionUserChipEl.textContent = label ? `User: ${label}` : 'User: --';
}

function tickHeaderClock() {
  if (!headerClockEl) return;
  const now = new Date();
  headerClockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  headerClockEl.dateTime = now.toISOString();
}

function startHeaderClock() {
  if (headerClockTimer) clearInterval(headerClockTimer);
  tickHeaderClock();
  headerClockTimer = setInterval(tickHeaderClock, 30000);
}

function updateDashboardStats(partial = {}) {
  Object.assign(dashboardStats, partial);
  const totalTasks = dashboardStats.openTasks + dashboardStats.progressTasks + dashboardStats.completeTasks;
  const completion = totalTasks ? Math.round((dashboardStats.completeTasks / totalTasks) * 100) : 0;
  if (metricVisibleCasesEl) metricVisibleCasesEl.textContent = String(dashboardStats.visibleCases || 0);
  if (metricOpenTasksEl) metricOpenTasksEl.textContent = String(dashboardStats.openTasks || 0);
  if (metricProgressTasksEl) metricProgressTasksEl.textContent = String(dashboardStats.progressTasks || 0);
  if (metricCompleteTasksEl) metricCompleteTasksEl.textContent = String(dashboardStats.completeTasks || 0);
  if (metricUsersEl) metricUsersEl.textContent = String(dashboardStats.users || 0);
  if (metricLocationsEl) metricLocationsEl.textContent = String(dashboardStats.locations || 0);
  if (metricsThroughputEl) {
    metricsThroughputEl.textContent = `Completion rate: ${completion}% (${dashboardStats.completeTasks}/${totalTasks || 0})`;
  }
  if (metricsUpdatedEl) {
    metricsUpdatedEl.textContent = `Last updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
}

function startRealtimeDashboardTasks() {
  if (unsubDashboardTasks) { try { unsubDashboardTasks(); } catch {} unsubDashboardTasks = null; }
  dashboardTaskStatusByPath.clear();
  dashboardSnapshotSeq += 1;
  const q = collectionGroup(db, 'tasks');
  unsubDashboardTasks = onSnapshot(q, async (snap) => {
    const seq = ++dashboardSnapshotSeq;
    const changes = snap.docChanges();
    const targets = changes.length ? changes : snap.docs.map((d) => ({ type: 'added', doc: d }));
    await Promise.all(targets.map(async (change) => {
      const path = change.doc.ref.path;
      if (change.type === 'removed') {
        dashboardTaskStatusByPath.delete(path);
        return;
      }
      const data = change.doc.data() || {};
      let status = 'open';
      try {
        if (data.statusCipher && data.statusIv) status = await decryptText(data.statusCipher, data.statusIv);
      } catch {}
      dashboardTaskStatusByPath.set(path, status);
    }));
    if (seq !== dashboardSnapshotSeq) return;
    let openTasks = 0;
    let progressTasks = 0;
    let completeTasks = 0;
    for (const status of dashboardTaskStatusByPath.values()) {
      if (status === 'complete') completeTasks += 1;
      else if (status === 'in progress') progressTasks += 1;
      else openTasks += 1;
    }
    updateDashboardStats({ openTasks, progressTasks, completeTasks });
  }, (err) => {
    console.error('Dashboard task metrics listener error', err);
  });
}

function openShortcutsModal() {
  if (shortcutsOpen) return;
  shortcutsOpen = true;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal shortcuts-modal';
  overlay.appendChild(modal);
  const title = document.createElement('h3');
  title.textContent = 'Keyboard Shortcuts';
  modal.appendChild(title);
  const list = document.createElement('div');
  list.className = 'shortcuts-grid';
  list.innerHTML = [
    '<div><kbd>Shift</kbd><span>+</span><kbd>N</kbd></div><p>Create a new case</p>',
    '<div><kbd>Shift</kbd><span>+</span><kbd>W</kbd></div><p>Open ward notes print flow</p>',
    '<div><kbd>?</kbd></div><p>Open this shortcuts panel</p>',
    '<div><kbd>Esc</kbd></div><p>Close active modal/panel</p>',
  ].join('');
  modal.appendChild(list);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn primary';
  closeBtn.textContent = 'Close';
  actions.appendChild(closeBtn);
  modal.appendChild(actions);
  document.body.appendChild(overlay);

  const close = () => {
    if (!shortcutsOpen) return;
    shortcutsOpen = false;
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKeyDown, true);
}

function setWorkspaceActionState(enabled) {
  const disabled = !enabled;
  for (const btn of [quickNewCaseBtn, quickWardNotesBtn]) {
    if (!btn) continue;
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', String(disabled));
  }
}

function setupWorkspaceEnhancements() {
  if (workspaceEnhancementsBound) return;
  workspaceEnhancementsBound = true;
  if (quickNewCaseBtn) quickNewCaseBtn.addEventListener('click', () => {
    if (!key || !username) { showToast('Sign in first to create a case'); return; }
    openNewCaseModal();
  });
  if (quickWardNotesBtn) quickWardNotesBtn.addEventListener('click', () => {
    if (!key || !username) { showToast('Sign in first to open notes'); return; }
    openWardNotesRangeModal();
  });
  if (quickShortcutsBtn) quickShortcutsBtn.addEventListener('click', () => openShortcutsModal());
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const pressed = (e.key || '').toLowerCase();
    if (isEditableTarget(e.target) && !(pressed === 'escape')) return;
    if (pressed === '?' || (e.shiftKey && pressed === '/')) {
      e.preventDefault();
      openShortcutsModal();
      return;
    }
    if (e.shiftKey && pressed === 'n') {
      e.preventDefault();
      if (!key || !username) { showToast('Sign in first to create a case'); return; }
      openNewCaseModal();
      return;
    }
    if (e.shiftKey && pressed === 'w') {
      e.preventDefault();
      if (!key || !username) { showToast('Sign in first to open notes'); return; }
      openWardNotesRangeModal();
    }
  });
  setWorkspaceActionState(false);
  startHeaderClock();
  updateSessionUserBadge();
  updateDashboardStats({});
}

// Global helper to hide/show the filters bar and align the Show button
function setTableFiltersHidden(hidden) {
  const bar = document.getElementById('table-tags-controls');
  const root = document.getElementById('table-section');
  if (!bar || !root) return;
  let ph = document.getElementById('filters-placeholder');
  if (hidden) {
    bar.style.display = 'none';
    if (!ph) {
      ph = document.createElement('div'); ph.id = 'filters-placeholder'; ph.className = 'filters-placeholder';
      root.insertBefore(ph, document.getElementById('table-root'));
    }
    ph.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'show-filters-btn';
    btn.textContent = 'Show Filters';
    btn.addEventListener('click', () => setTableFiltersHidden(false));
    ph.appendChild(btn);
    ph.appendChild(createWardNotesPrintButton());
    try { localStorage.setItem('tableFiltersHidden', '1'); } catch {}
  } else {
    bar.style.display = '';
    if (ph) ph.remove();
    try { localStorage.setItem('tableFiltersHidden', '0'); } catch {}
  }
}

// --- New Case modal (title + tags) and creation
async function openNewCaseModal() {
  const overlay = document.createElement('div'); overlay.className='modal-overlay';
  const modal = document.createElement('div'); modal.className='modal'; overlay.appendChild(modal);
  const title = document.createElement('h3'); title.textContent='New Case'; modal.appendChild(title);
  const form = document.createElement('div'); form.className='stack'; modal.appendChild(form);
  const nameWrap = document.createElement('label'); nameWrap.textContent='Title'; const nameInput = document.createElement('input'); nameInput.placeholder='Enter case title'; nameInput.setAttribute('aria-label','Case title'); nameWrap.appendChild(nameInput); form.appendChild(nameWrap);
  // Tags: Location, Room, Consultant
  const locWrap = document.createElement('label'); locWrap.textContent='Location'; const locSel = document.createElement('select'); locWrap.appendChild(locSel); form.appendChild(locWrap);
  const roomWrap = document.createElement('label'); roomWrap.textContent='Room'; const roomSel = document.createElement('select'); roomWrap.appendChild(roomSel); form.appendChild(roomWrap);
  const consWrap = document.createElement('label'); consWrap.textContent='Consultant'; const consSel = document.createElement('select'); consWrap.appendChild(consSel); form.appendChild(consWrap);
  // Actions
  const actions = document.createElement('div'); actions.className='actions'; const cancel=document.createElement('button'); cancel.className='btn'; cancel.textContent='Cancel'; const create=document.createElement('button'); create.className='btn primary'; create.textContent='Create'; actions.appendChild(cancel); actions.appendChild(create); modal.appendChild(actions);
  document.body.appendChild(overlay);

  const addOpts = (sel, items, includeUnassigned=true) => { sel.innerHTML=''; if (includeUnassigned) { const o=document.createElement('option'); o.value=''; o.textContent='Unassigned'; sel.appendChild(o);} for (const t of items) { const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o);} };
  const refreshRooms = async () => { const loc=locSel.value||''; if (loc) { const rooms = await loadSubtagsFor(loc); addOpts(roomSel, rooms, true); } else { addOpts(roomSel, [], true); } };
  // Prefill from active filters if single selections
  addOpts(locSel, tagsByType.get('location')||[]);
  addOpts(consSel, tagsByType.get('consultant')||[]);
  const locCandidates = Array.from(activeTagFilters.location||[]); if (locCandidates.length===1) locSel.value = locCandidates[0];
  const consCandidates = Array.from(activeTagFilters.consultant||[]); if (consCandidates.length===1) consSel.value = consCandidates[0];
  await refreshRooms(); const roomCandidates = Array.from(activeTagFilters.room||[]); if (roomCandidates.length===1) roomSel.value = roomCandidates[0];
  locSel.addEventListener('change', async ()=>{ await refreshRooms(); roomSel.value=''; });

  const close = () => { overlay.remove(); };
  cancel.addEventListener('click', close);
  create.addEventListener('click', async () => {
    const t = (nameInput.value||'').trim(); if (!t) { nameInput.focus(); return; }
    try {
      const e = await encryptText(t);
      const ct = { location: locSel.value||null, consultant: consSel.value||null };
      const loc = locSel.value||null; const room = roomSel.value||null; if (loc && room) ct.room = room; else ct.room = null;
      await addDoc(collection(db, 'cases'), { titleCipher: e.cipher, titleIv: e.iv, createdAt: serverTimestamp(), caseTags: ct });
      close();
      showToast('Case created');
    } catch (err) {
      console.error('Failed to create case', err); showToast('Failed to create case');
    }
  });
  nameInput.focus();
}

// Utility: assign a consistent color to a name for avatar badges
function colorForName(name) {
  if (!name) return { bg: '#e5e7eb', border: '#d1d5db', color: '#374151' };
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const bg = `hsl(${h}, 70%, 90%)`;
  const border = `hsl(${h}, 60%, 65%)`;
  const color = `hsl(${h}, 40%, 25%)`;
  return { bg, border, color };
}

// --- Crypto helpers
async function deriveKey(passphrase) {
  const enc = new TextEncoder();
  const salt = enc.encode('shared-salt');
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function encryptText(text) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { cipher: bufToB64(cipher), iv: Array.from(iv) };
}

async function decryptText(cipher, iv) {
  const dec = new TextDecoder();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    b64ToBuf(cipher)
  );
  return dec.decode(plain);
}

async function safeDecryptText(cipher, iv) {
  if (!cipher || !Array.isArray(iv) || iv.length !== 12) return null;
  try { return await decryptText(cipher, iv); } catch { return null; }
}

// --- UI helpers
function showCaseList() {
  // Legacy: route to table view now
  setWorkspaceOverviewVisible(true);
  if (tableSection) tableSection.hidden = false;
  caseDetailEl.hidden = true;
  userDetailEl.hidden = true;
  currentCaseId = null;
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
  if (unsubNotes) { unsubNotes(); unsubNotes = null; }
  compactOrderByCase = new Map();
}

async function openCase(id, title, source = 'list', initialTab = 'overview') {
  clearPendingDischargeState();
  currentCaseId = id;
  backTarget = source === 'user' ? 'user' : (source === 'table' ? 'table' : (source === 'updates' ? 'updates' : 'list'));
  setWorkspaceOverviewVisible(false);
  caseTitleEl.textContent = title;
  if (tableSection) tableSection.hidden = true;
  if (updatesSection) updatesSection.hidden = true; // ensure updates is hidden when opening a case
  if (caseListSection) caseListSection.style.display = 'none';
  userDetailEl.hidden = true;
  caseDetailEl.hidden = false;
  startRealtimeTasks(id);
  startRealtimeCaseFields(id);
  // Notes embedded tasks removed
  // Open Overview by default
  showCaseSection('overview');
  // Update URL for deep link
  try {
    const url = new URL(window.location.href); url.searchParams.set('case', id); window.history.pushState({ caseId: id }, '', url.toString());
  } catch {}
}


// Top-level tabs between Cases and My Tasks
function showMainTab(which) {
  const mainTabTable = document.getElementById('tab-table');
  const mainTabMy = document.getElementById('tab-my');
  const mainTabUpdates = document.getElementById('tab-updates');
  const isTable = which === 'table';
  const isMy = which === 'my';
  const isUpdates = which === 'updates';
  if (mainTabTable) {
    mainTabTable.classList.toggle('active', isTable);
    mainTabTable.setAttribute('aria-selected', String(isTable));
  }
  if (mainTabMy) {
    mainTabMy.classList.toggle('active', isMy);
    mainTabMy.setAttribute('aria-selected', String(isMy));
  }
  if (mainTabUpdates) {
    mainTabUpdates.classList.toggle('active', isUpdates);
    mainTabUpdates.setAttribute('aria-selected', String(isUpdates));
  }
  if (isTable) {
    setWorkspaceOverviewVisible(true);
    if (caseListSection) caseListSection.style.display = 'none';
    caseDetailEl.hidden = true;
    userDetailEl.hidden = true;
    if (updatesSection) updatesSection.hidden = true;
    if (tableSection) tableSection.hidden = false;
    updateTableStickyOffset();
    if (!unsubTable) startRealtimeTable();
    if (unsubUpdates) { try { unsubUpdates(); } catch {} unsubUpdates = null; }
  } else if (isMy) {
    clearPendingDischargeState();
    setWorkspaceOverviewVisible(true);
    if (tableSection) tableSection.hidden = true;
    if (unsubTable) { unsubTable(); unsubTable = null; }
    if (updatesSection) updatesSection.hidden = true;
    if (unsubUpdates) { try { unsubUpdates(); } catch {} unsubUpdates = null; }
    openUser(username);
  } else if (isUpdates) {
    clearPendingDischargeState();
    setWorkspaceOverviewVisible(true);
    if (tableSection) tableSection.hidden = true;
    if (unsubTable) { unsubTable(); unsubTable = null; }
    caseDetailEl.hidden = true;
    userDetailEl.hidden = true;
    if (updatesSection) updatesSection.hidden = false;
    if (!unsubUpdates) startRealtimeUpdates();
  } else {
    // default: hide everything except table
    clearPendingDischargeState();
    setWorkspaceOverviewVisible(true);
    if (updatesSection) updatesSection.hidden = true;
    if (unsubUpdates) { try { unsubUpdates(); } catch {} unsubUpdates = null; }
    if (tableSection) tableSection.hidden = false;
  }
}


// User select modal using live users list
function showUserSelectModal() {
  return new Promise(async (resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const modal = document.createElement('div'); modal.className = 'modal'; overlay.appendChild(modal);
    const title = document.createElement('h3'); title.textContent = 'Select your user'; modal.appendChild(title);
    const row = document.createElement('div'); row.className = 'row'; modal.appendChild(row);
    const select = document.createElement('select'); select.style.height = '48px'; select.style.borderRadius = '12px'; select.style.border = '1px solid #e5e7eb'; select.style.padding = '0 12px'; row.appendChild(select);
    const actions = document.createElement('div'); actions.className = 'actions'; modal.appendChild(actions);
    const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; actions.appendChild(cancel);
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = 'Continue'; actions.appendChild(ok);
    document.body.appendChild(overlay);
    let unsub = null;
    const fill = (names) => {
      const prev = select.value;
      select.innerHTML = '';
      for (const n of names) { const opt=document.createElement('option'); opt.value=n; opt.textContent=n; select.appendChild(opt);} 
      if (prev && names.includes(prev)) select.value = prev;
    };
    try {
      const qUsers = query(collection(db, 'users'), orderBy('username'));
      unsub = onSnapshot(qUsers, (snap) => {
        const names = snap.docs.map(d => (d.data().username || '').trim()).filter(Boolean);
        fill(names);
      });
    } catch (e) {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('username')));
      fill(snap.docs.map(d => (d.data().username || '').trim()).filter(Boolean));
    }
    const cleanup = () => { if (unsub) unsub(); overlay.remove(); };
    cancel.addEventListener('click', () => { cleanup(); resolve(''); });
    ok.addEventListener('click', () => { const val = select.value || ''; cleanup(); resolve(val); });
    select.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); }});
    select.focus();
  });
}

// --- Firestore listeners
function startRealtimeCases() {
  const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));
  onSnapshot(q, async snap => {
    caseListEl.innerHTML = '';
    // Build list and sort by location
    const rows = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      try {
        const title = await decryptText(data.titleCipher, data.titleIv);
        const location = (data.location || '').trim();
        rows.push({ docSnap, title, location });
      } catch (err) {
        console.error('Skipping undecryptable case', err);
      }
    }
    rows.sort((a, b) => {
      const la = a.location || '\uFFFF';
      const lb = b.location || '\uFFFF';
      const byLoc = la.localeCompare(lb);
      if (byLoc !== 0) return byLoc;
      return a.title.localeCompare(b.title);
    });

    for (const { docSnap, title, location } of rows) {
      const li = document.createElement('li');
      li.className = 'case-item';
      const left = document.createElement('div');
      left.className = 'case-left';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'case-title';
      // Parse trailing ID in parentheses for subtitle
      let mainTitle = title, idText = '';
      const m = title.match(/^(.*?)(\s*\(([^)]+)\))\s*$/);
      if (m) { mainTitle = m[1]; idText = m[3]; }
      titleSpan.textContent = mainTitle;
      left.appendChild(titleSpan);
      // Location chip (clickable to edit)
      const chip = document.createElement('span');
      chip.className = 'chip location';
      const renderChip = (val) => { chip.textContent = `📍 ${val || 'None'}`; };
      renderChip(location);
      // Build a second-line container for subtitle + chip
      const subinfo = document.createElement('div');
      subinfo.className = 'case-subinfo-left';
      if (idText) {
        const idEl = document.createElement('span'); idEl.className = 'case-id'; idEl.textContent = `(${idText})`;
        subinfo.appendChild(idEl);
      }
      subinfo.appendChild(chip);
      // Prevent chip click from opening the case
      chip.addEventListener('mousedown', (e) => e.stopPropagation());
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle select next to chip
        const existing = subinfo.querySelector('select.location-select');
        if (existing) { existing.remove(); return; }
        const sel = document.createElement('select');
        sel.className = 'location-select';
        const none = document.createElement('option'); none.value=''; none.textContent='No location'; sel.appendChild(none);
        for (const l of locationsCache) { const opt=document.createElement('option'); opt.value=l.name; opt.textContent=l.name; sel.appendChild(opt);} 
        sel.value = location || '';
        const stop = (ev) => ev.stopPropagation();
        sel.addEventListener('mousedown', stop);
        sel.addEventListener('click', stop);
        sel.addEventListener('keydown', stop);
        sel.addEventListener('change', async (ev) => {
          ev.stopPropagation();
          const newVal = sel.value || null;
          try {
            await updateDoc(doc(db, 'cases', docSnap.id), { location: newVal });
            renderChip(newVal);
          } catch (err) {
            console.error('Failed to update location', err);
            showToast('Failed to update location');
          } finally {
            sel.remove();
          }
        }, { once: true });
        chip.insertAdjacentElement('afterend', sel);
        sel.focus();
      });
      const actions = document.createElement('div');
      actions.className = 'case-actions';

      // Show/hide compact tasks toggle (chevron)
      const tasksToggle = document.createElement('button');
      tasksToggle.type = 'button';
      tasksToggle.className = 'chev-btn';
      tasksToggle.setAttribute('aria-label', 'Hide tasks');
      tasksToggle.textContent = '▾';
      actions.appendChild(tasksToggle);

      // Overflow menu (⋯) for edit/delete
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'actions-menu';
      const menuBtn = document.createElement('button');
      menuBtn.className = 'icon-btn';
      menuBtn.setAttribute('aria-label', 'More actions');
      menuBtn.textContent = '⋯';
      actionsWrap.appendChild(menuBtn);
      const panel = document.createElement('div');
      panel.className = 'menu-panel';
      panel.hidden = true;
      const addItem = (label, onClick, opts={}) => {
        const { danger=false } = opts;
        const b=document.createElement('button'); b.className='menu-item'+(danger?' delete-btn':''); b.textContent=label; b.addEventListener('click',(e)=>{ e.stopPropagation(); onClick(); panel.hidden=true;}); panel.appendChild(b);
      };
      addItem('Edit title', async () => {
        const current = mainTitle;
        const newTitle = (prompt('Edit case title', current) || '').trim();
        if (!newTitle) return;
        const { cipher, iv } = await encryptText(newTitle);
        await updateDoc(doc(db, 'cases', docSnap.id), { titleCipher: cipher, titleIv: iv });
        if (currentCaseId === docSnap.id) caseTitleEl.textContent = newTitle;
        showToast('Case title updated');
      });
      addItem('Delete case', async () => {
        if (!confirm('Delete this case and all its items?')) return;
        await deleteCaseDeep(docSnap.id);
        if (currentCaseId === docSnap.id) showCaseList();
        showToast('Case deleted');
      }, { danger: true });
      actionsWrap.appendChild(panel);
      actions.appendChild(actionsWrap);

      // Prevent clicks in actions area from opening the case
      actions.addEventListener('click', (e) => e.stopPropagation());
      actions.addEventListener('mousedown', (e) => e.stopPropagation());

      // Overflow interactions
      const toggleMenu = (open) => { panel.hidden = !open; };
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(panel.hidden); });
      document.addEventListener('click', (e) => { if (panel.hidden) return; const ae=document.activeElement; const inside=panel.contains(e.target)|| (ae && panel.contains(ae)); if (!inside && e.target!==menuBtn) toggleMenu(false); });

      // Header row that contains title/loc and actions
      const headerRow = document.createElement('div');
      headerRow.className = 'case-item-header';
      headerRow.appendChild(left);
      headerRow.appendChild(subinfo);
      headerRow.appendChild(actions);
      li.appendChild(headerRow);
      li.addEventListener('click', () => openCase(docSnap.id, title, 'list', 'notes'));

      // Compact tasks container (beneath header row)
      const tasksWrap = document.createElement('div');
      tasksWrap.className = 'case-tasks-wrap';
      const tasksUl = document.createElement('ul');
      tasksUl.className = 'case-tasks';
      tasksWrap.appendChild(tasksUl);
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'case-tasks-more';
      moreBtn.hidden = true;
      tasksWrap.appendChild(moreBtn);
      // allow clicking tasks to navigate; controls will stop propagation individually
      li.appendChild(tasksWrap);

      // Toggle behavior
      let tasksHidden = collapseAll;
      tasksWrap.hidden = tasksHidden;
      tasksToggle.textContent = tasksHidden ? '▸' : '▾';
      tasksToggle.setAttribute('aria-label', tasksHidden ? 'Show tasks' : 'Hide tasks');
      tasksToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        tasksHidden = !tasksHidden;
        tasksWrap.hidden = tasksHidden;
        tasksToggle.textContent = tasksHidden ? '▸' : '▾';
        tasksToggle.setAttribute('aria-label', tasksHidden ? 'Show tasks' : 'Hide tasks');
      });

      // Load compact tasks (non-realtime snapshot)
      loadCompactTasks(docSnap.id, title, tasksUl, moreBtn);

      caseListEl.appendChild(li);
    }
  });
}

// --- Tags: encrypted catalogs with subtags (rooms under locations)
function startRealtimeTags() {
  // Single listener on all tags ordered by 'order' only (no composite index needed)
  const qAll = query(collection(db, 'tags'), orderBy('order'));
  onSnapshot(qAll, async (snap) => {
    const byType = new Map();
    for (const d of snap.docs) {
      const dat = d.data();
      const type = dat.type || '';
      let name = '';
      try { name = await decryptText(dat.nameCipher, dat.nameIv); } catch {}
      const item = { id: d.id, name, order: typeof dat.order === 'number' ? dat.order : 0, type };
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(item);
    }
    for (const [t, arr] of byType) arr.sort((a,b)=> a.order - b.order || a.name.localeCompare(b.name));
    tagsByType = byType;
    tagsReady = true;
    updateDashboardStats({ locations: (tagsByType.get('location') || []).length });
    fillTagFilters();
    document.dispatchEvent(new CustomEvent('tags:updated'));
  }, (err) => console.error('Tags listener error', err));
}

function loadSubtagsFor(parentId) {
  if (!parentId) return Promise.resolve([]);
  if (subtagsByParent.has(parentId)) return Promise.resolve(subtagsByParent.get(parentId));
  return new Promise((resolve) => {
    const q = query(collection(db, 'tags', parentId, 'subtags'), orderBy('order'));
    onSnapshot(q, async (snap) => {
      const items = [];
      for (const d of snap.docs) {
        const dat = d.data();
        let name = '';
        try { name = await decryptText(dat.nameCipher, dat.nameIv); } catch {}
        items.push({ id: d.id, name, order: typeof dat.order === 'number' ? dat.order : 0, type: dat.type || 'room' });
      }
      items.sort((a,b)=> a.order - b.order || a.name.localeCompare(b.name));
      subtagsByParent.set(parentId, items);
      document.dispatchEvent(new CustomEvent('subtags:updated', { detail: { parentId } }));
      resolve(items);
    });
  });
}

function fillTagFilters() {
  if (filterLocationSel) {
    fillSelectWithTags(filterLocationSel, tagsByType.get('location') || []);
  }
  if (filterConsultantSel) {
    fillSelectWithTags(filterConsultantSel, tagsByType.get('consultant') || []);
  }
}

function fillSelectWithTags(sel, arr) {
  const prev = new Set(Array.from(sel.selectedOptions || []).map(o=>o.value));
  sel.innerHTML = '';
  for (const t of arr) {
    const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.name; sel.appendChild(opt);
  }
  for (const c of Array.from(sel.options)) if (prev.has(c.value)) c.selected = true;
}

function bindTagControls() {
  const reapply = () => {
    if (tableSection && !tableSection.hidden && lastCasesDocs && renderTableFromDocs) {
      renderTableFromDocs(lastCasesDocs);
    }
  };
  const onFilterChange = () => {
    activeTagFilters.location = new Set(Array.from(filterLocationSel?.selectedOptions || []).map(o=>o.value));
    activeTagFilters.consultant = new Set(Array.from(filterConsultantSel?.selectedOptions || []).map(o=>o.value));
    saveTagFilterState();
    reapply();
  };
  if (filterLocationSel) filterLocationSel.addEventListener('change', onFilterChange);
  if (filterConsultantSel) filterConsultantSel.addEventListener('change', onFilterChange);
  if (sortByTagSel) sortByTagSel.addEventListener('change', () => { activeTagSort = sortByTagSel.value || 'none'; saveTagFilterState(); reapply(); });
  if (clearTagFiltersBtn) clearTagFiltersBtn.addEventListener('click', () => {
    activeTagFilters.location.clear(); activeTagFilters.consultant.clear(); activeTagFilters.room?.clear?.();
    if (filterLocationSel) Array.from(filterLocationSel.options).forEach(o=>o.selected=false);
    if (filterConsultantSel) Array.from(filterConsultantSel.options).forEach(o=>o.selected=false);
    if (sortByTagSel) sortByTagSel.value = 'none'; activeTagSort = 'none';
    saveTagFilterState();
    reapply();
  });
}

function caseMatchesTagFilters(caseTags) {
  // AND across types; OR within a type
  for (const type of ['location','consultant','room']) {
    const set = activeTagFilters[type];
    if (set && set.size) {
      const v = caseTags && caseTags[type];
      if (!v || !set.has(v)) return false;
    }
  }
  return true;
}

async function loadCompactTasks(caseId, caseTitle, ul, moreBtn) {
  ul.innerHTML = '';
  try {
    const snap = await getDocs(collection(db, 'cases', caseId, 'tasks'));
    const items = [];
    for (const d of snap.docs) {
      const dat = d.data();
      try {
        const text = await decryptText(dat.textCipher, dat.textIv);
        const status = await decryptText(dat.statusCipher, dat.statusIv);
        items.push({ id: d.id, text, status, priority: dat.priority || null, assignee: dat.assignee || null });
      } catch {}
    }
    // Establish per-case in-session order on first render
    if (!compactOrderByCase.has(caseId)) {
      const orderVal = (s) => s === 'open' ? 0 : (s === 'in progress' ? 1 : 2);
      const init = [...items].sort((a,b) => orderVal(a.status) - orderVal(b.status));
      compactOrderByCase.set(caseId, init.map(i => i.id));
    } else {
      // If new tasks appear, add to the front without reordering existing
      const order = compactOrderByCase.get(caseId);
      for (const i of items) if (!order.includes(i.id)) order.unshift(i.id);
    }
    const order = compactOrderByCase.get(caseId) || items.map(i => i.id);
    const idx = new Map(order.map((id, i) => [id, i]));
    items.sort((a, b) => (idx.get(a.id) ?? 999999) - (idx.get(b.id) ?? 999999));

    const limit = 4;
    const expanded = ul.dataset.expanded === 'true';
    const nonCompleted = items.filter(i => i.status !== 'complete');
    const visible = expanded ? items : nonCompleted.slice(0, limit);

    // Show/hide the more button
    const remainingCount = expanded ? 0 : (items.length - visible.length);
    if (remainingCount > 0) {
      moreBtn.hidden = false;
      moreBtn.textContent = expanded ? 'Show less' : `Show more (${remainingCount})`;
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        ul.dataset.expanded = expanded ? 'false' : 'true';
        // Re-render with toggled state
        loadCompactTasks(caseId, caseTitle, ul, moreBtn);
      };
    } else {
      moreBtn.hidden = true;
    }

    for (const it of visible) {
      const li = document.createElement('li');
      const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
      li.className = 'case-task ' + statusCls;
      // Navigate to case tasks focused on this task when clicking the row
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingFocusTaskId = it.id;
        openCase(caseId, caseTitle, 'list', 'tasks');
      });
      const statusBtn = document.createElement('button');
      statusBtn.type = 'button';
      statusBtn.className = 'status-btn';
      const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
      statusBtn.textContent = icon(it.status);
      statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
      statusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const order = ['open','in progress','complete'];
        const idx = order.indexOf(it.status);
        const next = order[(idx + 1) % order.length];
        try {
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', it.id), { statusCipher: cipher, statusIv: iv });
          it.status = next;
          statusBtn.textContent = icon(next);
          statusBtn.setAttribute('aria-label', `Task status: ${next}`);
          li.className = 'case-task ' + (next === 'in progress' ? 's-inprogress' : (next === 'complete' ? 's-complete' : 's-open'));
          if (next === 'complete') {
            // Log completion with task text snapshot
            try {
              const tEnc = await encryptText(it.text || '');
              await logUpdate({ type: 'task_completed', caseId, caseTitle: caseTitle, taskId: it.id, taskTextCipher: tEnc.cipher, taskTextIv: tEnc.iv });
            } catch {}
          }
          // Do not re-sort now; keep in-session order stable until leaving page
        } catch (err) {
          console.error('Failed to update status', err);
          showToast('Failed to update status');
        }
      });
      const text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = it.text;
      li.appendChild(statusBtn);
      li.appendChild(text);
      if (it.priority) {
        const pri = document.createElement('span');
        pri.className = 'mini-chip';
        pri.textContent = it.priority;
        li.appendChild(pri);
      }
      // Assignee badge (always rendered), with hover tooltip and popup picker on click
      const av = document.createElement('span');
      av.className = 'mini-avatar';
      const initials = it.assignee ? it.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase() : '';
      av.textContent = initials || '';
      const col = colorForName(it.assignee || '');
      av.style.background = col.bg;
      av.style.color = col.color;
      av.style.border = `1px solid ${col.border}`;
      av.setAttribute('aria-label', it.assignee ? `Assigned to ${it.assignee}` : 'Unassigned');
      // Tooltip for full name on hover (rendered at body level to avoid clipping)
      let tipEl = null;
      const removeTip = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
      av.addEventListener('mouseenter', () => {
        if (!it.assignee) return; // skip tooltip when unassigned
        tipEl = document.createElement('div');
        tipEl.className = 'assignee-tip';
        tipEl.textContent = it.assignee;
        tipEl.style.position = 'fixed';
        tipEl.style.zIndex = '2147483647';
        document.body.appendChild(tipEl);
        // Position above the avatar
        const r = av.getBoundingClientRect();
        // After layout, adjust top to account for tooltip height
        requestAnimationFrame(() => {
          const h = tipEl.offsetHeight || 24;
          tipEl.style.left = `${Math.round(r.left + r.width / 2)}px`;
          tipEl.style.top = `${Math.round(r.top - 6 - h)}px`;
          tipEl.style.transform = 'translateX(-50%)';
        });
      });
      av.addEventListener('mouseleave', removeTip);
      window.addEventListener('scroll', removeTip, { passive: true });
      window.addEventListener('resize', removeTip, { passive: true });
      
      // Popup picker
      av.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close existing if open
        const existing = li.querySelector('.assignee-panel');
        if (existing) { existing.remove(); return; }
        const panel = document.createElement('div');
        panel.className = 'assignee-panel';
        panel.style.position = 'fixed';
        panel.style.zIndex = '2147483646';
        const addOpt = (label, value) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'assignee-option';
          b.textContent = label;
          b.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            try {
              await updateTaskAssignment(caseId, it.id, value, { caseTitle, taskText: it.text });
              loadCompactTasks(caseId, caseTitle, ul, moreBtn);
            } catch (err) {
              console.error('Failed to reassign task', err);
              showToast('Failed to update assignee');
            } finally {
              panel.remove();
            }
          });
          panel.appendChild(b);
        };
        addOpt('Open task', null);
        for (const u of usersCache) addOpt(u.username, u.username);
        document.body.appendChild(panel);
        // Position near the avatar (below, aligned to right if space)
        const r = av.getBoundingClientRect();
        requestAnimationFrame(() => {
          const w = panel.offsetWidth || 180;
          const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
          const top = Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6);
          panel.style.left = `${Math.round(left)}px`;
          panel.style.top = `${Math.round(top)}px`;
        });
        // outside click to close
        const onDocClick = (evt) => {
          if (!panel || panel.contains(evt.target) || evt.target === av) return;
          panel.remove();
          document.removeEventListener('click', onDocClick, true);
        };
        setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
      });
      li.appendChild(av);
      // Minimal comments line (latest)
      const cm = document.createElement('div');
      cm.className = 'case-mini-comments';
      cm.hidden = hideAllComments;
      li.appendChild(cm);
      loadLastComment(caseId, it.id, cm);
      ul.appendChild(li);
    }
  } catch (err) {
    console.error('Failed to load compact tasks for case', caseId, err);
  }
}

async function loadLastComment(caseId, taskId, container) {
  container.textContent = '';
  try {
    const snap = await getDocs(query(collection(db, 'cases', caseId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'desc'), limit(1)));
    if (snap.empty) { container.hidden = hideAllComments; return; }
    const d = snap.docs[0].data();
    const text = await decryptText(d.cipher, d.iv);
    const author = d.username || '';
    const line = document.createElement('div'); line.className = 'c-line';
    if (author) {
      const a = document.createElement('span'); a.className = 'c-author'; a.textContent = author + ':'; line.appendChild(a);
    }
    const t = document.createElement('span'); t.textContent = ' ' + text; line.appendChild(t);
    container.appendChild(line);
  } catch (err) {
    // ignore comment load errors
  }
}

// Global collapse/expand toggle for all compact task lists on case list page
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-all-tasks');
  if (!btn) return;
  const apply = () => {
    const wraps = document.querySelectorAll('.case-tasks-wrap');
    wraps.forEach(w => { w.hidden = collapseAll; });
    const toggles = document.querySelectorAll('.case-tasks-toggle');
    toggles.forEach(t => {
      if (!(t instanceof HTMLElement)) return;
      if (t.id === 'toggle-all-tasks' || t.id === 'toggle-all-comments') return; // skip header controls
      t.textContent = collapseAll ? 'Show tasks' : 'Hide tasks';
    });
    btn.textContent = collapseAll ? 'Expand all' : 'Collapse all';
  };
  btn.addEventListener('click', () => { collapseAll = !collapseAll; apply(); });
  apply();
});

// Global comments show/hide on case list
document.addEventListener('DOMContentLoaded', () => {
  const cbtn = document.getElementById('toggle-all-comments');
  if (!cbtn) return;
  const applyComments = () => {
    const c = document.querySelectorAll('.case-mini-comments');
    c.forEach(el => { if (el instanceof HTMLElement) el.hidden = hideAllComments; });
    cbtn.textContent = hideAllComments ? 'Show comments' : 'Hide comments';
  };
  cbtn.addEventListener('click', () => { hideAllComments = !hideAllComments; applyComments(); });
  applyComments();
});

function startRealtimeTasks(caseId) {
  const q = query(collection(db, 'cases', caseId, 'tasks'), orderBy('createdAt', 'desc'));
  if (unsubTasks) unsubTasks();
  // Persist in-session order: set on first load; not reshuffled on status changes
  let taskOrder = null;
  unsubTasks = onSnapshot(q, async snap => {
    taskListEl.innerHTML = '';
    // Collect tasks with decrypted fields
    const items = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      try {
        const text = await decryptText(data.textCipher, data.textIv);
        const status = await decryptText(data.statusCipher, data.statusIv);
        const createdAt = (data.createdAt && data.createdAt.toMillis) ? data.createdAt.toMillis() : 0;
        items.push({ docSnap, data, text, status, createdAt });
      } catch (err) {
        console.error('Skipping undecryptable task', err);
      }
    }

    // Establish initial order by desired grouping, but keep it fixed during this session
    if (!taskOrder) {
      const orderVal = (s) => s === 'open' ? 0 : (s === 'in progress' ? 1 : 2);
      const init = [...items].sort((a, b) => {
        const byStatus = orderVal(a.status) - orderVal(b.status);
        if (byStatus !== 0) return byStatus;
        return b.createdAt - a.createdAt;
      });
      taskOrder = init.map(i => i.docSnap.id);
    } else {
      // Add any new tasks to the top without reordering existing ones
      for (const i of items) {
        const id = i.docSnap.id;
        if (!taskOrder.includes(id)) taskOrder.unshift(id);
      }
    }

    // Sort current items by the established in-session order
    const idx = new Map(taskOrder.map((id, i) => [id, i]));
    items.sort((a, b) => (idx.get(a.docSnap.id) ?? 999999) - (idx.get(b.docSnap.id) ?? 999999));

    // Feed toolbar-based renderer
    currentTaskOrder = taskOrder.slice();
    currentCaseTasks = items.map(({ docSnap, data, text, status, createdAt }) => ({ caseId, id: docSnap.id, text, status, data, createdAt }));
    renderCaseTasks();
    return;

    for (const item of items) {
      const { docSnap, text, status, data } = item;
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.status = status;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'task-title';
        titleSpan.textContent = text;

        const taskMain = document.createElement('div');
        taskMain.className = 'task-main';

        const actions = document.createElement('div');
        actions.className = 'task-actions';
        li.appendChild(actions);


        // Status checkbox-style button to the left of the title
        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.className = 'icon-btn task-status-btn';
        const statusIcon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
        const statusLabel = (s) => `Task status: ${s}`;
        statusBtn.textContent = statusIcon(status);
        statusBtn.setAttribute('aria-label', statusLabel(status));
        statusBtn.addEventListener('click', async () => {
          const order = ['open', 'in progress', 'complete'];
          const idx = order.indexOf(li.dataset.status || 'open');
          const next = order[(idx + 1) % order.length];
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { statusCipher: cipher, statusIv: iv });
          li.dataset.status = next;
          statusBtn.textContent = statusIcon(next);
          statusBtn.setAttribute('aria-label', statusLabel(next));
          if (next === 'complete') {
            try {
              const tt = titleSpan && titleSpan.textContent ? titleSpan.textContent : '';
              const tEnc = await encryptText(tt);
              await logUpdate({ type: 'task_completed', caseId, caseTitle: (caseTitleEl && caseTitleEl.textContent) || 'Case', taskId: docSnap.id, taskTextCipher: tEnc.cipher, taskTextIv: tEnc.iv });
            } catch {}
          }
        });
        taskMain.appendChild(statusBtn);
        taskMain.appendChild(titleSpan);
        li.appendChild(taskMain);

        // chips under title (priority)
        const chips = document.createElement('div');
        chips.className = 'chips';
        if (data.priority) {
          const pri = document.createElement('span');
          const val = data.priority;
          pri.className = 'chip ' + (val === 'high' ? 'pri-high' : val === 'medium' ? 'pri-medium' : 'pri-low');
          pri.textContent = `Priority: ${val}`;
          chips.appendChild(pri);
        }
        if (data.assignee) {
          const as = document.createElement('span');
          as.className = 'chip';
          const av = document.createElement('span');
          av.className = 'avatar';
          const initials = data.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase();
          av.textContent = initials || 'U';
          const name = document.createElement('span');
          name.textContent = data.assignee;
          as.appendChild(av); as.appendChild(name);
          chips.appendChild(as);
        }
        if (chips.children.length) li.appendChild(chips);


        // Actions menu (⋯)
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'actions-menu';
        const menuBtn = document.createElement('button');
        menuBtn.className = 'icon-btn';
        menuBtn.setAttribute('aria-label', 'More actions');
        menuBtn.textContent = '⋯';
        actionsWrap.appendChild(menuBtn);
        const panel = document.createElement('div');
        panel.className = 'menu-panel';
        panel.hidden = true;

        const addItem = (label, onClick, opts = {}) => {
          const { danger = false, autoClose = true } = opts;
          const b = document.createElement('button');
          b.className = 'menu-item' + (danger ? ' delete-btn' : '');
          b.textContent = label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
            if (autoClose) panel.hidden = true;
          });
          panel.appendChild(b);
        };

        addItem('Edit', async () => {
          const current = titleSpan.textContent;
          const next = (prompt('Edit task', current) || '').trim();
          if (!next || next === current) return;
          const { cipher: textCipher, iv: textIv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { textCipher, textIv });
          titleSpan.textContent = next;
          showToast('Task updated');
        });

        addItem('Assign', () => {
          const sel = document.createElement('select');
          sel.className = 'assignee-select';
          const none = document.createElement('option');
          none.value = '';
          none.textContent = 'Unassigned';
          sel.appendChild(none);
          for (const u of usersCache) {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.username;
            sel.appendChild(opt);
          }
          sel.value = (data.assignee || '');
          sel.addEventListener('change', async () => {
            await updateTaskAssignment(caseId, docSnap.id, sel.value || null, { caseTitle: (caseTitleEl && caseTitleEl.textContent) || null, taskText: titleSpan.textContent || '' });
            sel.remove();
            panel.hidden = true;
            showToast('Assignee updated');
          }, { once: true });
          panel.appendChild(sel);
          sel.focus();
        }, { autoClose: false });

        addItem('Delete', async () => {
          if (!confirm('Delete this task?')) return;
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id));
        }, { danger: true, autoClose: true });

        actionsWrap.appendChild(panel);
        actions.appendChild(actionsWrap);

      const toggleMenu = (open) => { panel.hidden = !open; };
      menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(panel.hidden); });
      document.addEventListener('click', (e) => {
        if (panel.hidden) return;
        const ae = document.activeElement;
        const interactingInside = panel.contains(e.target) || (ae && panel.contains(ae));
        if (!interactingInside && e.target !== menuBtn) toggleMenu(false);
      });

        const toggle = document.createElement('button');
        toggle.type = 'button';

        toggle.className = 'icon-btn comment-toggle';
        toggle.setAttribute('aria-label', 'Show comments');
        actions.appendChild(toggle);
        const commentCountEl = document.createElement('span');
        commentCountEl.className = 'badge comment-count';
        actions.appendChild(commentCountEl);

        // comments section (open by default)
        const commentSection = document.createElement('div');
        commentSection.className = 'comment-section';
        commentSection.hidden = false;

        const commentsList = document.createElement('ul');
        commentsList.className = 'comments';

        commentSection.appendChild(commentsList);

        const commentForm = document.createElement('form');
        commentForm.className = 'comment-form';

        const commentInput = document.createElement('input');
        commentInput.placeholder = 'Add comment';
        commentForm.appendChild(commentInput);
        const commentBtn = document.createElement('button');
        commentBtn.className = 'icon-btn add-comment-btn';
        commentBtn.type = 'submit';
        commentBtn.textContent = '➕';
        commentBtn.setAttribute('aria-label', 'Add comment');
        commentForm.appendChild(commentBtn);
        commentForm.addEventListener('submit', async e => {
          e.preventDefault();
          const text = commentInput.value.trim();
          if (!text) return;
        // Optimistic render
        const tempLi = document.createElement('li');
        tempLi.className = 'optimistic';
        const tempSpan = document.createElement('span');
        tempSpan.textContent = username ? `${username}: ${text}` : text;
        tempLi.appendChild(tempSpan);
        commentsList.appendChild(tempLi);

          // Auto-expand immediately
          commentSection.hidden = false;
          // bump count immediately for snappy feedback
          commentCount += 1;
          updateToggleLabel();

          const shouldStartListener = !commentsLoaded;

          // Clear input right away for snappy UX
          commentInput.value = '';

            try {
              const { cipher, iv } = await encryptText(text);
              await addDoc(collection(db, 'cases', caseId, 'tasks', docSnap.id, 'comments'), {
                cipher, iv, username, createdAt: serverTimestamp(),
              });
            // Log update: comment added
            try {
              await logUpdate({ type: 'comment_added', caseId, caseTitle: (caseTitleEl && caseTitleEl.textContent) || 'Case', taskId: docSnap.id, commentCipher: cipher, commentIv: iv });
            } catch {}
            // Kick off realtime after write to avoid flicker
            if (shouldStartListener) {
              startRealtimeComments(caseId, docSnap.id, commentsList, (n) => { commentCount = n; updateToggleLabel(); });
              commentsLoaded = true;
            }
            showToast('Comment added');
          } catch (err) {
            // If write fails, mark the optimistic item as failed
            tempLi.classList.add('failed');
            // revert optimistic count bump
            commentCount = Math.max(0, commentCount - 1);
            updateToggleLabel();
            showToast('Failed to add comment');
            console.error('Failed to add comment', err);
          }
        });
        commentSection.appendChild(commentForm);
        li.appendChild(commentSection);


        let commentsLoaded = true;
        // Start comments immediately so they show by default
        startRealtimeComments(caseId, docSnap.id, commentsList, (n) => { commentCount = n; updateToggleLabel(); });
        let commentCount = 0;
        const updateToggleLabel = () => {
          const icon = commentSection.hidden ? '💬' : '✖';
          toggle.textContent = icon;
          commentCountEl.textContent = commentCount > 0 ? String(commentCount) : '';
          toggle.setAttribute('aria-label', commentSection.hidden ? 'Show comments' : 'Hide comments');
        };
        updateToggleLabel();

        toggle.addEventListener('click', () => {
          const hidden = commentSection.hidden;
          commentSection.hidden = !hidden;
          updateToggleLabel();

          if (hidden && !commentsLoaded) {
            startRealtimeComments(caseId, docSnap.id, commentsList, (n) => { commentCount = n; updateToggleLabel(); });
            commentsLoaded = true;
          }

        });

        taskListEl.appendChild(li);
    }
  });
}

function startRealtimeComments(caseId, taskId, listEl, onCount) {
  const q = query(collection(db, 'cases', caseId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'));
  onSnapshot(q, async snap => {
    if (onCount) onCount(snap.size);
    listEl.innerHTML = '';
    for (const s of snap.docs) {
      const { cipher, iv, username: user } = s.data();
      try {
        const text = await decryptText(cipher, iv);
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = user ? `${user}: ${text}` : text;
        li.appendChild(span);

        const actions = document.createElement('div');
        actions.className = 'case-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.textContent = '✏️';
        editBtn.setAttribute('aria-label', 'Edit comment');
        editBtn.addEventListener('click', async () => {
          const current = text;
          const next = (prompt('Edit comment', current) || '').trim();
          if (!next) return;
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId, 'comments', s.id), { cipher, iv });
          showToast('Comment updated');
        });
        actions.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn delete-btn';
        delBtn.textContent = '🗑';
        delBtn.setAttribute('aria-label', 'Delete comment');
        delBtn.addEventListener('click', async () => {
          if (!confirm('Delete this comment?')) return;
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', taskId, 'comments', s.id));
          showToast('Comment deleted');
        });
        actions.appendChild(delBtn);

        li.appendChild(actions);
        listEl.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable comment', err);
      }
    }
  }, err => console.error('Comments listener error', err));
}

function startRealtimeNotes(caseId) {
  const q = query(collection(db, 'cases', caseId, 'notes'), orderBy('createdAt', 'desc'));
  if (unsubNotes) unsubNotes();
  unsubNotes = onSnapshot(q, async snap => {
    notesListEl.innerHTML = '';
    for (const docSnap of snap.docs) {
      const { cipher, iv, username: noteUser } = docSnap.data();
      try {
        const text = await decryptText(cipher, iv);
        const li = document.createElement('li');
        li.textContent = noteUser ? `${noteUser}: ${text}` : text;
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'cases', caseId, 'notes', docSnap.id));
        });
        li.appendChild(del);
        notesListEl.appendChild(li);
      } catch (err) {
        console.error('Skipping undecryptable note', err);
      }
    }
  });
}

// --- Updates feed helpers ---
async function logUpdate(payload = {}) {
  try {
    const base = { type: payload.type, caseId: payload.caseId || currentCaseId || '', username, createdAt: serverTimestamp() };
    // Case title snapshot
    let caseTitleText = payload.caseTitle || (typeof caseTitleEl !== 'undefined' && caseTitleEl && caseTitleEl.textContent ? caseTitleEl.textContent : 'Case');
    try { caseTitleText = (caseTitleText || '').trim(); } catch {}
    const { cipher: caseTitleCipher, iv: caseTitleIv } = await encryptText(caseTitleText || 'Case');
    const docBody = { ...base, caseTitleCipher, caseTitleIv };
    const optional = [
      'taskId','taskTextCipher','taskTextIv','assignee','priority',
      'commentCipher','commentIv',
      'noteSection','noteTitleCipher','noteTitleIv','noteTextCipher','noteTextIv'
    ];
    for (const k of optional) if (payload[k] !== undefined) docBody[k] = payload[k];
    await addDoc(collection(db, 'updates'), docBody);
  } catch (err) {
    console.error('Failed to log update', err);
  }
}

function formatTime(ts) { try { if (!ts) return ''; const d = ts.toDate ? ts.toDate() : ts; return d.toLocaleString?.() || String(d); } catch { return ''; } }
function formatRelative(ts) {
  try {
    const d = ts.toDate ? ts.toDate() : ts;
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff/1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec/60); if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min/60); if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr/24); return `${day}d ago`;
  } catch { return ''; }
}

function dayKey(ts) { try { const d = ts.toDate ? ts.toDate() : ts; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } catch { return ''; } }
function dayLabel(ts) {
  try {
    const d = ts.toDate ? ts.toDate() : ts;
    const today = new Date(); const yday = new Date(); yday.setDate(today.getDate()-1);
    const same = (a,b)=> a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
    if (same(d,today)) return 'Today'; if (same(d,yday)) return 'Yesterday';
    return d.toLocaleDateString?.(undefined,{ weekday:'short', month:'short', day:'numeric' }) || d.toDateString();
  } catch { return ''; }
}

function buildUpdateDom(item) {
  const li = document.createElement('li'); li.className='update-item';
  const icon = document.createElement('div'); icon.className='update-icon'; icon.textContent = item.icon || '•';
  const content = document.createElement('div'); content.className='update-content';
  const line = document.createElement('div'); line.className='update-line';
  const who = document.createElement('span'); who.className='who'; who.textContent=item.username||'Someone';
  const a = document.createElement('a'); a.href='#'; a.className='link'; a.style.textDecoration='none'; a.style.color='inherit';
  // Build message with inline-emphasized task name
  const caseChip = document.createElement('span'); caseChip.className='chip'; caseChip.textContent=item.caseTitle||'Case';
  const frag = document.createDocumentFragment();
  frag.appendChild(who);
  if (item.type==='task_added') {
    frag.appendChild(document.createTextNode(' added '));
    if (item.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=item.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
    frag.appendChild(document.createTextNode(' to '));
    frag.appendChild(caseChip);
  } else if (item.type==='task_completed') {
    frag.appendChild(document.createTextNode(' marked '));
    if (item.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=item.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
    frag.appendChild(document.createTextNode(' as complete in '));
    frag.appendChild(caseChip);
  } else if (item.type==='task_assigned') {
    frag.appendChild(document.createTextNode(' assigned '));
    if (item.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=item.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
    frag.appendChild(document.createTextNode(` to ${item.assignee || 'a teammate'} (pending acceptance) in `));
    frag.appendChild(caseChip);
  } else if (item.type==='task_assignment_accepted') {
    frag.appendChild(document.createTextNode(' accepted '));
    if (item.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=item.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
    frag.appendChild(document.createTextNode(' in '));
    frag.appendChild(caseChip);
  } else if (item.type==='task_assignment_declined') {
    frag.appendChild(document.createTextNode(' declined '));
    if (item.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=item.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
    frag.appendChild(document.createTextNode(' (returned to open) in '));
    frag.appendChild(caseChip);
  } else if (item.type==='task_reopened') {
    frag.appendChild(document.createTextNode(' returned '));
    if (item.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=item.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
    frag.appendChild(document.createTextNode(' to open in '));
    frag.appendChild(caseChip);
  } else if (item.type==='comment_added') {
    frag.appendChild(document.createTextNode(' commented in '));
    frag.appendChild(caseChip);
    if (item.comment) { const cchip=document.createElement('span'); cchip.className='chip update-text-chip'; cchip.textContent=item.comment; frag.appendChild(document.createTextNode(' ')); frag.appendChild(cchip); }
  } else if (item.type==='note_added') {
    frag.appendChild(document.createTextNode(' added a note '));
    if (item.noteSection) { frag.appendChild(document.createTextNode(`to section ${item.noteSection} `)); }
    frag.appendChild(document.createTextNode('in '));
    frag.appendChild(caseChip);
    if (item.note) { const nchip=document.createElement('span'); nchip.className='chip update-text-chip'; nchip.textContent=item.note; frag.appendChild(document.createTextNode(' ')); frag.appendChild(nchip); }
  } else {
    frag.appendChild(document.createTextNode(' updated '));
    frag.appendChild(caseChip);
  }
  line.appendChild(frag);
  a.appendChild(line);
  a.addEventListener('click', (e)=>{ e.preventDefault(); const cid=item.caseId; if (!cid) return; // Switch to table to hide updates
    try { showMainTab('table'); } catch {}
    if (item.taskId) pendingFocusTaskId = item.taskId; openCase(cid, item.caseTitle||'Case', 'updates', 'tasks'); });
  content.appendChild(a);
  const meta = document.createElement('div'); meta.className='update-meta'; meta.title = item.createdAt ? formatTime(item.createdAt) : ''; meta.textContent = item.createdAt ? formatRelative(item.createdAt) : '';
  li.appendChild(icon); li.appendChild(content); li.appendChild(meta);
  return li;
}

function renderUpdatesList() {
  if (!updatesListEl) return;
  updatesListEl.innerHTML='';
  // Filters
  const filtered = updatesItems.filter(it => {
    if (updatesUserFilter && (it.username||'') !== updatesUserFilter) return false;
    if (updatesSearch) {
      const hay = `${it.username||''} ${it.caseTitle||''} ${it.taskText||''} ${it.comment||''}`.toLowerCase();
      if (!hay.includes(updatesSearch.toLowerCase())) return false;
    }
    return true;
  });
  if (filtered.length===0) { const d=document.createElement('div'); d.className='update-empty'; d.textContent='No updates yet.'; updatesListEl.appendChild(d); return; }
  // Group by day and then group contiguous items by same caseId
  let prevDay = '';
  let currentCase = '';
  let group = [];
  const flush = () => {
    if (!group.length) return;
    if (group.length === 1) {
      updatesListEl.appendChild(buildUpdateDom(group[0]));
    } else {
      const outer = document.createElement('li'); outer.className='update-item';
      const icon = document.createElement('div'); icon.className='update-icon'; icon.textContent='📁';
      const content = document.createElement('div'); content.className='update-content';
      const header = document.createElement('div'); header.className='update-line';
      const caseChip = document.createElement('span'); caseChip.className='chip'; caseChip.textContent = group[0].caseTitle || 'Case'; header.appendChild(caseChip);
      content.appendChild(header);
      const list = document.createElement('ul'); list.style.margin='4px 0 0'; list.style.padding='0'; list.style.listStyle='none';
      const renderLine = (it) => {
        const li = document.createElement('li');
        const a = document.createElement('a'); a.href='#'; a.style.textDecoration='none'; a.style.color='inherit';
        const who = document.createElement('span'); who.className='who'; who.textContent=it.username||'Someone';
        const frag = document.createDocumentFragment(); frag.appendChild(who);
        if (it.type==='task_added') {
          frag.appendChild(document.createTextNode(' added '));
          if (it.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=it.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
        } else if (it.type==='task_completed') {
          frag.appendChild(document.createTextNode(' marked '));
          if (it.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=it.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
          frag.appendChild(document.createTextNode(' as complete'));
        } else if (it.type==='task_assigned') {
          frag.appendChild(document.createTextNode(' assigned '));
          if (it.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=it.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
          frag.appendChild(document.createTextNode(` to ${it.assignee || 'a teammate'} (pending)`));
        } else if (it.type==='task_assignment_accepted') {
          frag.appendChild(document.createTextNode(' accepted '));
          if (it.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=it.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
        } else if (it.type==='task_assignment_declined') {
          frag.appendChild(document.createTextNode(' declined assignment'));
          if (it.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=it.taskText; frag.appendChild(tn); }
        } else if (it.type==='task_reopened') {
          frag.appendChild(document.createTextNode(' reopened '));
          if (it.taskText) { const tn=document.createElement('span'); tn.className='task-name-chip'; tn.textContent=it.taskText; frag.appendChild(tn); } else { frag.appendChild(document.createTextNode('a task')); }
        } else if (it.type==='comment_added') {
          frag.appendChild(document.createTextNode(' commented'));
          if (it.comment) { const chip=document.createElement('span'); chip.className='chip update-text-chip'; chip.textContent=it.comment; frag.appendChild(document.createTextNode(' ')); frag.appendChild(chip); }
        } else if (it.type==='note_added') {
          frag.appendChild(document.createTextNode(' added a note'));
          if (it.note) { const chip=document.createElement('span'); chip.className='chip update-text-chip'; chip.textContent=it.note; frag.appendChild(document.createTextNode(' ')); frag.appendChild(chip); }
        } else {
          frag.appendChild(document.createTextNode(' updated'));
        }
        a.appendChild(frag);
        a.addEventListener('click', (e)=>{ e.preventDefault(); try { showMainTab('table'); } catch {}; if (it.taskId) pendingFocusTaskId = it.taskId; openCase(it.caseId, it.caseTitle||'Case', 'updates', 'tasks'); });
        li.appendChild(a); list.appendChild(li);
      };
      const max = 3; const more = Math.max(0, group.length - max);
      group.slice(0, max).forEach(renderLine);
      if (more > 0) { const li=document.createElement('li'); const btn=document.createElement('button'); btn.type='button'; btn.className='btn'; btn.textContent=`Show ${more} more`; btn.addEventListener('click', ()=>{ btn.remove(); group.slice(max).forEach(renderLine); }); li.appendChild(btn); list.appendChild(li); }
      content.appendChild(list);
      const meta = document.createElement('div'); meta.className='update-meta'; meta.textContent = group[0].createdAt ? formatRelative(group[0].createdAt) : '';
      outer.appendChild(icon); outer.appendChild(content); outer.appendChild(meta);
      updatesListEl.appendChild(outer);
    }
    group = []; currentCase = '';
  };
  for (const it of filtered) {
    const day = it.createdAt ? dayKey(it.createdAt) : '';
    if (day && day !== prevDay) { flush(); prevDay = day; const g=document.createElement('div'); g.className='update-group'; g.textContent= dayLabel(it.createdAt); updatesListEl.appendChild(g); }
    if (!currentCase) { currentCase = it.caseId || ''; group = [it]; }
    else if ((it.caseId||'') === currentCase) { group.push(it); }
    else { flush(); currentCase = it.caseId || ''; group = [it]; }
  }
  flush();
}

function startRealtimeUpdates() {
  try {
    const q = query(collection(db, 'updates'), orderBy('createdAt', 'desc'), limit(100));
    if (unsubUpdates) { try { unsubUpdates(); } catch {} }
    unsubUpdates = onSnapshot(q, async (snap) => {
      updatesItems = [];
      updatesCache.clear();
      for (const d of snap.docs) {
        const data = d.data();
        const it = { id: d.id, type: data.type, username: data.username||'', assignee: data.assignee || '', caseId: data.caseId||'', taskId: data.taskId||'', createdAt: data.createdAt||null, createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null };
        try { if (data.caseTitleCipher && data.caseTitleIv) it.caseTitle = await decryptText(data.caseTitleCipher, data.caseTitleIv); } catch {}
        if (['task_added','task_completed','task_assigned','task_assignment_accepted','task_assignment_declined','task_reopened'].includes(it.type)) {
          try { if (data.taskTextCipher && data.taskTextIv) it.taskText = await decryptText(data.taskTextCipher, data.taskTextIv); } catch {}
        } else if (it.type==='comment_added') {
          try { if (data.commentCipher && data.commentIv) it.comment = await decryptText(data.commentCipher, data.commentIv); } catch {}
        } else if (it.type==='note_added') {
          it.noteSection = data.noteSection || '';
          try { if (data.noteTitleCipher && data.noteTitleIv) it.noteTitle = await decryptText(data.noteTitleCipher, data.noteTitleIv); } catch {}
          try { if (data.noteTextCipher && data.noteTextIv) it.note = await decryptText(data.noteTextCipher, data.noteTextIv); } catch {}
        }
        if (it.type==='task_added') it.icon = '➕';
        else if (it.type==='task_completed') it.icon = '☑';
        else if (it.type==='task_assigned') it.icon = '📨';
        else if (it.type==='task_assignment_accepted') it.icon = '✅';
        else if (it.type==='task_assignment_declined') it.icon = '↩';
        else if (it.type==='task_reopened') it.icon = '🔓';
        else if (it.type==='comment_added') it.icon = '💬';
        else if (it.type==='note_added') it.icon = '📝';
        else it.icon = '•';
        updatesItems.push(it); updatesCache.set(d.id, it);
      }
      updatesLastDoc = snap.docs[snap.docs.length-1] || null;
      // Populate user filter options from usersCache
      if (updatesUserFilterEl) {
        const prev = updatesUserFilterEl.value;
        updatesUserFilterEl.innerHTML = '<option value="">All users</option>' + (usersCache||[]).map(u=>`<option value="${u.username}">${u.username}</option>`).join('');
        updatesUserFilterEl.value = prev || '';
      }
      renderUpdatesList();
    }, (err) => console.error('Updates listener error', err));
  } catch (err) {
    console.error('Failed to start updates listener', err);
  }
}

async function loadMoreUpdates() {
  if (!updatesLastDoc) return;
  try {
    const q = query(collection(db,'updates'), orderBy('createdAt','desc'), startAfter(updatesLastDoc), limit(100));
    const snap = await getDocs(q);
    const more = [];
    for (const d of snap.docs) {
      const data = d.data();
      const it = { id: d.id, type: data.type, username: data.username||'', assignee: data.assignee || '', caseId: data.caseId||'', taskId: data.taskId||'', createdAt: data.createdAt||null, createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null };
      try { if (data.caseTitleCipher && data.caseTitleIv) it.caseTitle = await decryptText(data.caseTitleCipher, data.caseTitleIv); } catch {}
      if (['task_added','task_completed','task_assigned','task_assignment_accepted','task_assignment_declined','task_reopened'].includes(it.type)) {
        try { if (data.taskTextCipher && data.taskTextIv) it.taskText = await decryptText(data.taskTextCipher, data.taskTextIv); } catch {}
      } else if (it.type==='comment_added') {
        try { if (data.commentCipher && data.commentIv) it.comment = await decryptText(data.commentCipher, data.commentIv); } catch {}
      } else if (it.type==='note_added') {
        it.noteSection = data.noteSection || '';
        try { if (data.noteTitleCipher && data.noteTitleIv) it.noteTitle = await decryptText(data.noteTitleCipher, data.noteTitleIv); } catch {}
        try { if (data.noteTextCipher && data.noteTextIv) it.note = await decryptText(data.noteTextCipher, data.noteTextIv); } catch {}
      }
      if (it.type==='task_added') it.icon = '➕';
      else if (it.type==='task_completed') it.icon = '☑';
      else if (it.type==='task_assigned') it.icon = '📨';
      else if (it.type==='task_assignment_accepted') it.icon = '✅';
      else if (it.type==='task_assignment_declined') it.icon = '↩';
      else if (it.type==='task_reopened') it.icon = '🔓';
      else if (it.type==='comment_added') it.icon = '💬';
      else if (it.type==='note_added') it.icon = '📝';
      else it.icon = '•';
      more.push(it); updatesCache.set(d.id, it);
    }
    updatesLastDoc = snap.docs[snap.docs.length-1] || null;
    updatesItems = updatesItems.concat(more);
    renderUpdatesList();
  } catch (err) { console.error('Failed to load more updates', err); }
}

// --- A–F case fields stored on the case doc
function fieldNames(letter) {
  return { c: `col${letter}Cipher`, iv: `col${letter}Iv` };
}

function bodyFieldNames(letter) {
  return { c: `col${letter}BodyCipher`, iv: `col${letter}BodyIv` };
}

async function saveCaseColumn(caseId, letter, value) {
  const { c, iv } = fieldNames(letter);
  const text = (value || '').trim();
  if (!caseId) return;
  try {
    if (!text) {
      await updateDoc(doc(db, 'cases', caseId), { [c]: null, [iv]: null });
    } else {
      const e = await encryptText(text);
      await updateDoc(doc(db, 'cases', caseId), { [c]: e.cipher, [iv]: e.iv });
    }
  } catch (err) {
    console.error('Failed to save column', letter, err);
    showToast('Failed to save');
  }
}

async function saveCaseColumnBody(caseId, letter, value) {
  const { c, iv } = bodyFieldNames(letter);
  const text = (value || '').trim();
  if (!caseId) return;
  try {
    if (!text) {
      await updateDoc(doc(db, 'cases', caseId), { [c]: null, [iv]: null });
    } else {
      const e = await encryptText(text);
      await updateDoc(doc(db, 'cases', caseId), { [c]: e.cipher, [iv]: e.iv });
    }
  } catch (err) {
    console.error('Failed to save body column', letter, err);
    showToast('Failed to save');
  }
}

// Multi-item model per column (A–E)
function itemsFieldName(letter) { return `col${letter}Items`; }
function newItem(title = '', body = '') {
  return { id: Math.random().toString(36).slice(2, 10), title, body, order: Date.now() };
}
async function decryptItems(data, letter) {
  const arr = data[itemsFieldName(letter)] || null;
  if (Array.isArray(arr) && arr.length) {
    const out = [];
    for (const it of arr) {
      let title = '', body = '';
      try { if (it.titleCipher && it.titleIv) title = await decryptText(it.titleCipher, it.titleIv); } catch {}
      try { if (it.bodyCipher && it.bodyIv) body = await decryptText(it.bodyCipher, it.bodyIv); } catch {}
      out.push({ id: it.id || Math.random().toString(36).slice(2,10), title, body, order: it.order || 0 });
    }
    out.sort((a,b)=> (a.order||0) - (b.order||0));
    return out;
  }
  // Fallback to legacy single header/body
  let title = '', body = '';
  try { const { c, iv } = fieldNames(letter); if (data[c] && data[iv]) title = await decryptText(data[c], data[iv]); } catch {}
  try { const { c, iv } = bodyFieldNames(letter); if (data[c] && data[iv]) body = await decryptText(data[c], data[iv]); } catch {}
  if (title || body) return [{ id: 'legacy', title, body, order: 0 }];
  return [];
}
async function encryptItemsPayload(items) {
  const out = [];
  for (const it of items) {
    const { cipher: titleCipher, iv: titleIv } = await encryptText((it.title||'').trim());
    const { cipher: bodyCipher, iv: bodyIv } = await encryptText((it.body||'').trim());
    out.push({ id: it.id, titleCipher, titleIv, bodyCipher, bodyIv, order: it.order||0 });
  }
  return out;
}
async function saveItems(caseId, letter, items) {
  const field = itemsFieldName(letter);
  const payload = await encryptItemsPayload(items);
  const first = (items[0] && (items[0].title||'').trim()) || '';
  const legacy = first ? await encryptText(first) : null;
  const p = { [field]: payload };
  if (legacy) { const { c, iv } = fieldNames(letter); p[c] = legacy.cipher; p[iv] = legacy.iv; } else { const { c, iv } = fieldNames(letter); p[c] = null; p[iv] = null; }
  await updateDoc(doc(db, 'cases', caseId), p);
}

function buildTableSkeleton(opts = {}) {
  const { variant = 'active' } = opts || {};
  if (!tableRoot) return { table: null, tbody: null };
  const table = document.createElement('table');
  table.className = `data-table ${variant === 'discharged' ? 'data-table--discharged' : ''}`.trim();
  table.dataset.variant = variant;
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const headers = ['Patient', 'Diagnosis', 'History', 'Meds', 'Investigations', 'Issues', 'Tasks'];
  for (const h of headers) { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); }
  thead.appendChild(tr);
  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);
  return { table, tbody };
}

function attachTableKeyboardNavigation(table) {
  if (!table) return;
  const cells = Array.from(table.querySelectorAll('tbody td'));
  cells.forEach((cell) => {
    cell.tabIndex = 0;
    cell.classList.add('table-nav-cell');
  });

  const getCellPosition = (cell) => {
    const row = cell.parentElement;
    if (!row || !row.parentElement) return null;
    const rowIndex = Array.prototype.indexOf.call(row.parentElement.children, row);
    const colIndex = cell.cellIndex;
    if (rowIndex < 0 || colIndex < 0) return null;
    return { rowIndex, colIndex };
  };

  const focusCell = (rowIndex, colIndex) => {
    const row = table.querySelectorAll('tbody tr')[rowIndex];
    if (!row) return null;
    const cell = row.children[colIndex];
    if (!cell) return null;
    cell.focus();
    return cell;
  };

  const focusPrimaryInCell = (cell, activate = false) => {
    if (!cell) return;
    const patientLink = cell.querySelector('.patient-link');
    if (patientLink) {
      if (activate) patientLink.click();
      else patientLink.focus();
      return;
    }
    const target = cell.querySelector('.cell-title, .cell-editable, .composer input, input, button, select, textarea, [contenteditable="true"]');
    if (!target) return;
    target.focus();
    if (target.matches('.cell-title, .cell-editable, [contenteditable="true"]')) placeCaretAtEnd(target);
  };

  table.addEventListener('keydown', (e) => {
    const cell = e.target instanceof Element ? e.target.closest('td') : null;
    if (!cell || !table.contains(cell)) return;
    const pos = getCellPosition(cell);
    if (!pos) return;

    const inEditor = isEditableTarget(e.target);
    const needsModifier = inEditor && !e.altKey;
    const key = e.key;

    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      if (needsModifier) return;
      e.preventDefault();
      let nextRow = pos.rowIndex;
      let nextCol = pos.colIndex;
      if (key === 'ArrowLeft') nextCol -= 1;
      if (key === 'ArrowRight') nextCol += 1;
      if (key === 'ArrowUp') nextRow -= 1;
      if (key === 'ArrowDown') nextRow += 1;
      const next = focusCell(nextRow, nextCol);
      if (next && e.shiftKey) focusPrimaryInCell(next, false);
      return;
    }

    if (key === 'Enter' && !inEditor) {
      e.preventDefault();
      focusPrimaryInCell(cell, e.altKey);
      return;
    }

    if (key === 'F2') {
      e.preventDefault();
      focusPrimaryInCell(cell, false);
    }
  });
}

function startRealtimeTable() {
  const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));

  // Renderer that can be invoked from listener and on-demand
  renderTableFromDocs = async (docsInput) => {
    // If editing a cell, defer table rebuild to preserve caret
    const active = document.activeElement;
    if (active && active.classList && (active.classList.contains('cell-editable') || active.classList.contains('cell-title'))) {
      pendingTableSnap = { docs: docsInput }; tableRebuildPending = true; return;
    }
    const { table, tbody } = buildTableSkeleton({ variant: 'active' });
    const { table: dischargedTable, tbody: dischargedTbody } = buildTableSkeleton({ variant: 'discharged' });
    if (!table || !tbody || !tableRoot || !dischargedTable || !dischargedTbody) return;
    // Optionally sort by tag
    let docs = docsInput;
    if (activeTagSort && activeTagSort !== 'none') {
      const scored = [];
      for (const d of docs) {
        const dat = d.data();
        const ct = dat.caseTags || {};
        let score = 999999;
        if (activeTagSort === 'location') {
          const arr = tagsByType.get('location') || [];
          const idx = arr.findIndex(t=>t.id === ct.location);
          score = idx === -1 ? 999999 : idx;
        } else if (activeTagSort === 'consultant') {
          const arr = tagsByType.get('consultant') || [];
          const idx = arr.findIndex(t=>t.id === ct.consultant);
          score = idx === -1 ? 999999 : idx;
        } else if (activeTagSort === 'room') {
          const arr = subtagsByParent.get(ct.location) || [];
          const idx = arr.findIndex(t=>t.id === ct.room);
          score = idx === -1 ? 999999 : idx;
        }
        scored.push({ d, score, title: '' });
      }
      // Need titles as tiebreaker
      for (const s of scored) { try { const dat = s.d.data(); s.title = await decryptText(dat.titleCipher, dat.titleIv); } catch {} }
      scored.sort((a,b)=> a.score - b.score || a.title.localeCompare(b.title));
      if (activeTagSortDir === 'desc') scored.reverse();
      docs = scored.map(s=>s.d);
    }

    const presentTaskListeners = new Set();
    let visibleCases = 0;
    let dischargedVisibleCases = 0;
    for (const d of docs) {
      const data = d.data();
      let title = '';
      try { title = await decryptText(data.titleCipher, data.titleIv); } catch {}
      if (!title || !title.trim()) continue;
      if (!caseMatchesTagFilters(data.caseTags || {})) continue;
      const isDischarged = isCaseDischarged(data);
      const pendingDischarge = pendingDischargeCaseIds.has(d.id);
      const renderAsDischarged = isDischarged && !pendingDischarge;
      if (renderAsDischarged && !showDischargedCases) {
        dischargedVisibleCases += 1;
        continue;
      }
      const tr = document.createElement('tr');
      tr.dataset.caseId = d.id;
      if (pendingDischarge) tr.classList.add('case-row-discharge-pending');
      if (renderAsDischarged) tr.classList.add('case-row-discharged');
      const tdName = document.createElement('td');
      const nameWrap = document.createElement('div'); nameWrap.className = 'name-cell';
      const nameRow = document.createElement('div'); nameRow.className = 'name-row';
      const nameTitle = document.createElement('div'); nameTitle.className = 'name-title';
      const nameActions = document.createElement('div'); nameActions.className = 'name-actions';
      const btn = document.createElement('button');
      btn.className = 'patient-link'; btn.textContent = title;
      btn.addEventListener('click', () => { tableScrollY = window.scrollY; openCase(d.id, title, 'table', 'notes'); });
      nameTitle.appendChild(btn);
      nameRow.appendChild(nameTitle);
      const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='name-action-btn edit-tags-btn'; editBtn.textContent='Tags';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTagPanelForCase(d.id, tdName); });
      nameActions.appendChild(editBtn);
      const newNoteBtn = document.createElement('button');
      newNoteBtn.type = 'button';
      newNoteBtn.className = 'name-action-btn';
      newNoteBtn.textContent = 'New note';
      newNoteBtn.title = 'Create a new ward note';
      newNoteBtn.addEventListener('click', async (e) => { e.stopPropagation();
        // Open case in background if needed to ensure currentCaseId is set
        currentCaseId = d.id; caseTitleEl.textContent = title;
        openWardNoteComposerV2();
      });
      nameActions.appendChild(newNoteBtn);
      const makeDeleteCaseBtn = () => {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'name-action-btn delete-action-btn';
        delBtn.textContent = 'Delete';
        delBtn.title = 'Delete case permanently';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this case and all its items?')) return;
          try {
            await deleteCaseDeep(d.id);
            if (currentCaseId === d.id) {
              if (unsubTasks) { try { unsubTasks(); } catch {} unsubTasks = null; }
              if (unsubNotes) { try { unsubNotes(); } catch {} unsubNotes = null; }
              if (unsubCaseDoc) { try { unsubCaseDoc(); } catch {} unsubCaseDoc = null; }
              currentCaseId = null;
              caseDetailEl.hidden = true;
              if (tableSection) tableSection.hidden = false;
            }
            showToast('Case deleted');
          } catch (err) {
            console.error('Failed to delete case', err);
            showToast('Failed to delete case');
          }
        });
        return delBtn;
      };

      if (renderAsDischarged) {
        const reopenBtn = document.createElement('button');
        reopenBtn.type = 'button';
        reopenBtn.className = 'name-action-btn';
        reopenBtn.textContent = 'Reopen';
        reopenBtn.title = 'Move case back to active list';
        reopenBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await updateDoc(doc(db, 'cases', d.id), { dischargedAt: null, dischargedBy: null });
            showToast('Case moved back to active list');
          } catch (err) {
            console.error('Failed to reopen case', err);
            showToast('Failed to reopen case');
          }
        });
        nameActions.appendChild(reopenBtn);
        nameActions.appendChild(makeDeleteCaseBtn());
      } else if (pendingDischarge) {
        const pendingChip = document.createElement('span');
        pendingChip.className = 'pending-discharge-chip';
        pendingChip.textContent = 'Discharge pending';
        pendingChip.title = 'This case will move after refresh or navigation away';
        nameActions.appendChild(pendingChip);
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'name-action-btn';
        undoBtn.textContent = 'Undo';
        undoBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await updateDoc(doc(db, 'cases', d.id), { dischargedAt: null, dischargedBy: null });
            pendingDischargeCaseIds.delete(d.id);
            if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
            showToast('Discharge cancelled');
          } catch (err) {
            console.error('Failed to cancel discharge', err);
            showToast('Failed to cancel discharge');
          }
        });
        nameActions.appendChild(undoBtn);
      } else {
        const dischargeBtn = document.createElement('button');
        dischargeBtn.type = 'button';
        dischargeBtn.className = 'name-action-btn discharge-action-btn';
        dischargeBtn.textContent = 'Discharge';
        dischargeBtn.title = 'Mark patient as discharged';
        dischargeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Discharge ${title}?`)) return;
          pendingDischargeCaseIds.add(d.id);
          if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
          try {
            await updateDoc(doc(db, 'cases', d.id), { dischargedAt: serverTimestamp(), dischargedBy: username || null });
            showToast('Discharge queued. It moves after refresh or navigation away.');
          } catch (err) {
            pendingDischargeCaseIds.delete(d.id);
            if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
            console.error('Failed to discharge case', err);
            showToast('Failed to discharge case');
          }
        });
        nameActions.appendChild(dischargeBtn);
      }
      nameRow.appendChild(nameActions);
      nameWrap.appendChild(nameRow);
      // Render tag chips (location/room/consultant)
      const chips = document.createElement('div'); chips.className = 'tag-chips';
      const caseTags = (data.caseTags || {});
      const mkChip = (label, type, id) => {
        if (!id) return;
        const list = type === 'room' ? (subtagsByParent.get(caseTags.location) || []) : (tagsByType.get(type) || []);
        const idx = list.findIndex(t => t.id === id);
        if (idx === -1) return;
        const tag = list[idx];
        const chip = document.createElement('span'); chip.className='tag-chip'; chip.setAttribute('role','button'); chip.setAttribute('tabindex','0');
        const o = document.createElement('span'); o.className='tag-order'; o.textContent = String(idx+1)+'.'; chip.appendChild(o);
        const t = document.createElement('span'); t.textContent = tag.name; chip.appendChild(t);
        if (type === 'location') {
          chip.title = 'Edit tags';
          const openEditor = () => { openTagPanelForCase(d.id, tdName); };
          chip.addEventListener('click', (e) => { e.stopPropagation(); openEditor(); });
          chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); } });
        } else {
          chip.title = `Filter by ${label}`;
          const toggle = () => {
            const set = activeTagFilters[type];
            if (set.has(id)) set.delete(id); else set.add(id);
            chip.classList.toggle('active', set.has(id));
            saveTagFilterState();
            if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
            const evt = new CustomEvent('filters:updated'); document.dispatchEvent(evt);
          };
          // Reflect current active filter state on initial render
          try { const set = activeTagFilters[type]; chip.classList.toggle('active', set && set.has(id)); } catch {}
          chip.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
          chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        }
        chips.appendChild(chip);
      };
      mkChip('Location', 'location', caseTags.location || null);
      if (caseTags.room && caseTags.location) mkChip('Room', 'room', caseTags.room);
      mkChip('Consultant', 'consultant', caseTags.consultant || null);
      nameWrap.appendChild(chips);
      if (renderAsDischarged || pendingDischarge) {
        const dischargeMeta = document.createElement('div');
        dischargeMeta.className = 'case-discharge-meta';
        const at = (data.dischargedAt && data.dischargedAt.toDate) ? data.dischargedAt.toDate() : null;
        if (pendingDischarge) {
          dischargeMeta.textContent = 'Pending discharge. Changes apply after refresh or navigation.';
        } else {
          const when = at ? at.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'recently';
          const who = (data.dischargedBy || '').trim();
          dischargeMeta.textContent = who ? `Discharged by ${who} (${when})` : `Discharged (${when})`;
        }
        nameWrap.appendChild(dischargeMeta);
      }
      tdName.appendChild(nameWrap);
      tr.appendChild(tdName);
      for (const letter of ['A','B','C','D','E','F']) {
        const td = document.createElement('td');
        if (letter === 'F') {
          const wrap = document.createElement('div'); wrap.className = 'cell-tasks';
          const ul = document.createElement('ul'); wrap.appendChild(ul);
          td.appendChild(wrap);
          if (!renderAsDischarged) {
            const form = document.createElement('form'); form.className = 'composer compact';
            const inp = document.createElement('input'); inp.placeholder = 'Add task…'; inp.setAttribute('aria-label','Task description');
            form.appendChild(inp);
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const t = (inp.value || '').trim();
              if (!t) return;
              const { cipher: textCipher, iv: textIv } = await encryptText(t);
              const { cipher: statusCipher, iv: statusIv } = await encryptText('open');
              const payload = buildTaskCreationPayload({ textCipher, textIv, statusCipher, statusIv, assignee: null, priority: null });
              const ref = await addDoc(collection(db, 'cases', d.id, 'tasks'), payload);
              try { await logUpdate({ type: 'task_added', caseId: d.id, caseTitle: title, taskId: ref.id, taskTextCipher: textCipher, taskTextIv: textIv }); } catch {}
              inp.value = '';
            });
            td.appendChild(form);
          }
          if (tableTaskUnsubs.has(d.id)) { try { tableTaskUnsubs.get(d.id)(); } catch {} tableTaskUnsubs.delete(d.id); }
          const unsub = attachTasksListRealtime(d.id, ul, { caseTitle: title, readOnly: renderAsDischarged });
          tableTaskUnsubs.set(d.id, unsub);
          presentTaskListeners.add(d.id);
        } else {
          // Multi-header cell with inline-editable header lines
          const container = document.createElement('div'); container.className = 'cell-items';
          const items = await decryptItems(data, letter);
          const max = 8;
          const expandedKey = `${d.id}:${letter}`;
          if (!window._cellExpand) window._cellExpand = new Set();
          const isExpanded = window._cellExpand.has(expandedKey);

          const saveTitles = async () => { try { await saveItems(d.id, letter, items); } catch (e) { console.error('save', e); showToast('Failed to save'); } };
          let saveTimer = null; const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveTitles, 500); };
          const renderLines = (showAll) => {
            container.innerHTML = '';
            // If empty, render a placeholder editable line to allow immediate typing
            if (!items.length) {
              const line = document.createElement('div'); line.className='cell-line';
              const bullet = document.createElement('div'); bullet.className='cell-bullet'; line.appendChild(bullet);
              const title = document.createElement('div'); title.className='cell-title'; title.setAttribute('contenteditable','true'); title.dataset.placeholder = 'Add header…';
              // Commit first item as soon as user types something
              title.addEventListener('input', () => {
                const t = (title.textContent || '').trim();
                if (t.length > 0 && items.length === 0) {
                  items.push(newItem(t, ''));
                  window._cellExpand.add(expandedKey);
                  renderLines(true);
                  scheduleSave();
                  // Focus the newly created first line
                  setTimeout(()=>{ const n=container.querySelector('.cell-title'); if (n) { n.focus(); placeCaretAtEnd(n); } },0);
                }
              });
              // Navigation keys on placeholder
              title.addEventListener('keydown', (e) => {
                if ((e.key==='Enter') && !(e.ctrlKey||e.metaKey||e.shiftKey)) {
                  e.preventDefault();
                  const t = (title.textContent || '').trim();
                  if (!t) return; // nothing to add yet
                  // Create first and second item
                  items.splice(0,0,newItem(t,''));
                  items.splice(1,0,newItem('',''));
                  window._cellExpand.add(expandedKey);
                  renderLines(true); scheduleSave();
                  setTimeout(()=>{ const n=container.querySelectorAll('.cell-title')[1]; if (n) { n.focus(); placeCaretAtStart(n); } },0);
                } else if ((e.key==='Enter') && (e.ctrlKey||e.metaKey)) {
                  e.preventDefault();
                  const cellIndex=td.cellIndex; const nextRow=tr.nextElementSibling; if (nextRow && nextRow.children[cellIndex]) { const n=nextRow.children[cellIndex].querySelector('.cell-title, .cell-editable'); if (n) n.focus(); }
                } else if (e.key==='Tab') {
                  e.preventDefault();
                  const dir=e.shiftKey?-1:1; const cellIndex=td.cellIndex; let targetCol=cellIndex+dir; let targetRow=tr;
                  if (targetCol<1) { const prev=tr.previousElementSibling; if (prev) { targetRow=prev; targetCol=6; } else { return; } }
                  else if (targetCol>6) { const next=tr.nextElementSibling; if (next) { targetRow=next; targetCol=1; } else { return; } }
                  const targetCell=targetRow.children[targetCol]; if (targetCell) { const n=targetCell.querySelector('.cell-title, .cell-editable'); if (n) n.focus(); }
                }
              });
              line.appendChild(title);
              container.appendChild(line);
              return;
            }
            const toShow = showAll ? Math.min(items.length, max) : Math.min(items.length, 3);
            for (let i=0;i<toShow;i++) {
              const it = items[i];
              const line = document.createElement('div'); line.className='cell-line';
              const bullet = document.createElement('div'); bullet.className='cell-bullet'; line.appendChild(bullet);
              const title = document.createElement('div'); title.className='cell-title'; title.setAttribute('contenteditable','true'); title.textContent = it.title || '';
              title.addEventListener('keydown', (e) => {
                const sel = window.getSelection(); const atStart = sel && sel.anchorOffset === 0 && sel.anchorNode && (sel.anchorNode === title || sel.anchorNode.parentElement === title);
                const isEmpty = !title.textContent || title.textContent.replace(/\u200B/g,'').trim() === '';
                if (e.key==='Enter' && !(e.ctrlKey||e.metaKey||e.shiftKey)) {
                  e.preventDefault();
                  if (items.length >= max) { showToast('Limit 8 items'); return; }
                  const ni = newItem('',''); items.splice(i+1,0,ni); window._cellExpand.add(expandedKey); renderLines(true); scheduleSave();
                  setTimeout(()=>{
                    const n=container.querySelectorAll('.cell-title')[i+1];
                    if (n) {
                      n.focus();
                      try {
                        const sel = window.getSelection(); const range = document.createRange();
                        range.selectNodeContents(n); range.collapse(true);
                        sel.removeAllRanges(); sel.addRange(range);
                      } catch {}
                    }
                  },0);
                } else if (e.key==='Backspace' && i>0 && isEmpty) {
                  // Delete empty header line and move caret to end of previous line
                  e.preventDefault();
                  items.splice(i,1);
                  renderLines(showAll); scheduleSave();
                  setTimeout(()=>{
                    const p=container.querySelectorAll('.cell-title')[i-1];
                    if (p) {
                      p.focus();
                      try {
                        const sel2 = window.getSelection(); const range2 = document.createRange();
                        range2.selectNodeContents(p); range2.collapse(false);
                        sel2.removeAllRanges(); sel2.addRange(range2);
                      } catch {}
                    }
                  },0);
                } else if (e.key==='Backspace' && atStart && i>0) {
                  e.preventDefault();
                  const prev = items[i-1]; const cur = items[i];
                  prev.title = (prev.title||'') + (cur.title||''); items.splice(i,1); renderLines(showAll); scheduleSave();
                  setTimeout(()=>{
                    const p=container.querySelectorAll('.cell-title')[i-1];
                    if (p) {
                      p.focus();
                      try {
                        const sel = window.getSelection(); const range = document.createRange();
                        range.selectNodeContents(p); range.collapse(false);
                        sel.removeAllRanges(); sel.addRange(range);
                      } catch {}
                    }
                  },0);
                } else if (e.key==='Tab') {
                  e.preventDefault();
                  const dir = e.shiftKey?-1:1; const cellIndex=td.cellIndex; let targetCol=cellIndex+dir; let targetRow=tr;
                  if (targetCol<1) { const prev=tr.previousElementSibling; if (prev) { targetRow=prev; targetCol=6; } else { return; } }
                  else if (targetCol>6) { const next=tr.nextElementSibling; if (next) { targetRow=next; targetCol=1; } else { return; } }
                  const targetCell=targetRow.children[targetCol]; if (targetCell) { const n=targetCell.querySelector('.cell-title, .cell-editable'); if (n) n.focus(); }
                } else if ((e.key==='Enter') && (e.ctrlKey||e.metaKey)) {
                  e.preventDefault();
                  const cellIndex=td.cellIndex; const nextRow=tr.nextElementSibling; if (nextRow && nextRow.children[cellIndex]) { const n=nextRow.children[cellIndex].querySelector('.cell-title, .cell-editable'); if (n) n.focus(); }
                }
              });
              title.addEventListener('input', () => { it.title = title.textContent || ''; scheduleSave(); });
              line.appendChild(title);
              // Add per-header body icon if body exists
              if ((it.body||'').trim().length>0) {
                const info = document.createElement('button'); info.type='button'; info.className='line-info-btn'; info.textContent='›'; info.title='Show details';
                let panel = null; let persisted = false; let overBtn=false; let overPanel=false;
                const cleanup = () => { if (panel) { panel.remove(); panel=null; } persisted=false; document.removeEventListener('click', onDocClick, true); };
                const onDocClick = (evt) => { if (panel && !panel.contains(evt.target) && evt.target !== info) { cleanup(); } };
                const openPanel = () => {
                  if (panel) return;
                  panel = document.createElement('div'); panel.className='cell-body-panel';
                  const bodyOnly = document.createElement('div'); bodyOnly.className='cell-body-text'; bodyOnly.textContent = it.body || '';
                  panel.appendChild(bodyOnly);
                  document.body.appendChild(panel);
                  const r = info.getBoundingClientRect();
                  requestAnimationFrame(()=>{
                    const pw = panel.offsetWidth || 240; const ph = panel.offsetHeight || 120;
                    const left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
                    const top = Math.min(window.innerHeight - ph - 8, r.bottom + 6);
                    panel.style.left = `${Math.round(left)}px`; panel.style.top = `${Math.round(top)}px`;
                  });
                  panel.addEventListener('mouseenter', ()=>{ overPanel=true; });
                  panel.addEventListener('mouseleave', ()=>{ overPanel=false; if (!persisted && !overBtn) setTimeout(()=>{ if (!persisted && !overBtn && panel) cleanup(); }, 120); });
                };
                info.addEventListener('mouseenter', ()=>{ overBtn=true; if (!persisted) openPanel(); });
                info.addEventListener('mouseleave', ()=>{ overBtn=false; if (!persisted && !overPanel) setTimeout(()=>{ if (!persisted && !overBtn && panel) cleanup(); }, 120); });
                info.addEventListener('click', (e)=>{ e.stopPropagation(); if (!panel) openPanel(); if (!persisted) { persisted=true; document.addEventListener('click', onDocClick, true); } else { cleanup(); } });
                line.appendChild(info);
              }
              container.appendChild(line);
            }
            if (!showAll && items.length>3) {
              const more = document.createElement('div'); more.className='cell-more'; more.textContent = `+${items.length-3}`; more.addEventListener('click', ()=>{ window._cellExpand.add(expandedKey); renderLines(true); }); container.appendChild(more);
            }
            if (showAll && items.length>3) {
              const collapse = document.createElement('div'); collapse.className='cell-collapse'; collapse.textContent='Collapse'; collapse.addEventListener('click', ()=>{ window._cellExpand.delete(expandedKey); renderLines(false); }); container.appendChild(collapse);
            }
          };
          renderLines(isExpanded);
          
          // Apply saved background color if present
          const colorField = `col${letter}Color`;
          const bg = data[colorField] || null;
          if (bg) td.style.background = bg;

          // Add subtle color button (top-right of cell) if enabled
          if (showCellColor) {
            const colorBtn = document.createElement('button');
            colorBtn.type = 'button';
            colorBtn.className = 'cell-color-btn';
            colorBtn.title = 'Cell color';
            colorBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              // Close any existing panel
              const existing = document.querySelector('.color-panel');
              if (existing) existing.remove();
              const panel = document.createElement('div');
              panel.className = 'color-panel';
              // None (clear) option
              const none = document.createElement('div');
              none.className = 'color-swatch none';
              none.title = 'None';
              none.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                try {
                  const update = {}; update[colorField] = null;
                  await updateDoc(doc(db, 'cases', d.id), update);
                  td.style.background = '';
                } catch (err) { console.error('Failed to clear color', err); showToast('Failed to update color'); }
                panel.remove();
              });
              panel.appendChild(none);
              // Color swatches
              for (const col of CELL_COLORS) {
                const sw = document.createElement('div');
                sw.className = 'color-swatch';
                sw.style.background = col;
                sw.title = col;
                sw.addEventListener('click', async (ev) => {
                  ev.stopPropagation();
                  try {
                    const update = {}; update[colorField] = col;
                    await updateDoc(doc(db, 'cases', d.id), update);
                    td.style.background = col; // optimistic
                  } catch (err) { console.error('Failed to set color', err); showToast('Failed to update color'); }
                  panel.remove();
                });
                panel.appendChild(sw);
              }
              document.body.appendChild(panel);
              // Position panel near button
              const r = colorBtn.getBoundingClientRect();
              requestAnimationFrame(() => {
                const pw = panel.offsetWidth || 180;
                const ph = panel.offsetHeight || 120;
                const left = Math.min(Math.max(8, r.right - pw), window.innerWidth - pw - 8);
                const top = Math.min(window.innerHeight - ph - 8, r.bottom + 6);
                panel.style.left = `${Math.round(left)}px`;
                panel.style.top = `${Math.round(top)}px`;
              });
              const onDocClick = (evt) => { if (!panel.contains(evt.target) && evt.target !== colorBtn) { panel.remove(); document.removeEventListener('click', onDocClick, true); } };
              setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
            });
            td.appendChild(colorBtn);
          }
          // Per-line info icons handle body previews; remove old cell-level info button
          td.appendChild(container);
        }
        tr.appendChild(td);
      }
      if (renderAsDischarged) {
        dischargedTbody.appendChild(tr);
        dischargedVisibleCases += 1;
      } else {
        tbody.appendChild(tr);
        visibleCases += 1;
      }
    }
    updateDashboardStats({ visibleCases });
    // Atomically replace table to prevent duplicated DOM
    tableRoot.innerHTML = '';
    tableRoot.appendChild(table);
    attachTableKeyboardNavigation(table);

    // Footer new case button at bottom of table
    const footer = document.createElement('div'); footer.className='new-case-footer';
    const addBtn = document.createElement('button'); addBtn.type='button'; addBtn.className='btn primary'; addBtn.textContent='➕ New Case'; addBtn.addEventListener('click', openNewCaseModal);
    footer.appendChild(addBtn);
    tableRoot.appendChild(footer);

    if (pendingDischargeCaseIds.size) {
      const pendingBanner = document.createElement('div');
      pendingBanner.className = 'pending-discharge-banner';
      const count = pendingDischargeCaseIds.size;
      pendingBanner.textContent = `${count} case${count === 1 ? '' : 's'} marked for discharge. Refresh or navigate away to move to discharged list.`;
      tableRoot.appendChild(pendingBanner);
    }

    const dischargedSection = document.createElement('section');
    dischargedSection.className = 'discharged-table-section';
    const dischargedHeader = document.createElement('div');
    dischargedHeader.className = 'discharged-table-header';
    const dischargedToggle = document.createElement('button');
    dischargedToggle.type = 'button';
    dischargedToggle.className = 'icon-btn small';
    dischargedToggle.textContent = `${showDischargedCases ? 'Hide' : 'Show'} discharged cases (${dischargedVisibleCases})`;
    dischargedToggle.addEventListener('click', () => {
      showDischargedCases = !showDischargedCases;
      try { localStorage.setItem('table.showDischargedCases', showDischargedCases ? '1' : '0'); } catch {}
      if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
    });
    dischargedHeader.appendChild(dischargedToggle);
    dischargedSection.appendChild(dischargedHeader);
    if (showDischargedCases) {
      if (dischargedVisibleCases > 0) {
        dischargedSection.appendChild(dischargedTable);
        attachTableKeyboardNavigation(dischargedTable);
      } else {
        const empty = document.createElement('div');
        empty.className = 'discharged-empty';
        empty.textContent = 'No discharged cases in this view.';
        dischargedSection.appendChild(empty);
      }
    }
    tableRoot.appendChild(dischargedSection);

    // Clean up per-case task listeners for rows no longer present
    for (const [cid, un] of Array.from(tableTaskUnsubs.entries())) {
      if (!presentTaskListeners.has(cid)) {
        try { un(); } catch {}
        tableTaskUnsubs.delete(cid);
      }
    }
  };
  unsubTable = onSnapshot(q, (snap) => {
    lastCasesDocs = snap.docs;
    if (renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
    try { document.dispatchEvent(new CustomEvent('filters:updated')); } catch {}
  }, (err) => console.error('Table listener error', err));
}

// --- Modern table filter UI (pills, popovers, counts, segmented sort)
function setupTableFilterUI() {
  const bar = document.getElementById('table-tags-controls');
  if (!bar) return;
  // Clear and rebuild with new controls while keeping legacy selects hidden for fallback
  bar.innerHTML = '';
  const left = document.createElement('div'); left.className = 'left';
  const right = document.createElement('div'); right.className = 'right';
  bar.appendChild(left); bar.appendChild(right);

  // Active chips area
  const chipsWrap = document.createElement('div'); chipsWrap.className = 'filter-chips'; left.appendChild(chipsWrap);
  // Section label for filters
  const filtersLabel = document.createElement('span'); filtersLabel.className = 'section-label'; filtersLabel.textContent = 'Filters'; left.appendChild(filtersLabel);

  // Pills
  const pillsWrap = document.createElement('div'); pillsWrap.className = 'pills-wrap'; left.appendChild(pillsWrap);
  const locPill = document.createElement('button'); locPill.type='button'; locPill.className='filter-pill'; locPill.setAttribute('aria-haspopup','listbox'); locPill.setAttribute('aria-expanded','false'); locPill.textContent='Location'; const lc=document.createElement('span'); lc.className='count'; lc.textContent=''; locPill.appendChild(lc); pillsWrap.appendChild(locPill);
  const roomPill = document.createElement('button'); roomPill.type='button'; roomPill.className='filter-pill'; roomPill.setAttribute('aria-haspopup','listbox'); roomPill.setAttribute('aria-expanded','false'); roomPill.textContent='Room'; const rc=document.createElement('span'); rc.className='count'; rc.textContent=''; roomPill.appendChild(rc); pillsWrap.appendChild(roomPill);
  const consPill = document.createElement('button'); consPill.type='button'; consPill.className='filter-pill'; consPill.setAttribute('aria-haspopup','listbox'); consPill.setAttribute('aria-expanded','false'); consPill.textContent='Consultant'; const cc=document.createElement('span'); cc.className='count'; cc.textContent=''; consPill.appendChild(cc); pillsWrap.appendChild(consPill);
  const mobileBtn = document.createElement('button'); mobileBtn.type='button'; mobileBtn.className='mobile-filters-btn'; mobileBtn.textContent='Filters'; right.appendChild(mobileBtn);

  // Segmented sort and clear
  const sortLabel = document.createElement('span'); sortLabel.className = 'section-label'; sortLabel.textContent = 'Sort'; right.appendChild(sortLabel);
  const seg = document.createElement('div'); seg.className='segmented';
  const mkSegBtn = (label, key) => { const b=document.createElement('button'); b.type='button'; b.textContent=label; b.dataset.key=key; b.addEventListener('click',()=>{ activeTagSort = key; saveTagFilterState(); updateSegmented(); if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs); }); return b; };
  const segNone = mkSegBtn('None','none');
  const segLoc = mkSegBtn('Location','location');
  const segRoom = mkSegBtn('Room','room');
  const segCons = mkSegBtn('Consultant','consultant');
  seg.appendChild(segNone); const s1=document.createElement('div'); s1.className='sep'; seg.appendChild(s1); seg.appendChild(segLoc); const s2=document.createElement('div'); s2.className='sep'; seg.appendChild(s2); seg.appendChild(segRoom); const s3=document.createElement('div'); s3.className='sep'; seg.appendChild(s3); seg.appendChild(segCons);
  const dirBtn = document.createElement('button'); dirBtn.type='button'; dirBtn.className='sort-dir'; dirBtn.textContent='↑'; dirBtn.title='Toggle sort direction'; dirBtn.addEventListener('click', ()=>{ activeTagSortDir = activeTagSortDir==='asc'?'desc':'asc'; dirBtn.textContent = activeTagSortDir==='asc'?'↑':'↓'; saveTagFilterState(); if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs); });
  const clearBtn = document.createElement('button'); clearBtn.type='button'; clearBtn.className='icon-btn small'; clearBtn.textContent='Clear'; clearBtn.addEventListener('click', ()=>{ activeTagFilters.location.clear(); activeTagFilters.consultant.clear(); activeTagFilters.room.clear(); saveTagFilterState(); updateFilterPills(); if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs); });
  const hideBtn = document.createElement('button'); hideBtn.type='button'; hideBtn.className='icon-btn small'; hideBtn.textContent='Hide'; hideBtn.addEventListener('click', ()=>{ setTableFiltersHidden(true); });
  right.appendChild(seg); right.appendChild(dirBtn); right.appendChild(clearBtn); right.appendChild(hideBtn);

  // Cell color toggle (buried in filters menu)
  const colorWrap = document.createElement('label');
  colorWrap.className = 'ctrl';
  colorWrap.style.display = 'inline-flex';
  colorWrap.style.alignItems = 'center';
  colorWrap.style.gap = '6px';
  const colorChk = document.createElement('input'); colorChk.type = 'checkbox';
  const colorText = document.createElement('span'); colorText.textContent = 'Cell colors'; colorText.className = 'section-label';
  // Load persisted preference
  try { showCellColor = (localStorage.getItem('table.showCellColor') ?? '1') !== '0'; } catch { showCellColor = true; }
  colorChk.checked = !!showCellColor;
  setCellColorEnabled(showCellColor);
  colorChk.addEventListener('change', () => { setCellColorEnabled(colorChk.checked); });
  colorWrap.appendChild(colorChk); colorWrap.appendChild(colorText);
  right.insertBefore(colorWrap, clearBtn);

  // Helper: render active chips and counts on pills
  function renderActiveChips() {
    chipsWrap.innerHTML = '';
    const addChip = (type, id, name) => {
      const chip = document.createElement('span'); chip.className='filter-chip';
      const t = document.createElement('span'); t.textContent = name; chip.appendChild(t);
      const x = document.createElement('span'); x.className='x'; x.textContent='✕'; x.setAttribute('role','button'); x.setAttribute('tabindex','0');
      const remove = () => { const set=activeTagFilters[type]; set.delete(id); saveTagFilterState(); updateFilterPills(); if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs); };
      x.addEventListener('click', remove); x.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); remove(); } });
      chip.appendChild(x);
      chipsWrap.appendChild(chip);
    };
    const addChipsFor = (type, list) => { for (const id of activeTagFilters[type]) { const it = list.find(t=>t.id===id); if (it) addChip(type, id, it.name); } };
    addChipsFor('location', tagsByType.get('location') || []);
    addChipsFor('consultant', tagsByType.get('consultant') || []);
    // Room chips: need selected location context; approximate by searching all subtags
    for (const id of activeTagFilters.room) {
      let name = 'Room';
      for (const [parent, arr] of subtagsByParent.entries()) { const f = (arr||[]).find(t=>t.id===id); if (f) { name = f.name; break; } }
      addChip('room', id, name);
    }
  }

  function updateSegmented() {
    [segNone, segLoc, segRoom, segCons].forEach(btn => btn.classList.toggle('active', btn.dataset.key === (activeTagSort||'none')));
    dirBtn.style.display = (activeTagSort && activeTagSort !== 'none') ? '' : 'none';
    dirBtn.textContent = activeTagSortDir==='asc' ? '↑' : '↓';
  }

  // Track current popover for toggle behavior
  let activePopoverAnchor = null;
  function togglePopover(anchorBtn, type) {
    const existing = document.querySelector('.filter-popover');
    const isOpenOnThis = existing && activePopoverAnchor === anchorBtn;
    if (isOpenOnThis) {
      existing.remove();
      anchorBtn.setAttribute('aria-expanded','false');
      activePopoverAnchor = null;
      return;
    }
    openPopover(anchorBtn, type);
  }
  // Popover builder
  function openPopover(anchorBtn, type) {
    if (anchorBtn.getAttribute('aria-disabled') === 'true') return;
    // Close any existing
    const existing = document.querySelector('.filter-popover'); if (existing) existing.remove();
    const pop = document.createElement('div'); pop.className='filter-popover'; pop.setAttribute('role','listbox');
    const search = document.createElement('input'); search.className='search'; search.type='search'; search.placeholder='Search…'; pop.appendChild(search);
    const list = document.createElement('div'); list.className='list'; pop.appendChild(list);
    document.body.appendChild(pop);
    const rect = anchorBtn.getBoundingClientRect(); requestAnimationFrame(()=>{ const left=Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left); const top=Math.min(window.innerHeight - pop.offsetHeight - 8, rect.bottom + 6); pop.style.left=`${Math.max(8,left)}px`; pop.style.top=`${Math.max(8,top)}px`; });

    const set = activeTagFilters[type];
    const options = [];
    if (type === 'room') {
      // Only when exactly one location selected
      const locIds = Array.from(activeTagFilters.location);
      const parent = locIds.length === 1 ? locIds[0] : null;
      const rooms = parent ? (subtagsByParent.get(parent) || []) : [];
      for (const r of rooms) options.push({ id: r.id, name: r.name, count: countCasesBy({ room: r.id }) });
    } else {
      const base = tagsByType.get(type) || [];
      for (const t of base) options.push({ id: t.id, name: t.name, count: countCasesBy({ [type]: t.id }) });
    }

    const renderList = () => {
      const q = (search.value||'').toLowerCase();
      list.innerHTML='';
      for (const opt of options) {
        if (q && !opt.name.toLowerCase().includes(q)) continue;
        const row = document.createElement('div'); row.className='opt'; row.setAttribute('role','option'); row.setAttribute('aria-selected', String(set.has(opt.id)));
        const label = document.createElement('div'); label.className='label';
        const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = set.has(opt.id); label.appendChild(cb);
        const txt = document.createElement('span'); txt.textContent = opt.name; label.appendChild(txt);
        const cnt = document.createElement('div'); cnt.className='opt-count'; cnt.textContent = String(opt.count);
        row.appendChild(label); row.appendChild(cnt);
        row.addEventListener('click', () => { if (set.has(opt.id)) set.delete(opt.id); else set.add(opt.id); row.setAttribute('aria-selected', String(set.has(opt.id))); cb.checked = set.has(opt.id); saveTagFilterState(); updateFilterPills(); if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs); });
        list.appendChild(row);
      }
    };
    renderList();
    search.addEventListener('input', () => { clearTimeout(search._t); search._t = setTimeout(renderList, 120); });

    // Outside click to close
    const onDocClick = (e) => { if (!pop.contains(e.target) && e.target !== anchorBtn) { pop.remove(); document.removeEventListener('click', onDocClick, true); anchorBtn.setAttribute('aria-expanded','false'); activePopoverAnchor = null; } };
    setTimeout(()=> document.addEventListener('click', onDocClick, true), 0);
    anchorBtn.setAttribute('aria-expanded','true');
    activePopoverAnchor = anchorBtn;
    search.focus();
  }

  function countCasesBy(match) {
    if (!Array.isArray(lastCasesDocs)) return 0;
    let n = 0; for (const d of lastCasesDocs) { const ct = (d.data().caseTags||{}); let ok = true; for (const k in match) { if (!ct[k] || ct[k] !== match[k]) { ok=false; break; } } if (ok) n++; }
    return n;
  }

  function updateFilterPills() {
    // Counts: show number of selections on each pill
    lc.textContent = activeTagFilters.location.size ? ` (${activeTagFilters.location.size})` : '';
    cc.textContent = activeTagFilters.consultant.size ? ` (${activeTagFilters.consultant.size})` : '';
    rc.textContent = activeTagFilters.room.size ? ` (${activeTagFilters.room.size})` : '';
    // Room pill enabled only when exactly one location selected
    const enableRoom = activeTagFilters.location.size === 1;
    roomPill.setAttribute('aria-disabled', enableRoom ? 'false' : 'true');
    renderActiveChips();
  }

  // Wire pills
  locPill.addEventListener('click', () => togglePopover(locPill, 'location'));
  consPill.addEventListener('click', () => togglePopover(consPill, 'consultant'));
  roomPill.addEventListener('click', () => togglePopover(roomPill, 'room'));

  updateSegmented();
  updateFilterPills();
  document.addEventListener('tags:updated', updateFilterPills);
  document.addEventListener('filters:updated', updateFilterPills);

  // Mobile bottom sheet
  function openFiltersSheet() {
    const overlay = document.createElement('div'); overlay.className='sheet-overlay';
    const sheet = document.createElement('div'); sheet.className='sheet'; overlay.appendChild(sheet);
    const addSection = (title) => { const s=document.createElement('div'); s.className='section'; const h=document.createElement('h4'); h.textContent=title; s.appendChild(h); sheet.appendChild(s); return s; };
    const sLoc = addSection('Location'); const sRoom = addSection('Room'); const sCons = addSection('Consultant');
    const sSort = addSection('Sort');
    // Lists
    const addList = (container, type, items) => { const list=document.createElement('div'); list.className='list'; container.appendChild(list); for (const it of items) { const row=document.createElement('div'); row.className='opt'; const lbl=document.createElement('label'); lbl.className='label'; const cb=document.createElement('input'); cb.type='checkbox'; cb.checked = activeTagFilters[type].has(it.id); const sp=document.createElement('span'); sp.textContent=it.name; lbl.appendChild(cb); lbl.appendChild(sp); const cnt=document.createElement('div'); cnt.className='opt-count'; cnt.textContent=String(it.count); row.appendChild(lbl); row.appendChild(cnt); row.addEventListener('click',()=>{ cb.checked=!cb.checked; if (cb.checked) activeTagFilters[type].add(it.id); else activeTagFilters[type].delete(it.id); }); list.appendChild(row); } };
    const locItems = (tagsByType.get('location')||[]).map(t=>({ id:t.id, name:t.name, count: countCasesBy({ location: t.id }) }));
    addList(sLoc, 'location', locItems);
    const locIds = Array.from(activeTagFilters.location); const parent = locIds.length===1?locIds[0]:null; const rooms = parent ? (subtagsByParent.get(parent) || []) : [];
    const roomItems = rooms.map(r=>({ id:r.id, name:r.name, count: countCasesBy({ room: r.id }) }));
    addList(sRoom, 'room', roomItems);
    const consItems = (tagsByType.get('consultant')||[]).map(t=>({ id:t.id, name:t.name, count: countCasesBy({ consultant: t.id }) }));
    addList(sCons, 'consultant', consItems);
    // Sort controls
    const sortWrap = document.createElement('div'); sortWrap.className='segmented'; const mk = (l,k)=>{ const b=document.createElement('button'); b.type='button'; b.textContent=l; b.classList.toggle('active', (activeTagSort||'none')===k); b.addEventListener('click',()=>{ activeTagSort=k; updateSeg(); }); return b; };
    const updateSeg = () => { saveTagFilterState(); };
    sortWrap.appendChild(mk('None','none')); const sA=document.createElement('div'); sA.className='sep'; sortWrap.appendChild(sA); sortWrap.appendChild(mk('Location','location')); const sB=document.createElement('div'); sB.className='sep'; sortWrap.appendChild(sB); sortWrap.appendChild(mk('Room','room')); const sC=document.createElement('div'); sC.className='sep'; sortWrap.appendChild(sC); sortWrap.appendChild(mk('Consultant','consultant'));
    sSort.appendChild(sortWrap);
    const actions = document.createElement('div'); actions.className='actions';
    const clear=document.createElement('button'); clear.className='btn'; clear.textContent='Clear'; clear.addEventListener('click',()=>{ activeTagFilters.location.clear(); activeTagFilters.room.clear(); activeTagFilters.consultant.clear(); });
    const apply=document.createElement('button'); apply.className='btn primary'; apply.textContent='Apply'; apply.addEventListener('click',()=>{ saveTagFilterState(); updateFilterPills(); if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs); overlay.remove(); });
    const create=document.createElement('button'); create.className='btn primary'; create.textContent='New Case'; create.addEventListener('click',()=>{ overlay.remove(); openNewCaseModal(); });
    actions.appendChild(clear); actions.appendChild(apply); actions.appendChild(create); sheet.appendChild(actions);
    overlay.addEventListener('click',(e)=>{ if (e.target===overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  mobileBtn.addEventListener('click', openFiltersSheet);
}

// Attach realtime compact tasks list to a UL
function attachTasksListRealtime(caseId, ul, opts = {}) {
  const q = query(collection(db, 'cases', caseId, 'tasks'), orderBy('createdAt', 'desc'));
  let taskOrder = null;
  let taskRebuildPending = false;
  let pendingItems = null;

  const renderItems = (items) => {
    if (!ul) return;
    ul.innerHTML = '';
    for (const it of items) ul.appendChild(buildCompactTaskRow(caseId, it, { ...opts, _onEditStart, _onEditEnd }));
  };

  const _onEditStart = () => { ul.dataset.editing = '1'; };
  const _onEditEnd = () => {
    delete ul.dataset.editing;
    if (taskRebuildPending && pendingItems) {
      const items = pendingItems; pendingItems = null; taskRebuildPending = false;
      renderItems(items);
    }
  };

  const unsub = onSnapshot(q, async (snap) => {
    if (!ul) return;
    const items = [];
    for (const d of snap.docs) {
      const dat = d.data();
      try {
        const text = await decryptText(dat.textCipher, dat.textIv);
        const status = await decryptText(dat.statusCipher, dat.statusIv);
        const createdAt = (dat.createdAt && dat.createdAt.toMillis) ? dat.createdAt.toMillis() : 0;
        items.push({ id: d.id, text, status, data: dat, createdAt });
      } catch {}
    }
    if (!taskOrder) {
      const orderVal = (s) => s === 'open' ? 0 : (s === 'in progress' ? 1 : 2);
      const init = [...items].sort((a,b) => {
        const byStatus = orderVal(a.status) - orderVal(b.status);
        if (byStatus !== 0) return byStatus;
        return b.createdAt - a.createdAt;
      });
      taskOrder = init.map(i => i.id);
    } else {
      for (const i of items) if (!taskOrder.includes(i.id)) taskOrder.unshift(i.id);
    }
    const idx = new Map(taskOrder.map((id,i)=>[id,i]));
    items.sort((a,b) => (idx.get(a.id) ?? 999999) - (idx.get(b.id) ?? 999999));

    // If an edit is in progress, defer the rebuild
    if (ul.dataset.editing === '1') {
      pendingItems = items; taskRebuildPending = true; return;
    }
    renderItems(items);
  }, (err) => console.error('Tasks cell listener error', err));
  return () => { try { unsub(); } catch {} };
}

function buildCompactTaskRow(caseId, it, opts = {}) {
  const readOnly = !!opts.readOnly;
  const data = it.data || {};
  const assignmentState = normalizeTaskAssignmentState(data);
  const pendingAcceptance = isTaskPendingAcceptance(data);
  const pendingForMe = pendingAcceptance && (data.assignee || '') === (username || '');
  const li = document.createElement('li');
  const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
  li.className = 'case-task ' + statusCls + (pendingAcceptance ? ' task-pending-acceptance' : '');
  // Status toggle
  const statusBtn = document.createElement('button'); statusBtn.type='button'; statusBtn.className='status-btn';
  const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  statusBtn.textContent = icon(it.status);
  statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
  statusBtn.disabled = readOnly || pendingAcceptance;
  if (statusBtn.disabled) statusBtn.title = pendingAcceptance ? 'Awaiting acceptance' : 'Read-only';
  statusBtn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if (statusBtn.disabled) return;
    const order = ['open','in progress','complete'];
    const next = order[(order.indexOf(it.status)+1)%order.length];
    try { const { cipher, iv } = await encryptText(next); await updateDoc(doc(db,'cases',caseId,'tasks',it.id),{ statusCipher:cipher, statusIv:iv }); it.status=next; statusBtn.textContent=icon(next); statusBtn.setAttribute('aria-label',`Task status: ${next}`); li.className='case-task '+(next==='in progress'?'s-inprogress':(next==='complete'?'s-complete':'s-open')) + (pendingAcceptance ? ' task-pending-acceptance' : ''); if (next==='complete') { try { const tEnc = await encryptText(it.text || ''); await logUpdate({ type: 'task_completed', caseId, caseTitle: (opts && opts.caseTitle) || 'Case', taskId: it.id, taskTextCipher: tEnc.cipher, taskTextIv: tEnc.iv }); } catch {} } } catch(err){ console.error('Failed to update status',err); showToast('Failed to update status'); }
  });
  const text = document.createElement('span'); text.className='task-text'; text.textContent = it.text;
  // Inline edit behavior: click to turn into a contenteditable field
  text.addEventListener('click', (e) => {
    if (readOnly) return;
    e.stopPropagation();
    if (typeof opts._onEditStart === 'function') opts._onEditStart();
    const ed = document.createElement('div');
    ed.className = 'cell-editable';
    ed.setAttribute('contenteditable', 'true');
    ed.style.minWidth = '120px';
    ed.textContent = it.text;
    let last = it.text;
    const saveNow = async () => {
      const v = (ed.innerText || '').replace(/\r/g, '');
      if (v === last) { cancel(); return; }
      try {
        const { cipher: textCipher, iv: textIv } = await encryptText(v);
        await updateDoc(doc(db, 'cases', caseId, 'tasks', it.id), { textCipher, textIv });
        last = v; it.text = v; text.textContent = v;
        cleanup();
      } catch (err) { console.error('Failed to update task text', err); showToast('Failed to update task'); cleanup(); }
    };
    const cancel = () => { cleanup(); };
    const cleanup = () => {
      try { ed.remove(); } catch {}
      text.style.display = '';
      if (typeof opts._onEditEnd === 'function') opts._onEditEnd();
    };
    ed.addEventListener('paste', (ev) => { ev.preventDefault(); const t=(ev.clipboardData||window.clipboardData).getData('text'); if (document.queryCommandSupported && document.queryCommandSupported('insertText')) { document.execCommand('insertText', false, t); } else { const sel=window.getSelection(); if (sel && sel.rangeCount) { sel.deleteFromDocument(); sel.getRangeAt(0).insertNode(document.createTextNode(t)); } } });
    ed.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !(ev.ctrlKey||ev.metaKey)) { ev.preventDefault(); saveNow(); } else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); } });
    ed.addEventListener('blur', () => { saveNow(); });
    text.insertAdjacentElement('afterend', ed);
    text.style.display = 'none';
    ed.focus();
    placeCaretAtEnd(ed);
  });
  li.appendChild(statusBtn); li.appendChild(text);
  if (data && data.priority) {
    if (opts.compact) {
      const pri=document.createElement('span'); pri.style.fontSize='11px'; pri.style.color='#6b7280'; pri.title='Priority';
      const p = (data.priority||'').toLowerCase();
      pri.textContent = p === 'high' ? 'H' : p === 'medium' ? 'M' : p === 'low' ? 'L' : '';
      if (pri.textContent) li.appendChild(pri);
    } else {
      const pri=document.createElement('span'); pri.className='mini-chip'; pri.textContent=data.priority; li.appendChild(pri);
    }
  }
  const assignmentLabel = taskAssignmentStatusLabel(data);
  if (assignmentLabel) {
    const assignmentChip = document.createElement('span');
    assignmentChip.className = `assignment-state-chip ${pendingAcceptance ? 'pending' : 'open'}`;
    assignmentChip.textContent = assignmentLabel;
    li.appendChild(assignmentChip);
  }

  if (pendingForMe && !readOnly) {
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'icon-btn small';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await acceptTaskAssignment(caseId, it.id, { caseTitle: opts.caseTitle, taskText: it.text });
        showToast('Task accepted');
      } catch (err) {
        console.error('Failed to accept task', err);
        showToast('Failed to accept task');
      }
    });
    const declineBtn = document.createElement('button');
    declineBtn.type = 'button';
    declineBtn.className = 'icon-btn small';
    declineBtn.textContent = 'Decline';
    declineBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await declineTaskAssignment(caseId, it.id, { caseTitle: opts.caseTitle, taskText: it.text });
        showToast('Task returned to open');
      } catch (err) {
        console.error('Failed to decline task', err);
        showToast('Failed to decline task');
      }
    });
    li.appendChild(acceptBtn);
    li.appendChild(declineBtn);
  }

  const av=document.createElement('span'); av.className='mini-avatar'; const initials = data && data.assignee ? data.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase() : ''; av.textContent=initials||''; const col=colorForName((data && data.assignee)||''); av.style.background=col.bg; av.style.color=col.color; av.style.border=`1px solid ${col.border}`;
  if (!readOnly) {
    av.addEventListener('click',(e)=>{
      e.stopPropagation();
      const existing=document.querySelector('.assignee-panel');
      if(existing) existing.remove();
      const panel=document.createElement('div');
      panel.className='assignee-panel';
      panel.style.position='fixed';
      panel.style.zIndex='2147483646';
      const addOpt=(label,value)=>{
        const b=document.createElement('button');
        b.type='button';
        b.className='assignee-option';
        b.textContent=label;
        b.addEventListener('click', async (ev)=>{
          ev.stopPropagation();
          try {
            await updateTaskAssignment(caseId, it.id, value, { caseTitle: opts.caseTitle, taskText: it.text });
          } catch(err){
            console.error('Failed to reassign',err);
            showToast('Failed to update assignee');
          } finally {
            panel.remove();
          }
        });
        panel.appendChild(b);
      };
      addOpt('Open task', null);
      for (const u of usersCache) addOpt(u.username, u.username);
      document.body.appendChild(panel);
      const r=av.getBoundingClientRect();
      requestAnimationFrame(()=>{
        const w=panel.offsetWidth||160;
        const left=Math.min(Math.max(8, r.right-w), window.innerWidth - w - 8);
        const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6);
        panel.style.left=`${Math.round(left)}px`;
        panel.style.top=`${Math.round(top)}px`;
      });
      const onDocClick=(evt)=>{ if(!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); };
      setTimeout(()=>document.addEventListener('click', onDocClick, true),0);
    });
  }
  // Delete button
  const del = document.createElement('button'); del.type='button'; del.className='icon-btn delete-btn'; del.textContent='🗑'; del.title='Delete task';
  del.hidden = readOnly;
  del.addEventListener('click', async (e) => { e.stopPropagation(); if (!confirm('Delete this task?')) return; try { await deleteDoc(doc(db, 'cases', caseId, 'tasks', it.id)); } catch (err) { console.error('Failed to delete task', err); showToast('Failed to delete task'); } });
  li.appendChild(av);
  if (!readOnly) li.appendChild(del);
  return li;
}

// --- Inline tag editor for a case
function openTagPanelForCase(caseId, anchorTd) {
  const panel = document.createElement('div'); panel.className='tag-panel';
  const title = document.createElement('h4'); title.textContent = 'Edit tags'; panel.appendChild(title);
  const row = document.createElement('div'); row.className='row'; panel.appendChild(row);
  // Location select
  const locWrap = document.createElement('div'); locWrap.style.display='flex'; locWrap.style.gap='6px';
  const locSel = document.createElement('select');
  const addOpts = (sel, items, includeUnassigned=true) => {
    sel.innerHTML = '';
    if (includeUnassigned) { const o=document.createElement('option'); o.value=''; o.textContent='Unassigned'; sel.appendChild(o);} 
    for (const t of items) { const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o);} 
  };
  addOpts(locSel, tagsByType.get('location') || []);
  const addWard = document.createElement('button'); addWard.type='button'; addWard.textContent='+'; addWard.className='icon-btn small';
  addWard.title='Add ward'; addWard.addEventListener('click', async ()=>{ await addTag('location'); });
  locWrap.appendChild(locSel); locWrap.appendChild(addWard); row.appendChild(locWrap);
  // Room select (depends on location)
  const roomWrap = document.createElement('div'); roomWrap.style.display='flex'; roomWrap.style.gap='6px';
  const roomSel = document.createElement('select');
  addOpts(roomSel, [], true);
  const addRoomBtn = document.createElement('button'); addRoomBtn.type='button'; addRoomBtn.textContent='+'; addRoomBtn.className='icon-btn small'; addRoomBtn.title='Add room';
  addRoomBtn.addEventListener('click', async ()=>{ const loc=locSel.value||''; if (!loc) { showToast('Pick a ward first'); return; } await addRoom(loc); });
  roomWrap.appendChild(roomSel); roomWrap.appendChild(addRoomBtn); row.appendChild(roomWrap);
  // Consultant select
  const consWrap = document.createElement('div'); consWrap.style.display='flex'; consWrap.style.gap='6px';
  const consSel = document.createElement('select');
  addOpts(consSel, tagsByType.get('consultant') || []);
  const addCons = document.createElement('button'); addCons.type='button'; addCons.textContent='+'; addCons.className='icon-btn small'; addCons.title='Add consultant';
  addCons.addEventListener('click', async ()=>{ await addTag('consultant'); });
  consWrap.appendChild(consSel); consWrap.appendChild(addCons); row.appendChild(consWrap);
  const actions = document.createElement('div'); actions.className='actions'; panel.appendChild(actions);
  const cancel = document.createElement('button'); cancel.className='icon-btn small'; cancel.textContent='Cancel'; actions.appendChild(cancel);
  const save = document.createElement('button'); save.className='icon-btn small'; save.textContent='Save'; actions.appendChild(save);

  // Prefill current values
  (async () => {
    const ref = doc(db,'cases',caseId); const snap = await getDoc(ref);
    const ct = (snap.exists() && snap.data().caseTags) || {};
    if (ct.location) locSel.value = ct.location; else locSel.value = '';
    await refreshRooms(); if (ct.room) roomSel.value = ct.room; else roomSel.value='';
    if (ct.consultant) consSel.value = ct.consultant; else consSel.value='';
  })();

  async function refreshRooms() {
    const loc = locSel.value || null;
    if (loc) { const rooms = await loadSubtagsFor(loc); addOpts(roomSel, rooms, true); } else { addOpts(roomSel, [], true); }
  }
  locSel.addEventListener('change', async ()=>{ await refreshRooms(); roomSel.value=''; });

  // Keep location options in sync if tags change while editor is open
  const onTagsUpdated = () => {
    const prev = locSel.value || '';
    addOpts(locSel, tagsByType.get('location') || []);
    // Restore previous selection if still present
    try { if (prev && Array.from(locSel.options).some(o => o.value === prev)) locSel.value = prev; } catch {}
  };
  document.addEventListener('tags:updated', onTagsUpdated);

  const cleanupPanel = () => {
    panel.remove();
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('tags:updated', onTagsUpdated);
  };

  cancel.addEventListener('click', cleanupPanel);
  save.addEventListener('click', async ()=>{
    try {
      const loc = locSel.value || null; const room = roomSel.value || null; const cons = consSel.value || null;
      const ct = { location: loc, consultant: cons };
      if (loc && room) ct.room = room; else ct.room = null;
      await updateDoc(doc(db,'cases',caseId), { caseTags: ct });
      cleanupPanel();
    } catch (err) { console.error('Failed to update tags', err); showToast('Failed to update tags'); }
  });

  document.body.appendChild(panel);
  const r = anchorTd.getBoundingClientRect(); requestAnimationFrame(()=>{
    const left = Math.min(window.innerWidth - panel.offsetWidth - 8, r.left);
    const top = Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6);
    panel.style.left = `${Math.max(8,left)}px`; panel.style.top = `${Math.max(8,top)}px`;
  });
  const onDocClick = (e)=>{ if (!panel || panel.contains(e.target)) return; cleanupPanel(); };
  setTimeout(()=>document.addEventListener('click', onDocClick, true),0);
}

function bindNotesFields() {
  const map = [
    { el: colAInput, L: 'A' },
    { el: colBInput, L: 'B' },
    { el: colCInput, L: 'C' },
    { el: colDInput, L: 'D' },
    { el: colEInput, L: 'E' },
    { el: colFInput, L: 'F' },
  ];
  for (const { el, L } of map) {
    if (!el) continue;
    el.addEventListener('blur', () => { if (currentCaseId != null) saveCaseColumn(currentCaseId, L, el.value); });
  }
  const bodyMap = [
    { el: colABody, L: 'A' },
    { el: colBBody, L: 'B' },
    { el: colCBody, L: 'C' },
    { el: colDBody, L: 'D' },
    { el: colEBody, L: 'E' },
  ];
  for (const { el, L } of bodyMap) {
    if (!el) continue;
    el.addEventListener('blur', () => { if (currentCaseId != null) saveCaseColumnBody(currentCaseId, L, el.value); });
  }
}

function startRealtimeCaseFields(caseId) {
  if (unsubCaseDoc) { unsubCaseDoc(); unsubCaseDoc = null; }
  const ref = doc(db, 'cases', caseId);
  unsubCaseDoc = onSnapshot(ref, async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    // Render tag chips under the title
    try {
      const chipsWrap = document.getElementById('case-tag-chips');
      if (chipsWrap) {
        chipsWrap.innerHTML = '';
        const ct = data.caseTags || {};
        const mkChip = (type, id) => {
          if (!id) return;
          const list = type === 'room' ? (subtagsByParent.get(ct.location) || []) : (tagsByType.get(type) || []);
          const tag = list.find(t => t.id === id);
          if (!tag) return;
          const chip = document.createElement('span'); chip.className='tag-chip'; chip.setAttribute('role','button'); chip.setAttribute('tabindex','0');
          const t = document.createElement('span'); t.textContent = tag.name; chip.appendChild(t);
          const openEditor = () => { const anchor = caseTitleEl || chipsWrap; openTagPanelForCase(caseId, anchor); };
          chip.addEventListener('click', (e)=>{ e.stopPropagation(); openEditor(); });
          chip.addEventListener('keydown', (e)=>{ if (e.key==='Enter'||e.key===' '){ e.preventDefault(); openEditor(); } });
          chipsWrap.appendChild(chip);
        };
        mkChip('location', ct.location || null);
        if (ct.room && ct.location) mkChip('room', ct.room);
        mkChip('consultant', ct.consultant || null);
      }
    } catch {}
    // Render Notes UI items per section (A–E)
    const sections = [
      { L: 'A', el: document.getElementById('notes-A-items') },
      { L: 'B', el: document.getElementById('notes-B-items') },
      { L: 'C', el: document.getElementById('notes-C-items') },
      { L: 'D', el: document.getElementById('notes-D-items') },
      { L: 'E', el: document.getElementById('notes-E-items') },
    ];
    for (const s of sections) {
      const items = await decryptItems(data, s.L);
      renderNotesSection(s.el, s.L, items);
    }
    // Apply cell background colors to notes inputs (A–E) if present
    try {
      const applyBg = (el, L) => { if (!el) return; const key = `col${L}Color`; const bg = data[key] || null; el.style.background = bg ? bg : ''; };
      const applyToContainer = (id, L) => {
        const el = document.getElementById(id); if (!el) return; const key = `col${L}Color`; const bg = data[key] || null; el.querySelectorAll('input, textarea').forEach(n => { n.style.background = bg || ''; });
      };
      applyToContainer('notes-A-items','A');
      applyToContainer('notes-B-items','B');
      applyToContainer('notes-C-items','C');
      applyToContainer('notes-D-items','D');
      applyToContainer('notes-E-items','E');
    } catch {}
  });
}

function renderNotesSection(container, letter, items) {
  if (!container) return;
  container.innerHTML = '';
  const max = 8;
  const addBtn = container.parentElement?.querySelector('.add-note-item[data-letter="'+letter+'"]');
  const canAdd = items.length < max;
  if (addBtn) { addBtn.disabled = !canAdd; addBtn.onclick = () => { if (items.length >= max) { showToast('Limit reached'); return; } items.push(newItem()); persist(); try { logUpdate({ type: 'note_added', caseId: currentCaseId, noteSection: letter }); } catch {} render(); }; }
  const render = () => {
    container.innerHTML = '';
    items.forEach((it, idx) => {
      const row = document.createElement('div'); row.className = 'note-item'; row.dataset.id = it.id;
      const header = document.createElement('input'); header.type='text'; header.className='note-item-header'; header.placeholder='Header'; header.value = it.title || '';
      const body = document.createElement('textarea'); body.className='note-item-body auto-grow'; body.placeholder='Add details…'; body.value = it.body || '';
      const actions = document.createElement('div'); actions.className='note-actions';
      const up = document.createElement('button'); up.type='button'; up.className='icon-btn small'; up.textContent='↑'; up.title='Move up'; up.disabled = idx===0;
      const down = document.createElement('button'); down.type='button'; down.className='icon-btn small'; down.textContent='↓'; down.title='Move down'; down.disabled = idx===items.length-1;
      const del = document.createElement('button'); del.type='button'; del.className='icon-btn small delete-btn'; del.textContent='🗑'; del.title='Delete';
      actions.appendChild(up); actions.appendChild(down); actions.appendChild(del);
      row.appendChild(header); row.appendChild(body); row.appendChild(actions);
      container.appendChild(row);
      autoResizeTextarea(body);
      header.addEventListener('blur', () => { it.title = header.value; persistDebounced(); });
      body.addEventListener('input', () => { autoResizeTextarea(body); });
      body.addEventListener('blur', () => { it.body = body.value; persistDebounced(); });
      const normalizeOrder = () => { for (let i=0;i<items.length;i++) { items[i].order = (items[i].order && Number.isFinite(items[i].order)) ? items[i].order : 0; } };
      const resequence = () => { // ensure a simple increasing sequence to reflect UI order
        for (let i=0;i<items.length;i++) items[i].order = i+1;
      };
      up.addEventListener('click', () => {
        if (idx === 0) return;
        normalizeOrder();
        // swap array positions
        const t = items[idx-1]; items[idx-1] = items[idx]; items[idx] = t;
        resequence();
        persist();
        render();
      });
      down.addEventListener('click', () => {
        if (idx === items.length-1) return;
        normalizeOrder();
        const t = items[idx+1]; items[idx+1] = items[idx]; items[idx] = t;
        resequence();
        persist();
        render();
      });
      del.addEventListener('click', () => { items.splice(idx,1); persist(); render(); });
    });
  };
  const persist = async () => { try { await saveItems(currentCaseId, letter, items); } catch (e) { console.error('save items', e); showToast('Failed to save'); } if (addBtn) addBtn.disabled = items.length >= max; };
  let persistTimer = null; const persistDebounced = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 500); };
  render();
}

// --- Form bindings
function showCaseSection(which) {
  const isOverview = which === 'overview';
  if (tabOverviewBtn) {
    tabOverviewBtn.classList.toggle('active', isOverview);
    tabOverviewBtn.setAttribute('aria-selected', String(isOverview));
  }
  if (tabWardNotesBtn) {
    tabWardNotesBtn.classList.toggle('active', !isOverview);
    tabWardNotesBtn.setAttribute('aria-selected', String(!isOverview));
  }
  const overview = document.getElementById('overview');
  const wardNotes = document.getElementById('ward-notes');
  if (overview) overview.hidden = !isOverview;
  if (wardNotes) wardNotes.hidden = isOverview;
  if (!isOverview) {
    if (!unsubWardNotes) startRealtimeWardNotes();
  } else {
    if (unsubWardNotes) { try { unsubWardNotes(); } catch {} unsubWardNotes = null; }
    if (overview) overview.querySelectorAll('textarea.auto-grow').forEach(autoResizeTextarea);
  }
}

function bindCaseTabs() {
  if (tabOverviewBtn) tabOverviewBtn.addEventListener('click', () => showCaseSection('overview'));
  if (tabWardNotesBtn) tabWardNotesBtn.addEventListener('click', () => showCaseSection('ward-notes'));
}

function renderWardNoteBody(container, body) {
  if (!container) return;
  const doc = container.ownerDocument || document;
  const mk = (tag) => doc.createElement(tag);
  container.innerHTML = '';
  if (!body) return;
  const blocks = body
    .split(/\n\s*\n/)
    .map(s => (s || '').trim())
    .filter(Boolean);
  if (!blocks.length) return;

  const dxLine = blocks[0] || '';
  const dxText = dxLine.replace(/^Δ\s*/, '').trim();
  const dx = mk('div'); dx.className = 'ward-note-section ward-note-section--dx';
  const dxLabel = mk('div'); dxLabel.className = 'ward-note-label'; dxLabel.textContent = 'Diagnosis';
  const dxValue = mk('div'); dxValue.className = 'ward-note-text'; dxValue.textContent = dxText || 'Not specified';
  dx.appendChild(dxLabel); dx.appendChild(dxValue);
  container.appendChild(dx);

  const issues = [];
  let otherText = '';
  let tasksText = '';
  for (let i = 1; i < blocks.length; i += 2) {
    const head = blocks[i];
    const next = blocks[i + 1] || '';
    if (head === 'Other') { otherText = next; continue; }
    if (head === 'Tasks') { tasksText = next; continue; }
    issues.push({ title: head, body: next });
  }

  if (issues.length) {
    const group = mk('div'); group.className = 'ward-note-group';
    const groupHead = mk('div'); groupHead.className = 'ward-note-group-head'; groupHead.textContent = 'Issues';
    group.appendChild(groupHead);
    for (const it of issues) {
      const section = mk('div'); section.className = 'ward-note-section';
      const title = mk('div'); title.className = 'ward-note-subhead'; title.textContent = it.title || 'Untitled issue';
      const bodyEl = mk('div'); bodyEl.className = 'ward-note-text'; bodyEl.textContent = it.body || '';
      section.appendChild(title); section.appendChild(bodyEl);
      group.appendChild(section);
    }
    container.appendChild(group);
  }

  if (otherText) {
    const other = mk('div'); other.className = 'ward-note-section ward-note-section--other';
    const label = mk('div'); label.className = 'ward-note-label'; label.textContent = 'Other';
    const text = mk('div'); text.className = 'ward-note-text'; text.textContent = otherText;
    other.appendChild(label); other.appendChild(text);
    container.appendChild(other);
  }

  if (tasksText) {
    const tasks = mk('div'); tasks.className = 'ward-note-section ward-note-section--tasks';
    const label = mk('div'); label.className = 'ward-note-label'; label.textContent = 'Tasks';
    const list = mk('ul'); list.className = 'ward-note-tasks';
    const lines = tasksText.split('\n').map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      const li = mk('li'); li.textContent = line.replace(/^•\s*/, '');
      list.appendChild(li);
    }
    tasks.appendChild(label); tasks.appendChild(list);
    container.appendChild(tasks);
  }
}

function startRealtimeWardNotes() {
  if (!currentCaseId) return;
  const list = wardNotesListEl;
  if (!list) return;
  const ref = collection(db, 'cases', currentCaseId, 'wardNotes');
  const qn = query(ref, orderBy('createdAt', 'desc'));
  if (unsubWardNotes) { try { unsubWardNotes(); } catch {} }
  unsubWardNotes = onSnapshot(qn, async (snap) => {
    list.innerHTML = '';
    if (snap.empty) {
      const d = document.createElement('div'); d.className='update-empty'; d.textContent='No notes yet.'; list.appendChild(d); return;
    }
    for (const d of snap.docs) {
      const li = document.createElement('li'); li.className='ward-note-item';
      const data = d.data();
      const head = document.createElement('div'); head.className='ward-note-head';
      const title = document.createElement('strong');
      let heading = '';
      try { if (data.headingCipher && data.headingIv) heading = await decryptText(data.headingCipher, data.headingIv); } catch {}
      title.textContent = heading || 'Ward Note'; head.appendChild(title);
      const meta = document.createElement('span'); meta.className='meta';
      const author = data.author || 'Unknown';
      const ts = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
      meta.textContent = ` by ${author}` + (ts ? ` — ${ts.toLocaleString()}` : '');
      head.appendChild(meta);
      li.appendChild(head);
      const preview = document.createElement('div'); preview.className='ward-note-preview';
      try { if (data.compiledCipher && data.compiledIv) {
        const body = await decryptText(data.compiledCipher, data.compiledIv);
        renderWardNoteBody(preview, body);
      } } catch {}
      li.appendChild(preview);
      list.appendChild(li);
    }
  });
}

function createWardNotesPrintButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn small';
  btn.textContent = 'Ward Notes';
  btn.title = 'View or print ward notes by date';
  btn.addEventListener('click', openWardNotesRangeModal);
  return btn;
}

function formatLocalDateInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateInput(value) {
  if (!value) return null;
  const parts = value.split('-').map(v => parseInt(v, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

function formatDateLabel(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function formatDateTimeLabel(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return 'Unknown time';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function buildWardNoteBodyHtml(body) {
  const wrap = document.createElement('div');
  renderWardNoteBody(wrap, body);
  return wrap.innerHTML;
}

function buildWardNotePrintItemHtml(note) {
  const article = document.createElement('article');
  article.className = 'ward-note-item ward-note-page';

  const head = document.createElement('div');
  head.className = 'ward-note-page-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'ward-note-page-title';
  const patient = document.createElement('div');
  patient.className = 'ward-note-patient';
  patient.textContent = note.caseTitle || 'Unknown patient';
  const heading = document.createElement('div');
  heading.className = 'ward-note-heading';
  heading.textContent = note.heading || 'Ward Note';
  titleWrap.appendChild(patient);
  titleWrap.appendChild(heading);

  const meta = document.createElement('div');
  meta.className = 'ward-note-page-meta';
  const author = note.author || 'Unknown';
  const when = note.createdAt ? formatDateTimeLabel(note.createdAt) : 'Unknown time';
  meta.textContent = `${author} — ${when}`;

  head.appendChild(titleWrap);
  head.appendChild(meta);
  article.appendChild(head);

  const body = document.createElement('div');
  body.className = 'ward-note-preview';
  body.innerHTML = buildWardNoteBodyHtml(note.compiled || '');
  article.appendChild(body);

  return article.outerHTML;
}

async function fetchWardNotesRange(start, end) {
  const ref = collectionGroup(db, 'wardNotes');
  const qn = query(ref, where('createdAt', '>=', start), where('createdAt', '<=', end), orderBy('createdAt', 'desc'));
  const snap = await getDocs(qn);

  const raw = [];
  const caseIds = new Set();
  for (const d of snap.docs) {
    const data = d.data();
    const caseRef = d.ref.parent && d.ref.parent.parent;
    const caseId = caseRef ? caseRef.id : null;
    if (!caseId) continue;
    caseIds.add(caseId);
    raw.push({ id: d.id, caseId, data });
  }

  const caseTitles = new Map();
  await Promise.all(Array.from(caseIds).map(async (caseId) => {
    try {
      const snap = await getDoc(doc(db, 'cases', caseId));
      if (snap.exists()) {
        const data = snap.data();
        let title = '';
        try { title = await decryptText(data.titleCipher, data.titleIv); } catch {}
        caseTitles.set(caseId, title || 'Unknown patient');
      } else {
        caseTitles.set(caseId, 'Unknown patient');
      }
    } catch {
      caseTitles.set(caseId, 'Unknown patient');
    }
  }));

  const notes = await Promise.all(raw.map(async (item) => {
    const data = item.data || {};
    let heading = '';
    let compiled = '';
    try { if (data.headingCipher && data.headingIv) heading = await decryptText(data.headingCipher, data.headingIv); } catch {}
    try { if (data.compiledCipher && data.compiledIv) compiled = await decryptText(data.compiledCipher, data.compiledIv); } catch {}
    const createdAt = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
    return {
      id: item.id,
      caseId: item.caseId,
      caseTitle: caseTitles.get(item.caseId) || 'Unknown patient',
      author: data.author || 'Unknown',
      createdAt,
      heading,
      compiled,
    };
  }));

  return notes;
}

function openWardNotesPrintWindow({ start, end, notes, autoPrint }) {
  const rangeLabel = `${formatDateLabel(start)}${formatDateLabel(start) === formatDateLabel(end) ? '' : ` – ${formatDateLabel(end)}`}`;
  const countLabel = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
  const itemsHtml = notes.length
    ? notes.map(buildWardNotePrintItemHtml).join('')
    : `<div class="update-empty" style="padding:12px;">No ward notes found for this date range.</div>`;

  const autoPrintScript = autoPrint
    ? `<script>window.addEventListener('load',function(){ setTimeout(function(){ window.print(); }, 50); });</script>`
    : '';

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Ward Notes (${rangeLabel})</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <div class="ward-notes-print-header">
      <div>
        <div class="ward-notes-print-title">Ward notes</div>
        <div class="ward-notes-print-range">${rangeLabel} • ${countLabel}</div>
      </div>
      <button class="btn print-btn" type="button" onclick="window.print()">Print</button>
    </div>
    <div class="ward-notes-print">${itemsHtml}</div>
    ${autoPrintScript}
  </body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { showToast('Pop-up blocked. Allow pop-ups to view notes.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function openWardNotesRangeModal() {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const modal = document.createElement('div'); modal.className = 'modal'; overlay.appendChild(modal);
  const title = document.createElement('h3'); title.textContent = 'Ward notes by date'; modal.appendChild(title);
  const form = document.createElement('div'); form.className = 'stack'; modal.appendChild(form);

  const startLabel = document.createElement('label'); startLabel.textContent = 'Start date';
  const startInput = document.createElement('input'); startInput.type = 'date'; startInput.setAttribute('aria-label', 'Start date');
  startLabel.appendChild(startInput);
  form.appendChild(startLabel);

  const endLabel = document.createElement('label'); endLabel.textContent = 'End date';
  const endInput = document.createElement('input'); endInput.type = 'date'; endInput.setAttribute('aria-label', 'End date');
  endLabel.appendChild(endInput);
  form.appendChild(endLabel);

  const help = document.createElement('div');
  help.style.fontSize = '12px';
  help.style.color = '#6b7280';
  help.textContent = 'Dates are inclusive. Notes are grouped across all patients.';
  form.appendChild(help);

  const today = new Date();
  startInput.value = formatLocalDateInput(today);
  endInput.value = formatLocalDateInput(today);

  const actions = document.createElement('div'); actions.className = 'actions';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const viewBtn = document.createElement('button'); viewBtn.className = 'btn primary'; viewBtn.textContent = 'View notes';
  const printBtn = document.createElement('button'); printBtn.className = 'btn'; printBtn.textContent = 'Print now';
  actions.appendChild(cancel);
  actions.appendChild(printBtn);
  actions.appendChild(viewBtn);
  modal.appendChild(actions);
  document.body.appendChild(overlay);

  const setBusy = (on) => {
    viewBtn.disabled = on;
    printBtn.disabled = on;
    cancel.disabled = on;
    viewBtn.textContent = on ? 'Loading…' : 'View notes';
    printBtn.textContent = on ? 'Loading…' : 'Print now';
  };

  const run = async (autoPrint) => {
    const startVal = startInput.value;
    const endVal = endInput.value || startVal;
    const startDate = parseDateInput(startVal);
    const endDate = parseDateInput(endVal);
    if (!startDate || !endDate) { showToast('Select a start and end date'); return; }
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
    if (end < start) { showToast('End date must be on or after start date'); return; }

    setBusy(true);
    try {
      const notes = await fetchWardNotesRange(start, end);
      openWardNotesPrintWindow({ start, end, notes, autoPrint });
      overlay.remove();
    } catch (err) {
      console.error('Failed to load ward notes', err);
      showToast('Failed to load ward notes');
      setBusy(false);
    }
  };

  cancel.addEventListener('click', () => overlay.remove());
  viewBtn.addEventListener('click', () => run(false));
  printBtn.addEventListener('click', () => run(true));
  endInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); viewBtn.click(); }});
  startInput.focus();
}

// Append helper: adds a blank line + text if existing body present
function appendWithSpacing(existing, added) {
  const a = (added || '').trim();
  if (!a) return existing || '';
  const e = (existing || '').trim();
  if (!e) return a;
  return e + "\n\n" + a;
}

async function saveCaseOtherBody(caseId, addedText) {
  if (!caseId) return;
  try {
    const ref = doc(db, 'cases', caseId);
    const snap = await getDoc(ref);
    let current = '';
    if (snap.exists()) {
      const data = snap.data();
      if (data.issuesOtherBodyCipher && data.issuesOtherBodyIv) {
        try { current = await decryptText(data.issuesOtherBodyCipher, data.issuesOtherBodyIv); } catch {}
      }
    }
    const next = appendWithSpacing(current, addedText);
    if (!next) {
      await updateDoc(ref, { issuesOtherBodyCipher: null, issuesOtherBodyIv: null });
    } else {
      const e = await encryptText(next);
      await updateDoc(ref, { issuesOtherBodyCipher: e.cipher, issuesOtherBodyIv: e.iv });
    }
  } catch (err) { console.error('Failed to save Other body', err); showToast('Failed to save'); }
}

async function openWardNoteComposer() {
  if (!currentCaseId) return;
  const overlay = document.createElement('div'); overlay.className='modal-overlay';
  const modal = document.createElement('div'); modal.className='modal modal-wide'; overlay.appendChild(modal);
  const form = document.createElement('div'); form.className='stack'; modal.appendChild(form);

  // (Heading handled inline above main note)

  // Diagnoses (A)
  const dxWrap = document.createElement('div'); dxWrap.className='section'; dxWrap.style.display='none';
  const dxTitle = document.createElement('div'); dxTitle.textContent='Diagnoses (Δ)'; dxTitle.style.fontWeight='600'; dxWrap.appendChild(dxTitle);
  const dxList = document.createElement('div'); dxList.className='note-items'; dxWrap.appendChild(dxList);
  form.appendChild(dxWrap);

  // Issues (E)
  const issuesWrap = document.createElement('div'); issuesWrap.className='section'; issuesWrap.style.display='none';
  const issuesHeader = document.createElement('div'); issuesHeader.style.display='flex'; issuesHeader.style.gap='8px'; issuesHeader.style.alignItems='center';
  const issuesTitle = document.createElement('div'); issuesTitle.textContent='Issues'; issuesTitle.style.fontWeight='600'; issuesHeader.appendChild(issuesTitle);
  const showAllBtn = document.createElement('button'); showAllBtn.type='button'; showAllBtn.className='icon-btn small'; showAllBtn.textContent='Show all'; issuesHeader.appendChild(showAllBtn);
  const hideAllBtn = document.createElement('button'); hideAllBtn.type='button'; hideAllBtn.className='icon-btn small'; hideAllBtn.textContent='Hide all'; issuesHeader.appendChild(hideAllBtn);
  issuesWrap.appendChild(issuesHeader);
  const issuesList = document.createElement('div'); issuesList.className='note-items'; issuesWrap.appendChild(issuesList);
  form.appendChild(issuesWrap);

  // Other
  // Compact controls row above the main note
  const ctrls = document.createElement('div'); ctrls.style.display='flex'; ctrls.style.gap='12px'; ctrls.style.alignItems='center'; ctrls.style.fontSize='12px'; ctrls.style.color='#6b7280';
  const mkLink = (label) => { const b=document.createElement('button'); b.type='button'; b.textContent=label; b.className='compact-link'; return b; };
  const dxBtn = mkLink('Diagnoses (Δ)');
  const issuesBtn = mkLink('Issues');
  form.appendChild(ctrls);
  ctrls.appendChild(dxBtn);
  ctrls.appendChild(issuesBtn);
  // Insert toggled sections below the compact controls (to keep menu fixed)
  form.appendChild(dxWrap);
  form.appendChild(issuesWrap);

  // Main Ward note field
  const otherWrap = document.createElement('div');
  // Inline editable heading (looks like a header, but editable)
  const headingEl = document.createElement('div');
  headingEl.className = 'wardnote-title';
  headingEl.setAttribute('contenteditable','true');
  headingEl.setAttribute('role','textbox');
  headingEl.setAttribute('aria-label','Note heading');
  headingEl.textContent = 'Ward note';
  otherWrap.appendChild(headingEl);
  const otherHelp = document.createElement('div'); otherHelp.className='wardnote-help'; otherHelp.textContent = 'This free text is the main body of the note; it doesn’t appear in the table.'; otherWrap.appendChild(otherHelp);
  const otherInput = document.createElement('textarea'); otherInput.className='wardnote-area'; otherInput.placeholder='Write your note…'; otherWrap.appendChild(otherInput); form.appendChild(otherWrap);

  // Tasks
  const tasksWrap = document.createElement('div'); tasksWrap.className='section'; tasksWrap.style.display='none';
  const includeRow = document.createElement('label'); includeRow.style.display='flex'; includeRow.style.gap='8px'; includeRow.style.alignItems='center';
  const includeChk = document.createElement('input'); includeChk.type='checkbox'; includeChk.checked = true; includeRow.appendChild(includeChk);
  includeRow.appendChild(document.createTextNode('Include existing open tasks in this note'));
  tasksWrap.appendChild(includeRow);
  // Mini task composer and list
  const miniForm = document.createElement('form'); miniForm.className='composer'; miniForm.autocomplete='off'; miniForm.style.marginTop='8px';
  const plus = document.createElement('button'); plus.type='button'; plus.className='icon-btn'; plus.setAttribute('aria-hidden','true'); plus.tabIndex=-1; plus.textContent='+';
  const miniInput = document.createElement('input'); miniInput.placeholder='Add a task…'; miniInput.setAttribute('aria-label','Task description');
  const miniAdd = document.createElement('button'); miniAdd.type='submit'; miniAdd.className='primary'; miniAdd.textContent='Add';
  miniForm.appendChild(plus); miniForm.appendChild(miniInput); miniForm.appendChild(miniAdd);
  tasksWrap.appendChild(miniForm);
  const modalTaskList = document.createElement('ul'); modalTaskList.style.marginTop='6px'; tasksWrap.appendChild(modalTaskList);
  form.appendChild(tasksWrap);
  const tasksBtn = mkLink('Tasks (include open: on)'); ctrls.appendChild(tasksBtn);

  // Toggle handlers for compact controls
  function setActive(btn, on) { btn.classList.toggle('active', !!on); }
  dxBtn.addEventListener('click', ()=>{ const show = dxWrap.style.display==='none'; dxWrap.style.display = show ? '' : 'none'; setActive(dxBtn, show); });
  issuesBtn.addEventListener('click', ()=>{ const show = issuesWrap.style.display==='none'; issuesWrap.style.display = show ? '' : 'none'; setActive(issuesBtn, show); if (show) { issuesWrap.querySelectorAll('textarea.auto-grow').forEach(autoResizeTextarea); } });
  tasksBtn.addEventListener('click', ()=>{ const show = tasksWrap.style.display==='none'; tasksWrap.style.display = show ? '' : 'none'; setActive(tasksBtn, show); });

  // Actions
  const actions = document.createElement('div'); actions.className='actions';
  const cancel = document.createElement('button'); cancel.className='btn'; cancel.textContent='Cancel'; actions.appendChild(cancel);
  const save = document.createElement('button'); save.className='btn primary'; save.textContent='Save Note'; actions.appendChild(save);
  modal.appendChild(actions);
  document.body.appendChild(overlay);

  // Load Dx and Issues
  let dxItems = [];
  let issueItems = [];
  let modalTasks = [];
  let modalTasksUnsub = null;
  try {
    const snap = await getDoc(doc(db,'cases', currentCaseId));
    const data = snap.data() || {};
    dxItems = await decryptItems(data, 'A');
    issueItems = (await decryptItems(data, 'E')).slice(0,8);
  } catch {}
  const renderDx = () => {
    dxList.innerHTML='';
    dxItems.slice(0,8).forEach((it, idx) => {
      const row = document.createElement('div'); row.className='note-item';
      const inp = document.createElement('input'); inp.type='text'; inp.value = it.title || ''; inp.placeholder='Diagnosis';
      inp.addEventListener('input', ()=>{ it.title = inp.value; });
      row.appendChild(inp);
      const del = document.createElement('button'); del.type='button'; del.className='icon-btn small'; del.textContent='🗑'; del.addEventListener('click', ()=>{ dxItems.splice(idx,1); renderDx(); }); row.appendChild(del);
      dxList.appendChild(row);
    });
    const add = document.createElement('button'); add.type='button'; add.className='icon-btn small'; add.textContent='+ Add diagnosis'; add.addEventListener('click', ()=>{ if (dxItems.length>=8) return; dxItems.push(newItem('','')); renderDx(); }); dxList.appendChild(add);
  };
  renderDx();

  // Issues rows with Show toggle + per-issue added text
  const issueState = new Map(); // id -> { show: bool, added: string }
  const renderIssues = () => {
    issuesList.innerHTML='';
    issueItems.forEach(it => {
      if (!issueState.has(it.id)) issueState.set(it.id, { show: true, added: '' });
      const st = issueState.get(it.id);
      const row = document.createElement('div'); row.className='note-item';
      const head = document.createElement('div'); head.style.display='flex'; head.style.justifyContent='space-between'; head.style.alignItems='center';
      const title = document.createElement('input'); title.type='text'; title.value = it.title || ''; title.placeholder='Issue header'; title.addEventListener('input', ()=>{ it.title = title.value; }); head.appendChild(title);
      const tog = document.createElement('label'); tog.style.display='flex'; tog.style.gap='6px'; tog.style.alignItems='center';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = !!st.show; cb.addEventListener('change', ()=>{ st.show = cb.checked; }); tog.appendChild(cb); tog.appendChild(document.createTextNode('Show in note'));
      head.appendChild(tog);
      row.appendChild(head);
      const body = document.createElement('textarea'); body.className='auto-grow'; body.placeholder='Add note for this issue (appends to Overview)'; body.value = st.added || ''; body.addEventListener('input', ()=>{ st.added = body.value; autoResizeTextarea(body); }); row.appendChild(body);
      issuesList.appendChild(row);
      autoResizeTextarea(body);
    });
  };
  renderIssues();
  showAllBtn.addEventListener('click', ()=>{ issueItems.forEach(it=>{ const st = issueState.get(it.id)||{}; st.show = true; issueState.set(it.id, st); }); renderIssues(); });
  hideAllBtn.addEventListener('click', ()=>{ issueItems.forEach(it=>{ const st = issueState.get(it.id)||{}; st.show = false; issueState.set(it.id, st); }); renderIssues(); });
  // Reflect tasks include state in compact link
  includeChk.addEventListener('change', ()=>{ tasksBtn.textContent = `Tasks (include open: ${includeChk.checked ? 'on':'off'})`; renderModalTasks(); });
  tasksBtn.textContent = `Tasks (include open: ${includeChk.checked ? 'on':'off'})`;

  // Tasks realtime list for modal
  let newTaskIds = [];
  let newTaskTitles = [];
  const qTasks = query(collection(db,'cases',currentCaseId,'tasks'), orderBy('createdAt','desc'));
  const statusIcon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  function renderModalTasks() {
    modalTaskList.innerHTML = '';
    for (const t of modalTasks) {
      const li = document.createElement('li'); li.className = 'modal-task' + (newTaskIds.includes(t.id) ? ' modal-task--new' : '');
      li.style.display='grid'; li.style.gridTemplateColumns='auto 1fr'; li.style.alignItems='center'; li.style.gap='6px';
      const sb = document.createElement('button'); sb.type='button'; sb.className='status-btn'; sb.textContent = statusIcon(t.status);
      sb.setAttribute('aria-label',`Task status: ${t.status}`);
      sb.addEventListener('click', async (e)=>{
        e.preventDefault();
        const order = ['open','in progress','complete'];
        const next = order[(order.indexOf(t.status)+1)%order.length];
        try {
          const { cipher, iv } = await encryptText(next);
          await updateDoc(doc(db,'cases',currentCaseId,'tasks',t.id), { statusCipher: cipher, statusIv: iv });
        } catch {}
      });
      const span = document.createElement('span'); span.textContent = t.text || '';
      if (newTaskIds.includes(t.id)) { const b=document.createElement('span'); b.className='badge-new'; b.textContent='NEW'; span.appendChild(b); }
      li.appendChild(sb); li.appendChild(span);
      modalTaskList.appendChild(li);
    }
  }
  if (modalTasksUnsub) { try { modalTasksUnsub(); } catch {} }
  modalTasksUnsub = onSnapshot(qTasks, async (snap) => {
    const arr = [];
    for (const d of snap.docs) {
      const dat = d.data();
      let text = '', status = '';
      try { text = await decryptText(dat.textCipher, dat.textIv); } catch {}
      try { status = await decryptText(dat.statusCipher, dat.statusIv); } catch {}
      arr.push({ id: d.id, text, status, data: dat });
    }
    modalTasks = arr;
    renderModalTasks();
  });

  // Add new task from modal
  miniForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (miniInput.value||'').trim(); if (!v) return;
    try {
      const { cipher: textCipher, iv: textIv } = await encryptText(v);
      const { cipher: statusCipher, iv: statusIv } = await encryptText('open');
      const payload = buildTaskCreationPayload({ textCipher, textIv, statusCipher, statusIv, assignee: null, priority: null });
      const ref = await addDoc(collection(db,'cases',currentCaseId,'tasks'), payload);
      newTaskIds.push(ref.id); newTaskTitles.push(v);
      miniInput.value='';
    } catch {}
  });

  const close = () => { if (modalTasksUnsub) { try { modalTasksUnsub(); } catch {} } overlay.remove(); };
  cancel.addEventListener('click', close);
  save.addEventListener('click', async () => {
    try {
      // 1) Save Dx (A)
      const cleanDx = dxItems.filter(it => (it.title||'').trim()).map(it => ({ id: it.id||Math.random().toString(36).slice(2,10), title: (it.title||'').trim(), body: '' }));
      await saveItems(currentCaseId, 'A', cleanDx);

      // 2) Save Issue headers change + append per-issue added text to case E bodies
      const cleanIssues = issueItems.filter(it => (it.title||'').trim());
      // Merge added text into body
      const merged = cleanIssues.map(it => {
        const st = issueState.get(it.id)||{ show:true, added:'' };
        const added = (st.added||'').trim();
        const nextBody = appendWithSpacing(it.body||'', added);
        return { id: it.id, title: (it.title||'').trim(), body: nextBody };
      });
      await saveItems(currentCaseId, 'E', merged);

      // 3) Save Other body append
      const otherText = (otherInput.value||'').trim();
      if (otherText) await saveCaseOtherBody(currentCaseId, otherText);

      // 4) Tasks: include existing open + add new
      const includeExisting = !!includeChk.checked;
      const includedTaskIds = [];
      const includedTaskTitles = [];
      if (includeExisting) {
        try {
          for (const t of modalTasks || []) {
            if ((t.status||'') === 'open') { includedTaskIds.push(t.id); includedTaskTitles.push(t.text||''); }
          }
        } catch {}
      }

      // 5) Build compiled body
      const parts = [];
      const heading = (headingEl.textContent||'').trim();
      const dxLine = (cleanDx.length>0) ? ('Δ ' + cleanDx.map(d=>d.title).join('; ')) : 'Δ Diagnosis not specified';
      parts.push(dxLine);
      // Issues included
      for (const it of merged) {
        const st = issueState.get(it.id)||{ show:true, added:'' };
        const added = (st.added||'').trim();
        if (!st.show) continue;
        if (!it.title || !added) continue;
        parts.push(it.title);
        parts.push(added);
      }
      if (otherText) {
        // Only include an 'Other' heading if there were any shown issue additions
        let hasIssueAddsShown = false;
        for (const it of merged) {
          const st = issueState.get(it.id)||{ show:true, added:'' };
          const added = (st.added||'').trim();
          if (st.show && added) { hasIssueAddsShown = true; break; }
        }
        if (hasIssueAddsShown) { parts.push('Other'); parts.push(otherText); }
        else { parts.push(otherText); }
      }
      const taskLines = [];
      if (includeExisting) taskLines.push(...includedTaskTitles.map(t=>`• ${t}`));
      taskLines.push(...newTaskTitles.map(t=>`• ${t}`));
      if (taskLines.length) { parts.push('Tasks'); parts.push(taskLines.join('\n')); }
      const compiled = parts.join('\n\n');

      // 6) Save ward note doc (immutable)
      const wnRef = collection(db,'cases',currentCaseId,'wardNotes');
      const eHead = await encryptText(heading);
      const eComp = await encryptText(compiled);
      const eDx = await encryptText(dxLine);
      const issuesAdded = [];
      for (const it of merged) {
        const st = issueState.get(it.id)||{ show:true, added:'' };
        const added = (st.added||'').trim();
        if (!added) continue;
        const enc = await encryptText(added);
        issuesAdded.push({ id: it.id, cipher: enc.cipher, iv: enc.iv, show: !!st.show });
      }
      await addDoc(wnRef, {
        headingCipher: eHead.cipher, headingIv: eHead.iv,
        compiledCipher: eComp.cipher, compiledIv: eComp.iv,
        diagnosesLineCipher: eDx.cipher, diagnosesLineIv: eDx.iv,
        issuesAdded,
        includeExistingOpenTasks: includeExisting,
        includedTaskIds,
        newTaskIds,
        author: username || null,
        createdAt: serverTimestamp(),
      });

      showToast('Ward note saved');
      close();
    } catch (err) {
      console.error('Failed to save ward note', err);
      showToast('Failed to save note');
    }
  });

  // Emphasize main note input
  setTimeout(()=>{ try { otherInput.focus(); otherInput.setSelectionRange(otherInput.value.length, otherInput.value.length); } catch {} }, 0);
  overlay.addEventListener('keydown', (e) => { if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.click(); } });
}

// New inline-block rich editor version for Ward Notes
async function openWardNoteComposerV2() {
  if (!currentCaseId) return;
  const overlay = document.createElement('div'); overlay.className='modal-overlay';
  const modal = document.createElement('div'); modal.className='modal modal-wide'; overlay.appendChild(modal);
  const form = document.createElement('div'); form.className='stack'; modal.appendChild(form);

  // Toolbar
  const ctrls = document.createElement('div'); ctrls.className = 'rich-editor-toolbar';
  const mkLink = (label) => { const b=document.createElement('button'); b.type='button'; b.textContent=label; b.className='compact-link'; return b; };
  const issuesToggleBtn = mkLink('Issues: Off');
  const showAllBtn = mkLink('Show all');
  const hideAllBtn = mkLink('Hide all');
  const tasksBtn = mkLink('Tasks (include open: on)');
  ctrls.appendChild(issuesToggleBtn); ctrls.appendChild(showAllBtn); ctrls.appendChild(hideAllBtn); ctrls.appendChild(tasksBtn);
  form.appendChild(ctrls);

  // Heading
  const headingEl = document.createElement('div');
  headingEl.className = 'wardnote-title';
  headingEl.setAttribute('contenteditable','true');
  headingEl.setAttribute('role','textbox');
  headingEl.setAttribute('aria-label','Note heading');
  headingEl.textContent = 'Ward note';
  form.appendChild(headingEl);

  // Editor field
  const editorWrap = document.createElement('div'); editorWrap.className='rich-editor-wrap';
  const editor = document.createElement('div'); editor.className='rich-editor'; editor.setAttribute('contenteditable','true'); editor.setAttribute('role','textbox'); editor.setAttribute('aria-label','Ward note body');
  form.appendChild(editorWrap);
  editorWrap.appendChild(editor);
  // Other section lives at the bottom of the same editor
  const otherDivider = document.createElement('div'); otherDivider.className='other-divider'; otherDivider.textContent='Other';
  const otherArea = document.createElement('div'); otherArea.className='other-area'; otherArea.dataset.placeholder = '';
  editor.appendChild(otherDivider);
  editor.appendChild(otherArea);

  // Tasks panel
  const tasksWrap = document.createElement('div'); tasksWrap.className='section'; tasksWrap.style.display='none';
  const includeRow = document.createElement('label'); includeRow.style.display='flex'; includeRow.style.gap='8px'; includeRow.style.alignItems='center';
  const includeChk = document.createElement('input'); includeChk.type='checkbox'; includeChk.checked = true; includeRow.appendChild(includeChk);
  includeRow.appendChild(document.createTextNode('Include existing open tasks in this note'));
  tasksWrap.appendChild(includeRow);
  const miniForm = document.createElement('form'); miniForm.className='composer'; miniForm.autocomplete='off'; miniForm.style.marginTop='8px';
  const plus = document.createElement('button'); plus.type='button'; plus.className='icon-btn'; plus.setAttribute('aria-hidden','true'); plus.tabIndex=-1; plus.textContent='+';
  const miniInput = document.createElement('input'); miniInput.placeholder='Add a task…'; miniInput.setAttribute('aria-label','Task description');
  const miniAdd = document.createElement('button'); miniAdd.type='submit'; miniAdd.className='primary'; miniAdd.textContent='Add';
  miniForm.appendChild(plus); miniForm.appendChild(miniInput); miniForm.appendChild(miniAdd);
  tasksWrap.appendChild(miniForm);
  const modalTaskList = document.createElement('ul'); modalTaskList.style.marginTop='6px'; tasksWrap.appendChild(modalTaskList);
  form.appendChild(tasksWrap);

  function setActive(btn, on) { btn.classList.toggle('active', !!on); }
  tasksBtn.addEventListener('click', ()=>{ const show = tasksWrap.style.display==='none'; tasksWrap.style.display = show ? '' : 'none'; setActive(tasksBtn, show); });
  includeChk.addEventListener('change', ()=>{ tasksBtn.textContent = `Tasks (include open: ${includeChk.checked ? 'on':'off'})`; renderModalTasks(); });

  // Data
  let dxItems = [];
  let issueItems = [];
  let modalTasks = [];
  let modalTasksUnsub = null;
  try {
    const snap = await getDoc(doc(db,'cases', currentCaseId));
    const data = snap.data() || {};
    dxItems = await decryptItems(data, 'A');
    issueItems = (await decryptItems(data, 'E')).slice(0,8);
  } catch {}

  // Inline blocks
  const issueState = new Map();
  const ISSUE_MARKER_START = '## Issue:';
  const isIssueBlock = (el) => el && el.classList && el.classList.contains('issue-block');
  const createIssueBlock = (it) => {
    if (!issueState.has(it.id)) issueState.set(it.id, { show: true });
    const block = document.createElement('div'); block.className = 'issue-block'; block.dataset.issueId = it.id;
    const header = document.createElement('div'); header.className='issue-header';
    const pill = document.createElement('span'); pill.className='issue-pill'; pill.textContent='Issue'; header.appendChild(pill);
    const title = document.createElement('span'); title.className='issue-title'; title.setAttribute('contenteditable','true'); title.textContent = (it.title||'').trim(); header.appendChild(title);
    const actions = document.createElement('div'); actions.className='issue-actions';
    const collapse = document.createElement('button'); collapse.type='button'; collapse.className='icon-btn small'; collapse.textContent='▾'; actions.appendChild(collapse);
    const remove = document.createElement('button'); remove.type='button'; remove.className='icon-btn small'; remove.textContent='✖'; actions.appendChild(remove);
    header.appendChild(actions);
    const body = document.createElement('div'); body.className='issue-body'; body.setAttribute('contenteditable','true'); body.dataset.placeholder='Type here to add to this issue…';
    block.appendChild(header); block.appendChild(body);
    collapse.addEventListener('click', () => { const c = block.classList.toggle('collapsed'); collapse.textContent = c ? '▸' : '▾'; });
    remove.addEventListener('click', () => { block.remove(); updateOtherHint(); });
    return block;
  };
  const insertIssuesIntoEditor = () => {
    const existingIds = new Set(Array.from(editor.querySelectorAll('.issue-block')).map(b=>b.dataset.issueId));
    const frag = document.createDocumentFragment();
    for (const it of issueItems) { if (!existingIds.has(it.id)) frag.appendChild(createIssueBlock(it)); }
    // Insert Issues before the Other divider so Other stays below
    editor.insertBefore(frag, otherDivider);
    updateOtherHint();
  };
  const flattenIssuesToMarkers = () => {
    const blocks = Array.from(editor.querySelectorAll('.issue-block'));
    for (const b of blocks) {
      const title = (b.querySelector('.issue-title')?.textContent||'').trim();
      const body = (b.querySelector('.issue-body')?.innerText||'').trim();
      const repl = document.createElement('div');
      repl.className = 'issue-marker';
      repl.style.display = 'none';
      repl.textContent = body ? `${ISSUE_MARKER_START} ${title}\n${body}` : `${ISSUE_MARKER_START} ${title}`;
      editor.insertBefore(repl, b);
      b.remove();
    }
    updateOtherHint();
  };
  const rehydrateIssuesFromMarkers = () => {
    const nodes = Array.from(editor.childNodes);
    for (const el of nodes) {
      if (!(el instanceof Element)) continue;
      const txt = el.innerText || '';
      if (txt.startsWith(ISSUE_MARKER_START)) {
        const lines = txt.split('\n');
        const title = lines[0].replace(ISSUE_MARKER_START, '').trim();
        const bodyText = lines.slice(1).join('\n');
        let it = issueItems.find(i => (i.title||'').trim() === title) || issueItems.find(i => !editor.querySelector(`.issue-block[data-issue-id="${i.id}"]`));
        if (!it) { it = { id: Math.random().toString(36).slice(2,10), title }; }
        const block = createIssueBlock(it);
        block.querySelector('.issue-title').textContent = title;
        block.querySelector('.issue-body').textContent = bodyText;
        editor.insertBefore(block, el);
        el.remove();
      }
    }
    updateOtherHint();
  };
  const updateOtherHint = () => {
    // Show placeholder styling on Other area only
    // No external floating hint required
  };

  // Default: Issues Off
  let issuesOn = false;
  const setIssuesToggle = (on) => {
    issuesOn = !!on;
    issuesToggleBtn.textContent = 'Issues: ' + (issuesOn ? 'On' : 'Off');
    showAllBtn.style.display = issuesOn ? '' : 'none';
    hideAllBtn.style.display = issuesOn ? '' : 'none';
    otherDivider.style.display = issuesOn ? '' : 'none';
    otherArea.dataset.placeholder = issuesOn ? 'Type here to add to Other…' : '';
    if (issuesOn) { rehydrateIssuesFromMarkers(); insertIssuesIntoEditor(); } else { flattenIssuesToMarkers(); }
  };
  issuesToggleBtn.addEventListener('click', () => setIssuesToggle(!issuesOn));
  showAllBtn.addEventListener('click', () => { editor.querySelectorAll('.issue-block').forEach(b=>{ b.classList.remove('collapsed'); const cBtn=b.querySelector('.issue-actions button'); if(cBtn) cBtn.textContent='▾'; }); });
  hideAllBtn.addEventListener('click', () => { editor.querySelectorAll('.issue-block').forEach(b=>{ b.classList.add('collapsed'); const cBtn=b.querySelector('.issue-actions button'); if(cBtn) cBtn.textContent='▸'; }); });

  // Insert Issue blocks above the Other section and default to Issues Off
  insertIssuesIntoEditor();
  setIssuesToggle(false);
  // If user clicks the editor background, move caret to end of Other
  const placeCaretAtEnd = (el) => { try { const range=document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch {} };
  editor.addEventListener('mousedown', (e) => {
    const t = e.target;
    const withinIssue = (t instanceof Element) && !!t.closest('.issue-block');
    const withinOther = (t instanceof Element) && (t === otherArea || otherArea.contains(t));
    const onEditorChrome = t === editor || t === editorWrap;
    if (onEditorChrome || (!withinIssue && !withinOther)) {
      // Only force caret to Other when clicking editor chrome/empty space
      setTimeout(()=>placeCaretAtEnd(otherArea), 0);
    }
  });

  // Keyboard navigation and editing shortcuts
  const placeCaretAtStart = (el) => { try { const range=document.createRange(); range.selectNodeContents(el); range.collapse(true); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } catch {} };
  const getBlocks = () => Array.from(editor.querySelectorAll('.issue-block'));
  const focusIssueHeader = (block) => { const el = block.querySelector('.issue-title'); if (el) { el.focus(); placeCaretAtEnd(el); } };
  const focusIssueBody = (block, atEnd=true) => { const el = block.querySelector('.issue-body'); if (el) { el.focus(); if (atEnd) placeCaretAtEnd(el); else placeCaretAtStart(el); } };
  const selInfo = () => { const sel = window.getSelection(); if (!sel || sel.rangeCount===0) return null; const r=sel.getRangeAt(0); return { sel, range: r } };
  const caretAtStart = (el) => { const s = selInfo(); if (!s) return false; const r = s.range.cloneRange(); const test = document.createRange(); test.selectNodeContents(el); test.collapse(true); return r.compareBoundaryPoints(Range.START_TO_START, test) === 0 && r.collapsed; };
  const caretAtEnd = (el) => { const s = selInfo(); if (!s) return false; const r = s.range.cloneRange(); const test = document.createRange(); test.selectNodeContents(el); test.collapse(false); return r.compareBoundaryPoints(Range.END_TO_END, test) === 0 && r.collapsed; };
  const textLen = (el) => (el.innerText || '').length;

  editor.addEventListener('keydown', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const block = target.closest('.issue-block');
    const isTitle = block && target.classList.contains('issue-title');
    const isBody = block && target.classList.contains('issue-body');

    // Alt+Up/Down navigation across blocks; Alt+Left/Right between header/body
    if ((e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) && (isTitle || isBody)) {
      const blocks = getBlocks();
      const idx = blocks.indexOf(block);
      if (e.key === 'ArrowUp') { e.preventDefault(); if (idx > 0) focusIssueBody(blocks[idx-1]); else headingEl.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (idx < blocks.length-1) focusIssueBody(blocks[idx+1]); else { otherArea.focus(); placeCaretAtEnd(otherArea); } return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); focusIssueHeader(block); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); focusIssueBody(block); return; }
    }

    // Cmd/Ctrl+Shift+Up/Down → reorder blocks
    if ((e.shiftKey && (e.metaKey || e.ctrlKey)) && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && block) {
      e.preventDefault();
      const blocks = getBlocks();
      const idx = blocks.indexOf(block);
      if (e.key === 'ArrowUp' && idx > 0) { editor.insertBefore(block, blocks[idx-1]); focusIssueHeader(block); }
      else if (e.key === 'ArrowDown' && idx < blocks.length-1) { editor.insertBefore(blocks[idx+1], block); focusIssueHeader(block); }
      return;
    }

    // Title field behaviors
    if (isTitle) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); focusIssueBody(block); return; }
      if (e.key === 'Backspace' && textLen(target) === 0) {
        e.preventDefault();
        const blocks = getBlocks(); const idx = blocks.indexOf(block); const prev = blocks[idx-1];
        block.remove();
        if (prev) focusIssueBody(prev); else { otherArea.focus(); placeCaretAtEnd(otherArea); }
        return;
      }
    }

    // Body field behaviors
    if (isBody) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (caretAtEnd(target)) {
          const count = Number(target.dataset.enterEndCount || '0') + 1;
          target.dataset.enterEndCount = String(count);
          if (count >= 2) { e.preventDefault(); target.dataset.enterEndCount = '0'; otherArea.focus(); placeCaretAtEnd(otherArea); return; }
        } else { target.dataset.enterEndCount = '0'; }
        return; // allow newline
      }
      if (e.key !== 'Enter') target.dataset.enterEndCount = '0';
      if (e.key === 'Backspace' && caretAtStart(target) && textLen(target) === 0) {
        e.preventDefault();
        const titleEl = block.querySelector('.issue-title');
        if (titleEl && textLen(titleEl) > 0) { focusIssueHeader(block); return; }
        const blocks = getBlocks(); const idx = blocks.indexOf(block); const prev = blocks[idx-1];
        block.remove(); if (prev) focusIssueBody(prev); else { otherArea.focus(); placeCaretAtEnd(otherArea); }
        return;
      }
    }
  });

  // Tasks realtime list
  let newTaskIds = [];
  let newTaskTitles = [];
  const qTasks = query(collection(db,'cases',currentCaseId,'tasks'), orderBy('createdAt','desc'));
  const statusIcon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  function renderModalTasks() {
    modalTaskList.innerHTML = '';
    for (const t of modalTasks) {
      const li = document.createElement('li'); li.className = 'modal-task' + (newTaskIds.includes(t.id) ? ' modal-task--new' : '');
      li.style.display='grid'; li.style.gridTemplateColumns='auto 1fr'; li.style.alignItems='center'; li.style.gap='6px';
      const sb = document.createElement('span'); sb.textContent = statusIcon(t.status||'open'); li.appendChild(sb);
      const tt = document.createElement('span'); tt.textContent = t.text||''; li.appendChild(tt);
      modalTaskList.appendChild(li);
    }
  }
  renderModalTasks();
  modalTasksUnsub = onSnapshot(qTasks, async (snap) => {
    const list = [];
    for (const d of snap.docs) {
      const data = d.data();
      let text = '';
      let status = '';
      try { if (data.textCipher && data.textIv) text = await decryptText(data.textCipher, data.textIv); } catch {}
      try { if (data.statusCipher && data.statusIv) status = await decryptText(data.statusCipher, data.statusIv); } catch {}
      list.push({ id: d.id, text, status });
    }
    modalTasks = list;
    renderModalTasks();
  });
  miniForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const v = (miniInput.value||'').trim(); if (!v) return;
      const { cipher: textCipher, iv: textIv } = await encryptText(v);
      const { cipher: statusCipher, iv: statusIv } = await encryptText('open');
      const payload = buildTaskCreationPayload({ textCipher, textIv, statusCipher, statusIv, assignee: null, priority: null });
      const ref = await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), payload);
      newTaskIds.push(ref.id); newTaskTitles.push(v);
      miniInput.value='';
    } catch {}
  });

  // Actions
  const actions = document.createElement('div'); actions.className='actions';
  const cancel = document.createElement('button'); cancel.className='btn'; cancel.textContent='Cancel'; actions.appendChild(cancel);
  const save = document.createElement('button'); save.className='btn primary'; save.textContent='Save Note'; actions.appendChild(save);
  modal.appendChild(actions);

  document.body.appendChild(overlay);

  const close = () => { if (modalTasksUnsub) { try { modalTasksUnsub(); } catch {} } overlay.remove(); };
  cancel.addEventListener('click', close);
  save.addEventListener('click', async () => {
    try {
      // Collect issue additions and Other text
      const mergedIssues = [];
      const issuesAdded = [];
      // Collect from Issue blocks in the editor (above Other)
      for (const n of Array.from(editor.querySelectorAll('.issue-block'))) {
          const id = n.dataset.issueId;
          const title = (n.querySelector('.issue-title')?.textContent||'').trim();
          const added = (n.querySelector('.issue-body')?.innerText||'').trim();
          const show = !n.classList.contains('collapsed');
          const orig = issueItems.find(i=>i.id===id) || { id, title: title, body: '' };
          const nextBody = appendWithSpacing(orig.body||'', added);
          mergedIssues.push({ id: orig.id, title: title || (orig.title||''), body: nextBody });
          if (added) issuesAdded.push({ id: orig.id, added, show });
      }
      // Gather Other text from the dedicated area only
      const otherText = (otherArea.innerText || '').trim();

      // Dx line from current A items
      const cleanDx = dxItems.filter(it => (it.title||'').trim()).map(it => ({ id: it.id||Math.random().toString(36).slice(2,10), title: (it.title||'').trim(), body: '' }));
      await saveItems(currentCaseId, 'A', cleanDx);
      await saveItems(currentCaseId, 'E', mergedIssues.length ? mergedIssues : issueItems);
      if (otherText) await saveCaseOtherBody(currentCaseId, otherText);

      // Tasks
      const includeExisting = !!includeChk.checked;
      const includedTaskIds = [];
      const includedTaskTitles = [];
      if (includeExisting) {
        for (const t of modalTasks || []) { if ((t.status||'') === 'open') { includedTaskIds.push(t.id); includedTaskTitles.push(t.text||''); } }
      }

      // Compile
      const parts = [];
      const heading = (headingEl.textContent||'').trim();
      const dxLine = (cleanDx.length>0) ? ('Δ ' + cleanDx.map(d=>d.title).join('; ')) : 'Δ Diagnosis not specified';
      parts.push(dxLine);
      for (const it of mergedIssues) {
        const ia = issuesAdded.find(x=>x.id===it.id);
        const added = ia ? (ia.added||'').trim() : '';
        const shown = ia ? !!ia.show : true;
        if (!shown) continue;
        if (!it.title || !added) continue;
        parts.push(it.title);
        parts.push(added);
      }
      if (otherText) {
        const hasIssueAddsShown = issuesAdded.some(x => x.show && (x.added||'').trim());
        if (hasIssueAddsShown) { parts.push('Other'); parts.push(otherText); }
        else { parts.push(otherText); }
      }
      const taskLines = [];
      if (includeExisting) taskLines.push(...includedTaskTitles.map(t=>`• ${t}`));
      taskLines.push(...newTaskTitles.map(t=>`• ${t}`));
      if (taskLines.length) { parts.push('Tasks'); parts.push(taskLines.join('\n')); }
      const compiled = parts.join('\n\n');

      const wnRef = collection(db,'cases',currentCaseId,'wardNotes');
      const eHead = await encryptText(heading);
      const eComp = await encryptText(compiled);
      const eDx = await encryptText(dxLine);
      const encIssuesAdded = [];
      for (const ia of issuesAdded) { if (!ia.added) continue; const enc = await encryptText(ia.added); encIssuesAdded.push({ id: ia.id, cipher: enc.cipher, iv: enc.iv, show: !!ia.show }); }
      await addDoc(wnRef, { headingCipher: eHead.cipher, headingIv: eHead.iv, compiledCipher: eComp.cipher, compiledIv: eComp.iv, diagnosesLineCipher: eDx.cipher, diagnosesLineIv: eDx.iv, issuesAdded: encIssuesAdded, includeExistingOpenTasks: includeExisting, includedTaskIds, newTaskIds, author: username || null, createdAt: serverTimestamp() });

      showToast('Ward note saved');
      close();
    } catch (err) {
      console.error('Failed to save ward note', err);
      showToast('Failed to save note');
    }
  });

  // Focus editor
  setTimeout(()=>{ try { editor.focus(); } catch {} }, 0);
  overlay.addEventListener('keydown', (e) => { if ((e.key === 'Enter') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.querySelector('.btn.primary')?.click(); } });
}

// Apply toolbar filters to current case tasks and render
function renderCaseTasks() {
  if (caseTasksEditing) { caseTasksRebuildPending = true; return; }
  if (!taskListEl) return;
  const priVal = (p) => (p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0);
  let visible = currentCaseTasks.filter(it => {
    const pri = (it.data && it.data.priority) || '';
    const matchStatus = (!toolbarStatuses.size || toolbarStatuses.has(it.status));
    const matchPriority = (toolbarPriority === 'all' || pri === toolbarPriority);
    const matchSearch = (!toolbarSearch || it.text.toLowerCase().includes(toolbarSearch.toLowerCase()));
    return matchStatus && matchPriority && matchSearch;
  });
  let ordered;
  if (toolbarSort === 'pri-asc' || toolbarSort === 'pri-desc') {
    ordered = [...visible].sort((a,b) => {
      const pa = (a.data && a.data.priority) || '';
      const pb = (b.data && b.data.priority) || '';
      return toolbarSort === 'pri-asc' ? (priVal(pa) - priVal(pb)) : (priVal(pb) - priVal(pa));
    });
  } else {
    const idx = new Map((currentTaskOrder || []).map((id,i)=>[id,i]));
    ordered = [...visible].sort((a,b)=>(idx.get(a.id)??999999)-(idx.get(b.id)??999999));
  }
  // Re-render list with ordered
  taskListEl.innerHTML = '';
  for (const item of ordered) {
    // Reuse existing builder by simulating a single-item snapshot render
    // Build the same DOM fragment used in startRealtimeTasks for each item
    // Simplest: call a small builder
    const openComments = (pendingFocusTaskId && item.id === pendingFocusTaskId);
    taskListEl.appendChild(buildTaskListItem(item, { openComments }));
  }
  if (pendingFocusTaskId) {
    const target = document.getElementById('task-' + pendingFocusTaskId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('flash-highlight');
      setTimeout(() => target.classList.remove('flash-highlight'), 1400);
    }
    pendingFocusTaskId = null;
  }
}

function buildTaskListItem(item, opts = {}) {
  const { caseId, id: taskId, text, status, data } = item;
  const assignmentState = normalizeTaskAssignmentState(data || {});
  const pendingAcceptance = isTaskPendingAcceptance(data || {});
  const pendingForMe = pendingAcceptance && ((data?.assignee || '') === (username || ''));
  const li = document.createElement('li');
  const statusCls = status === 'in progress' ? 's-inprogress' : (status === 'complete' ? 's-complete' : 's-open');
  li.className = 'case-task ' + statusCls + (pendingAcceptance ? ' task-pending-acceptance' : '');
  li.id = 'task-' + taskId;
  // Status button
  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.className = 'status-btn';
  const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  statusBtn.textContent = icon(status);
  statusBtn.setAttribute('aria-label', `Task status: ${status}`);
  statusBtn.disabled = pendingAcceptance;
  if (pendingAcceptance) statusBtn.title = 'Awaiting acceptance';
  statusBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (statusBtn.disabled) return;
    const order = ['open','in progress','complete'];
    const next = order[(order.indexOf(statusBtn.getAttribute('aria-label')?.split(': ')[1] || status) + 1) % order.length];
    try {
      const { cipher, iv } = await encryptText(next);
      await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), { statusCipher: cipher, statusIv: iv });
      statusBtn.textContent = icon(next);
      statusBtn.setAttribute('aria-label', `Task status: ${next}`);
      li.className = 'case-task ' + (next === 'in progress' ? 's-inprogress' : (next === 'complete' ? 's-complete' : 's-open')) + (pendingAcceptance ? ' task-pending-acceptance' : '');
      if (next === 'complete') {
        try {
          const tEnc = await encryptText(titleSpan.textContent || '');
          await logUpdate({ type: 'task_completed', caseId, taskId, taskTextCipher: tEnc.cipher, taskTextIv: tEnc.iv });
        } catch {}
      }
    } catch (err) { console.error('Failed to update status', err); showToast('Failed to update status'); }
  });
  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-text';
  titleSpan.textContent = text;
  // Inline edit on title click
  titleSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    caseTasksEditing = true;
    const ed = document.createElement('div');
    ed.className = 'cell-editable';
    ed.setAttribute('contenteditable', 'true');
    ed.textContent = text;
    let last = text;
    const endEdit = () => {
      try { ed.remove(); } catch {}
      titleSpan.style.display = '';
      caseTasksEditing = false;
      if (caseTasksRebuildPending) { caseTasksRebuildPending = false; renderCaseTasks(); }
    };
    const saveNow = async () => {
      const v = (ed.innerText || '').replace(/\r/g, '');
      if (v === last) { endEdit(); return; }
      try {
        const { cipher: textCipher, iv: textIv } = await encryptText(v);
        await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), { textCipher, textIv });
        last = v; titleSpan.textContent = v;
      } catch (err) { console.error('Failed to update task', err); showToast('Failed to update task'); }
      endEdit();
    };
    ed.addEventListener('paste', (ev) => { ev.preventDefault(); const t=(ev.clipboardData||window.clipboardData).getData('text'); if (document.queryCommandSupported && document.queryCommandSupported('insertText')) { document.execCommand('insertText', false, t); } else { const sel=window.getSelection(); if (sel && sel.rangeCount) { sel.deleteFromDocument(); sel.getRangeAt(0).insertNode(document.createTextNode(t)); } } });
    ed.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !(ev.ctrlKey||ev.metaKey)) { ev.preventDefault(); saveNow(); } else if (ev.key === 'Escape') { ev.preventDefault(); endEdit(); } });
    ed.addEventListener('blur', () => { saveNow(); });
    titleSpan.insertAdjacentElement('afterend', ed);
    titleSpan.style.display = 'none';
    ed.focus();
    placeCaretAtEnd(ed);
  });
  li.appendChild(statusBtn);
  li.appendChild(titleSpan);
  const assignmentLabel = taskAssignmentStatusLabel(data || {});
  if (assignmentLabel) {
    const assignmentChip = document.createElement('span');
    assignmentChip.className = `assignment-state-chip ${assignmentState === TASK_ASSIGNMENT.PENDING ? 'pending' : 'open'}`;
    assignmentChip.textContent = assignmentLabel;
    li.appendChild(assignmentChip);
  }
  if (pendingForMe) {
    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'icon-btn small';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await acceptTaskAssignment(caseId, taskId, { caseTitle: caseTitleEl?.textContent || null, taskText: titleSpan.textContent || text });
        showToast('Task accepted');
      } catch (err) {
        console.error('Failed to accept task', err);
        showToast('Failed to accept task');
      }
    });
    li.appendChild(acceptBtn);
    const declineBtn = document.createElement('button');
    declineBtn.type = 'button';
    declineBtn.className = 'icon-btn small';
    declineBtn.textContent = 'Decline';
    declineBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await declineTaskAssignment(caseId, taskId, { caseTitle: caseTitleEl?.textContent || null, taskText: titleSpan.textContent || text });
        showToast('Task returned to open');
      } catch (err) {
        console.error('Failed to decline task', err);
        showToast('Failed to decline task');
      }
    });
    li.appendChild(declineBtn);
  }
  // Quick edit/delete actions
  const quickEdit = document.createElement('button');
  quickEdit.type = 'button';
  quickEdit.className = 'icon-btn';
  quickEdit.setAttribute('aria-label', 'Edit task');
  quickEdit.textContent = '✏️';
  quickEdit.addEventListener('click', (e) => { e.stopPropagation(); titleSpan.click(); });
  li.appendChild(quickEdit);
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'icon-btn delete-btn';
  delBtn.setAttribute('aria-label', 'Delete task');
  delBtn.textContent = '🗑';
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this task?')) return;
    try { await deleteDoc(doc(db, 'cases', caseId, 'tasks', taskId)); } catch (err) { console.error('Failed to delete task', err); showToast('Failed to delete task'); }
  });
  li.appendChild(delBtn);
  // Priority chip
  if (data.priority) {
    const pri = document.createElement('span');
    pri.className = 'mini-chip';
    pri.textContent = data.priority;
    li.appendChild(pri);
  }
  // Assignee avatar with tooltip and popup picker
  const av = document.createElement('span');
  av.className = 'mini-avatar';
  const initials = data.assignee ? data.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase() : '';
  av.textContent = initials || '';
  const col = colorForName(data.assignee || '');
  av.style.background = col.bg; av.style.color = col.color; av.style.border = `1px solid ${col.border}`;
  let tipEl = null; const removeTip = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
  av.addEventListener('mouseenter', () => {
    if (!data.assignee) return;
    tipEl = document.createElement('div'); tipEl.className = 'assignee-tip'; tipEl.textContent = data.assignee; tipEl.style.position = 'fixed'; tipEl.style.zIndex='2147483647'; document.body.appendChild(tipEl);
    const r = av.getBoundingClientRect(); requestAnimationFrame(()=>{ const h=tipEl.offsetHeight||24; tipEl.style.left=`${Math.round(r.left + r.width/2)}px`; tipEl.style.top=`${Math.round(r.top - 6 - h)}px`; tipEl.style.transform='translateX(-50%)'; });
  });
  av.addEventListener('mouseleave', removeTip);
  av.addEventListener('click', (e) => {
    e.stopPropagation(); removeTip();
    const existing = document.querySelector('.assignee-panel'); if (existing) existing.remove();
    const panel = document.createElement('div'); panel.className='assignee-panel'; panel.style.position='fixed'; panel.style.zIndex='2147483646';
    const addOpt = (label, value) => {
      const b = document.createElement('button');
      b.type='button';
      b.className='assignee-option';
      b.textContent=label;
      b.addEventListener('click', async (ev)=>{
        ev.stopPropagation();
        try {
          await updateTaskAssignment(caseId, taskId, value, { caseTitle: caseTitleEl?.textContent || null, taskText: titleSpan.textContent || text });
          renderCaseTasks();
        } catch(err){
          console.error('Failed to reassign',err);
          showToast('Failed to update assignee');
        } finally { panel.remove(); }
      });
      panel.appendChild(b);
    };
    addOpt('Open task', null); for (const u of usersCache) addOpt(u.username, u.username);
    document.body.appendChild(panel);
    const r = av.getBoundingClientRect(); requestAnimationFrame(()=>{ const w=panel.offsetWidth||180; const left=Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8); const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6); panel.style.left=`${Math.round(left)}px`; panel.style.top=`${Math.round(top)}px`; });
    const onDocClick = (evt)=>{ if (!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); }; setTimeout(()=>document.addEventListener('click', onDocClick, true),0);
  });
  li.appendChild(av);
  // Comments unobtrusive below (hidden by default)
  const toggle = document.createElement('button'); toggle.type='button'; toggle.className='icon-btn comment-toggle'; toggle.setAttribute('aria-label','Show comments'); toggle.textContent='💬';
  const countEl = document.createElement('span'); countEl.className='badge comment-count';
  li.appendChild(toggle); li.appendChild(countEl);
  const commentSection = document.createElement('div'); commentSection.className='comment-section'; commentSection.hidden= !(opts && opts.openComments); const commentsList=document.createElement('ul'); commentsList.className='comments'; commentSection.appendChild(commentsList);
  const commentForm=document.createElement('form'); commentForm.className='comment-form'; const commentInput=document.createElement('input'); commentInput.placeholder='Add comment'; commentForm.appendChild(commentInput); const commentBtn=document.createElement('button'); commentBtn.className='icon-btn add-comment-btn'; commentBtn.type='submit'; commentBtn.textContent='➕'; commentBtn.setAttribute('aria-label','Add comment'); commentForm.appendChild(commentBtn); commentSection.appendChild(commentForm);
  let commentsLoaded=false; let commentCount=0; const updateToggle=()=>{ countEl.textContent = commentCount>0? String(commentCount):''; toggle.setAttribute('aria-label', commentSection.hidden?'Show comments':'Hide comments'); toggle.textContent = commentSection.hidden ? '💬' : '✖'; };
  updateToggle();
  if (!commentSection.hidden && !commentsLoaded) {
    startRealtimeComments(caseId, taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); });
    commentsLoaded = true;
  }
  toggle.addEventListener('click', ()=>{ const h=commentSection.hidden; commentSection.hidden=!h; updateToggle(); if(h && !commentsLoaded){ startRealtimeComments(caseId, taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } });
  commentForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const t=commentInput.value.trim(); if(!t) return; const tempLi=document.createElement('li'); tempLi.className='optimistic'; const span=document.createElement('span'); span.textContent = username ? `${username}: ${t}` : t; tempLi.appendChild(span); commentsList.appendChild(tempLi); commentInput.value=''; commentSection.hidden=false; updateToggle(); try{ const {cipher, iv}= await encryptText(t); await addDoc(collection(db,'cases',caseId,'tasks',taskId,'comments'),{cipher,iv,username,createdAt:serverTimestamp()}); try { await logUpdate({ type: 'comment_added', caseId, caseTitle: (caseTitleEl && caseTitleEl.textContent) || 'Case', taskId, commentCipher: cipher, commentIv: iv }); } catch {} if(!commentsLoaded){ startRealtimeComments(caseId,taskId,commentsList,(n)=>{ commentCount=n; updateToggle();}); commentsLoaded=true; } } catch(err){ tempLi.classList.add('failed'); showToast('Failed to add comment'); } });
  li.appendChild(commentSection);
  return li;
}
function bindCaseForm() {
  if (!caseForm) return;
  caseForm.addEventListener('submit', async e => {
    e.preventDefault();
    const title = caseInput.value.trim();
    if (!title) return;
    const { cipher, iv } = await encryptText(title);
    const location = caseLocationSel ? (caseLocationSel.value || null) : null;
    await addDoc(collection(db, 'cases'), {
      titleCipher: cipher,
      titleIv: iv,
      createdAt: serverTimestamp(),
      username,
      location,
    });
    caseInput.value = '';
    if (caseLocationSel) caseLocationSel.value = '';
  });
}

function bindTaskForm() {
  populateComposerAssignees();
  if (document.getElementById('task-input') && document.getElementById('composer-opts')) {
    document.getElementById('task-input').addEventListener('focus', () => {
      document.getElementById('composer-opts').hidden = false;
    });
  }
  taskForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCaseId) return;
    const text = taskInput.value.trim();
    const statusVal = 'open';
    if (!text) return;
    const { cipher: textCipher, iv: textIv } = await encryptText(text);
    const { cipher: statusCipher, iv: statusIv } = await encryptText(statusVal);
    const assigneeSel = document.getElementById('task-assignee');
    const priSel = document.getElementById('task-priority');
    const assignee = assigneeSel ? (assigneeSel.value || null) : null;
    const priority = priSel ? (priSel.value || null) : null;
    const payload = buildTaskCreationPayload({ textCipher, textIv, statusCipher, statusIv, assignee, priority });
    const ref = await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), payload);
    // Log update: task added
    try {
      await logUpdate({
        type: 'task_added',
        caseId: currentCaseId,
        taskId: ref.id,
        taskTextCipher: textCipher,
        taskTextIv: textIv,
        assignee,
        priority,
      });
      if (assignee) {
        await logUpdate({
          type: 'task_assigned',
          caseId: currentCaseId,
          taskId: ref.id,
          taskTextCipher: textCipher,
          taskTextIv: textIv,
          assignee,
        });
      }
    } catch {}
    taskInput.value = '';
    if (assigneeSel) assigneeSel.value = '';
    if (priSel) priSel.value = '';
  });
}

// Keep the composer assignee list in sync with usersCache
function populateComposerAssignees() {
  const sel = document.getElementById('task-assignee');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Open task (team)';
  sel.appendChild(none);
  for (const u of usersCache) {
    const opt = document.createElement('option');
    opt.value = u.username;
    opt.textContent = u.username;
    sel.appendChild(opt);
  }
  sel.value = prev || '';
}

function bindNoteForm() {
  if (!noteForm) return;
  noteForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentCaseId) return;
    const text = noteInput.value.trim();
    if (!text) return;
    const { cipher, iv } = await encryptText(text);
    await addDoc(collection(db, 'cases', currentCaseId, 'notes'), {
      cipher, iv, username, createdAt: serverTimestamp(),
    });
    try { await logUpdate({ type: 'note_added', caseId: currentCaseId, caseTitle: (caseTitleEl && caseTitleEl.textContent) || 'Case', noteTextCipher: cipher, noteTextIv: iv }); } catch {}
    noteInput.value = '';
  });
}

// --- Init on load
window.addEventListener('DOMContentLoaded', async () => {
  caseListEl = document.getElementById('case-list');
  caseListSection = document.getElementById('case-list-section');
  caseForm = document.getElementById('case-form');
  caseInput = document.getElementById('case-input');
  caseLocationSel = document.getElementById('case-location');
  caseDetailEl = document.getElementById('case-detail');
  caseTitleEl = document.getElementById('case-title');
  updatesSection = document.getElementById('updates-section');
  updatesListEl = document.getElementById('updates-list');
  updatesToolbarEl = document.getElementById('updates-toolbar');
  updatesUserFilterEl = document.getElementById('updates-user-filter');
  updatesSearchEl = document.getElementById('updates-search');
  updatesLoadMoreBtn = document.getElementById('updates-load-more');
  backBtn = document.getElementById('back-btn');
  taskForm = document.getElementById('task-form');
  taskInput = document.getElementById('task-input');
  taskListEl = document.getElementById('task-list');
  taskAssigneeEl = document.getElementById('task-assignee');
  taskPriorityEl = document.getElementById('task-priority');
  composerOptsEl = document.getElementById('composer-opts');
  // A–F inputs in Notes tab
  colAInput = document.getElementById('colA-input');
  colBInput = document.getElementById('colB-input');
  colCInput = document.getElementById('colC-input');
  colDInput = document.getElementById('colD-input');
  colEInput = document.getElementById('colE-input');
  colFInput = document.getElementById('colF-input');
  colABody = document.getElementById('colA-body');
  colBBody = document.getElementById('colB-body');
  colCBody = document.getElementById('colC-body');
  colDBody = document.getElementById('colD-body');
  colEBody = document.getElementById('colE-body');
  // Notes embedded tasks removed
  tabOverviewBtn = document.getElementById('tab-overview');
  tabWardNotesBtn = document.getElementById('tab-wardnotes');
  wardNotesSection = document.getElementById('ward-notes');
  wardNotesListEl = document.getElementById('ward-notes-list');
  newWardNoteBtn = document.getElementById('new-ward-note');
  // Main tabs
  const mainTabTable = document.getElementById('tab-table');
  const mainTabCases = document.getElementById('tab-cases');
  const mainTabMy = document.getElementById('tab-my');
  const mainTabUpdates = document.getElementById('tab-updates');
  userDetailEl = document.getElementById('user-detail');
  userTitleEl = document.getElementById('user-title');
  userTaskListEl = document.getElementById('user-task-list');
  userBackBtn = document.getElementById('user-back-btn');
  brandHome = document.getElementById('brand-home');
  headerClockEl = document.getElementById('header-clock');
  sessionUserChipEl = document.getElementById('session-user-chip');
  quickNewCaseBtn = document.getElementById('quick-new-case-btn');
  quickWardNotesBtn = document.getElementById('quick-ward-notes-btn');
  quickShortcutsBtn = document.getElementById('quick-shortcuts-btn');
  metricVisibleCasesEl = document.getElementById('metric-visible-cases');
  metricOpenTasksEl = document.getElementById('metric-open-tasks');
  metricProgressTasksEl = document.getElementById('metric-progress-tasks');
  metricCompleteTasksEl = document.getElementById('metric-complete-tasks');
  metricUsersEl = document.getElementById('metric-users');
  metricLocationsEl = document.getElementById('metric-locations');
  metricsThroughputEl = document.getElementById('metrics-throughput');
  metricsUpdatedEl = document.getElementById('metrics-updated');
  setupWorkspaceEnhancements();
  updateTableStickyOffset();
  window.addEventListener('resize', scheduleTableStickyOffsetUpdate, { passive: true });
  window.addEventListener('scroll', scheduleTableStickyOffsetUpdate, { passive: true });
  // Add a Delete Case button next to the case title if not present
  // Case header overflow menu (⋯) with Delete
  const actionsWrap = document.getElementById('case-header-actions');
  if (actionsWrap && !document.getElementById('case-overflow-btn')) {
    // New Ward Note quick action
    if (!document.getElementById('new-ward-note-header')) {
      const nn = document.createElement('button');
      nn.id = 'new-ward-note-header';
      nn.className = 'btn';
      nn.type = 'button';
      nn.textContent = 'New Note';
      nn.addEventListener('click', openWardNoteComposerV2);
      actionsWrap.appendChild(nn);
    }
    const btn = document.createElement('button');
    btn.id = 'case-overflow-btn';
    btn.className = 'icon-btn case-overflow-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '⋯';
    const panel = document.createElement('div');
    panel.id = 'case-overflow-panel';
    panel.className = 'case-overflow-panel';
    panel.hidden = true;
    const addItem = (label, onClick, danger=false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'case-overflow-item' + (danger ? ' delete' : '');
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); panel.hidden = true; btn.setAttribute('aria-expanded','false'); });
      panel.appendChild(b);
    };
    addItem('Delete case', async () => {
      if (!currentCaseId) return;
      if (!confirm('Delete this case and all its items?')) return;
      try {
        await deleteCaseDeep(currentCaseId);
        currentCaseId = null;
        caseDetailEl.hidden = true;
        if (tableSection) tableSection.hidden = false;
        showToast('Case deleted');
      } catch (err) { console.error('Failed to delete case', err); showToast('Failed to delete case'); }
    }, true);
    actionsWrap.appendChild(btn);
    actionsWrap.appendChild(panel);
    const toggle = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); toggle(panel.hidden); });
    document.addEventListener('click', (e)=>{ if (!panel.hidden && e.target !== btn && !panel.contains(e.target)) toggle(false); }, true);
  }
  userFilterEl = document.getElementById('user-filter');
  userStatusEls = Array.from(document.querySelectorAll('.user-status'));
  userPriorityFilterEl = document.getElementById('user-priority-filter');
  userSortEl = document.getElementById('user-sort');
  tableSection = document.getElementById('table-section');
  tableRoot = document.getElementById('table-root');
  const hideFiltersBtn = document.getElementById('hide-filters-btn');
  const showFiltersBtn = document.getElementById('show-filters-btn');
  const printOpenBtn = document.getElementById('print-open-btn');
  wardNotesPrintBtn = document.getElementById('ward-notes-print-btn');
  // Tag controls
  filterLocationSel = document.getElementById('filter-location');
  filterConsultantSel = document.getElementById('filter-consultant');
  sortByTagSel = document.getElementById('sort-by-tag');
  clearTagFiltersBtn = document.getElementById('clear-tag-filters');

  bindCaseForm();
  bindTaskForm();
  bindNoteForm();
  bindNotesFields();
  if (newWardNoteBtn) newWardNoteBtn.addEventListener('click', openWardNoteComposerV2);
  bindCaseTabs();
  // Ensure Overview visible by default
  showCaseSection('overview');
  // Main tab bindings
  if (mainTabTable) mainTabTable.addEventListener('click', () => showMainTab('table'));
  if (mainTabUpdates) mainTabUpdates.addEventListener('click', () => showMainTab('updates'));
  if (updatesUserFilterEl) updatesUserFilterEl.addEventListener('change', () => { updatesUserFilter = updatesUserFilterEl.value || ''; renderUpdatesList(); });
  if (updatesSearchEl) updatesSearchEl.addEventListener('input', () => { updatesSearch = updatesSearchEl.value.trim(); renderUpdatesList(); });
  if (updatesLoadMoreBtn) updatesLoadMoreBtn.addEventListener('click', loadMoreUpdates);
  if (mainTabMy) mainTabMy.addEventListener('click', () => showMainTab('my'));
  if (wardNotesPrintBtn) wardNotesPrintBtn.addEventListener('click', openWardNotesRangeModal);
  // Filters show/hide
  const filtersKey = 'tableFiltersHidden';
  if (hideFiltersBtn) hideFiltersBtn.addEventListener('click', () => setTableFiltersHidden(true));
  if (showFiltersBtn) showFiltersBtn.addEventListener('click', () => setTableFiltersHidden(false));
  try { const hidden = localStorage.getItem(filtersKey) === '1'; setTableFiltersHidden(hidden); } catch {}
  // Load persisted tag filter state (URL/localStorage)
  loadTagFilterState();
  try { showDischargedCases = localStorage.getItem('table.showDischargedCases') === '1'; } catch { showDischargedCases = false; }
  // Print action in header
  if (printOpenBtn) {
    printOpenBtn.addEventListener('click', () => {
      const ts = new Date().toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const html = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Print Table</title><link rel=\"stylesheet\" href=\"style.css\"></head><body class=\"print-mode\"><div class=\"print-header\">Printed ${ts}</div><section id=\"table-section\">${tableRoot ? tableRoot.innerHTML : ''}</section><script>window.addEventListener('load',function(){ setTimeout(function(){ window.print(); }, 50); });</script></body></html>`;
      const w = window.open('', '_blank');
      if (!w) { showToast('Pop-up blocked. Allow pop-ups to print.'); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    });
  }
  // Print action: open new window in print mode and print
  if (printOpenBtn) {
    printOpenBtn.addEventListener('click', () => {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Print Table</title><link rel="stylesheet" href="style.css"></head><body class="print-mode"><section id="table-section">${tableRoot ? tableRoot.innerHTML : ''}</section><script>window.addEventListener('load',function(){ setTimeout(function(){ window.print(); }, 50); });</script></body></html>`;
      const w = window.open('', '_blank');
      if (!w) { showToast('Pop-up blocked. Allow pop-ups to print.'); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    });
  }
  backBtn.addEventListener('click', () => {
    if (backTarget === 'user' && userDetailEl) {
      // Leave case view, return to user page
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
      if (unsubNotes) { unsubNotes(); unsubNotes = null; }
      if (unsubCaseDoc) { unsubCaseDoc(); unsubCaseDoc = null; }
      currentCaseId = null;
      caseDetailEl.hidden = true;
      userDetailEl.hidden = false;
      setWorkspaceOverviewVisible(true);
      if (caseListSection) caseListSection.style.display = 'none';
      backTarget = 'list';
    } else if (backTarget === 'updates' && updatesSection) {
      // Return to updates tab
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
      if (unsubNotes) { unsubNotes(); unsubNotes = null; }
      if (unsubCaseDoc) { unsubCaseDoc(); unsubCaseDoc = null; }
      currentCaseId = null;
      caseDetailEl.hidden = true;
      showMainTab('updates');
      setWorkspaceOverviewVisible(true);
      // Clear case param
      try { const url = new URL(window.location.href); url.searchParams.delete('case'); window.history.pushState({}, '', url.toString()); } catch {}
    } else {
      // Return to table
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
      if (unsubNotes) { unsubNotes(); unsubNotes = null; }
      if (unsubCaseDoc) { unsubCaseDoc(); unsubCaseDoc = null; }
      currentCaseId = null;
      caseDetailEl.hidden = true;
      if (tableSection) tableSection.hidden = false;
      setWorkspaceOverviewVisible(true);
      // Restore scroll and clear URL param
      try { window.scrollTo(0, tableScrollY || 0); const url = new URL(window.location.href); url.searchParams.delete('case'); window.history.pushState({}, '', url.toString()); } catch {}
    }
  });
  if (userBackBtn) {
    userBackBtn.addEventListener('click', () => {
      userDetailEl.hidden = true;
      // Return to prior view: case detail if one is open, else table
      if (currentCaseId) {
        caseDetailEl.hidden = false;
        setWorkspaceOverviewVisible(false);
        if (caseListSection) caseListSection.style.display = 'none';
      } else {
        if (tableSection) tableSection.hidden = false;
        setWorkspaceOverviewVisible(true);
      }
      if (Array.isArray(unsubUserTasks)) {
        for (const u of unsubUserTasks) try { u(); } catch {}
        unsubUserTasks = [];
      }
    });
  }
  if (brandHome) {
    brandHome.addEventListener('click', () => {
      // Go to table
      if (tableSection) tableSection.hidden = false;
      caseDetailEl.hidden = true;
      userDetailEl.hidden = true;
      setWorkspaceOverviewVisible(true);
    });
  
  // React toolbar events -> filter/sort case tasks
  document.addEventListener('taskToolbar:status', (e) => {
    const detail = (e && e.detail) || {};
    toolbarStatuses = new Set((detail.statuses || []).map(String));
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:priority', (e) => {
    toolbarPriority = (e && e.detail && e.detail.priority) || 'all';
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:sort', (e) => {
    toolbarSort = (e && e.detail && e.detail.sort) || 'none';
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:search', (e) => {
    toolbarSearch = (e && e.detail && e.detail.query) || '';
    renderCaseTasks();
  });
  document.addEventListener('taskToolbar:clear', () => {
    toolbarStatuses = new Set(['open','in progress','complete']);
    toolbarPriority = 'all';
    toolbarSort = 'none';
    toolbarSearch = '';
    renderCaseTasks();
  });

  // Defer tags + filter UI setup until after sign-in
}
  // React User toolbar events
  document.addEventListener('userToolbar:status', (e) => {
    const detail = (e && e.detail) || {};
    currentUserStatusSet = new Set((detail.statuses || []).map(String));
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:priority', (e) => {
    currentUserPriorityFilter = (e && e.detail && e.detail.priority) || 'all';
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:sort', (e) => {
    currentUserSort = (e && e.detail && e.detail.sort) || 'none';
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:search', (e) => {
    currentUserSearch = (e && e.detail && e.detail.query) || '';
    saveUserFilterState();
    renderUserTasks();
  });
  document.addEventListener('userToolbar:assignee', (e) => {
    const a = (e && e.detail && e.detail.assignee) || 'me';
    currentAssigneeFilter = a;
    saveUserFilterState();
    setUserHeader();
    // Try cached first
    const cached = userTasksCacheByKey.get(assigneeKey());
    if (cached && cached.perCase && cached.titles) {
      userPerCase = new Map(cached.perCase);
      userCaseTitles = new Map(cached.titles);
      renderUserTasks();
    }
    // Restart listener
    startRealtimeUserTasks(currentUserPageName || username);
  });
  document.addEventListener('userToolbar:clear', () => {
    currentUserStatusSet = new Set(['open','in progress','complete']);
    currentUserPriorityFilter = 'all';
    currentUserSort = 'none';
    saveUserFilterState();
    renderUserTasks();
  });

  try {
    await signInAnonymously(auth);
  } catch (err) {
    console.error('Failed to sign in anonymously', err);
    return;
  }
  // First, passphrase
  const pass = prompt('Enter shared passphrase');
  if (!pass) return;
  key = await deriveKey(pass);
  // Then pick a user from dropdown modal fed by live users list
  username = await showUserSelectModal();
  if (!username) return;
  updateSessionUserBadge(username);
  setWorkspaceActionState(true);
  startRealtimeDashboardTasks();
  // Now that we're signed in and have a user, start tags + build filter UI
  startRealtimeTags();
  bindTagControls();
  setupTableFilterUI();
  // Reflect persisted filter state in hidden native selects and render
  if (filterLocationSel) Array.from(filterLocationSel.options).forEach(o => { o.selected = activeTagFilters.location.has(o.value); });
  if (filterConsultantSel) Array.from(filterConsultantSel.options).forEach(o => { o.selected = activeTagFilters.consultant.has(o.value); });
  // Removed: startRealtimeCases(); now table is the primary index
  // Start settings (users + locations)
  startRealtimeUsers();
  // Default tab
  const mobileDefault = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  showMainTab(mobileDefault ? 'my' : 'table');
  // URL deep link: open case if ?case=
  try {
    const url = new URL(window.location.href);
    const caseId = url.searchParams.get('case');
    if (caseId) {
      // Title is unknown without decrypt; open with placeholder
      openCase(caseId, 'Case', 'table', 'notes');
    }
  } catch {}
  // Handle browser back/forward between table and case
  window.addEventListener('popstate', () => {
    try {
      const url = new URL(window.location.href);
      const cid = url.searchParams.get('case');
      if (cid) {
        // If already on this case, ignore; else open
        if (currentCaseId !== cid) openCase(cid, 'Case', 'table', 'notes');
      } else {
        // Show table
        caseDetailEl.hidden = true;
        if (tableSection) tableSection.hidden = false;
        setWorkspaceOverviewVisible(true);
      }
    } catch {}
  });
});

// Toast utility
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 3300);
}

// Deep delete a case and nested content
async function deleteCaseDeep(caseId) {
  // Delete tasks and their comments
  const tasks = await getDocs(collection(db, 'cases', caseId, 'tasks'));
  for (const t of tasks.docs) {
    const comments = await getDocs(collection(db, 'cases', caseId, 'tasks', t.id, 'comments'));
    await Promise.all(comments.docs.map((c) => deleteDoc(doc(db, 'cases', caseId, 'tasks', t.id, 'comments', c.id))));
    await deleteDoc(doc(db, 'cases', caseId, 'tasks', t.id));
  }
  // Delete notes
  const notes = await getDocs(collection(db, 'cases', caseId, 'notes'));
  await Promise.all(notes.docs.map((n) => deleteDoc(doc(db, 'cases', caseId, 'notes', n.id))));
  // Delete case doc
  await deleteDoc(doc(db, 'cases', caseId));
}

// --- Presence: users list
function startRealtimeUsers() {
  const list = document.getElementById('user-list');
  const addBtn = document.getElementById('add-user-btn');
  const menu = document.getElementById('users-menu');
  const btn = document.getElementById('users-btn');
  const locList = document.getElementById('location-list');
  const addLocBtn = document.getElementById('add-location-btn');
  const manageTagsBtn = document.getElementById('manage-tags-btn');
  if (!list || !addBtn || !menu || !btn || !locList || !addLocBtn) return;

  // Toggle dropdown
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false);
  });

  // Add user
  addBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = (prompt('Add user name') || '').trim();
    if (!name) return;
    await addDoc(collection(db, 'users'), { username: name, createdAt: serverTimestamp() });
  });

  if (manageTagsBtn) {
    manageTagsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(false);
      openTagsManager();
    });
  }

  const q = query(collection(db, 'users'), orderBy('username'));
  if (unsubUsers) { unsubUsers(); unsubUsers = null; }
  unsubUsers = onSnapshot(q, snap => {
    list.innerHTML = '';
    usersCache = [];
    for (const d of snap.docs) {
      const data = d.data();
      const name = data.username || 'Unknown';
      usersCache.push({ id: d.id, username: name });

      const li = document.createElement('li');
      const nameBtn = document.createElement('button');
      nameBtn.className = 'name icon-btn';
      nameBtn.textContent = name;
      nameBtn.addEventListener('click', () => {
        setOpen(false);
        // Switch current user context and open their tasks
        username = name;
        openUser(name);
      });

      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.textContent = '✏️';
      edit.setAttribute('aria-label', `Edit ${name}`);
      edit.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = (prompt('Edit user name', name) || '').trim();
        if (!next || next === name) return;
        await updateDoc(doc(db, 'users', d.id), { username: next });
      });

      const del = document.createElement('button');
      del.className = 'icon-btn delete-btn';
      del.textContent = '🗑';
      del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete user '${name}'?`)) return;
        await deleteDoc(doc(db, 'users', d.id));
      });

      li.appendChild(nameBtn);
      li.appendChild(edit);
      li.appendChild(del);
      list.appendChild(li);
    }
    updateDashboardStats({ users: usersCache.length });
    // Update composer assignee select with latest users
    populateComposerAssignees();
    // Inform My Tasks toolbar about users for the assignee selector
    try { const names = usersCache.map(u => u.username); document.dispatchEvent(new CustomEvent('userToolbar:users', { detail: { users: names } })); } catch {}
  });

  // Locations realtime
  const qLoc = query(collection(db, 'locations'), orderBy('name'));
  if (unsubLocations) { unsubLocations(); unsubLocations = null; }
  unsubLocations = onSnapshot(qLoc, (snap) => {
    locList.innerHTML = '';
    locationsCache = [];
    for (const d of snap.docs) {
      const data = d.data();
      const name = (data.name || '').trim() || 'Unnamed';
      locationsCache.push({ id: d.id, name });

      const li = document.createElement('li');
      const nameBtn = document.createElement('button');
      nameBtn.className = 'name icon-btn';
      nameBtn.textContent = name;

      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.textContent = '✏️';
      edit.setAttribute('aria-label', `Edit ${name}`);
      edit.addEventListener('click', async (e) => {
        e.stopPropagation();
        const next = (prompt('Edit location', name) || '').trim();
        if (!next || next === name) return;
        try {
          await updateDoc(doc(db, 'locations', d.id), { name: next });
        } catch (err) {
          console.error('Failed to update location', err);
          showToast('Failed to update location (permissions)');
        }
      });

      const del = document.createElement('button');
      del.className = 'icon-btn delete-btn';
      del.textContent = '🗑';
      del.setAttribute('aria-label', `Delete ${name}`);
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete location '${name}'?`)) return;
        try {
          await deleteDoc(doc(db, 'locations', d.id));
        } catch (err) {
          console.error('Failed to delete location', err);
          showToast('Failed to delete location (permissions)');
        }
      });

      li.appendChild(nameBtn);
      li.appendChild(edit);
      li.appendChild(del);
      locList.appendChild(li);
    }
    // Update case creation select with latest locations
    populateCaseLocationSelect();
  }, (err) => {
    console.error('Locations listener error', err);
    showToast('Cannot access locations (permissions)');
  });

  function openTagsManager() {
    const overlay = document.createElement('div'); overlay.className='modal-overlay';
    const modal = document.createElement('div'); modal.className='modal tags-manager'; overlay.appendChild(modal);
    const title = document.createElement('h3'); title.textContent = 'Manage Tags'; modal.appendChild(title);
    const tabWrap = document.createElement('div'); tabWrap.className='tabs';
    const tabLoc = document.createElement('button'); tabLoc.className='tab active'; tabLoc.textContent='Locations'; tabWrap.appendChild(tabLoc);
    const tabCons = document.createElement('button'); tabCons.className='tab'; tabCons.textContent='Consultants'; tabWrap.appendChild(tabCons);
    modal.appendChild(tabWrap);
    const content = document.createElement('div'); modal.appendChild(content);
    const actions = document.createElement('div'); actions.className='section-actions'; modal.appendChild(actions);
    const closeBtn = document.createElement('button'); closeBtn.className='btn'; closeBtn.textContent='Close'; actions.appendChild(closeBtn);
    document.body.appendChild(overlay);

    const setTab = (which) => { tabLoc.classList.toggle('active', which==='loc'); tabCons.classList.toggle('active', which==='cons'); render(which); };
    tabLoc.addEventListener('click', ()=>setTab('loc'));
    tabCons.addEventListener('click', ()=>setTab('cons'));
    closeBtn.addEventListener('click', ()=> overlay.remove());

    // Re-render on tag/subtag changes
    const onTags = () => {
      const active = tabLoc.classList.contains('active') ? 'loc' : 'cons';
      render(active);
    };
    const onRooms = (e) => {
      if (!tabLoc.classList.contains('active')) return;
      // When rooms change, simply re-render current selection
      render('loc');
    };
    document.addEventListener('tags:updated', onTags);
    document.addEventListener('subtags:updated', onRooms);
    const cleanup = () => {
      document.removeEventListener('tags:updated', onTags);
      document.removeEventListener('subtags:updated', onRooms);
    };
    closeBtn.addEventListener('click', cleanup, { once: true });

    // Initial render
    setTab('loc');

    async function render(which) {
      content.innerHTML = '';
      if (which === 'cons') { renderTypeManager('consultant'); return; }
      const grid = document.createElement('div'); grid.className='grid'; content.appendChild(grid);
      const left = document.createElement('div'); left.className='tags-list'; grid.appendChild(left);
      const right = document.createElement('div'); right.className='rooms-list'; grid.appendChild(right);
      const lh = document.createElement('h4'); lh.textContent='Wards'; left.appendChild(lh);
      const rh = document.createElement('h4'); rh.textContent='Rooms'; right.appendChild(rh);
      const list = document.createElement('div'); left.appendChild(list);
      const lActions = document.createElement('div'); lActions.className='section-actions'; left.appendChild(lActions);
      const addWardBtn = document.createElement('button'); addWardBtn.textContent='Add ward'; addWardBtn.className='btn'; lActions.appendChild(addWardBtn);
      let selected = (tagsByType.get('location')||[])[0]?.id || '';

      function renderWards() {
        list.innerHTML = '';
        const arr = (tagsByType.get('location') || []);
        for (let i=0;i<arr.length;i++) {
          const t = arr[i];
          const row = document.createElement('div'); row.className='entry';
          const name = document.createElement('span'); name.className='name'; name.textContent = `${i+1}. ${t.name}`; row.appendChild(name);
          row.addEventListener('click', ()=>{ selected=t.id; renderRooms(); });
          const ra = document.createElement('div'); ra.className='row-actions';
          const up=document.createElement('button'); up.textContent='↑'; up.addEventListener('click', ()=> moveTag('location', i, -1)); ra.appendChild(up);
          const down=document.createElement('button'); down.textContent='↓'; down.addEventListener('click', ()=> moveTag('location', i, +1)); ra.appendChild(down);
          const edit=document.createElement('button'); edit.textContent='Edit'; edit.addEventListener('click', ()=> editTagName(t.id, t.name)); ra.appendChild(edit);
          const del=document.createElement('button'); del.textContent='Delete'; del.addEventListener('click', ()=> deleteTag('location', t.id)); ra.appendChild(del);
          row.appendChild(ra); list.appendChild(row);
        }
      }
      renderWards();
      addWardBtn.addEventListener('click', ()=> addTag('location'));

      async function renderRooms() {
        right.innerHTML = ''; const rh2=document.createElement('h4'); rh2.textContent='Rooms'; right.appendChild(rh2);
        const cont=document.createElement('div'); right.appendChild(cont);
        const rooms = await loadSubtagsFor(selected);
        for (let i=0;i<rooms.length;i++) {
          const r=rooms[i];
          const row=document.createElement('div'); row.className='entry';
          const name=document.createElement('span'); name.className='name'; name.textContent=`${i+1}. ${r.name}`; row.appendChild(name);
          const ra=document.createElement('div'); ra.className='row-actions';
          const up=document.createElement('button'); up.textContent='↑'; up.addEventListener('click', ()=> moveRoom(selected, i, -1)); ra.appendChild(up);
          const down=document.createElement('button'); down.textContent='↓'; down.addEventListener('click', ()=> moveRoom(selected, i, +1)); ra.appendChild(down);
          const edit=document.createElement('button'); edit.textContent='Edit'; edit.addEventListener('click', ()=> editRoomName(selected, r.id, r.name)); ra.appendChild(edit);
          const del=document.createElement('button'); del.textContent='Delete'; del.addEventListener('click', ()=> deleteRoom(selected, r.id)); ra.appendChild(del);
          row.appendChild(ra); cont.appendChild(row);
        }
        const rAct=document.createElement('div'); rAct.className='section-actions'; right.appendChild(rAct);
        const addRoomBtn=document.createElement('button'); addRoomBtn.className='btn'; addRoomBtn.textContent='Add room'; addRoomBtn.addEventListener('click', ()=> addRoom(selected)); rAct.appendChild(addRoomBtn);
      }
      renderRooms();
    }

    function renderTypeManager(type) {
      content.innerHTML='';
      const box=document.createElement('div'); box.className='tags-list'; content.appendChild(box);
      const h=document.createElement('h4'); h.textContent= type==='consultant'?'Consultants': type; box.appendChild(h);
      const list=document.createElement('div'); box.appendChild(list);
      const arr=(tagsByType.get(type)||[]);
      for (let i=0;i<arr.length;i++) {
        const t=arr[i]; const row=document.createElement('div'); row.className='entry';
        const name=document.createElement('span'); name.className='name'; name.textContent=`${i+1}. ${t.name}`; row.appendChild(name);
        const ra=document.createElement('div'); ra.className='row-actions';
        const up=document.createElement('button'); up.textContent='↑'; up.addEventListener('click', ()=> moveTag(type, i, -1)); ra.appendChild(up);
        const down=document.createElement('button'); down.textContent='↓'; down.addEventListener('click', ()=> moveTag(type, i, +1)); ra.appendChild(down);
        const edit=document.createElement('button'); edit.textContent='Edit'; edit.addEventListener('click', ()=> editTagName(t.id, t.name)); ra.appendChild(edit);
        const del=document.createElement('button'); del.textContent='Delete'; del.addEventListener('click', ()=> deleteTag(type, t.id)); ra.appendChild(del);
        row.appendChild(ra); list.appendChild(row);
      }
      const act=document.createElement('div'); act.className='section-actions'; box.appendChild(act);
      const addBtn=document.createElement('button'); addBtn.className='btn'; addBtn.textContent='Add'; addBtn.addEventListener('click', ()=> addTag(type)); act.appendChild(addBtn);
    }
  }

  // Add location → open Tags manager (unified tags system)
  addLocBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTagsManager();
  });
}

function populateCaseLocationSelect() {
  const sel = document.getElementById('case-location');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No location';
  sel.appendChild(none);
  for (const l of locationsCache) {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
  sel.value = prev || '';
}

// --- Tag catalog helpers (used by Tags Manager)
async function addTag(type) {
  try {
    const name = (prompt(`Add ${type}`) || '').trim();
    if (!name) return;
    const { cipher, iv } = await encryptText(name);
    const arr = (tagsByType.get(type) || []);
    await addDoc(collection(db, 'tags'), { type, order: arr.length, nameCipher: cipher, nameIv: iv });
  } catch (err) {
    console.error('Failed to add tag', err); showToast('Failed to add tag');
  }
}

async function editTagName(tagId, current) {
  try {
    const name = (prompt('Rename', current) || '').trim();
    if (!name) return;
    const { cipher, iv } = await encryptText(name);
    await updateDoc(doc(db, 'tags', tagId), { nameCipher: cipher, nameIv: iv });
  } catch (err) { console.error('Failed to rename tag', err); showToast('Failed to rename'); }
}

async function deleteTag(type, tagId) {
  try {
    if (!confirm('Delete tag and its rooms (if any)?')) return;
    const subs = await getDocs(collection(db, 'tags', tagId, 'subtags'));
    for (const s of subs.docs) await deleteDoc(doc(db, 'tags', tagId, 'subtags', s.id));
    await deleteDoc(doc(db, 'tags', tagId));
  } catch (err) { console.error('Failed to delete tag', err); showToast('Failed to delete'); }
}

async function moveTag(type, index, delta) {
  try {
    const arr = (tagsByType.get(type) || []).slice();
    const j = index + delta; if (j < 0 || j >= arr.length) return;
    const a = arr[index], b = arr[j];
    await Promise.all([
      updateDoc(doc(db, 'tags', a.id), { order: j }),
      updateDoc(doc(db, 'tags', b.id), { order: index }),
    ]);
  } catch (err) { console.error('Failed to reorder', err); showToast('Failed to reorder'); }
}

async function addRoom(parentId) {
  try {
    if (!parentId) return;
    const name = (prompt('Add room') || '').trim(); if (!name) return;
    const { cipher, iv } = await encryptText(name);
    const arr = (subtagsByParent.get(parentId) || []);
    await addDoc(collection(db, 'tags', parentId, 'subtags'), { type: 'room', order: arr.length, nameCipher: cipher, nameIv: iv });
  } catch (err) { console.error('Failed to add room', err); showToast('Failed to add room'); }
}

async function editRoomName(parentId, roomId, current) {
  try {
    const name = (prompt('Rename room', current) || '').trim(); if (!name) return;
    const { cipher, iv } = await encryptText(name);
    await updateDoc(doc(db, 'tags', parentId, 'subtags', roomId), { nameCipher: cipher, nameIv: iv });
  } catch (err) { console.error('Failed to rename room', err); showToast('Failed to rename room'); }
}

async function deleteRoom(parentId, roomId) {
  try {
    if (!confirm('Delete this room?')) return;
    await deleteDoc(doc(db, 'tags', parentId, 'subtags', roomId));
  } catch (err) { console.error('Failed to delete room', err); showToast('Failed to delete room'); }
}

async function moveRoom(parentId, index, delta) {
  try {
    const arr = (subtagsByParent.get(parentId) || []).slice();
    const j = index + delta; if (j < 0 || j >= arr.length) return;
    const a = arr[index], b = arr[j];
    await Promise.all([
      updateDoc(doc(db, 'tags', parentId, 'subtags', a.id), { order: j }),
      updateDoc(doc(db, 'tags', parentId, 'subtags', b.id), { order: index }),
    ]);
  } catch (err) { console.error('Failed to reorder room', err); showToast('Failed to reorder room'); }
}

function openUser(name) {
  clearPendingDischargeState();
  currentUserPageName = name;
  updateSessionUserBadge(name);
  // Title with inline change link
  setUserHeader();
  if (caseListSection) caseListSection.style.display = 'none';
  caseDetailEl.hidden = true;
  userDetailEl.hidden = false;
  // Bind change user link
  const changeBtn = document.getElementById('change-user-link');
  if (changeBtn) {
    changeBtn.addEventListener('click', async () => {
      const next = await showUserSelectModal();
      if (next && next !== username) {
        username = next;
        openUser(next);
      }
    }, { once: true });
  }
  // Restore last-used filters (multi-status, priority, sort) for this user
  const saved = userFilterByName.get(name);
  if (saved && typeof saved === 'object') {
    currentUserStatusSet = new Set(saved.statuses || ['open','in progress','complete']);
    currentUserPriorityFilter = saved.priority || 'all';
    currentUserSort = saved.sort || 'none';
    currentUserSearch = saved.search || '';
    currentAssigneeFilter = saved.assignee || 'me';
  } else {
    currentUserStatusSet = new Set(['open','in progress','complete']);
    currentUserPriorityFilter = 'all';
    currentUserSort = 'none';
    currentUserSearch = '';
    currentAssigneeFilter = 'me';
  }
  // Reflect in controls
  if (userStatusEls.length) userStatusEls.forEach(cb => cb.checked = currentUserStatusSet.has(cb.value));
  if (userPriorityFilterEl) userPriorityFilterEl.value = currentUserPriorityFilter;
  if (userSortEl) userSortEl.value = currentUserSort;
  // Hydrate React toolbar
  document.dispatchEvent(new CustomEvent('userToolbar:hydrate', { detail: {
    statuses: Array.from(currentUserStatusSet),
    priority: currentUserPriorityFilter,
    sort: currentUserSort,
    search: currentUserSearch,
    assignee: currentAssigneeFilter,
  }}));
  // If we have cached data for current assignee selection, render it immediately for snappy UX
  const cached = userTasksCacheByKey.get(assigneeKey());
  if (cached && cached.perCase && cached.titles) {
    userPerCase = new Map(cached.perCase);
    userCaseTitles = new Map(cached.titles);
    renderUserTasks();
  } else {
    // Show a lightweight loading indicator while first load happens
    if (userTaskListEl) { userTaskListEl.innerHTML = '<li style="list-style:none;color:var(--muted);padding:8px 0;">Loading…</li>'; }
  }
  startRealtimeUserTasks(name);
}

function setUserHeader() {
  if (!userTitleEl) return;
  let label = '';
  if (currentAssigneeFilter === 'all') label = 'All tasks';
  else if (currentAssigneeFilter === 'unassigned') label = 'Open tasks';
  else if (currentAssigneeFilter === 'me') label = `${username || currentUserPageName || 'Me'}'s tasks`;
  else if (currentAssigneeFilter.startsWith('name:')) label = `${currentAssigneeFilter.slice(5)}'s tasks`;
  userTitleEl.innerHTML = `${label} <button id="change-user-link" class="change-user-link" type="button">(Change user)</button>`;
}

function assigneeKey() {
  return currentAssigneeFilter || 'me';
}

function saveUserFilterState() {
  if (!currentUserPageName) return;
  userFilterByName.set(currentUserPageName, {
    statuses: Array.from(currentUserStatusSet),
    priority: currentUserPriorityFilter,
    sort: currentUserSort,
    search: currentUserSearch,
    assignee: currentAssigneeFilter,
  });
}

async function startRealtimeUserTasks(name) {
  // Clean up any prior listeners
  if (Array.isArray(unsubUserTasks)) {
    for (const u of unsubUserTasks) { try { u(); } catch {} }
    unsubUserTasks = [];
  }
  // Prepare current maps; keep existing titles (cache) where possible
  if (!userCaseTitles) userCaseTitles = new Map();
  if (!userPerCase) userPerCase = new Map();
  const tasksRef = collectionGroup(db, 'tasks');
  const snapshotsBySource = new Map();
  let buildSeq = 0;
  const targetUser = currentAssigneeFilter === 'me'
    ? (username || name)
    : (currentAssigneeFilter.startsWith('name:') ? currentAssigneeFilter.slice(5) : (username || name));

  const rebuildFromSnapshots = async () => {
    try {
      const seq = ++buildSeq;
      const merged = new Map();
      for (const docs of snapshotsBySource.values()) {
        for (const d of docs) merged.set(d.ref.path, d);
      }
      const docs = Array.from(merged.values());
      const perCase = new Map();
      const decryptPromises = [];
      const rawItems = [];
      const neededCaseIds = new Set();

      for (const d of docs) {
        const dat = d.data() || {};
        const caseRef = d.ref.parent && d.ref.parent.parent;
        const caseId = caseRef ? caseRef.id : null;
        if (!caseId) continue;
        const state = normalizeTaskAssignmentState(dat);
        const assignee = dat.assignee || null;
        const openTask = isTaskOpenForTeam(dat);
        let include = false;
        if (currentAssigneeFilter === 'all') include = true;
        else if (currentAssigneeFilter === 'unassigned') include = openTask;
        else include = (assignee === targetUser) || openTask;
        if (!include) continue;

        neededCaseIds.add(caseId);
        const item = {
          taskId: d.id,
          caseId,
          assignee,
          priority: dat.priority || null,
          assignmentState: state,
          assignedBy: dat.assignedBy || null,
          assignedAt: dat.assignedAt || null,
          acceptedBy: dat.acceptedBy || null,
          acceptedAt: dat.acceptedAt || null,
          text: null,
          status: null,
        };
        rawItems.push(item);
        decryptPromises.push(
          Promise.all([
            safeDecryptText(dat.textCipher, dat.textIv),
            safeDecryptText(dat.statusCipher, dat.statusIv),
          ]).then(([text, status]) => {
            item.text = text;
            item.status = status || 'open';
          }).catch(() => {})
        );
      }

      await Promise.all(decryptPromises);
      if (seq !== buildSeq) return;

      for (const it of rawItems) {
        if (!it || !it.caseId || typeof it.text !== 'string') continue;
        if (!perCase.has(it.caseId)) perCase.set(it.caseId, []);
        perCase.get(it.caseId).push(it);
      }

      const titleFetches = [];
      for (const cid of neededCaseIds) {
        if (!userCaseTitles.has(cid)) {
          titleFetches.push(
            getDoc(doc(db, 'cases', cid)).then(async (cd) => {
              if (cd.exists()) {
                const cdat = cd.data();
                const title = await safeDecryptText(cdat.titleCipher, cdat.titleIv);
                userCaseTitles.set(cid, title || '(case)');
              } else {
                userCaseTitles.set(cid, '(case)');
              }
            }).catch(() => { userCaseTitles.set(cid, '(case)'); })
          );
        }
      }
      await Promise.all(titleFetches);
      if (seq !== buildSeq) return;

      userPerCase = perCase;
      userTasksCacheByKey.set(assigneeKey(), { perCase: new Map(perCase), titles: new Map(userCaseTitles) });
      if (userTasksEditing) { userTasksRebuildPending = true; return; }
      renderUserTasks();
    } catch (err) {
      console.error('Failed to build user tasks view', err);
    }
  };

  const attachSource = (key, q) => {
    const unsub = onSnapshot(q, (snap) => {
      snapshotsBySource.set(key, snap.docs);
      rebuildFromSnapshots();
    }, (err) => console.error('User tasks listener error', err));
    unsubUserTasks.push(unsub);
  };

  if (currentAssigneeFilter === 'all') {
    attachSource('all', tasksRef);
  } else if (currentAssigneeFilter === 'unassigned') {
    attachSource('open', query(tasksRef, where('assignee', '==', null)));
  } else {
    attachSource('assigned', query(tasksRef, where('assignee', '==', targetUser)));
    attachSource('open', query(tasksRef, where('assignee', '==', null)));
  }
}

function renderUserTasks() {
  if (!userTaskListEl) return;
  userTaskListEl.innerHTML = '';
  const targetUser = currentAssigneeFilter === 'me'
    ? (username || currentUserPageName)
    : (currentAssigneeFilter.startsWith('name:') ? currentAssigneeFilter.slice(5) : (username || currentUserPageName));
  const sections = {
    pending: new Map(),
    assigned: new Map(),
    open: new Map(),
  };

  const addToSection = (section, caseId, item) => {
    if (!sections[section].has(caseId)) sections[section].set(caseId, []);
    sections[section].get(caseId).push(item);
  };

  for (const [caseId, originalItems] of userPerCase.entries()) {
    let items = originalItems || [];
    if (currentUserStatusSet && currentUserStatusSet.size) items = items.filter(i => currentUserStatusSet.has(i.status));
    if (currentUserPriorityFilter !== 'all') items = items.filter(i => (i.priority || '') === currentUserPriorityFilter);
    if (currentUserSearch && currentUserSearch.trim()) {
      const q = currentUserSearch.toLowerCase();
      items = items.filter(i => (i.text || '').toLowerCase().includes(q));
    }
    for (const it of items) {
      const openTask = isTaskOpenForTeam(it);
      const pending = normalizeTaskAssignmentState(it) === TASK_ASSIGNMENT.PENDING && !!it.assignee;
      if (currentAssigneeFilter === 'unassigned') {
        if (openTask) addToSection('open', caseId, it);
        continue;
      }
      if (currentAssigneeFilter === 'all') {
        if (openTask) addToSection('open', caseId, it);
        else if (pending) addToSection('pending', caseId, it);
        else addToSection('assigned', caseId, it);
        continue;
      }
      if (openTask) addToSection('open', caseId, it);
      else if (it.assignee === targetUser && pending) addToSection('pending', caseId, it);
      else if (it.assignee === targetUser) addToSection('assigned', caseId, it);
    }
  }

  const priVal = (p) => p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0;
  const tsVal = (ts) => (ts && ts.toMillis) ? ts.toMillis() : 0;
  const sortCases = (map) => Array.from(map.keys()).sort((a, b) => (userCaseTitles.get(a) || '').localeCompare(userCaseTitles.get(b) || ''));
  const sectionCount = (map) => Array.from(map.values()).reduce((sum, arr) => sum + arr.length, 0);

  const buildUserTaskRow = (caseId, title, it) => {
    const pending = normalizeTaskAssignmentState(it) === TASK_ASSIGNMENT.PENDING && !!it.assignee;
    const pendingForMe = pending && (it.assignee === username);
    const li = document.createElement('li');
    const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
    li.className = 'case-task ' + statusCls + (pending ? ' task-pending-acceptance' : '');

    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'status-btn';
    const icon = (s)=> s==='complete'?'☑':(s==='in progress'?'◐':'☐');
    statusBtn.textContent = icon(it.status);
    statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
    statusBtn.disabled = pending;
    if (pending) statusBtn.title = 'Awaiting acceptance';
    statusBtn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if (statusBtn.disabled) return;
      const order=['open','in progress','complete'];
      const next=order[(order.indexOf(it.status)+1)%order.length];
      try{
        const {cipher, iv}= await encryptText(next);
        await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ statusCipher:cipher, statusIv:iv });
        it.status=next;
        statusBtn.textContent=icon(next);
        statusBtn.setAttribute('aria-label',`Task status: ${next}`);
        li.className='case-task '+(next==='in progress'?'s-inprogress':(next==='complete'?'s-complete':'s-open')) + (pending ? ' task-pending-acceptance' : '');
        if (next==='complete') {
          try {
            const tEnc = await encryptText(it.text || '');
            await logUpdate({ type: 'task_completed', caseId, caseTitle: title, taskId: it.taskId, taskTextCipher: tEnc.cipher, taskTextIv: tEnc.iv });
          } catch {}
        }
      } catch(err){ console.error('Failed to update status',err); showToast('Failed to update status'); }
    });
    li.appendChild(statusBtn);

    const titleSpan = document.createElement('span');
    titleSpan.className='task-text';
    titleSpan.textContent=it.text;
    titleSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      userTasksEditing = true;
      const ed = document.createElement('div');
      ed.className='cell-editable';
      ed.setAttribute('contenteditable','true');
      ed.textContent = it.text;
      let last = it.text;
      const endEdit = () => {
        try{ ed.remove(); }catch{}
        titleSpan.style.display='';
        userTasksEditing=false;
        if (userTasksRebuildPending) { userTasksRebuildPending=false; renderUserTasks(); }
      };
      const saveNow = async () => {
        const v=(ed.innerText||'').replace(/\r/g,'');
        if (v===last) { endEdit(); return; }
        try{
          const {cipher:textCipher, iv:textIv}= await encryptText(v);
          await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ textCipher, textIv });
          last=v;
          titleSpan.textContent=v;
        } catch(err){ console.error('Failed to update task',err); showToast('Failed to update task'); }
        endEdit();
      };
      ed.addEventListener('paste',(ev)=>{ ev.preventDefault(); const t=(ev.clipboardData||window.clipboardData).getData('text'); if (document.queryCommandSupported && document.queryCommandSupported('insertText')) { document.execCommand('insertText', false, t); } else { const sel=window.getSelection(); if (sel && sel.rangeCount) { sel.deleteFromDocument(); sel.getRangeAt(0).insertNode(document.createTextNode(t)); } } });
      ed.addEventListener('keydown',(ev)=>{ if (ev.key==='Enter' && !(ev.ctrlKey||ev.metaKey)) { ev.preventDefault(); saveNow(); } else if (ev.key==='Escape') { ev.preventDefault(); endEdit(); } });
      ed.addEventListener('blur', () => { saveNow(); });
      titleSpan.insertAdjacentElement('afterend', ed);
      titleSpan.style.display='none';
      ed.focus();
      placeCaretAtEnd(ed);
    });
    li.appendChild(titleSpan);

    const assignmentLabel = taskAssignmentStatusLabel(it);
    if (assignmentLabel) {
      const assignmentChip = document.createElement('span');
      assignmentChip.className = `assignment-state-chip ${pending ? 'pending' : 'open'}`;
      assignmentChip.textContent = assignmentLabel;
      li.appendChild(assignmentChip);
    }

    if (pendingForMe) {
      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'icon-btn small';
      acceptBtn.textContent = 'Accept';
      acceptBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await acceptTaskAssignment(caseId, it.taskId, { caseTitle: title, taskText: it.text });
          showToast('Task accepted');
        } catch (err) {
          console.error('Failed to accept task', err);
          showToast('Failed to accept task');
        }
      });
      li.appendChild(acceptBtn);
      const declineBtn = document.createElement('button');
      declineBtn.type = 'button';
      declineBtn.className = 'icon-btn small';
      declineBtn.textContent = 'Decline';
      declineBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await declineTaskAssignment(caseId, it.taskId, { caseTitle: title, taskText: it.text });
          showToast('Task returned to open');
        } catch (err) {
          console.error('Failed to decline task', err);
          showToast('Failed to decline task');
        }
      });
      li.appendChild(declineBtn);
    }

    if (it.priority) { const pri=document.createElement('span'); pri.className='mini-chip'; pri.textContent=it.priority; li.appendChild(pri); }

    const av=document.createElement('span');
    av.className='mini-avatar';
    const initials= it.assignee? it.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase():'';
    av.textContent=initials||'';
    const col=colorForName(it.assignee||'');
    av.style.background=col.bg;
    av.style.color=col.color;
    av.style.border=`1px solid ${col.border}`;
    let tipEl=null;
    const removeTip=()=>{ if(tipEl){ tipEl.remove(); tipEl=null; } };
    av.addEventListener('mouseenter',()=>{ if(!it.assignee) return; tipEl=document.createElement('div'); tipEl.className='assignee-tip'; tipEl.textContent=it.assignee; tipEl.style.position='fixed'; tipEl.style.zIndex='2147483647'; document.body.appendChild(tipEl); const r=av.getBoundingClientRect(); requestAnimationFrame(()=>{ const h=tipEl.offsetHeight||24; tipEl.style.left=`${Math.round(r.left + r.width/2)}px`; tipEl.style.top=`${Math.round(r.top - 6 - h)}px`; tipEl.style.transform='translateX(-50%)'; }); });
    av.addEventListener('mouseleave', removeTip);
    av.addEventListener('click',(e)=>{
      e.stopPropagation();
      removeTip();
      const existing=document.querySelector('.assignee-panel');
      if(existing) existing.remove();
      const panel=document.createElement('div');
      panel.className='assignee-panel';
      panel.style.position='fixed';
      panel.style.zIndex='2147483646';
      const addOpt=(label,value)=>{
        const b=document.createElement('button');
        b.type='button';
        b.className='assignee-option';
        b.textContent=label;
        b.addEventListener('click', async (ev)=>{
          ev.stopPropagation();
          try{
            await updateTaskAssignment(caseId, it.taskId, value, { caseTitle: title, taskText: it.text });
          } catch(err){ console.error('Failed to reassign',err); showToast('Failed to update assignee'); }
          finally { panel.remove(); }
        });
        panel.appendChild(b);
      };
      addOpt('Open task', null);
      for (const u of usersCache) addOpt(u.username,u.username);
      document.body.appendChild(panel);
      const r=av.getBoundingClientRect();
      requestAnimationFrame(()=>{
        const w=panel.offsetWidth||180;
        const left=Math.min(Math.max(8, r.right-w), window.innerWidth - w - 8);
        const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6);
        panel.style.left=`${Math.round(left)}px`;
        panel.style.top=`${Math.round(top)}px`;
      });
      const onDocClick=(evt)=>{ if(!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); };
      setTimeout(()=>document.addEventListener('click', onDocClick, true),0);
    });
    li.appendChild(av);

    const del = document.createElement('button');
    del.type='button';
    del.className='icon-btn delete-btn';
    del.textContent='🗑';
    del.title='Delete task';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this task?')) return;
      try { await deleteDoc(doc(db, 'cases', caseId, 'tasks', it.taskId)); }
      catch (err) { console.error('Failed to delete task', err); showToast('Failed to delete task'); }
    });
    li.appendChild(del);

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='icon-btn comment-toggle';
    toggle.setAttribute('aria-label','Show comments');
    toggle.textContent='💬';
    const countEl=document.createElement('span');
    countEl.className='badge comment-count';
    li.appendChild(toggle);
    li.appendChild(countEl);
    const commentSection=document.createElement('div');
    commentSection.className='comment-section';
    commentSection.hidden=true;
    const commentsList=document.createElement('ul');
    commentsList.className='comments';
    commentSection.appendChild(commentsList);
    const commentForm=document.createElement('form');
    commentForm.className='comment-form';
    const commentInput=document.createElement('input');
    commentInput.placeholder='Add comment';
    commentForm.appendChild(commentInput);
    const commentBtn=document.createElement('button');
    commentBtn.className='icon-btn add-comment-btn';
    commentBtn.type='submit';
    commentBtn.textContent='➕';
    commentBtn.setAttribute('aria-label','Add comment');
    commentForm.appendChild(commentBtn);
    commentSection.appendChild(commentForm);
    let commentsLoaded=false;
    let commentCount=0;
    const updateToggle=()=>{ countEl.textContent= commentCount>0? String(commentCount):''; toggle.textContent= commentSection.hidden? '💬':'✖'; toggle.setAttribute('aria-label', commentSection.hidden? 'Show comments':'Hide comments'); };
    updateToggle();
    toggle.addEventListener('click', ()=>{ const h=commentSection.hidden; commentSection.hidden=!h; updateToggle(); if(h && !commentsLoaded){ startRealtimeComments(caseId, it.taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } });
    commentForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const t=commentInput.value.trim(); if(!t) return; const tempLi=document.createElement('li'); tempLi.className='optimistic'; const span=document.createElement('span'); span.textContent= username? `${username}: ${t}` : t; tempLi.appendChild(span); commentsList.appendChild(tempLi); commentInput.value=''; commentSection.hidden=false; updateToggle(); try{ const {cipher, iv}= await encryptText(t); await addDoc(collection(db,'cases',caseId,'tasks',it.taskId,'comments'), {cipher,iv,username,createdAt:serverTimestamp()}); try { await logUpdate({ type: 'comment_added', caseId, caseTitle: title, taskId: it.taskId, commentCipher: cipher, commentIv: iv }); } catch {} if(!commentsLoaded){ startRealtimeComments(caseId, it.taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } } catch(err){ tempLi.classList.add('failed'); showToast('Failed to add comment'); } });
    li.appendChild(commentSection);
    return li;
  };

  const renderSection = (sectionKey, titleLabel, opts = {}) => {
    const map = sections[sectionKey];
    const total = sectionCount(map);
    if (!total) return false;
    const wrap = document.createElement('section');
    wrap.className = `task-section task-section--${sectionKey}`;
    const head = document.createElement('div');
    head.className = 'task-section-head';
    const h = document.createElement('h3');
    h.textContent = titleLabel;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = String(total);
    head.appendChild(h);
    head.appendChild(badge);
    wrap.appendChild(head);

    for (const caseId of sortCases(map)) {
      const items = map.get(caseId) || [];
      if (!items.length) continue;
      const caseTitle = userCaseTitles.get(caseId) || '(case)';
      const caseCard = document.createElement('div');
      caseCard.className = 'card user-case-card';
      const header = document.createElement('div');
      header.className = 'user-case-header';
      const hh = document.createElement('h3');
      const link = document.createElement('button');
      link.className = 'link-btn';
      link.textContent = caseTitle;
      link.setAttribute('aria-label', `Open case ${caseTitle}`);
      link.addEventListener('click', () => openCase(caseId, caseTitle, 'user', 'notes'));
      hh.appendChild(link);
      header.appendChild(hh);
      const countBadge = document.createElement('span');
      countBadge.className = 'badge';
      countBadge.textContent = String(items.length);
      header.appendChild(countBadge);
      caseCard.appendChild(header);

      let sorted = [...items];
      if (opts.pendingSort) {
        sorted.sort((a,b) => tsVal(b.assignedAt) - tsVal(a.assignedAt));
      } else if (currentUserSort === 'pri-desc') sorted.sort((a,b) => priVal(b.priority) - priVal(a.priority));
      else if (currentUserSort === 'pri-asc') sorted.sort((a,b) => priVal(a.priority) - priVal(b.priority));
      const ul = document.createElement('ul');
      for (const it of sorted) ul.appendChild(buildUserTaskRow(caseId, caseTitle, it));
      caseCard.appendChild(ul);
      wrap.appendChild(caseCard);
    }
    userTaskListEl.appendChild(wrap);
    return true;
  };

  let rendered = false;
  if (currentAssigneeFilter === 'unassigned') {
    rendered = renderSection('open', 'Open Tasks', {}) || rendered;
  } else {
    const pendingLabel = (currentAssigneeFilter === 'all')
      ? 'Pending Acceptance'
      : `Pending Your Acceptance`;
    rendered = renderSection('pending', pendingLabel, { pendingSort: true }) || rendered;
    rendered = renderSection('assigned', 'Assigned Tasks', {}) || rendered;
    rendered = renderSection('open', 'Open Tasks', {}) || rendered;
  }

  if (!rendered) {
    userTaskListEl.innerHTML = '<li style="list-style:none;color:var(--muted);padding:8px 0;">No tasks match current filters.</li>';
  }
}
