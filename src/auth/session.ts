// Session lifecycle: idle timeout, max active session length, anomaly checks.
//
// Firebase handles refresh-token expiry server-side. Our concern here is the
// in-app session that the PIN gate guards: when has the user been idle long
// enough that they should re-enter their PIN? When has the active session
// been open long enough that we should reset to a fresh sign-in?

import { auth, db } from './firebase';
import { signOut } from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDeviceId, getDeviceName } from './device';
import { logAuthEvent } from './audit';

const SESSION_KEY = 'catalist.session';
export const IDLE_LOCK_MS = 30 * 60 * 1000;       // 30 min idle → PIN
export const ACTIVE_MAX_MS = 12 * 60 * 60 * 1000;  // 12 hr active → PIN
export const REFRESH_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 days → full re-auth

// `unlockedAt` deliberately lives in memory only, *not* in storage. The whole
// point of the PIN gate is "prove who you are again on every fresh page
// load" — if we persisted unlockedAt, a reload would simply read the old
// value and skip the prompt. Keeping it module-scoped means every JS module
// boot starts at 0 ("never unlocked this page-load"), and only `unlockSession`
// or `startNewSession` (after a successful sign-in / PIN entry) sets it to
// a real timestamp.
//
// One intentional exception: workspace switches deliberately reload the
// page (script.js does it instead of tearing down half the app's listeners
// inline), and forcing the user through PIN every time they switch
// workspace would be brutal. `markIntentionalReload()` sets a one-shot
// sessionStorage flag right before that reload; this module checks the
// flag at boot, treats the previous unlock as still valid, and clears it.
// The flag is in sessionStorage (not localStorage) so it dies with the
// tab — closing and reopening the browser still demands PIN.
let unlockedAt = 0;

const INTENTIONAL_RELOAD_KEY = 'catalist.intentionalReload';
try {
  if (sessionStorage.getItem(INTENTIONAL_RELOAD_KEY)) {
    sessionStorage.removeItem(INTENTIONAL_RELOAD_KEY);
    // Adopt the persisted lastActiveAt so evaluateSession's recency math
    // still works without us having to also persist `unlockedAt`.
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { lastActiveAt?: number };
        unlockedAt = typeof parsed.lastActiveAt === 'number' ? parsed.lastActiveAt : Date.now();
      } catch {
        unlockedAt = Date.now();
      }
    }
  }
} catch { /* ignore */ }

// Call right before window.location.reload() to skip the PIN prompt on
// the next boot of this tab. Used by workspace-switch reloads.
export function markIntentionalReload(): void {
  try { sessionStorage.setItem(INTENTIONAL_RELOAD_KEY, '1'); } catch { /* ignore */ }
}

// Bridge to legacy script.js so it can mark its own reloads as intentional.
declare global {
  interface Window {
    __session?: { markIntentionalReload(): void };
  }
}
window.__session = { markIntentionalReload };

interface DeviceSession {
  uid: string;
  lastActiveAt: number;     // last user interaction (persisted for idle math)
  signInAt: number;         // initial full sign-in time (persisted for refresh-window math)
  shared: boolean;          // shared-device sign-in (no PIN, session-only persistence)
}

export function readSession(): DeviceSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceSession;
  } catch {
    return null;
  }
}

export function writeSession(session: DeviceSession): void {
  // Shared-device sessions go in sessionStorage so they vanish on tab close.
  const target = session.shared ? sessionStorage : localStorage;
  target.setItem(SESSION_KEY, JSON.stringify(session));
  // Make sure the other store doesn't keep a stale copy.
  (session.shared ? localStorage : sessionStorage).removeItem(SESSION_KEY);
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  unlockedAt = 0;
}

export function startNewSession(uid: string, shared: boolean): DeviceSession {
  const now = Date.now();
  const session: DeviceSession = {
    uid,
    lastActiveAt: now,
    signInAt: now,
    shared,
  };
  writeSession(session);
  unlockedAt = now;
  return session;
}

