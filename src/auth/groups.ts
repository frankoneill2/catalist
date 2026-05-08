// Groups: workspaces that contain patient cases.
//
// Data shape (Phase 2):
//
//   groups/{groupId}
//     name             — string, user-supplied
//     ownerUid         — uid of creator
//     memberUids       — string[]  (denormalized for quick membership reads)
//     adminUids        — string[]  (subset of memberUids; ownerUid is always admin)
//     createdAt        — server timestamp
//     createdAtClient  — number (ms since epoch, set by client for ordering)
//
//   groups/{groupId}/members/{uid}
//     uid, role ('owner' | 'admin' | 'member'), joinedAt
//
//   users/{uid}
//     groupIds: string[]   — denormalized list of groups the user belongs to,
//                            used to render the switcher without a fan-out read.
//
// Phase 4 will tighten the rules so that membership in `memberUids` is
// required to read/write under `groups/{groupId}/cases/...`. For now (Phase 2)
// the rules stay permissive and we just build the structure correctly.

import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { logDataEvent } from './dataAudit';

export interface Group {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  adminUids: string[];
  createdAtClient?: number;
}

export interface GroupMember {
  uid: string;
  role: 'owner' | 'admin' | 'member';
  joinedAtClient?: number;
}

const DEFAULT_GROUP_NAME = 'My workspace';

function groupsCol() {
  return collection(db, 'groups');
}
function groupRef(groupId: string) {
  return doc(db, 'groups', groupId);
}
function memberRef(groupId: string, uid: string) {
  return doc(db, 'groups', groupId, 'members', uid);
}
function userRef(uid: string) {
  return doc(db, 'users', uid);
}

function groupFromDoc(id: string, data: Record<string, unknown>): Group {
  const memberUids = Array.isArray(data.memberUids) ? (data.memberUids as string[]) : [];
  const adminUids = Array.isArray(data.adminUids) ? (data.adminUids as string[]) : [];
  return {
    id,
    name: String(data.name || ''),
    ownerUid: String(data.ownerUid || ''),
    memberUids,
    adminUids,
    createdAtClient: typeof data.createdAtClient === 'number' ? (data.createdAtClient as number) : undefined,
  };
}

// Fetch every group the user is a member of. Uses the denormalized
// memberUids array, which is indexed by Firestore for `array-contains`.
export async function listMyGroups(uid: string): Promise<Group[]> {
  const q = query(groupsCol(), where('memberUids', 'array-contains', uid));
  const snap = await getDocs(q);
  const out: Group[] = [];
  snap.forEach((d) => out.push(groupFromDoc(d.id, d.data() as Record<string, unknown>)));
  out.sort((a, b) => (a.createdAtClient ?? 0) - (b.createdAtClient ?? 0));
  return out;
}

// Listen on the same set of groups, so the switcher updates when a group
// is created or the user is added to one. Snapshot errors are logged so
// the developer console always shows what's happening — without an
// explicit error handler, Firestore drops them silently.
export function watchMyGroups(uid: string, cb: (groups: Group[]) => void): Unsubscribe {
  const q = query(groupsCol(), where('memberUids', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const out: Group[] = [];
      snap.forEach((d) => out.push(groupFromDoc(d.id, d.data() as Record<string, unknown>)));
      out.sort((a, b) => (a.createdAtClient ?? 0) - (b.createdAtClient ?? 0));
      console.info('[groups] watchMyGroups snapshot:', out.length, 'group(s)');
      cb(out);
    },
    (err) => {
      console.error('[groups] watchMyGroups snapshot error', err);
    }
  );
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const snap = await getDoc(groupRef(groupId));
  if (!snap.exists()) return null;
  return groupFromDoc(snap.id, snap.data() as Record<string, unknown>);
}

