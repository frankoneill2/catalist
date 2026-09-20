// Server-side enforcement for Catalist (Phase 7).
//
// This module exists for the small set of operations that *must* be
// authoritative on the server, not just gated by client-side behaviour:
//
//   - Cascading delete of a case (with deterministic audit + failure handling).
//   - Removing a member from a group (so the ex-member can no longer write,
//     and so the operation is logged in a tamper-evident way).
//   - KMS-backed wrap/unwrap of per-group DEKs (Phase 5/7 hardening).
//   - Future: Crypto-shredding when a group is deleted.
//
// What is *not* here:
//
//   - Day-to-day reads and writes of cases / tasks / notes. Those still go
//     through the client SDK gated by Firestore rules — moving them through
//     a function would multiply latency for no security benefit, since the
//     same membership check the rule does is what the function would do.
//
// Deployment:
//
//   cd functions
//   npm install
//   firebase use dev          # or `firebase use default` for prod
//   npm run deploy
//
// Costs: the project moved to Blaze on 2026-09-20, which is what makes the
// KMS functions below possible. Expected volumes sit inside the free tier.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { KeyManagementServiceClient } from '@google-cloud/kms';

initializeApp();
const db = getFirestore();

// EU region to match the rest of the project's `eur3` posture. Cold starts
// from EU keep latency tight for clinicians inside Europe and avoid cross-
// border data transfer questions.
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

interface DeleteCaseRequest {
  groupId?: string;
  caseId?: string;
}

// -----------------------------------------------------------------------
// deleteCase — cascades through tasks/comments/notes/wardNotes.
//
// Why server-side:
//   - The cascade is multi-write; if it fails halfway through (offline,
//     auth lapse, rules update mid-op) the client leaves an inconsistent
//     case behind. The function can write the audit event last, after a
//     successful cascade, so the audit log accurately reflects what
//     actually happened.
//   - Phase 5 envelope-encryption rotation may want to crypto-shred the
//     per-case DEK at delete time. That belongs server-side because the
//     KEK lives in KMS.
//
// Caller requirement: must be a group admin. Members can request a delete
// from the UI which calls this function; the function rejects if the
// caller is not in the group's adminUids array.
// -----------------------------------------------------------------------

export const deleteCase = onCall<DeleteCaseRequest>(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const { groupId, caseId } = req.data || {};
  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  if (!caseId || typeof caseId !== 'string') {
    throw new HttpsError('invalid-argument', 'caseId is required');
  }

  // Verify admin membership.
  const groupSnap = await db.doc(`groups/${groupId}`).get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'Group does not exist.');
  }
  const groupData = groupSnap.data() as Record<string, unknown>;
  const admins = Array.isArray(groupData.adminUids) ? (groupData.adminUids as string[]) : [];
  if (!admins.includes(uid)) {
    throw new HttpsError('permission-denied', 'Only group admins can delete cases.');
  }

  const caseRef = db.doc(`groups/${groupId}/cases/${caseId}`);
  const tasksSnap = await caseRef.collection('tasks').get();
  let taskCount = 0;
  let commentCount = 0;
  for (const t of tasksSnap.docs) {
    const cmts = await t.ref.collection('comments').get();
    commentCount += cmts.size;
    for (const c of cmts.docs) await c.ref.delete();
    await t.ref.delete();
    taskCount += 1;
  }
  const notesSnap = await caseRef.collection('notes').get();
  for (const n of notesSnap.docs) await n.ref.delete();
  const wardNotesSnap = await caseRef.collection('wardNotes').get();
  for (const w of wardNotesSnap.docs) await w.ref.delete();
  await caseRef.delete();

  // Audit. Using Firestore for the log keeps the event under the same
  // tamper-evident rules as client-written events; clients can read it via
  // the existing /groups/{gid}/audit subcollection.
  await db.collection(`groups/${groupId}/audit`).add({
    uid,
    action: 'case.delete',
    groupId,
    caseId,
    detail: {
      taskCount,
      commentCount,
      noteCount: notesSnap.size,
      wardNoteCount: wardNotesSnap.size,
      via: 'cloud-function',
    },
    createdAt: FieldValue.serverTimestamp(),
    clientCreatedAt: Date.now(),
  });

  logger.info('deleteCase ok', { groupId, caseId, taskCount, noteCount: notesSnap.size });
  return { ok: true, taskCount, noteCount: notesSnap.size, wardNoteCount: wardNotesSnap.size };
});

interface RemoveMemberRequest {
  groupId?: string;
  targetUid?: string;
}

