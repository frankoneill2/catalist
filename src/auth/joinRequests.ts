// Admin-approval flow for invite acceptance.
//
// Background: the original invite flow added the recipient straight into
// memberUids the moment they clicked the link. That means a leaked link
// (forwarded email, screenshot in a chat, browser history) hands the
// attacker a workspace seat with no further review. The admin-approval
// model puts a holding pen — `/groups/{gid}/joinRequests/{uid}` — between
// "I clicked the link" and "I'm a member": the requester writes the
// pending doc, an admin reviews it from the Manage workspaces UI, and
// only then are they added to memberUids.
//
// Trade-off: the inviter has to be reachable to approve, which is fine
// for in-person clinical onboarding (admin standing next to the new
// hire) but adds latency for async invites. Acceptable, and the security
// upgrade is real for the leak-via-screenshot case.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  arrayUnion,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { logDataEvent } from './dataAudit';

export type JoinRequestStatus = 'pending' | 'approved' | 'denied';

export interface JoinRequest {
  // Doc id == requester's uid (so each user has at most one in-flight
  // request per group; re-applying overwrites).
  uid: string;
  groupId: string;
  inviteToken: string;
  email: string;
  displayName: string;
  status: JoinRequestStatus;
  requestedAtClient: number;
  reviewedByUid?: string;
  reviewedAtClient?: number;
}

function joinRequestRef(groupId: string, uid: string) {
  return doc(db, 'groups', groupId, 'joinRequests', uid);
}

function joinRequestsCol(groupId: string) {
  return collection(db, 'groups', groupId, 'joinRequests');
}

function fromDoc(snap: { id: string; data(): unknown }): JoinRequest {
  const data = (snap.data() as Record<string, unknown>) || {};
  return {
    uid: String(data.uid || snap.id),
    groupId: String(data.groupId || ''),
    inviteToken: String(data.inviteToken || ''),
    email: String(data.email || ''),
    displayName: String(data.displayName || ''),
    status: (data.status as JoinRequestStatus) || 'pending',
    requestedAtClient: typeof data.requestedAtClient === 'number'
      ? (data.requestedAtClient as number) : 0,
    reviewedByUid: typeof data.reviewedByUid === 'string'
      ? (data.reviewedByUid as string) : undefined,
    reviewedAtClient: typeof data.reviewedAtClient === 'number'
      ? (data.reviewedAtClient as number) : undefined,
  };
}

// Called by the requester once they've claimed the invite (i.e. the
// invite doc is now in 'accepted' state with their uid stamped on it).
// Writes a pending join request under the target group; the admin's UI
// will pick it up via the watcher below.
export async function requestJoin(opts: {
  groupId: string;
  inviteToken: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first to request access.');
  if (!opts.groupId || !opts.inviteToken) {
    throw new Error('Internal: requestJoin missing groupId or inviteToken.');
  }
  // Plain-object payload — fields the rule will look at must be at the
  // top level. Note: NOT including reviewedByUid / reviewedAt — the rule
  // explicitly forbids them on create so the requester can't pre-stamp
  // their own approval.
  await setDoc(joinRequestRef(opts.groupId, user.uid), {
    uid: user.uid,
    groupId: opts.groupId,
    inviteToken: opts.inviteToken,
    email: user.email || '',
    displayName: user.displayName || '',
    status: 'pending' as JoinRequestStatus,
    requestedAt: serverTimestamp(),
    requestedAtClient: Date.now(),
  });
}

// Called by an admin to grant access. Two writes (group memberUids +
// joinRequest status); not transactional, but the second is best-effort
// audit metadata — the load-bearing op is the memberUids update which
// actually gates Firestore access.
export async function approveJoinRequest(req: JoinRequest): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first.');
  // Step 1: add to memberUids. Permission check (isGroupAdmin) is enforced
  // by the group's update rule.
  await updateDoc(doc(db, 'groups', req.groupId), {
    memberUids: arrayUnion(req.uid),
    updatedAt: serverTimestamp(),
  });
  // Step 2: stamp the request as approved. If this fails the user is
  // already in — we'll log the warning but not throw.
  try {
    await updateDoc(joinRequestRef(req.groupId, req.uid), {
      status: 'approved' as JoinRequestStatus,
      reviewedByUid: user.uid,
      reviewedAt: serverTimestamp(),
      reviewedAtClient: Date.now(),
    });
  } catch (err) {
    console.warn('[joinRequests] could not stamp approval (membership granted regardless)', err);
  }
  void logDataEvent({
    action: 'member.add',
    groupId: req.groupId,
    targetUid: req.uid,
    detail: { via: 'invite-approval' },
  });
}

