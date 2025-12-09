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
let colAInput, colBInput, colCInput, colDInput, colEInput, colFInput; // A–F fields
let notesTasksList, notesTasksForm, notesTasksInput; // Notes embedded tasks
let tableSection, tableRoot; // Table view
// Tag controls
let filterLocationSel, filterConsultantSel, sortByTagSel, clearTagFiltersBtn;
let tabTasksBtn, tabNotesBtn;
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
let unsubCaseDoc = null;
let unsubTable = null;
// Keep the last cases snapshot docs for instant client-side filtering/sorting
let lastCasesDocs = null; // Array of document snapshots
let renderTableFromDocs = null; // function(docsArray)
let tableTaskUnsubs = new Map(); // per-case tasks listeners in table
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

// Tags caches
let tagsByType = new Map(); // type -> [{id, name, order}]
let subtagsByParent = new Map(); // parentTagId -> [{id, name, order, type}]
let tagsReady = false;
let activeTagFilters = { location: new Set(), consultant: new Set(), room: new Set() };
let activeTagSort = 'none';
let activeTagSortDir = 'asc'; // 'asc' | 'desc' for segmented control

function encodeSet(set) { return Array.from(set || []).join(','); }
function decodeSet(s) { return new Set((s || '').split(',').map(x=>x.trim()).filter(Boolean)); }

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

  const close = () => overlay.remove();
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

// --- UI helpers
function showCaseList() {
  // Legacy: route to table view now
  if (tableSection) tableSection.hidden = false;
  caseDetailEl.hidden = true;
  userDetailEl.hidden = true;
  currentCaseId = null;
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
  if (unsubNotes) { unsubNotes(); unsubNotes = null; }
  compactOrderByCase = new Map();
}

async function openCase(id, title, source = 'list', initialTab = 'notes') {
  currentCaseId = id;
  backTarget = source === 'user' ? 'user' : (source === 'table' ? 'table' : 'list');
  caseTitleEl.textContent = title;
  if (tableSection) tableSection.hidden = true;
  if (caseListSection) caseListSection.style.display = 'none';
  userDetailEl.hidden = true;
  caseDetailEl.hidden = false;
  startRealtimeTasks(id);
  startRealtimeCaseFields(id);
  // Bind notes embedded tasks
  if (unsubNotesTasks) { try { unsubNotesTasks(); } catch {} unsubNotesTasks = null; }
  if (notesTasksList) {
    unsubNotesTasks = attachTasksListRealtime(id, notesTasksList);
  }
  // Open chosen tab
  showTab(initialTab);
  // Update URL for deep link
  try {
    const url = new URL(window.location.href); url.searchParams.set('case', id); window.history.pushState({ caseId: id }, '', url.toString());
  } catch {}
}


// Top-level tabs between Cases and My Tasks
function showMainTab(which) {
  const mainTabTable = document.getElementById('tab-table');
  const mainTabMy = document.getElementById('tab-my');
  const isTable = which === 'table';
  const isMy = which === 'my';
  if (mainTabTable) {
    mainTabTable.classList.toggle('active', isTable);
    mainTabTable.setAttribute('aria-selected', String(isTable));
  }
  if (mainTabMy) {
    mainTabMy.classList.toggle('active', isMy);
    mainTabMy.setAttribute('aria-selected', String(isMy));
  }
  if (isTable) {
    if (caseListSection) caseListSection.style.display = 'none';
    caseDetailEl.hidden = true;
    userDetailEl.hidden = true;
    if (tableSection) tableSection.hidden = false;
    if (!unsubTable) startRealtimeTable();
  } else {
    if (tableSection) tableSection.hidden = true;
    if (unsubTable) { unsubTable(); unsubTable = null; }
    if (isMy) {
      openUser(username);
    }
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
      li.addEventListener('click', () => openCase(docSnap.id, title, 'list'));

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
              await updateDoc(doc(db, 'cases', caseId, 'tasks', it.id), { assignee: value });
              loadCompactTasks(caseId, caseTitle, ul, moreBtn);
            } catch (err) {
              console.error('Failed to reassign task', err);
              showToast('Failed to reassign');
            } finally {
              panel.remove();
            }
          });
          panel.appendChild(b);
        };
        addOpt('Unassigned', null);
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
            await updateDoc(doc(db, 'cases', caseId, 'tasks', docSnap.id), { assignee: sel.value || null });
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

// --- A–F case fields stored on the case doc
function fieldNames(letter) {
  return { c: `col${letter}Cipher`, iv: `col${letter}Iv` };
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

function buildTableSkeleton() {
  if (!tableRoot) return { table: null, tbody: null };
  const table = document.createElement('table');
  table.className = 'data-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  const headers = ['Patient', 'Diagnosis', 'History', 'Micro/ABx', 'Investigations', 'Updates', 'Tasks'];
  for (const h of headers) { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); }
  thead.appendChild(tr);
  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);
  return { table, tbody };
}

