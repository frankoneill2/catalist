// Tiny event-emitter that holds the "currently selected group id" and
// notifies listeners when it changes. Both React (the switcher) and the
// vanilla-JS legacy app (script.js) listen — React via subscribe(), legacy
// via the DOM event 'group:changed'.

import { auth } from './firebase';
import { activateGroup, deactivateGroup } from './envelope';

const STORAGE_KEY_PREFIX = 'catalist.currentGroup.';

let currentGroupId: string | null = null;
const subs = new Set<(id: string | null) => void>();

function storageKey(uid: string) {
  return `${STORAGE_KEY_PREFIX}${uid}`;
}

export function getCurrentGroupId(): string | null {
  return currentGroupId;
}

// Read whatever group id we last persisted for this user (or null on first run).
export function readPersistedGroupId(uid: string): string | null {
  try {
    return localStorage.getItem(storageKey(uid));
  } catch {
    return null;
  }
}

export function setCurrentGroupId(groupId: string | null): void {
  if (currentGroupId === groupId) return;
  currentGroupId = groupId;
  // Persist per-user so multiple accounts on one device don't trample each other.
  try {
    const uid = auth.currentUser?.uid;
    if (uid) {
      if (groupId) localStorage.setItem(storageKey(uid), groupId);
      else localStorage.removeItem(storageKey(uid));
    }
  } catch { /* ignore */ }

  // Activate (or deactivate) the per-group encryption key BEFORE notifying
  // listeners. script.js relies on `window.__envelope.isReady()` being true
  // by the time it starts binding listeners on the new group's data.
  if (groupId) {
    activateGroup(groupId).catch((err) => {
      console.error('[groupContext] envelope.activateGroup failed; encrypted reads in this group will return placeholders until resolved', err);
    });
  } else {
    deactivateGroup();
  }

  // Notify React subs first, then the DOM event so script.js can re-bind.
  subs.forEach((fn) => {
    try { fn(groupId); } catch (e) { console.error('[groupContext] sub failed', e); }
  });
  try {
    document.dispatchEvent(
      new CustomEvent('group:changed', { detail: { groupId } })
    );
  } catch { /* ignore */ }
}

export function subscribe(fn: (id: string | null) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Expose to legacy script.js the same way we expose __auth.
declare global {
  interface Window {
    __group?: {
      currentId(): string | null;
      setCurrentId(id: string | null): void;
      subscribe(fn: (id: string | null) => void): () => void;
    };
  }
}
window.__group = {
  currentId: getCurrentGroupId,
  setCurrentId: setCurrentGroupId,
  subscribe,
};
