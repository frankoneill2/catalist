// PIN storage and verification.
//
// The PIN never leaves the device. We hash it with PBKDF2 against a per-device
// random salt and store {salt, hash, iterations, createdAt}. On entry we
// re-hash and compare. Wrong attempts are rate-limited; 10 wrong attempts in
// a row clear the PIN entirely (and the active session) so the user has to
// do the full sign-in ceremony again.
//
// PIN-bound to the current Firebase user (the uid is part of the storage key).
// Different users on the same device get separate PINs.

const ITERATIONS = 200_000;

interface StoredPin {
  saltB64: string;
  hashB64: string;
  iterations: number;
  createdAt: number;
  attempts: number;
  lastFailureAt?: number;
  lockedUntil?: number;
}

function bufToB64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function storageKey(uid: string): string {
  return `catalist.pin.${uid}`;
}

async function derivePinHash(pin: string, saltBuf: ArrayBuffer): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuf, iterations: ITERATIONS },
    baseKey,
    256
  );
}

function readStored(uid: string): StoredPin | null {
  const raw = localStorage.getItem(storageKey(uid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPin;
  } catch {
    return null;
  }
}

function writeStored(uid: string, pin: StoredPin): void {
  localStorage.setItem(storageKey(uid), JSON.stringify(pin));
}

export function hasPin(uid: string): boolean {
  return readStored(uid) !== null;
}

export async function setPin(uid: string, pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error('PIN must be 4–8 digits.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt.buffer);
  writeStored(uid, {
    saltB64: bufToB64(salt.buffer),
    hashB64: bufToB64(hash),
    iterations: ITERATIONS,
    createdAt: Date.now(),
    attempts: 0,
  });
}

export function clearPin(uid: string): void {
  localStorage.removeItem(storageKey(uid));
}

export interface PinVerifyResult {
  ok: boolean;
  attemptsRemaining: number;
  lockedUntil?: number;
  resetRequired: boolean;
}

const MAX_ATTEMPTS = 10;
const SOFT_LOCK_AFTER = 5;
const SOFT_LOCK_MS = 30 * 1000; // 30 seconds after 5 wrong attempts

export async function verifyPin(uid: string, pin: string): Promise<PinVerifyResult> {
  const stored = readStored(uid);
  if (!stored) {
    return { ok: false, attemptsRemaining: 0, resetRequired: true };
  }

  // Hard lockout? wipe and force re-auth.
  if (stored.attempts >= MAX_ATTEMPTS) {
    clearPin(uid);
    return { ok: false, attemptsRemaining: 0, resetRequired: true };
  }

  // Soft lockout window?
  if (stored.lockedUntil && stored.lockedUntil > Date.now()) {
    return {
      ok: false,
      attemptsRemaining: MAX_ATTEMPTS - stored.attempts,
      lockedUntil: stored.lockedUntil,
      resetRequired: false,
    };
  }

  const hash = await derivePinHash(pin, b64ToBuf(stored.saltB64));
  const computed = bufToB64(hash);
  if (computed === stored.hashB64) {
    // success — reset counters
    writeStored(uid, { ...stored, attempts: 0, lockedUntil: undefined, lastFailureAt: undefined });
    return { ok: true, attemptsRemaining: MAX_ATTEMPTS, resetRequired: false };
  }

  const attempts = stored.attempts + 1;
  let lockedUntil: number | undefined;
  if (attempts >= MAX_ATTEMPTS) {
    clearPin(uid);
    return { ok: false, attemptsRemaining: 0, resetRequired: true };
  }
  if (attempts >= SOFT_LOCK_AFTER) {
    // exponential-ish backoff once past the soft threshold
    const factor = Math.max(1, attempts - SOFT_LOCK_AFTER + 1);
    lockedUntil = Date.now() + SOFT_LOCK_MS * factor;
  }
  writeStored(uid, { ...stored, attempts, lockedUntil, lastFailureAt: Date.now() });
  return {
    ok: false,
    attemptsRemaining: MAX_ATTEMPTS - attempts,
    lockedUntil,
    resetRequired: false,
  };
}