export function touchSession(): void {
  const s = readSession();
  if (!s) return;
  s.lastActiveAt = Date.now();
  writeSession(s);
}

export function unlockSession(): void {
  const s = readSession();
  if (!s) return;
  const now = Date.now();
  s.lastActiveAt = now;
  writeSession(s);
  unlockedAt = now;
}

export type SessionState =
  | 'fresh'           // no session — full sign-in needed
  | 'expired'         // refresh window blew past — full sign-in needed
  | 'idle-locked'     // PIN required (idle or active-max threshold or fresh page load)
  | 'active';         // good to go

export function evaluateSession(): SessionState {
  const s = readSession();
  if (!s) return 'fresh';
  const now = Date.now();
  if (now - s.signInAt > REFRESH_MAX_MS) return 'expired';
  // No in-memory unlock yet → this is a fresh page load (or the unlock
  // timestamp aged out beyond the 12h max-active window). Force PIN.
  if (unlockedAt === 0 || now - unlockedAt > ACTIVE_MAX_MS) return 'idle-locked';
  if (now - s.lastActiveAt > IDLE_LOCK_MS) return 'idle-locked';
  return 'active';
}

// --- Active sessions / device list (Firestore-backed) ---

export interface RemoteDeviceSession {
  id: string;        // doc id (deviceId)
  deviceName: string;
  userAgent: string;
  shared: boolean;
  createdAt: number;
  lastActiveAt: number;
  current: boolean;
}

function devicesCol(uid: string) {
  return collection(db, 'users', uid, 'devices');
}

export async function recordRemoteSession(uid: string, shared: boolean): Promise<void> {
  const deviceId = getDeviceId();
  await setDoc(
    doc(devicesCol(uid), deviceId),
    {
      deviceName: getDeviceName(),
      userAgent: navigator.userAgent,
      shared,
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
      lastActiveAtClient: Date.now(),
    },
    { merge: true }
  );
}

export async function touchRemoteSession(uid: string): Promise<void> {
  const deviceId = getDeviceId();
  try {
    await setDoc(
      doc(devicesCol(uid), deviceId),
      { lastActiveAt: serverTimestamp(), lastActiveAtClient: Date.now() },
      { merge: true }
    );
  } catch {
    // best effort
  }
}

export async function revokeRemoteSession(uid: string, deviceId: string): Promise<void> {
  await deleteDoc(doc(devicesCol(uid), deviceId));
  await logAuthEvent(uid, 'session_revoked', { deviceId });
}

// Watches our own device record. If the doc is deleted (or marked revoked
// elsewhere), force a sign-out on this client.
export function watchOwnRevocation(uid: string, onRevoked: () => void): Unsubscribe {
  const deviceId = getDeviceId();
  const ref = doc(devicesCol(uid), deviceId);
  let firstSnapshot = true;
  return onSnapshot(
    ref,
    (snap) => {
      if (firstSnapshot) {
        firstSnapshot = false;
        return;
      }
      if (!snap.exists()) onRevoked();
    },
    () => { /* ignore transient errors */ }
  );
}

// --- Idle activity tracking ---

let activityTimer: number | null = null;
const ACTIVITY_FLUSH_MS = 60 * 1000;

export function startActivityTracking(): void {
  const events = ['mousedown', 'keydown', 'touchstart', 'visibilitychange'];
  const onActivity = () => {
    touchSession();
    if (activityTimer != null) return;
    activityTimer = window.setTimeout(() => {
      activityTimer = null;
      const u = auth.currentUser;
      if (u) touchRemoteSession(u.uid);
    }, ACTIVITY_FLUSH_MS);
  };
  events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
}

// --- Forced sign-out (e.g. session revoked elsewhere) ---

export async function forceSignOut(reason: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (uid) {
    try { await logAuthEvent(uid, 'signout', { reason }); } catch { /* noop */ }
  }
  clearSession();
  try { await signOut(auth); } catch { /* noop */ }
}
