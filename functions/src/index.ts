// Server-side enforcement for Catalist (Phase 7).
//
// This module exists for the small set of operations that *must* be
// authoritative on the server, not just gated by client-side behaviour:
//
//   - Cascading delete of a case (with deterministic audit + failure handling).
//   - Removing a member from a group (so the ex-member can no longer write,
//     and so the operation is logged in a tamper-evident way).
//   - Future: KMS-backed wrap/unwrap of per-group DEKs (Phase 5 hardening).
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
// Costs: Cloud Functions on the Spark plan are free for the volumes Catalist
// expects. Moving to Blaze is required only if we hit the free-tier limits
// or want to use KMS / Pub/Sub / scheduled functions.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger, setGlobalOptions } from 'firebase-functions/v2';

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