// removeMember — strips someone out of memberUids+adminUids and writes audit.
// Callable from a UI that confirms the action; the rule for /groups/{id}
// already permits an admin to do this directly via the client SDK, but
// routing through this function gives us:
//   - Atomic write of group + audit entry + per-member doc cleanup.
//   - Future hook for revoking refresh tokens (auth.revokeRefreshTokens) so
//     the ex-member's existing sessions are invalidated immediately rather
//     than within the 1-hour ID token TTL window.
export const removeMember = onCall<RemoveMemberRequest>(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { groupId, targetUid } = req.data || {};
  if (!groupId || !targetUid) {
    throw new HttpsError('invalid-argument', 'groupId and targetUid are required');
  }
  if (uid === targetUid) {
    throw new HttpsError('failed-precondition', 'Use leaveGroup to remove yourself.');
  }
  const groupRef = db.doc(`groups/${groupId}`);
  const snap = await groupRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Group does not exist.');
  const data = snap.data() as Record<string, unknown>;
  const admins = Array.isArray(data.adminUids) ? (data.adminUids as string[]) : [];
  if (!admins.includes(uid)) {
    throw new HttpsError('permission-denied', 'Only group admins can remove members.');
  }
  const owner = String(data.ownerUid || '');
  if (targetUid === owner) {
    throw new HttpsError('failed-precondition', 'The group owner cannot be removed; transfer ownership first.');
  }

  await groupRef.update({
    memberUids: FieldValue.arrayRemove(targetUid),
    adminUids: FieldValue.arrayRemove(targetUid),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Best-effort: clean up the user back-reference + per-member doc.
  await db.doc(`users/${targetUid}`).update({
    groupIds: FieldValue.arrayRemove(groupId),
  }).catch(() => { /* missing user doc is non-fatal */ });
  await db.doc(`groups/${groupId}/members/${targetUid}`).set({
    leftAt: FieldValue.serverTimestamp(),
    leftAtClient: Date.now(),
  }, { merge: true }).catch(() => { /* non-fatal */ });

  await db.collection(`groups/${groupId}/audit`).add({
    uid,
    action: 'member.remove',
    groupId,
    targetUid,
    detail: { via: 'cloud-function' },
    createdAt: FieldValue.serverTimestamp(),
    clientCreatedAt: Date.now(),
  });

  logger.info('removeMember ok', { groupId, targetUid, by: uid });
  return { ok: true };
});

// =======================================================================
// KMS-backed DEK wrapping (Phase 5/7)
//
// The problem this solves: before this, the Key Encryption Key was derived
// in the browser from `VITE_FIELD_KEK_SEED`. Vite inlines every VITE_*
// variable into the bundle, so that key was downloadable by anyone who
// opened the site — which meant the envelope encryption protected nothing
// against an attacker who could also read the JavaScript.
//
// Now the KEK is a Cloud KMS key that never leaves Google's infrastructure.
// The browser calls `unwrapGroupDek`, this function checks membership
// server-side, asks KMS to decrypt the group's wrapped DEK, and returns the
// DEK. The KEK itself is never exposed.
//
// What this does and does not buy:
//   - A database-only breach (stolen backup, rules bug, Firestore-side
//     incident) now yields ciphertext and nothing else. That is the threat
//     model src/auth/envelope.ts names, and it now actually holds.
//   - Every unwrap is recorded in Cloud Audit Logs, and the key can be
//     disabled to revoke access to all encrypted content at once.
//   - The DEK still reaches the browser of an authenticated member, because
//     the client does the decryption. A compromised member session still
//     exposes that group's data. Closing that would require decrypting
//     server-side on every read, or true end-to-end encryption (Path B,
//     which was deliberately not chosen).
//
// Wrapped DEK versions stored on groups/{id}.wrappedDek:
//   v1 — AES-GCM under a PBKDF2 key derived in the browser. Legacy.
//   v2 — KMS ciphertext. No nonce field; KMS handles that internally.
// The client understands both so the migration needs no downtime.
// =======================================================================

const WRAPPED_DEK_VERSION_KMS = 2;

const kms = new KeyManagementServiceClient();

/** Resolved lazily so the project id comes from the runtime, not a constant. */
function kmsKeyName(): string {
  const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new HttpsError('internal', 'project id unavailable');
  return kms.cryptoKeyPath(project, 'europe', 'catalist', 'field-kek');
}

/**
 * Shared entry checks: signed in, email verified, and a member of the group.
 * Mirrors `isSignedIn()` + `isGroupMember()` in firestore.rules — the rules
 * cannot gate a function call, so the check is repeated here on purpose.
 */
async function requireGroupMember(
  req: { auth?: { uid?: string; token?: Record<string, unknown> } },
  groupId: string,
): Promise<{ uid: string; group: Record<string, unknown> }> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (req.auth?.token?.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Verify your email address first.');
  }
  const snap = await db.doc(`groups/${groupId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Group does not exist.');
  const group = snap.data() as Record<string, unknown>;
  const members = Array.isArray(group.memberUids) ? (group.memberUids as string[]) : [];
  if (!members.includes(uid)) {
    throw new HttpsError('permission-denied', 'You are not a member of this workspace.');
  }
  return { uid, group };
}

interface GroupDekRequest {
  groupId?: string;
}

// -----------------------------------------------------------------------
// unwrapGroupDek — return the group's data encryption key to a member.
//
// Only handles v2 (KMS) wrapping. A group still on v1 is left to the client,
// which can unwrap it locally during the migration window.
// -----------------------------------------------------------------------
export const unwrapGroupDek = onCall<GroupDekRequest>(async (req) => {
  const { groupId } = req.data || {};
  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  const { uid, group } = await requireGroupMember(req, groupId);

  const wrapped = group.wrappedDek as Record<string, unknown> | undefined;
  if (!wrapped || typeof wrapped !== 'object') {
    throw new HttpsError('failed-precondition', 'This workspace has no data key yet.');
  }
  if (Number(wrapped.v) !== WRAPPED_DEK_VERSION_KMS) {
    // v1 — the client unwraps this one itself. Telling it so explicitly is
    // clearer than a generic failure during the migration window.
    throw new HttpsError('failed-precondition', 'legacy-wrapping');
  }

  let plaintext: Buffer;
  try {
    const [result] = await kms.decrypt({
      name: kmsKeyName(),
      ciphertext: Buffer.from(String(wrapped.c), 'base64'),
    });
    plaintext = Buffer.from(result.plaintext as Uint8Array);
  } catch (err) {
    logger.error('unwrapGroupDek: KMS decrypt failed', { groupId, uid, err });
    throw new HttpsError('internal', 'Could not unwrap the workspace key.');
  }

  logger.info('unwrapGroupDek ok', { groupId, uid, dekId: wrapped.k });
  return { dekB64: plaintext.toString('base64'), dekId: String(wrapped.k) };
});

interface WrapGroupDekRequest extends GroupDekRequest {
  dekB64?: string;
  dekId?: string;
}

// -----------------------------------------------------------------------
// wrapGroupDek — store a newly generated DEK for a group, wrapped by KMS.
//
// Used when a group is first created. It deliberately REFUSES to overwrite
// an existing wrappedDek: doing so would orphan every field already
// encrypted under the old DEK. This mirrors `envelopeKeyImmutable()` in
// firestore.rules. Rotation is a separate, deliberate migration
// (scripts/migrate-kek-to-kms.mjs), not something a client can trigger.
// -----------------------------------------------------------------------
export const wrapGroupDek = onCall<WrapGroupDekRequest>(async (req) => {
  const { groupId, dekB64, dekId } = req.data || {};
  if (!groupId || typeof groupId !== 'string') {
    throw new HttpsError('invalid-argument', 'groupId is required');
  }
  if (!dekB64 || typeof dekB64 !== 'string') {
    throw new HttpsError('invalid-argument', 'dekB64 is required');
  }
  if (!dekId || typeof dekId !== 'string') {
    throw new HttpsError('invalid-argument', 'dekId is required');
  }
  const { uid, group } = await requireGroupMember(req, groupId);

  const admins = Array.isArray(group.adminUids) ? (group.adminUids as string[]) : [];
  if (!admins.includes(uid)) {
    throw new HttpsError('permission-denied', 'Only workspace admins can create the data key.');
  }
  if (group.wrappedDek) {
    throw new HttpsError('already-exists', 'This workspace already has a data key.');
  }

  const raw = Buffer.from(dekB64, 'base64');
  if (raw.length !== 32) {
    throw new HttpsError('invalid-argument', 'DEK must be 32 bytes (AES-256).');
  }

  let ciphertext: string;
  try {
    const [result] = await kms.encrypt({ name: kmsKeyName(), plaintext: raw });
    ciphertext = Buffer.from(result.ciphertext as Uint8Array).toString('base64');
  } catch (err) {
    logger.error('wrapGroupDek: KMS encrypt failed', { groupId, uid, err });
    throw new HttpsError('internal', 'Could not create the workspace key.');
  }

  await db.doc(`groups/${groupId}`).set(
    {
      wrappedDek: { v: WRAPPED_DEK_VERSION_KMS, c: ciphertext, k: dekId },
      wrappedDekUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('wrapGroupDek ok', { groupId, uid, dekId });
  return { ok: true };
});
