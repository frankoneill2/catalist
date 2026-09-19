// Phase 3 migration: move pre-Phase-2 patient data into the new
// groups/{groupId}/cases/... layout, decrypting along the way.
//
// What gets migrated:
//   /cases/{id}                                  → /groups/{gid}/cases/{newId}
//   /cases/{id}/tasks/{tid}                      → /groups/{gid}/cases/{newId}/tasks/{newTid}
//   /cases/{id}/tasks/{tid}/comments/{cmt}       → ditto
//   /cases/{id}/notes/{nid}                      → ditto
//   /cases/{id}/wardNotes/{wid}                  → ditto
//
// In-place legacy data inside /groups/{gid}/cases/ (anything written under
// Phase 2 with cipher fields still encrypted by the old shared passphrase)
// is also migrated: each cipher field is decrypted and written back into
// the *same* field name with a plaintext value plus a sentinel iv ([]).
// This preserves the existing field shape so Phase 4's passthrough crypto
// helpers keep working, and Phase 5's envelope encryption can re-use the
// same field names with a KMS-managed key.
//
// The migration is intentionally idempotent and resumable: a doc that has
// already been migrated (cipher fields gone, plaintext fields present, or
// `migrationVersion: 2` set) is skipped.

import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

// Local crypto helpers — kept here (and only here) so script.js can drop the
// shared passphrase machinery in Phase 4 without breaking migration.
async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('shared-salt'), iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function b64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function decryptText(key: CryptoKey, cipher: string, iv: number[]): Promise<string | null> {
  if (!cipher || !Array.isArray(iv) || iv.length !== 12) return null;
  try {
    const ivBytes = new Uint8Array(iv) as unknown as BufferSource;
    const cipherBytes = b64ToBuf(cipher) as unknown as BufferSource;
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      cipherBytes
    );
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

// A plaintext field is encoded as `{ <name>: '<text>', <name>Iv: [] }`. The
// empty iv array is the sentinel that says "this is plaintext now". Phase 5
// will replace these with real envelope-encrypted ciphertext under a KMS key.
const SENTINEL_IV: number[] = [];

// Pairs of (cipherField, ivField) the migration knows how to translate. Keys
// not in this list are copied as-is.
const CASE_FIELDS: [string, string][] = [
  ['titleCipher', 'titleIv'],
  ['summaryCipher', 'summaryIv'],
  ['descriptionCipher', 'descriptionIv'],
  ['colACipher', 'colAIv'],
  ['colBCipher', 'colBIv'],
  ['colCCipher', 'colCIv'],
  ['colDCipher', 'colDIv'],
  ['colECipher', 'colEIv'],
];

const TASK_FIELDS: [string, string][] = [
  ['textCipher', 'textIv'],
  ['statusCipher', 'statusIv'],
];

const COMMENT_FIELDS: [string, string][] = [['cipher', 'iv']];
const NOTE_FIELDS: [string, string][] = [['cipher', 'iv']];

const WARD_NOTE_FIELDS: [string, string][] = [
  ['headingCipher', 'headingIv'],
  ['compiledCipher', 'compiledIv'],
  ['diagnosesLineCipher', 'diagnosesLineIv'],
  ['noteCipher', 'noteIv'],
  ['issueTitlesCipher', 'issueTitlesIv'],
  ['taskTitlesCipher', 'taskTitlesIv'],
];

// Return a shallow copy with cipher pairs replaced by `(name, plaintext) +
// (nameIv, [])`. Returns null if NONE of the cipher fields decrypted — that
// usually means the user typed the wrong passphrase, and we shouldn't move
// the doc to avoid silently corrupting data.
async function decryptDoc(
  key: CryptoKey,
  data: Record<string, unknown>,
  pairs: [string, string][]
): Promise<Record<string, unknown> | null> {
  const out: Record<string, unknown> = { ...data };
  let anyDecoded = false;
  let anyAttempted = false;

  for (const [cipherKey, ivKey] of pairs) {
    const cipher = data[cipherKey];
    const iv = data[ivKey];
    if (typeof cipher !== 'string' || !Array.isArray(iv)) continue;
    anyAttempted = true;
    const plain = await decryptText(key, cipher, iv as number[]);
    if (plain !== null) {
      out[cipherKey] = plain;
      out[ivKey] = SENTINEL_IV;
      anyDecoded = true;
    }
  }

  // Items arrays (e.g. colAItems) — each item has its own titleCipher/Iv,
  // bodyCipher/Iv. Walk into them.
  for (const k of Object.keys(data)) {
    if (!/Items$/.test(k)) continue;
    const items = data[k];
    if (!Array.isArray(items)) continue;
    const next = [] as Record<string, unknown>[];
    for (const it of items as Record<string, unknown>[]) {
      const decoded = await decryptDoc(key, it, [
        ['titleCipher', 'titleIv'],
        ['bodyCipher', 'bodyIv'],
      ]);
      next.push(decoded ?? it);
      if (decoded) anyDecoded = true;
    }
    out[k] = next;
  }

  if (!anyAttempted) return out; // already plaintext or no encrypted fields
  return anyDecoded ? out : null;
}

// Resolve a (legacy) `username` string to a uid by looking it up in the
// users collection. Returns null if no match.
async function resolveAuthorUid(
  username: string,
  usersByName: Map<string, string>
): Promise<string | null> {
  const trimmed = (username || '').trim();
  if (!trimmed) return null;
  return usersByName.get(trimmed) ?? null;
}

async function loadUsersByName(): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, 'users'));
  const map = new Map<string, string>();
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const dn = String(data.displayName || data.username || '').trim();
    const uid = String(data.uid || d.id || '').trim();
    if (dn && uid) map.set(dn, uid);
  });
  return map;
}