function startRealtimeTable() {
  const q = query(collection(db, 'cases'), orderBy('createdAt', 'desc'));

  // Renderer that can be invoked from listener and on-demand
  renderTableFromDocs = async (docsInput) => {
    // If editing a cell, defer table rebuild to preserve caret
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains('cell-editable')) {
      pendingTableSnap = { docs: docsInput }; tableRebuildPending = true; return;
    }
    const { table, tbody } = buildTableSkeleton();
    if (!table || !tbody || !tableRoot) return;
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

    for (const d of docs) {
      const data = d.data();
      let title = '';
      try { title = await decryptText(data.titleCipher, data.titleIv); } catch {}
      if (!title || !title.trim()) continue;
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const nameWrap = document.createElement('div'); nameWrap.className = 'name-cell';
      const nameRow = document.createElement('div'); nameRow.className = 'name-row';
      const btn = document.createElement('button');
      btn.className = 'patient-link'; btn.textContent = title;
      btn.addEventListener('click', () => { tableScrollY = window.scrollY; openCase(d.id, title, 'table', 'notes'); });
      nameRow.appendChild(btn);
      const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='edit-tags-btn'; editBtn.textContent='Tags';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTagPanelForCase(d.id, tdName); });
      nameRow.appendChild(editBtn);
      // Delete case button in table row
      const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='icon-btn delete-btn'; delBtn.textContent='🗑'; delBtn.title='Delete case';
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
      nameRow.appendChild(delBtn);
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
            saveTagFilterState();
            if (lastCasesDocs && renderTableFromDocs) renderTableFromDocs(lastCasesDocs);
            const evt = new CustomEvent('filters:updated'); document.dispatchEvent(evt);
          };
          chip.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
          chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        }
        chips.appendChild(chip);
      };
      mkChip('Location', 'location', caseTags.location || null);
      if (caseTags.room && caseTags.location) mkChip('Room', 'room', caseTags.room);
      mkChip('Consultant', 'consultant', caseTags.consultant || null);
      nameWrap.appendChild(chips);
      tdName.appendChild(nameWrap);
      tr.appendChild(tdName);
      for (const letter of ['A','B','C','D','E','F']) {
        const td = document.createElement('td');
        if (letter === 'F') {
          const wrap = document.createElement('div'); wrap.className = 'cell-tasks';
          const ul = document.createElement('ul'); wrap.appendChild(ul);
          const form = document.createElement('form'); form.className = 'composer compact';
          const inp = document.createElement('input'); inp.placeholder = 'Add task…'; inp.setAttribute('aria-label','Task description');
          form.appendChild(inp);
          form.addEventListener('submit', async (e) => { e.preventDefault(); const t=(inp.value||'').trim(); if(!t) return; const { cipher: textCipher, iv: textIv } = await encryptText(t); const { cipher: statusCipher, iv: statusIv } = await encryptText('open'); await addDoc(collection(db,'cases',d.id,'tasks'), { textCipher, textIv, statusCipher, statusIv, createdAt: serverTimestamp(), username: username || null, assignee: null, priority: null }); inp.value=''; });
          td.appendChild(wrap); td.appendChild(form);
          if (tableTaskUnsubs.has(d.id)) { try { tableTaskUnsubs.get(d.id)(); } catch {} tableTaskUnsubs.delete(d.id); }
          const unsub = attachTasksListRealtime(d.id, ul);
          tableTaskUnsubs.set(d.id, unsub);
        } else {
          const ed = document.createElement('div');
          ed.className = 'cell-editable';
          ed.setAttribute('contenteditable', 'true');
          ed.dataset.placeholder = `Enter ${letter}`;
          ed.dataset.caseId = d.id;
          ed.dataset.letter = letter;
          const { c, iv } = fieldNames(letter);
          let val = '';
          try { if (data[c] && data[iv]) val = await decryptText(data[c], data[iv]); } catch {}
          ed.textContent = val;
          let last = val;
          const saveNow = () => { const v = (ed.innerText || '').replace(/\r/g, ''); if (v !== last) { last = v; saveCaseColumn(d.id, letter, v); } };
          ed.addEventListener('blur', () => { saveNow(); if (tableRebuildPending && pendingTableSnap) { const snapCopy=pendingTableSnap; pendingTableSnap=null; tableRebuildPending=false; if (renderTableFromDocs && snapCopy && snapCopy.docs) renderTableFromDocs(snapCopy.docs); } });
          ed.addEventListener('paste', (e) => { e.preventDefault(); const text=(e.clipboardData||window.clipboardData).getData('text'); if (document.queryCommandSupported && document.queryCommandSupported('insertText')) { document.execCommand('insertText', false, text); } else { const sel=window.getSelection(); if (sel && sel.rangeCount) { sel.deleteFromDocument(); sel.getRangeAt(0).insertNode(document.createTextNode(text)); } } });
          ed.addEventListener('input', () => { clearTimeout(ed._t); ed._t = setTimeout(saveNow, 1000); });
          ed.addEventListener('keydown', (e) => { const cellIndex=td.cellIndex; if (e.key==='Enter' && !(e.ctrlKey||e.metaKey)) { return; } else if ((e.key==='Enter') && (e.ctrlKey||e.metaKey)) { e.preventDefault(); saveNow(); const nextRow=tr.nextElementSibling; if (nextRow && nextRow.children[cellIndex]) { const n=nextRow.children[cellIndex].querySelector('.cell-editable'); if (n) n.focus(); } } else if (e.key==='Tab') { e.preventDefault(); saveNow(); const dir=e.shiftKey?-1:1; let targetCol=cellIndex+dir; let targetRow=tr; if (targetCol<1) { const prev=tr.previousElementSibling; if (prev) { targetRow=prev; targetCol=6; } else { return; } } else if (targetCol>6) { const next=tr.nextElementSibling; if (next) { targetRow=next; targetCol=1; } else { return; } } const targetCell=targetRow.children[targetCol]; if (targetCell) { const n=targetCell.querySelector('.cell-editable'); if (n) n.focus(); } } else if (e.key==='Escape') { e.preventDefault(); ed.textContent=last; } });
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
          td.appendChild(ed);
        }
        tr.appendChild(td);
      }
      // Apply tag filters: skip row if filters active and case doesn't match
      if (!caseMatchesTagFilters(data.caseTags || {})) {
        // skip
      } else {
        tbody.appendChild(tr);
      }
    }
  // Atomically replace table to prevent duplicated DOM
  tableRoot.innerHTML = '';
  tableRoot.appendChild(table);
  // Footer new case button at bottom of table
  const footer = document.createElement('div'); footer.className='new-case-footer';
  const addBtn = document.createElement('button'); addBtn.type='button'; addBtn.className='btn primary'; addBtn.textContent='➕ New Case'; addBtn.addEventListener('click', openNewCaseModal);
  footer.appendChild(addBtn);
  tableRoot.appendChild(footer);
    // Clean up per-case task listeners for rows no longer present
    const present = new Set(docsInput.map(s=>s.id));
    for (const [cid, un] of Array.from(tableTaskUnsubs.entries())) { if (!present.has(cid)) { try { un(); } catch {} tableTaskUnsubs.delete(cid); } }
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
  const li = document.createElement('li');
  const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
  li.className = 'case-task ' + statusCls;
  // Status toggle
  const statusBtn = document.createElement('button'); statusBtn.type='button'; statusBtn.className='status-btn';
  const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  statusBtn.textContent = icon(it.status);
  statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
  statusBtn.addEventListener('click', async (e)=>{
    e.stopPropagation();
    const order = ['open','in progress','complete'];
    const next = order[(order.indexOf(it.status)+1)%order.length];
    try { const { cipher, iv } = await encryptText(next); await updateDoc(doc(db,'cases',caseId,'tasks',it.id),{ statusCipher:cipher, statusIv:iv }); it.status=next; statusBtn.textContent=icon(next); statusBtn.setAttribute('aria-label',`Task status: ${next}`); li.className='case-task '+(next==='in progress'?'s-inprogress':(next==='complete'?'s-complete':'s-open')); } catch(err){ console.error('Failed to update status',err); showToast('Failed to update status'); }
  });
  const text = document.createElement('span'); text.className='task-text'; text.textContent = it.text;
  // Inline edit behavior: click to turn into a contenteditable field
  text.addEventListener('click', (e) => {
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
  });
  li.appendChild(statusBtn); li.appendChild(text);
  if (it.data && it.data.priority) {
    if (opts.compact) {
      const pri=document.createElement('span'); pri.style.fontSize='11px'; pri.style.color='#6b7280'; pri.title='Priority';
      const p = (it.data.priority||'').toLowerCase();
      pri.textContent = p === 'high' ? 'H' : p === 'medium' ? 'M' : p === 'low' ? 'L' : '';
      if (pri.textContent) li.appendChild(pri);
    } else {
      const pri=document.createElement('span'); pri.className='mini-chip'; pri.textContent=it.data.priority; li.appendChild(pri);
    }
  }
  const av=document.createElement('span'); av.className='mini-avatar'; const initials = it.data && it.data.assignee ? it.data.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase() : ''; av.textContent=initials||''; const col=colorForName((it.data && it.data.assignee)||''); av.style.background=col.bg; av.style.color=col.color; av.style.border=`1px solid ${col.border}`;
  av.addEventListener('click',(e)=>{ e.stopPropagation(); const existing=document.querySelector('.assignee-panel'); if(existing) existing.remove(); const panel=document.createElement('div'); panel.className='assignee-panel'; panel.style.position='fixed'; panel.style.zIndex='2147483646'; const addOpt=(label,value)=>{ const b=document.createElement('button'); b.type='button'; b.className='assignee-option'; b.textContent=label; b.addEventListener('click', async (ev)=>{ ev.stopPropagation(); try{ await updateDoc(doc(db,'cases',caseId,'tasks',it.id),{ assignee:value }); } catch(err){ console.error('Failed to reassign',err); showToast('Failed to reassign'); } finally { panel.remove(); } }); panel.appendChild(b); }; addOpt('Unassigned', null); for (const u of usersCache) addOpt(u.username, u.username); document.body.appendChild(panel); const r=av.getBoundingClientRect(); requestAnimationFrame(()=>{ const w=panel.offsetWidth||160; const left=Math.min(Math.max(8, r.right-w), window.innerWidth - w - 8); const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6); panel.style.left=`${Math.round(left)}px`; panel.style.top=`${Math.round(top)}px`; }); const onDocClick=(evt)=>{ if(!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); }; setTimeout(()=>document.addEventListener('click', onDocClick, true),0); });
  // Delete button
  const del = document.createElement('button'); del.type='button'; del.className='icon-btn delete-btn'; del.textContent='🗑'; del.title='Delete task';
  del.addEventListener('click', async (e) => { e.stopPropagation(); if (!confirm('Delete this task?')) return; try { await deleteDoc(doc(db, 'cases', caseId, 'tasks', it.id)); } catch (err) { console.error('Failed to delete task', err); showToast('Failed to delete task'); } });
  li.appendChild(av);
  li.appendChild(del);
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

  cancel.addEventListener('click', ()=>{ panel.remove(); document.removeEventListener('click', onDocClick, true); });
  save.addEventListener('click', async ()=>{
    try {
      const loc = locSel.value || null; const room = roomSel.value || null; const cons = consSel.value || null;
      const ct = { location: loc, consultant: cons };
      if (loc && room) ct.room = room; else ct.room = null;
      await updateDoc(doc(db,'cases',caseId), { caseTags: ct });
      panel.remove(); document.removeEventListener('click', onDocClick, true);
    } catch (err) { console.error('Failed to update tags', err); showToast('Failed to update tags'); }
  });

  document.body.appendChild(panel);
  const r = anchorTd.getBoundingClientRect(); requestAnimationFrame(()=>{
    const left = Math.min(window.innerWidth - panel.offsetWidth - 8, r.left);
    const top = Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6);
    panel.style.left = `${Math.max(8,left)}px`; panel.style.top = `${Math.max(8,top)}px`;
  });
  const onDocClick = (e)=>{ if (!panel || panel.contains(e.target)) return; panel.remove(); document.removeEventListener('click', onDocClick, true); };
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
    const fill = async (el, L) => {
      if (!el) return;
      const { c, iv } = fieldNames(L);
      let val = '';
      try { if (data[c] && data[iv]) val = await decryptText(data[c], data[iv]); } catch {}
      el.value = val;
    };
    await Promise.all([
      fill(colAInput, 'A'),
      fill(colBInput, 'B'),
      fill(colCInput, 'C'),
      fill(colDInput, 'D'),
      fill(colEInput, 'E'),
      fill(colFInput, 'F'),
    ]);
    // Apply cell background colors to notes inputs (A–E) if present
    try {
      const applyBg = (el, L) => { if (!el) return; const key = `col${L}Color`; const bg = data[key] || null; el.style.background = bg ? bg : ''; };
      applyBg(colAInput, 'A');
      applyBg(colBInput, 'B');
      applyBg(colCInput, 'C');
      applyBg(colDInput, 'D');
      applyBg(colEInput, 'E');
    } catch {}
  });
}

