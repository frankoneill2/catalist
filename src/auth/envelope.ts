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
//   - **Current state (since 2026-09-20):** the KEK lives in Cloud KMS. The
//     browser calls the `unwrapGroupDek` Cloud Function, which verifies
//     membership server-side and asks KMS to decrypt. KEK material never
//     reaches the client, so a database-only breach (stolen backup, rules
//     bug, Firestore-side incident) yields ciphertext and nothing else.
//     Every unwrap is recorded in Cloud Audit Logs and the key can be
//     disabled to revoke access to all content at once.
//
//     The DEK still reaches the browser of an authenticated member, because
//     the client does the decryption. A compromised member session still
//     exposes that group's data; closing that needs server-side decryption
//     on every read or true E2EE (Path B, deliberately not chosen).
//
//   - **Legacy v1 wrapping:** before the above, the KEK was derived in the
//     browser from `VITE_FIELD_KEK_SEED`, which Vite inlines into the public
//     bundle — so it protected nothing against anyone who read the JS. That
//     path is retained ONLY to unwrap groups that have not yet been migrated
//     (see scripts/migrate-kek-to-kms.mjs). Once every group reports v2,
//     delete `getKek`, `FALLBACK_SEED`, `unwrapLocalV1` and the env var.
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

import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase';

// Version of the *field* ciphertext format. Changing this invalidates every
// encrypted field, so it is deliberately independent of the wrapping version.
const ENVELOPE_VERSION = 1;

// Version of the *wrappedDek* stored on the group document.
//   v1 — AES-GCM under a PBKDF2 key derived in this bundle. Legacy.
//   v2 — Cloud KMS ciphertext; unwrapped only by the Cloud Function.
const WRAPPED_DEK_V1_LOCAL = 1;
const WRAPPED_DEK_V2_KMS = 2;

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

// LEGACY (v1 only). Derives the old browser-side KEK. Delete once every
// group has been migrated to KMS wrapping.
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
  n?: string; // base64 12-byte nonce — v1 only; KMS manages its own
  c: string;  // base64 wrapped DEK bytes
  k: string;  // a short id for this DEK so we can rotate later
}

const callUnwrapGroupDek = httpsCallable<{ groupId: string }, { dekB64: string; dekId: string }>(
  functions,
  'unwrapGroupDek',
);

const callWrapGroupDek = httpsCallable<{ groupId: string; dekB64: string; dekId: string }, { ok: boolean }>(
  functions,
  'wrapGroupDek',
);

function importDek(raw: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
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

// Wrapping now happens server-side: the client hands the raw DEK to the
// `wrapGroupDek` function, which encrypts it with the KMS key and writes it
// onto the group document. The function refuses to overwrite an existing
// wrappedDek, which is what stops a client orphaning encrypted content.
async function wrapDekViaKms(key: CryptoKey, id: string, groupId: string): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key);
  const dekB64 = bufToB64(raw);
  await callWrapGroupDek({ groupId, dekB64, dekId: id });
}

// LEGACY (v1 only). Unwraps a DEK that was wrapped by the old browser-side
// KEK. Delete along with getKek once every group reports v2.
async function unwrapLocalV1(w: WrappedDek): Promise<CryptoKey> {
  const kek = await getKek();
  const nonce = b64ToBytes(String(w.n));
  const cipher = b64ToBytes(w.c);
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    kek,
    cipher as unknown as BufferSource
  );
  return importDek(raw);
}

// Dispatches on the wrapping version so a half-migrated estate keeps working:
// v1 groups unwrap in the browser, v2 groups go through KMS.
async function unwrapDek(w: WrappedDek, groupId: string): Promise<CryptoKey> {
  if (w.v === WRAPPED_DEK_V2_KMS) {
    const res = await callUnwrapGroupDek({ groupId });
    return importDek(b64ToBytes(res.data.dekB64));
  }
  if (w.v === WRAPPED_DEK_V1_LOCAL) {
    return unwrapLocalV1(w);
  }
  throw new Error(`unsupported wrapped DEK version: ${w.v}`);
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
      currentDek = await unwrapDek(wrapped, groupId);
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
  try {
    // The function writes the group document itself, so the client never
    // needs write access to wrappedDek — and cannot clobber an existing one.
    await wrapDekViaKms(fresh.key, fresh.id, groupId);
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
