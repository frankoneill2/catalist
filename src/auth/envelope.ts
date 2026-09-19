// Phase 5 — Application-level envelope encryption for sensitive fields.
//
// Architecture:
//   Each group has its own AES-GCM-256 Data Encryption Key (DEK). The DEK is
//   used to encrypt/decrypt every sensitive field on cases, tasks, notes, and
//   ward notes belonging to that group. The DEK is held in memory only — never
//   persisted in plaintext, never sent to logs.
//
//   The DEK is itself encrypted ("wrapped") by a Key Encryption Key (KEK).
//   The wrapped DEK is stored on the group document as `wrappedDek`. When a
//   user activates a group, the client fetches the wrapped DEK and unwraps it
//   with the KEK in memory.
//
// Where the KEK lives:
//   - **Production target (Phase 7 deliverable):** the KEK is held in Google
//     Cloud KMS. A Cloud Function exposes wrap/unwrap as authenticated calls.
//     The browser never sees the KEK material — it only ever sees wrapped
//     DEKs and plaintext content.
//   - **Current state:** the KEK is derived from `VITE_FIELD_KEK_SEED`, an
//     environment variable shipped in the bundle. This is a deliberate
//     stepping stone: the architecture is in place (per-group DEK, versioned
//     envelope, KEK isolation), and swapping to KMS later means replacing
//     `getKek` / `wrapDek` / `unwrapDek` only. Until that swap, an attacker
//     who can read the JS bundle can also decrypt content — so the threat
//     model the current setup defends against is database-only breaches
//     (stolen backup, misconfigured rules export, Firestore-side incident),
//     not full-stack breaches.
//
// Versioned ciphertext format:
//   Encrypted fields are stored as a single base64url-encoded JSON string:
//     { v: 1, k: <dekId>, n: <base64-12-byte-nonce>, c: <base64-ciphertext> }
//   The legacy field shape `{ titleCipher: 'text', titleIv: [] }` is preserved
//   for callers — `iv: []` means plaintext, `iv: [1]` means the cipher field
//   holds an envelope blob. Reads check this discriminator.
//
// Algorithmic agility:
//   The `v` field on the envelope lets future versions of this module support
//   stronger algorithms without losing access to data encrypted under v1.
//   `decryptField` dispatches on `v`. New writes always use the latest version.

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

const ENVELOPE_VERSION = 1;

// 32 bytes of seed. Public-but-not-trivially-guessable; used only when the
// env var is not set, so that a fresh dev clone boots without manual setup.
const FALLBACK_SEED = 'catalist-dev-kek-fallback-not-for-production-use';

const KEK_SEED: string =
  (import.meta.env.VITE_FIELD_KEK_SEED as string | undefined) || FALLBACK_SEED;

let cachedKek: CryptoKey | null = null;
let currentDek: CryptoKey | null = null;
let currentDekId: string | null = null;
let activeGroupId: string | null = null;

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function getKek(): Promise<CryptoKey> {
  if (cachedKek) return cachedKek;
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(KEK_SEED),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  // Per-deployment salt baked into the bundle. The KEK lives only as long as
  // the page session; refreshing rederives it.
  const salt = enc.encode('catalist-envelope-kek-v1');
  cachedKek = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedKek;
}

interface WrappedDek {
  v: number;
  n: string; // base64 12-byte nonce
  c: string; // base64 wrapped DEK bytes (raw + auth tag)
  k: string; // a short id for this DEK so we can rotate later
}

async function generateDek(): Promise<{ key: CryptoKey; id: string }> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const idBytes = crypto.getRandomValues(new Uint8Array(6));
  return { key, id: bufToB64(idBytes).replace(/[+/=]/g, '').slice(0, 8) };
}

async function wrapDek(key: CryptoKey, id: string): Promise<WrappedDek> {
  const kek = await getKek();
  const raw = await crypto.subtle.exportKey('raw', key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    kek,
    raw
  );
  return {
    v: ENVELOPE_VERSION,
    n: bufToB64(nonce),
    c: bufToB64(cipher),
    k: id,
  };
}