// --- Form bindings
function bindTabs() {
  tabTasksBtn.addEventListener('click', () => showTab('tasks'));
  tabNotesBtn.addEventListener('click', () => showTab('notes'));
}

function showTab(which) {
  const tasks = document.getElementById('tasks');
  const notes = document.getElementById('notes');
  const isTasks = which === 'tasks';
  tasks.hidden = !isTasks;
  notes.hidden = isTasks;
  tabTasksBtn.classList.toggle('active', isTasks);
  tabNotesBtn.classList.toggle('active', !isTasks);
  tabTasksBtn.setAttribute('aria-selected', String(isTasks));
  tabNotesBtn.setAttribute('aria-selected', String(!isTasks));
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
  const li = document.createElement('li');
  const statusCls = status === 'in progress' ? 's-inprogress' : (status === 'complete' ? 's-complete' : 's-open');
  li.className = 'case-task ' + statusCls;
  li.id = 'task-' + taskId;
  // Status button
  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.className = 'status-btn';
  const icon = (s) => s === 'complete' ? '☑' : (s === 'in progress' ? '◐' : '☐');
  statusBtn.textContent = icon(status);
  statusBtn.setAttribute('aria-label', `Task status: ${status}`);
  statusBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const order = ['open','in progress','complete'];
    const next = order[(order.indexOf(statusBtn.getAttribute('aria-label')?.split(': ')[1] || status) + 1) % order.length];
    try {
      const { cipher, iv } = await encryptText(next);
      await updateDoc(doc(db, 'cases', caseId, 'tasks', taskId), { statusCipher: cipher, statusIv: iv });
      statusBtn.textContent = icon(next);
      statusBtn.setAttribute('aria-label', `Task status: ${next}`);
      li.className = 'case-task ' + (next === 'in progress' ? 's-inprogress' : (next === 'complete' ? 's-complete' : 's-open'));
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
  });
  li.appendChild(statusBtn);
  li.appendChild(titleSpan);
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
    const addOpt = (label, value) => { const b=document.createElement('button'); b.type='button'; b.className='assignee-option'; b.textContent=label; b.addEventListener('click', async (ev)=>{ ev.stopPropagation(); try{ await updateDoc(doc(db,'cases',caseId,'tasks',taskId),{ assignee: value }); renderCaseTasks(); } catch(err){ console.error('Failed to reassign',err); showToast('Failed to reassign'); } finally { panel.remove(); } }); panel.appendChild(b); };
    addOpt('Unassigned', null); for (const u of usersCache) addOpt(u.username, u.username);
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
  commentForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const t=commentInput.value.trim(); if(!t) return; const tempLi=document.createElement('li'); tempLi.className='optimistic'; const span=document.createElement('span'); span.textContent = username ? `${username}: ${t}` : t; tempLi.appendChild(span); commentsList.appendChild(tempLi); commentInput.value=''; commentSection.hidden=false; updateToggle(); try{ const {cipher, iv}= await encryptText(t); await addDoc(collection(db,'cases',caseId,'tasks',taskId,'comments'),{cipher,iv,username,createdAt:serverTimestamp()}); if(!commentsLoaded){ startRealtimeComments(caseId,taskId,commentsList,(n)=>{ commentCount=n; updateToggle();}); commentsLoaded=true; } } catch(err){ tempLi.classList.add('failed'); showToast('Failed to add comment'); } });
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
    await addDoc(collection(db, 'cases', currentCaseId, 'tasks'), {
      textCipher, textIv, statusCipher, statusIv, createdAt: serverTimestamp(), username, assignee, priority,
    });
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
  none.textContent = 'Unassigned';
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
  // Notes embedded tasks
  notesTasksList = document.getElementById('notes-tasks-list');
  notesTasksForm = document.getElementById('notes-tasks-form');
  notesTasksInput = document.getElementById('notes-tasks-input');
  tabTasksBtn = document.getElementById('tab-tasks');
  tabNotesBtn = document.getElementById('tab-notes');
  // Main tabs
  const mainTabTable = document.getElementById('tab-table');
  const mainTabCases = document.getElementById('tab-cases');
  const mainTabMy = document.getElementById('tab-my');
  userDetailEl = document.getElementById('user-detail');
  userTitleEl = document.getElementById('user-title');
  userTaskListEl = document.getElementById('user-task-list');
  userBackBtn = document.getElementById('user-back-btn');
  brandHome = document.getElementById('brand-home');
  // Add a Delete Case button next to the case title if not present
  // Case header overflow menu (⋯) with Delete
  const actionsWrap = document.getElementById('case-header-actions');
  if (actionsWrap && !document.getElementById('case-overflow-btn')) {
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
  // Tag controls
  filterLocationSel = document.getElementById('filter-location');
  filterConsultantSel = document.getElementById('filter-consultant');
  sortByTagSel = document.getElementById('sort-by-tag');
  clearTagFiltersBtn = document.getElementById('clear-tag-filters');

  bindCaseForm();
  bindTaskForm();
  bindNoteForm();
  bindNotesFields();
  bindTabs();
  // Main tab bindings
  if (mainTabTable) mainTabTable.addEventListener('click', () => showMainTab('table'));
  if (mainTabMy) mainTabMy.addEventListener('click', () => showMainTab('my'));
  // Filters show/hide
  const filtersKey = 'tableFiltersHidden';
  if (hideFiltersBtn) hideFiltersBtn.addEventListener('click', () => setTableFiltersHidden(true));
  if (showFiltersBtn) showFiltersBtn.addEventListener('click', () => setTableFiltersHidden(false));
  try { const hidden = localStorage.getItem(filtersKey) === '1'; setTableFiltersHidden(hidden); } catch {}
  // Load persisted tag filter state (URL/localStorage)
  loadTagFilterState();
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
      if (caseListSection) caseListSection.style.display = 'none';
      backTarget = 'list';
    } else {
      // Return to table
      if (unsubTasks) { unsubTasks(); unsubTasks = null; }
      if (unsubNotes) { unsubNotes(); unsubNotes = null; }
      if (unsubCaseDoc) { unsubCaseDoc(); unsubCaseDoc = null; }
      currentCaseId = null;
      caseDetailEl.hidden = true;
      if (tableSection) tableSection.hidden = false;
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
        if (caseListSection) caseListSection.style.display = 'none';
      } else {
        if (tableSection) tableSection.hidden = false;
      }
      if (Array.isArray(unsubUserTasks)) {
        for (const u of unsubUserTasks) try { u(); } catch {}
        unsubUserTasks = [];
      }
      if (unsubNotesTasks) { try { unsubNotesTasks(); } catch {} unsubNotesTasks = null; }
    });
  }
  if (brandHome) {
    brandHome.addEventListener('click', () => {
      // Go to table
      if (tableSection) tableSection.hidden = false;
      caseDetailEl.hidden = true;
      userDetailEl.hidden = true;
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
  showMainTab('table');
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

  // Add location
  addLocBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = (prompt('Add location name') || '').trim();
    if (!name) return;
    try {
      await addDoc(collection(db, 'locations'), { name, createdAt: serverTimestamp() });
    } catch (err) {
      console.error('Failed to add location', err);
      showToast('Failed to add location (permissions)');
    }
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
  currentUserPageName = name;
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
  else if (currentAssigneeFilter === 'unassigned') label = 'Unassigned tasks';
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

  let tasksRef = collectionGroup(db, 'tasks');
  let q;
  if (currentAssigneeFilter === 'all') q = tasksRef;
  else if (currentAssigneeFilter === 'unassigned') q = query(tasksRef, where('assignee', '==', null));
  else if (currentAssigneeFilter === 'me') q = query(tasksRef, where('assignee', '==', username || name));
  else if (currentAssigneeFilter.startsWith('name:')) q = query(tasksRef, where('assignee', '==', currentAssigneeFilter.slice(5)));
  else q = query(tasksRef, where('assignee', '==', username || name));
  const unsub = onSnapshot(q, async (snap) => {
    try {
      // Build items list with parallel decryption
      const docs = snap.docs;
      const perCase = new Map();
      const decryptPromises = [];
      const rawItems = [];
      const neededCaseIds = new Set();

      for (const d of docs) {
        const dat = d.data();
        // Extract caseId from the task path: /cases/{caseId}/tasks/{taskId}
        const caseRef = d.ref.parent && d.ref.parent.parent;
        const caseId = caseRef ? caseRef.id : null;
        if (!caseId) continue;
        neededCaseIds.add(caseId);
        const item = { taskId: d.id, caseId, assignee: dat.assignee || null, priority: dat.priority || null, text: null, status: null };
        rawItems.push(item);
        decryptPromises.push(
          Promise.all([
            decryptText(dat.textCipher, dat.textIv),
            decryptText(dat.statusCipher, dat.statusIv),
          ]).then(([text, status]) => { item.text = text; item.status = status; }).catch((err) => { console.error('Decrypt task failed', err); })
        );
      }

      await Promise.all(decryptPromises);

      // Group by case
      for (const it of rawItems) {
        if (!it || !it.caseId || !it.text) continue;
        if (!perCase.has(it.caseId)) perCase.set(it.caseId, []);
        perCase.get(it.caseId).push(it);
      }

      // Ensure we have titles for the cases we actually need; reuse cache for known ones
      const titleFetches = [];
      for (const cid of neededCaseIds) {
        if (!userCaseTitles.has(cid)) {
          titleFetches.push(
            getDoc(doc(db, 'cases', cid)).then(async (cd) => {
              if (cd.exists()) {
                const cdat = cd.data();
                try { const title = await decryptText(cdat.titleCipher, cdat.titleIv); userCaseTitles.set(cid, title); }
                catch { userCaseTitles.set(cid, '(case)'); }
              } else {
                userCaseTitles.set(cid, '(case)');
              }
            }).catch(() => { userCaseTitles.set(cid, '(case)'); })
          );
        }
      }
      await Promise.all(titleFetches);

      // Update state and cache, then render
      userPerCase = perCase;
      userTasksCacheByKey.set(assigneeKey(), { perCase: new Map(perCase), titles: new Map(userCaseTitles) });
      if (userTasksEditing) { userTasksRebuildPending = true; return; }
      renderUserTasks();
    } catch (err) {
      console.error('Failed to build user tasks view', err);
    }
  });
  unsubUserTasks.push(unsub);
}

function renderUserTasks() {
  if (!userTaskListEl) return;
  userTaskListEl.innerHTML = '';
  const caseIds = Array.from(userPerCase.keys()).sort((a, b) => (userCaseTitles.get(a) || '').localeCompare(userCaseTitles.get(b) || ''));
  for (const caseId of caseIds) {
    let items = userPerCase.get(caseId) || [];
    if (currentUserStatusSet && currentUserStatusSet.size) items = items.filter(i => currentUserStatusSet.has(i.status));
    if (currentUserPriorityFilter !== 'all') items = items.filter(i => (i.priority || '') === currentUserPriorityFilter);
    if (currentUserSearch && currentUserSearch.trim()) {
      const q = currentUserSearch.toLowerCase();
      items = items.filter(i => (i.text || '').toLowerCase().includes(q));
    }
    if (items.length === 0) continue;
    const title = userCaseTitles.get(caseId) || '(case)';

    const caseCard = document.createElement('div');
    caseCard.className = 'card user-case-card';
    const header = document.createElement('div');
    header.className = 'user-case-header';
    const h = document.createElement('h3');
    const link = document.createElement('button');
    link.className = 'link-btn';
    link.textContent = title;
    link.setAttribute('aria-label', `Open case ${title}`);
    link.addEventListener('click', () => openCase(caseId, title, 'user'));
    h.appendChild(link);
    header.appendChild(h);
    const countBadge = document.createElement('span');
    countBadge.className = 'badge';
    countBadge.textContent = String(items.length);
    header.appendChild(countBadge);
    caseCard.appendChild(header);

    const ul = document.createElement('ul');
    const priVal = (p) => p === 'high' ? 3 : p === 'medium' ? 2 : p === 'low' ? 1 : 0;
    let sorted = [...items];
    if (currentUserSort === 'pri-desc') sorted.sort((a,b) => priVal(b.priority) - priVal(a.priority));
    else if (currentUserSort === 'pri-asc') sorted.sort((a,b) => priVal(a.priority) - priVal(b.priority));
    for (const it of sorted) {
      const li = document.createElement('li');
      const statusCls = it.status === 'in progress' ? 's-inprogress' : (it.status === 'complete' ? 's-complete' : 's-open');
      li.className = 'case-task ' + statusCls;
      // Status button
      const statusBtn = document.createElement('button'); statusBtn.type='button'; statusBtn.className='status-btn';
      const icon = (s)=> s==='complete'?'☑':(s==='in progress'?'◐':'☐');
      statusBtn.textContent = icon(it.status);
      statusBtn.setAttribute('aria-label', `Task status: ${it.status}`);
      statusBtn.addEventListener('click', async (e)=>{ e.stopPropagation(); const order=['open','in progress','complete']; const next=order[(order.indexOf(it.status)+1)%order.length]; try{ const {cipher, iv}= await encryptText(next); await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ statusCipher:cipher, statusIv:iv }); it.status=next; statusBtn.textContent=icon(next); statusBtn.setAttribute('aria-label',`Task status: ${next}`); li.className='case-task '+(next==='in progress'?'s-inprogress':(next==='complete'?'s-complete':'s-open')); } catch(err){ console.error('Failed to update status',err); showToast('Failed to update status'); } });
      const titleSpan = document.createElement('span'); titleSpan.className='task-text'; titleSpan.textContent=it.text;
      // Inline edit on My Tasks title
      titleSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        userTasksEditing = true;
        const ed = document.createElement('div'); ed.className='cell-editable'; ed.setAttribute('contenteditable','true'); ed.textContent = it.text;
        let last = it.text;
        const endEdit = () => { try{ ed.remove(); }catch{} titleSpan.style.display=''; userTasksEditing=false; if (userTasksRebuildPending) { userTasksRebuildPending=false; renderUserTasks(); } };
        const saveNow = async () => { const v=(ed.innerText||'').replace(/\r/g,''); if (v===last) { endEdit(); return; } try{ const {cipher:textCipher, iv:textIv}= await encryptText(v); await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ textCipher, textIv }); last=v; titleSpan.textContent=v; } catch(err){ console.error('Failed to update task',err); showToast('Failed to update task'); } endEdit(); };
        ed.addEventListener('paste',(ev)=>{ ev.preventDefault(); const t=(ev.clipboardData||window.clipboardData).getData('text'); if (document.queryCommandSupported && document.queryCommandSupported('insertText')) { document.execCommand('insertText', false, t); } else { const sel=window.getSelection(); if (sel && sel.rangeCount) { sel.deleteFromDocument(); sel.getRangeAt(0).insertNode(document.createTextNode(t)); } } });
        ed.addEventListener('keydown',(ev)=>{ if (ev.key==='Enter' && !(ev.ctrlKey||ev.metaKey)) { ev.preventDefault(); saveNow(); } else if (ev.key==='Escape') { ev.preventDefault(); endEdit(); } });
        ed.addEventListener('blur', () => { saveNow(); });
        titleSpan.insertAdjacentElement('afterend', ed); titleSpan.style.display='none'; ed.focus();
      });
      li.appendChild(statusBtn); li.appendChild(titleSpan);
      if (it.priority) { const pri=document.createElement('span'); pri.className='mini-chip'; pri.textContent=it.priority; li.appendChild(pri); }
      // Assignee avatar
      const av=document.createElement('span'); av.className='mini-avatar'; const initials= it.assignee? it.assignee.split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase():''; av.textContent=initials||''; const col=colorForName(it.assignee||''); av.style.background=col.bg; av.style.color=col.color; av.style.border=`1px solid ${col.border}`;
      let tipEl=null; const removeTip=()=>{ if(tipEl){ tipEl.remove(); tipEl=null; } };
      av.addEventListener('mouseenter',()=>{ if(!it.assignee) return; tipEl=document.createElement('div'); tipEl.className='assignee-tip'; tipEl.textContent=it.assignee; tipEl.style.position='fixed'; tipEl.style.zIndex='2147483647'; document.body.appendChild(tipEl); const r=av.getBoundingClientRect(); requestAnimationFrame(()=>{ const h=tipEl.offsetHeight||24; tipEl.style.left=`${Math.round(r.left + r.width/2)}px`; tipEl.style.top=`${Math.round(r.top - 6 - h)}px`; tipEl.style.transform='translateX(-50%)'; }); });
      av.addEventListener('mouseleave', removeTip);
      av.addEventListener('click',(e)=>{ e.stopPropagation(); removeTip(); const existing=document.querySelector('.assignee-panel'); if(existing) existing.remove(); const panel=document.createElement('div'); panel.className='assignee-panel'; panel.style.position='fixed'; panel.style.zIndex='2147483646'; const addOpt=(label,value)=>{ const b=document.createElement('button'); b.type='button'; b.className='assignee-option'; b.textContent=label; b.addEventListener('click', async (ev)=>{ ev.stopPropagation(); try{ await updateDoc(doc(db,'cases',caseId,'tasks',it.taskId),{ assignee:value }); // If the task moves out of this user, remove from UI
        if (currentUserPageName && value !== currentUserPageName) { li.remove(); const current=parseInt(caseCard.querySelector('.badge')?.textContent||'1',10); if(!Number.isNaN(current)&&current>0) caseCard.querySelector('.badge').textContent=String(current-1); }
      } catch(err){ console.error('Failed to reassign',err); showToast('Failed to reassign'); } finally { panel.remove(); } }); panel.appendChild(b); };
      addOpt('Unassigned', null); for (const u of usersCache) addOpt(u.username,u.username); document.body.appendChild(panel); const r=av.getBoundingClientRect(); requestAnimationFrame(()=>{ const w=panel.offsetWidth||180; const left=Math.min(Math.max(8, r.right-w), window.innerWidth - w - 8); const top=Math.min(window.innerHeight - panel.offsetHeight - 8, r.bottom + 6); panel.style.left=`${Math.round(left)}px`; panel.style.top=`${Math.round(top)}px`; }); const onDocClick=(evt)=>{ if(!panel || panel.contains(evt.target) || evt.target===av) return; panel.remove(); document.removeEventListener('click', onDocClick, true); }; setTimeout(()=>document.addEventListener('click', onDocClick, true),0); });
      li.appendChild(av);
      // Delete button
      const del = document.createElement('button'); del.type='button'; del.className='icon-btn delete-btn'; del.textContent='🗑'; del.title='Delete task';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this task?')) return;
        try {
          await deleteDoc(doc(db, 'cases', caseId, 'tasks', it.taskId));
          // Optimistic UI: remove item and update badge
          li.remove();
          const badge = caseCard.querySelector('.badge');
          if (badge) {
            const current = parseInt(badge.textContent || '1', 10);
            if (!Number.isNaN(current) && current > 0) badge.textContent = String(current - 1);
          }
        } catch (err) {
          console.error('Failed to delete task', err);
          showToast('Failed to delete task');
        }
      });
      li.appendChild(del);
      // Comments unobtrusive
      const toggle=document.createElement('button'); toggle.type='button'; toggle.className='icon-btn comment-toggle'; toggle.setAttribute('aria-label','Show comments'); toggle.textContent='💬'; const countEl=document.createElement('span'); countEl.className='badge comment-count'; li.appendChild(toggle); li.appendChild(countEl);
      const commentSection=document.createElement('div'); commentSection.className='comment-section'; commentSection.hidden=true; const commentsList=document.createElement('ul'); commentsList.className='comments'; commentSection.appendChild(commentsList); const commentForm=document.createElement('form'); commentForm.className='comment-form'; const commentInput=document.createElement('input'); commentInput.placeholder='Add comment'; commentForm.appendChild(commentInput); const commentBtn=document.createElement('button'); commentBtn.className='icon-btn add-comment-btn'; commentBtn.type='submit'; commentBtn.textContent='➕'; commentBtn.setAttribute('aria-label','Add comment'); commentForm.appendChild(commentBtn); commentSection.appendChild(commentForm);
      let commentsLoaded=false; let commentCount=0; const updateToggle=()=>{ countEl.textContent= commentCount>0? String(commentCount):''; toggle.textContent= commentSection.hidden? '💬':'✖'; toggle.setAttribute('aria-label', commentSection.hidden? 'Show comments':'Hide comments'); }; updateToggle();
      toggle.addEventListener('click', ()=>{ const h=commentSection.hidden; commentSection.hidden=!h; updateToggle(); if(h && !commentsLoaded){ startRealtimeComments(caseId, it.taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } });
      commentForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const t=commentInput.value.trim(); if(!t) return; const tempLi=document.createElement('li'); tempLi.className='optimistic'; const span=document.createElement('span'); span.textContent= username? `${username}: ${t}` : t; tempLi.appendChild(span); commentsList.appendChild(tempLi); commentInput.value=''; commentSection.hidden=false; updateToggle(); try{ const {cipher, iv}= await encryptText(t); await addDoc(collection(db,'cases',caseId,'tasks',it.taskId,'comments'), {cipher,iv,username,createdAt:serverTimestamp()}); if(!commentsLoaded){ startRealtimeComments(caseId, it.taskId, commentsList, (n)=>{ commentCount=n; updateToggle(); }); commentsLoaded=true; } } catch(err){ tempLi.classList.add('failed'); showToast('Failed to add comment'); } });
      li.appendChild(commentSection);
      ul.appendChild(li);
    }
    caseCard.appendChild(ul);
    userTaskListEl.appendChild(caseCard);
  }
}