// Create a new group with `uid` as the owner + sole admin + sole member.
// Returns the new group's id.
//
// Each underlying write is wrapped with a contextual error so a permission
// denial surfaces *which* step failed rather than the bare
// "Missing or insufficient permissions" Firebase emits. The group doc is
// the only step that *must* succeed for the function to be usable; the
// member-doc and user-profile back-references are best-effort and a
// failure in either is logged but does not invalidate the group.
export async function createGroup(uid: string, name: string): Promise<string> {
  const trimmed = (name || '').trim() || DEFAULT_GROUP_NAME;
  const now = Date.now();
  // Sanity check: Firestore rules will fail in confusing ways if
  // auth.currentUser.uid disagrees with the uid we pass in (e.g. after a
  // sign-out/sign-in race). Surface it loudly here.
  const callerUid = auth.currentUser?.uid;
  if (!callerUid) {
    throw new Error('createGroup: not signed in');
  }
  if (callerUid !== uid) {
    console.warn('[groups] createGroup: caller uid', callerUid, '!= passed uid', uid, '— rules will reject this write');
  }

  let groupDoc;
  try {
    groupDoc = await addDoc(groupsCol(), {
      name: trimmed,
      ownerUid: uid,
      memberUids: [uid],
      adminUids: [uid],
      createdAt: serverTimestamp(),
      createdAtClient: now,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[groups] createGroup: addDoc(/groups) failed for uid=', uid, '(auth.currentUser=', callerUid, ')', err);
    throw err;
  }

  // Mirror into the per-member doc (so future audit writes have somewhere to
  // attach). Failure here doesn't invalidate the group — the group is already
  // committed and you're already in memberUids — so log and continue rather
  // than throwing the user back out.
  try {
    await setDoc(memberRef(groupDoc.id, uid), {
      uid,
      role: 'owner',
      joinedAt: serverTimestamp(),
      joinedAtClient: now,
    });
  } catch (err) {
    console.warn('[groups] createGroup: setDoc(/groups/<id>/members/<uid>) failed (continuing)', err);
  }

  // Track on the user profile so we can fast-load on next sign-in even
  // before the group query resolves. Two-step so the rule path that wants
  // an existing doc gets a chance first; if it fails we fall back to a
  // merging setDoc that creates the doc if needed.
  try {
    try {
      await updateDoc(userRef(uid), {
        groupIds: arrayUnion(groupDoc.id),
        updatedAt: serverTimestamp(),
      });
    } catch (innerErr) {
      console.warn('[groups] createGroup: updateDoc(/users/<uid>) failed, retrying with setDoc merge', innerErr);
      await setDoc(userRef(uid), { groupIds: [groupDoc.id] }, { merge: true });
    }
  } catch (err) {
    console.warn('[groups] createGroup: could not back-reference group on user profile (continuing)', err);
  }

  // Audit is fire-and-forget by design.
  void logDataEvent({ action: 'group.create', groupId: groupDoc.id, detail: { name: trimmed } });
  return groupDoc.id;
}

// First-sign-in resolution: find a group the user is already a member of,
// or return null. As of the invite-only switch, this never auto-creates a
// personal workspace — a brand new account with no invitations sits in the
// AuthGate's awaiting-invite stage until an admin shares an invite link.
//
// Two-stage lookup so the common case is fast (one read) and the recovery
// case for users whose profile lost its denormalized groupIds back-reference
// still works (a query against memberUids).
//
// Returns the group id to land in, or null if the user belongs to no group.
export async function ensureDefaultGroup(uid: string, _displayName: string): Promise<string | null> {
  // Fast path: check the user profile for a known group id and verify it.
  try {
    const userSnap = await getDoc(userRef(uid));
    if (userSnap.exists()) {
      const data = userSnap.data() as Record<string, unknown>;
      const groupIds = Array.isArray(data.groupIds) ? (data.groupIds as string[]) : [];
      for (const candidate of groupIds) {
        try {
          const g = await getGroup(candidate);
          if (g && g.memberUids.includes(uid)) {
            console.info('[groups] ensureDefaultGroup: using cached', candidate);
            return g.id;
          }
        } catch (err) {
          // Stale id or rules denied (e.g. user was removed from this
          // group). Move on to the next candidate or the slow path.
          console.warn('[groups] cached groupId', candidate, 'unreachable, trying next', err);
        }
      }
    }
  } catch (err) {
    console.warn('[groups] ensureDefaultGroup fast-path failed', err);
  }

  // Slow path: query for any group that lists this uid. Catches users who
  // were added by someone else without their profile's groupIds getting
  // backfilled.
  try {
    const groups = await listMyGroups(uid);
    if (groups.length > 0) {
      const ids = groups.map((g) => g.id);
      await setDoc(
        userRef(uid),
        { groupIds: ids, updatedAt: serverTimestamp() },
        { merge: true }
      ).catch(() => { /* best effort */ });
      console.info('[groups] ensureDefaultGroup: slow-path found', ids);
      return groups[0].id;
    }
  } catch (err) {
    console.warn('[groups] ensureDefaultGroup slow-path failed', err);
  }

  console.info('[groups] ensureDefaultGroup: no membership for', uid);
  return null;
}

// Suppress unused-import warning if DEFAULT_GROUP_NAME ends up only used by
// createGroup's fallback below.
void DEFAULT_GROUP_NAME;

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Group name cannot be empty');
  await updateDoc(groupRef(groupId), {
    name: trimmed,
    updatedAt: serverTimestamp(),
  });
  void logDataEvent({ action: 'group.rename', groupId, detail: { name: trimmed } });
}

// Add `uid` as a member of `groupId`. The caller must be an admin (or the
// owner) of the group: Firestore rules now enforce additive-only changes
// for non-owner admins, and full membership control for the owner.
export async function addMember(groupId: string, uid: string): Promise<void> {
  const now = Date.now();
  await updateDoc(groupRef(groupId), {
    memberUids: arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
  await setDoc(memberRef(groupId, uid), {
    uid,
    role: 'member',
    joinedAt: serverTimestamp(),
    joinedAtClient: now,
  });
  await setDoc(userRef(uid), { groupIds: arrayUnion(groupId), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  void logDataEvent({ action: 'member.add', groupId, targetUid: uid });
}

export async function removeMember(groupId: string, uid: string): Promise<void> {
  await updateDoc(groupRef(groupId), {
    memberUids: arrayRemove(uid),
    adminUids: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
  // Best-effort: clear the per-member doc + user profile back-reference.
  await setDoc(memberRef(groupId, uid), {
    uid,
    role: 'member',
    leftAt: serverTimestamp(),
    leftAtClient: Date.now(),
  }, { merge: true }).catch(() => {});
  await updateDoc(userRef(uid), { groupIds: arrayRemove(groupId) }).catch(() => {});
  void logDataEvent({ action: 'member.remove', groupId, targetUid: uid });
}

// List members of a group (for the membership UI).
export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  const col = collection(db, 'groups', groupId, 'members');
  const snap = await getDocs(query(col, orderBy('joinedAtClient', 'asc'), limit(200)));
  const out: GroupMember[] = [];
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    out.push({
      uid: String(data.uid || d.id),
      role: (data.role as GroupMember['role']) || 'member',
      joinedAtClient: typeof data.joinedAtClient === 'number' ? (data.joinedAtClient as number) : undefined,
    });
  });
  return out;
}

// Self-heal: make sure the calling user has a member doc under the group.
// Two paths into membership exist that historically didn't: (a) accounts
// that joined via invite before invites.ts started writing the subdoc, and
// (b) any future bypass that updates `memberUids` without creating the
// subdoc. Without this backfill, the Manage workspaces UI under-counts and
// can't render those members even though they have full access. Reads the
// group doc first to confirm the user is actually in `memberUids`, so we
// never write a stray member doc for someone who isn't really in the group.
export async function ensureMembershipDoc(groupId: string, uid: string): Promise<void> {
  if (!groupId || !uid) return;
  try {
    const memberSnap = await getDoc(memberRef(groupId, uid));
    if (memberSnap.exists()) return;
    const groupSnap = await getDoc(groupRef(groupId));
    if (!groupSnap.exists()) return;
    const data = groupSnap.data() as Record<string, unknown>;
    const memberUids = Array.isArray(data.memberUids) ? (data.memberUids as string[]) : [];
    if (!memberUids.includes(uid)) return;
    const adminUids = Array.isArray(data.adminUids) ? (data.adminUids as string[]) : [];
    const ownerUid = String(data.ownerUid || '');
    const role: GroupMember['role'] =
      ownerUid === uid ? 'owner' : adminUids.includes(uid) ? 'admin' : 'member';
    await setDoc(
      memberRef(groupId, uid),
      {
        uid,
        role,
        joinedAt: serverTimestamp(),
        joinedAtClient: Date.now(),
        backfilledAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[groups] ensureMembershipDoc failed for', groupId, uid, err);
  }
}