async function unwrapDek(w: WrappedDek): Promise<CryptoKey> {
  if (w.v !== ENVELOPE_VERSION) {
    throw new Error(`unsupported wrapped DEK version: ${w.v}`);
  }
  const kek = await getKek();
  const nonce = b64ToBytes(w.n);
  const cipher = b64ToBytes(w.c);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    kek,
    cipher as unknown as BufferSource
  );
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Activate the group's DEK: fetch the wrappedDek from the group doc; if
// missing, generate one and persist it. After this resolves, encryptField /
// decryptField are usable.
export async function activateGroup(groupId: string): Promise<void> {
  if (!groupId) throw new Error('activateGroup: groupId required');
  if (activeGroupId === groupId && currentDek) return;
  const ref = doc(db, 'groups', groupId);
  const snap = await getDoc(ref);
  let wrapped: WrappedDek | null = null;
  if (snap.exists()) {
    const data = snap.data() as Record<string, unknown>;
    if (data.wrappedDek && typeof data.wrappedDek === 'object') {
      wrapped = data.wrappedDek as WrappedDek;
    }
  }
  if (wrapped) {
    try {
      currentDek = await unwrapDek(wrapped);
      currentDekId = wrapped.k;
      activeGroupId = groupId;
      return;
    } catch (err) {
      console.error('[envelope] failed to unwrap existing DEK; refusing to bootstrap a new one to avoid data loss', err);
      currentDek = null;
      currentDekId = null;
      activeGroupId = null;
      throw err;
    }
  }

  // No DEK on the group → bootstrap one. Only the group owner / admin can
  // succeed at this write under the current rules; that's fine because the
  // first member of any group is its owner, so the bootstrap happens
  // naturally on group creation. For pre-existing groups (Phase 2 leftovers)
  // an admin must open the app once to seed the DEK before encrypted reads
  // become available to other members.
  const fresh = await generateDek();
  const newWrapped = await wrapDek(fresh.key, fresh.id);
  try {
    await setDoc(
      ref,
      {
        wrappedDek: newWrapped,
        wrappedDekUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[envelope] could not persist wrappedDek (likely a non-admin opening a group that has none yet); falling back to plaintext writes for now', err);
    // Don't activate — the next admin to open will seed.
    return;
  }
  currentDek = fresh.key;
  currentDekId = fresh.id;
  activeGroupId = groupId;
}

export function deactivateGroup(): void {
  currentDek = null;
  currentDekId = null;
  activeGroupId = null;
}

export function isReady(): boolean {
  return currentDek !== null;
}

// Encrypt a UTF-8 string under the active group's DEK. Returns a single
// base64-encoded envelope blob suitable for storing in `titleCipher`-shaped
// fields. The caller is expected to set the partner `iv` field to `[1]` so
// readers know to dispatch to decryptField.
export async function encryptField(text: string): Promise<string> {
  if (!currentDek || !currentDekId) {
    throw new Error('envelope.encryptField called with no active DEK');
  }
  const enc = new TextEncoder().encode(text);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    currentDek,
    enc as unknown as BufferSource
  );
  const env = {
    v: ENVELOPE_VERSION,
    k: currentDekId,
    n: bufToB64(nonce),
    c: bufToB64(cipher),
  };
  return bufToB64(new TextEncoder().encode(JSON.stringify(env)));
}

// Decrypt a previously-encrypted envelope blob. Returns null on any failure
// (corrupted blob, missing DEK, unsupported version) so the calling code can
// render a placeholder rather than throwing.
export async function decryptField(blob: string): Promise<string | null> {
  if (!currentDek) return null;
  let env: { v: number; k: string; n: string; c: string };
  try {
    const json = new TextDecoder().decode(b64ToBytes(blob));
    env = JSON.parse(json);
  } catch {
    return null;
  }
  if (!env || typeof env !== 'object') return null;
  if (env.v !== ENVELOPE_VERSION) return null;
  // For now we only support a single DEK per group, so dekId mismatch means
  // data was written under a key we no longer have. Phase 5+ DEK rotation
  // will introduce a key map; until then treat as not-decryptable.
  if (env.k !== currentDekId) return null;
  try {
    const nonce = b64ToBytes(env.n);
    const cipher = b64ToBytes(env.c);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
      currentDek,
      cipher as unknown as BufferSource
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// Cheap structural check the legacy script.js can use without importing the
// real decryptor — base64-decoded blob starts with `{"v":` followed by a
// version number we recognise.
export function isEnvelope(blob: string | null | undefined): boolean {
  if (!blob || typeof blob !== 'string') return false;
  // Avoid throwing on malformed base64; just return false.
  try {
    const decoded = atob(blob);
    return decoded.startsWith('{"v":');
  } catch {
    return false;
  }
}

// Bridge to the legacy script.js so it can call into envelope encryption
// without importing TypeScript modules.
declare global {
  interface Window {
    __envelope?: {
      isReady(): boolean;
      isEnvelope(s: string | null | undefined): boolean;
      encryptField(text: string): Promise<string>;
      decryptField(blob: string): Promise<string | null>;
    };
  }
}
window.__envelope = { isReady, isEnvelope, encryptField, decryptField };