// Called by an admin to refuse. Updates status so the requester's
// AwaitingApproval screen can surface the rejection, then deletes the
// doc shortly after (handled by the cleanup helper below or admin's
// explicit click).
export async function denyJoinRequest(req: JoinRequest): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first.');
  await updateDoc(joinRequestRef(req.groupId, req.uid), {
    status: 'denied' as JoinRequestStatus,
    reviewedByUid: user.uid,
    reviewedAt: serverTimestamp(),
    reviewedAtClient: Date.now(),
  });
  void logDataEvent({
    action: 'member.remove',
    groupId: req.groupId,
    targetUid: req.uid,
    detail: { via: 'invite-deny' },
  });
}

// Cleanup hook — admin can remove an old (approved or denied) request
// from the panel without affecting membership.
export async function deleteJoinRequest(groupId: string, uid: string): Promise<void> {
  await deleteDoc(joinRequestRef(groupId, uid));
}

// Requester-side: fetch their own pending request (if any) so the
// AwaitingApproval screen knows which group + admin to surface. Returns
// the first pending request found across all known group memberships.
export async function findOwnPendingRequest(): Promise<JoinRequest | null> {
  const user = auth.currentUser;
  if (!user) return null;
  // The requester knows the group id from the invite they just claimed
  // (passed through sessionStorage during the AuthGate dance), but we
  // can't list all groups looking for /joinRequests/{uid} without
  // permission. Instead the AuthGate hands the groupId+token in
  // explicitly via the AwaitingApproval props.
  return null; // placeholder — see AuthGate.routeFromUser for the real lookup.
}

// Listen to the requester's own join request doc so the AwaitingApproval
// screen can react when an admin approves or denies. The rule allows
// `isUser(requesterUid)` reads, so a non-member can subscribe to their
// own holding-pen doc without having any group access.
export function watchOwnJoinRequest(
  groupId: string,
  uid: string,
  cb: (req: JoinRequest | null) => void
): Unsubscribe {
  const ref = joinRequestRef(groupId, uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) { cb(null); return; }
      cb(fromDoc(snap));
    },
    (err) => console.warn('[joinRequests] own watcher error', err)
  );
}

// Admin-side: live list of pending requests for a group they admin.
// Used by the GroupSwitcher Manage modal to surface the "approve / deny"
// affordances and a count badge on the workspace pill.
export function watchGroupJoinRequests(
  groupId: string,
  cb: (rows: JoinRequest[]) => void
): Unsubscribe {
  const q = query(joinRequestsCol(groupId), where('status', '==', 'pending'));
  return onSnapshot(
    q,
    (snap) => {
      const out: JoinRequest[] = [];
      snap.forEach((d) => out.push(fromDoc(d)));
      out.sort((a, b) => (a.requestedAtClient || 0) - (b.requestedAtClient || 0));
      cb(out);
    },
    (err) => console.warn('[joinRequests] group watcher error for', groupId, err)
  );
}

// One-shot fetch of a specific request — used by the AwaitingApproval
// screen on first paint before the live listener kicks in.
export async function getJoinRequest(
  groupId: string,
  uid: string
): Promise<JoinRequest | null> {
  const snap = await getDoc(joinRequestRef(groupId, uid));
  if (!snap.exists()) return null;
  return fromDoc(snap);
}