export interface MigrationProgress {
  cases: number;
  tasks: number;
  comments: number;
  notes: number;
  wardNotes: number;
  inPlaceFixed: number;
  skipped: number;
}

export interface MigrationOptions {
  passphrase: string;
  targetGroupId: string;
  onProgress?: (p: MigrationProgress) => void;
}

function isAlreadyMigrated(data: Record<string, unknown>): boolean {
  return data.migrationVersion === 2;
}

// Walk legacy /cases/* and copy under /groups/{targetGroupId}/cases/, then
// fix any in-place encrypted docs that were written into /groups/.../cases/
// before the passphrase machinery was retired.
export async function runMigration(opts: MigrationOptions): Promise<MigrationProgress> {
  const { passphrase, targetGroupId, onProgress } = opts;
  if (!passphrase) throw new Error('Old shared passphrase is required');
  if (!targetGroupId) throw new Error('Target group is required');

  const key = await deriveKey(passphrase);
  const usersByName = await loadUsersByName();
  const progress: MigrationProgress = {
    cases: 0, tasks: 0, comments: 0, notes: 0, wardNotes: 0, inPlaceFixed: 0, skipped: 0,
  };
  const tick = () => { try { onProgress?.(progress); } catch { /* ignore */ } };

  // ---- Phase 3a: top-level /cases/* → /groups/{gid}/cases/{newId} -------

  const legacyCases = await getDocs(collection(db, 'cases'));
  for (const c of legacyCases.docs) {
    const data = c.data() as Record<string, unknown>;
    if (isAlreadyMigrated(data) || data.migratedTo) {
      progress.skipped += 1;
      tick();
      continue;
    }
    const decoded = await decryptDoc(key, data, CASE_FIELDS);
    if (!decoded) {
      progress.skipped += 1;
      tick();
      continue;
    }
    const authorUid =
      typeof data.username === 'string'
        ? await resolveAuthorUid(data.username as string, usersByName)
        : null;

    const newCase = await addDoc(collection(db, 'groups', targetGroupId, 'cases'), {
      ...decoded,
      authorUid: authorUid ?? null,
      migrationVersion: 2,
      migratedFrom: c.id,
      migratedAt: serverTimestamp(),
    });
    progress.cases += 1;
    tick();

    // Tasks
    const tasks = await getDocs(collection(db, 'cases', c.id, 'tasks'));
    for (const t of tasks.docs) {
      const td = t.data() as Record<string, unknown>;
      const decTask = await decryptDoc(key, td, TASK_FIELDS);
      if (!decTask) continue;
      const taskAuthor = typeof td.username === 'string'
        ? await resolveAuthorUid(td.username as string, usersByName)
        : null;
      const newTask = await addDoc(
        collection(db, 'groups', targetGroupId, 'cases', newCase.id, 'tasks'),
        { ...decTask, authorUid: taskAuthor ?? null, migrationVersion: 2 }
      );
      progress.tasks += 1;
      tick();

      // Comments
      const comments = await getDocs(
        collection(db, 'cases', c.id, 'tasks', t.id, 'comments')
      );
      for (const cm of comments.docs) {
        const cmd = cm.data() as Record<string, unknown>;
        const decC = await decryptDoc(key, cmd, COMMENT_FIELDS);
        if (!decC) continue;
        const cmAuthor = typeof cmd.username === 'string'
          ? await resolveAuthorUid(cmd.username as string, usersByName)
          : null;
        await addDoc(
          collection(
            db,
            'groups', targetGroupId, 'cases', newCase.id, 'tasks', newTask.id, 'comments'
          ),
          { ...decC, authorUid: cmAuthor ?? null, migrationVersion: 2 }
        );
        progress.comments += 1;
        tick();
      }
    }

    // Notes
    const notes = await getDocs(collection(db, 'cases', c.id, 'notes'));
    for (const n of notes.docs) {
      const nd = n.data() as Record<string, unknown>;
      const decN = await decryptDoc(key, nd, NOTE_FIELDS);
      if (!decN) continue;
      const nAuthor = typeof nd.username === 'string'
        ? await resolveAuthorUid(nd.username as string, usersByName)
        : null;
      await addDoc(collection(db, 'groups', targetGroupId, 'cases', newCase.id, 'notes'), {
        ...decN,
        authorUid: nAuthor ?? null,
        migrationVersion: 2,
      });
      progress.notes += 1;
      tick();
    }

    // Ward notes
    const wnotes = await getDocs(collection(db, 'cases', c.id, 'wardNotes'));
    for (const w of wnotes.docs) {
      const wd = w.data() as Record<string, unknown>;
      const decW = await decryptDoc(key, wd, WARD_NOTE_FIELDS);
      if (!decW) continue;
      const wAuthor = typeof wd.author === 'string'
        ? await resolveAuthorUid(wd.author as string, usersByName)
        : null;
      await addDoc(collection(db, 'groups', targetGroupId, 'cases', newCase.id, 'wardNotes'), {
        ...decW,
        authorUid: wAuthor ?? null,
        migrationVersion: 2,
      });
      progress.wardNotes += 1;
      tick();
    }

    // Mark the legacy doc so re-runs skip it. We don't delete; the plan keeps
    // it as a 30-day rollback option.
    await updateDoc(doc(db, 'cases', c.id), {
      migratedTo: newCase.id,
      migratedAt: serverTimestamp(),
    });
  }

  // ---- Phase 3b: in-place fix for /groups/{gid}/cases/* docs that still
  //                 carry encrypted cipher fields (Phase 2 leftovers).

  const newCases = await getDocs(collection(db, 'groups', targetGroupId, 'cases'));
  for (const c of newCases.docs) {
    const data = c.data() as Record<string, unknown>;
    if (isAlreadyMigrated(data)) continue;
    const decoded = await decryptDoc(key, data, CASE_FIELDS);
    if (decoded) {
      const authorUid =
        typeof data.username === 'string' && !data.authorUid
          ? await resolveAuthorUid(data.username as string, usersByName)
          : null;
      await updateDoc(c.ref, {
        ...decoded,
        ...(authorUid ? { authorUid } : {}),
        migrationVersion: 2,
      });
      progress.inPlaceFixed += 1;
      tick();
    }

    // Walk subcollections in place.
    const tasks = await getDocs(collection(c.ref, 'tasks'));
    for (const t of tasks.docs) {
      const td = t.data() as Record<string, unknown>;
      if (isAlreadyMigrated(td)) continue;
      const decTask = await decryptDoc(key, td, TASK_FIELDS);
      if (decTask) {
        const taskAuthor =
          typeof td.username === 'string' && !td.authorUid
            ? await resolveAuthorUid(td.username as string, usersByName)
            : null;
        await updateDoc(t.ref, {
          ...decTask,
          ...(taskAuthor ? { authorUid: taskAuthor } : {}),
          migrationVersion: 2,
        });
        progress.inPlaceFixed += 1;
        tick();
      }
      const comments = await getDocs(collection(t.ref, 'comments'));
      for (const cm of comments.docs) {
        const cmd = cm.data() as Record<string, unknown>;
        if (isAlreadyMigrated(cmd)) continue;
        const decC = await decryptDoc(key, cmd, COMMENT_FIELDS);
        if (decC) {
          const cmAuthor =
            typeof cmd.username === 'string' && !cmd.authorUid
              ? await resolveAuthorUid(cmd.username as string, usersByName)
              : null;
          await updateDoc(cm.ref, {
            ...decC,
            ...(cmAuthor ? { authorUid: cmAuthor } : {}),
            migrationVersion: 2,
          });
          progress.inPlaceFixed += 1;
          tick();
        }
      }
    }
    const notes = await getDocs(collection(c.ref, 'notes'));
    for (const n of notes.docs) {
      const nd = n.data() as Record<string, unknown>;
      if (isAlreadyMigrated(nd)) continue;
      const decN = await decryptDoc(key, nd, NOTE_FIELDS);
      if (decN) {
        const nAuthor =
          typeof nd.username === 'string' && !nd.authorUid
            ? await resolveAuthorUid(nd.username as string, usersByName)
            : null;
        await updateDoc(n.ref, {
          ...decN,
          ...(nAuthor ? { authorUid: nAuthor } : {}),
          migrationVersion: 2,
        });
        progress.inPlaceFixed += 1;
        tick();
      }
    }
    const wnotes = await getDocs(collection(c.ref, 'wardNotes'));
    for (const w of wnotes.docs) {
      const wd = w.data() as Record<string, unknown>;
      if (isAlreadyMigrated(wd)) continue;
      const decW = await decryptDoc(key, wd, WARD_NOTE_FIELDS);
      if (decW) {
        const wAuthor =
          typeof wd.author === 'string' && !wd.authorUid
            ? await resolveAuthorUid(wd.author as string, usersByName)
            : null;
        await updateDoc(w.ref, {
          ...decW,
          ...(wAuthor ? { authorUid: wAuthor } : {}),
          migrationVersion: 2,
        });
        progress.inPlaceFixed += 1;
        tick();
      }
    }
  }

  return progress;
}

// Quick check: does the user have legacy data that needs migrating?
// Used to surface the "Migrate legacy data" UI only when relevant.
export async function detectLegacyData(targetGroupId: string): Promise<{
  legacyCases: number;
  inPlaceEncrypted: number;
}> {
  let legacyCases = 0;
  let inPlaceEncrypted = 0;

  try {
    const legacy = await getDocs(query(collection(db, 'cases')));
    legacy.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      if (!data.migratedTo) legacyCases += 1;
    });
  } catch {
    // Rules might block it; treat as no legacy data.
  }

  try {
    const newCases = await getDocs(
      query(collection(db, 'groups', targetGroupId, 'cases'))
    );
    newCases.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const iv = data.titleIv;
      // titleIv with 12 entries = still encrypted with legacy AES-GCM.
      if (Array.isArray(iv) && iv.length === 12) inPlaceEncrypted += 1;
    });
  } catch {
    /* ignore */
  }

  return { legacyCases, inPlaceEncrypted };
}

// Suppress unused-import warning if the writeBatch import is dropped later.
void writeBatch;
void setDoc;
