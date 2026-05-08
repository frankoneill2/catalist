// Group invitations — tokenised, copy-paste-friendly invite links.
//
// Why this shape: we don't have a server (no Cloud Functions yet), so we
// can't look up an email→uid mapping or send mail directly from the
// browser. Instead the inviter creates an `/invites/{token}` doc with a
// random 24-char token, gets back a shareable URL, and sends it through
// whatever channel they prefer (email, Slack, paper, carrier pigeon).
//
// The token itself is the secret — anyone who has it can read the invite
// and accept it, so don't ship them in URL query strings to channels you
// wouldn't put a password in. ~96 bits of entropy is enough that
// guessing is not a realistic attack.
//
// Acceptance is a two-write dance, both done by the recipient:
//   1. Set acceptedByUid + status='accepted' on /invites/{token}.
//   2. Update /groups/{groupId} to add self to memberUids, including the
//      token in a `_claimedFromInvite` field so rules can re-fetch the
//      invite and verify it really was accepted by *this* user for *this*
//      group.
//
// Phase 7's Cloud Function rewrite of "removing a member" / "transferring
// ownership" will likely also rewrite this whole flow into a single
// callable, at which point we can drop the rule indirection.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { logDataEvent } from './dataAudit';
import { requestJoin } from './joinRequests';

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invite {
  id: string;            // == token
  groupId: string;
  groupName: string;
  invitedEmail: string;  // free text, optional, lower-cased
  invitedByUid: string;
  invitedByName: string;
  status: InviteStatus;
  createdAtClient?: number;
  expiresAtClient?: number;
  acceptedByUid?: string;
  acceptedAtClient?: number;
}

// Invite links expire after 1 hour. The expected use case is in-person
// onboarding (admin shows the QR to the new clinician on the spot) or a
// quick async send via WhatsApp / Slack / SMS. A short window cuts the
// blast radius of a leaked screenshot or forwarded email — if a link
// drifts past its expiry, the admin can regenerate it in one tap. For
// reference: Slack and Notion magic-link sign-in expire at the same window.
export const INVITE_TTL_MS = 60 * 60 * 1000; // 1 hour

function invitesCol() {
  return collection(db, 'invites');
}
function inviteRef(token: string) {
  return doc(db, 'invites', token);
}

// 24 chars of url-safe random — enough that guessing is not a realistic
// attack (96 bits ~ 2^96 possibilities).
function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  // Base64url-encode without padding.
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function inviteFromDoc(id: string, data: Record<string, unknown>): Invite {
  return {
    id,
    groupId: String(data.groupId || ''),
    groupName: String(data.groupName || ''),
    invitedEmail: String(data.invitedEmail || ''),
    invitedByUid: String(data.invitedByUid || ''),
    invitedByName: String(data.invitedByName || ''),
    status: (data.status as InviteStatus) || 'pending',
    createdAtClient: typeof data.createdAtClient === 'number' ? (data.createdAtClient as number) : undefined,
    expiresAtClient: typeof data.expiresAtClient === 'number' ? (data.expiresAtClient as number) : undefined,
    acceptedByUid: typeof data.acceptedByUid === 'string' ? (data.acceptedByUid as string) : undefined,
    acceptedAtClient: typeof data.acceptedAtClient === 'number' ? (data.acceptedAtClient as number) : undefined,
  };
}

// Caller must already be a group admin; rules enforce it. Returns the
// shareable invite URL.
export async function createInvite(opts: {
  groupId: string;
  groupName: string;
  invitedEmail?: string;
}): Promise<{ token: string; url: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const token = newToken();
  const now = Date.now();
  const email = (opts.invitedEmail || '').trim().toLowerCase();

  // expiresAt is a real Firestore Timestamp so the rules can compare it
  // against `request.time`. expiresAtClient stays for the UI's countdown
  // display (cheap to read without a server round-trip), but it is not
  // load-bearing for security — the rule check uses expiresAt only.
  await setDoc(inviteRef(token), {
    groupId: opts.groupId,
    groupName: opts.groupName,
    invitedEmail: email,
    invitedByUid: user.uid,
    invitedByName: user.displayName || user.email || 'Unknown',
    status: 'pending' as InviteStatus,
    createdAt: serverTimestamp(),
    createdAtClient: now,
    expiresAt: Timestamp.fromMillis(now + INVITE_TTL_MS),
    expiresAtClient: now + INVITE_TTL_MS,
  });

  void logDataEvent({ action: 'invite.create', groupId: opts.groupId, detail: { token } });
  const url = `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
  return { token, url };
}

export async function loadInvite(token: string): Promise<Invite | null> {
  const snap = await getDoc(inviteRef(token));
  if (!snap.exists()) return null;
  return inviteFromDoc(snap.id, snap.data() as Record<string, unknown>);
}

// Recipient flow under the admin-approval model.
//
// Two writes:
//   1. Mark the invite doc `accepted` with our uid (single-use guard).
//   2. Create a /groups/{gid}/joinRequests/{uid} doc that an admin will
//      review. Membership is NOT granted here — that happens when an
//      admin approves the request in the Manage workspaces UI.
//
// Returns the Invite (so the caller can pass groupId/groupName to the
// AwaitingApproval screen). Throws if either write fails.
export async function acceptInvite(token: string): Promise<Invite> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first to accept this invite.');

  const existing = await loadInvite(token);
  if (!existing) throw new Error('This invite link is no longer valid.');
  if (existing.status === 'revoked') throw new Error('This invite has been revoked.');
  if (existing.status === 'expired') throw new Error('This invite has expired.');
  if (existing.expiresAtClient && existing.expiresAtClient < Date.now()) {
    throw new Error('This invite has expired.');
  }

  // If somebody else already accepted with this token, refuse — tokens are
  // single-use to keep the rule check (acceptedByUid == auth.uid) honest.
  if (existing.status === 'accepted' && existing.acceptedByUid && existing.acceptedByUid !== user.uid) {
    throw new Error('This invite link has already been used by someone else.');
  }

  const now = Date.now();
  // Step 1: claim the invite. Skip if we've already accepted it (retry
  // after a failed step-2) — the rule only allows pending → accepted, so
  // re-claiming an already-accepted invite would 403.
  const alreadyClaimedByMe =
    existing.status === 'accepted' && existing.acceptedByUid === user.uid;
  if (!alreadyClaimedByMe) {
    await updateDoc(inviteRef(token), {
      status: 'accepted' as InviteStatus,
      acceptedByUid: user.uid,
      acceptedAt: serverTimestamp(),
      acceptedAtClient: now,
    });
  }

  // Step 2: write a join request the admin will review. The rule on
  // /groups/{gid}/joinRequests/{uid} verifies the invite token, the
  // requester's uid, and the invite expiry. Idempotent — re-running
  // overwrites the same doc.
  await requestJoin({ groupId: existing.groupId, inviteToken: token });

  void logDataEvent({ action: 'invite.accept', groupId: existing.groupId, detail: { token } });
  return { ...existing, status: 'accepted', acceptedByUid: user.uid, acceptedAtClient: now };
}

// Admin can revoke an invite. Backed by a deleteDoc; the link becomes
// useless because the rule on accept requires status:'pending'.
export async function revokeInvite(token: string): Promise<void> {
  // Snapshot for audit (we lose the groupId after the delete).
  let groupId: string | null = null;
  try {
    const snap = await getDoc(inviteRef(token));
    if (snap.exists()) groupId = String((snap.data() as Record<string, unknown>).groupId || '') || null;
  } catch { /* ignore */ }
  await deleteDoc(inviteRef(token));
  if (groupId) void logDataEvent({ action: 'invite.revoke', groupId, detail: { token } });
}

export async function listGroupInvites(groupId: string): Promise<Invite[]> {
  const q = query(invitesCol(), where('groupId', '==', groupId));
  const snap = await getDocs(q);
  const out: Invite[] = [];
  snap.forEach((d) => out.push(inviteFromDoc(d.id, d.data() as Record<string, unknown>)));
  out.sort((a, b) => (b.createdAtClient ?? 0) - (a.createdAtClient ?? 0));
  return out;
}

export function watchGroupInvites(
  groupId: string,
  cb: (invites: Invite[]) => void
): Unsubscribe {
  const q = query(invitesCol(), where('groupId', '==', groupId));
  return onSnapshot(q, (snap) => {
    const out: Invite[] = [];
    snap.forEach((d) => out.push(inviteFromDoc(d.id, d.data() as Record<string, unknown>)));
    out.sort((a, b) => (b.createdAtClient ?? 0) - (a.createdAtClient ?? 0));
    cb(out);
  });
}

// Pull a token from the current URL, if any. Cleared after the user has
// either accepted it or dismissed the prompt — see main.tsx.
export function readPendingInviteToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('invite');
    if (fromQuery) return fromQuery.trim() || null;
  } catch { /* ignore */ }
  // Stored before sign-in started (sessionStorage survives the SPA route
  // round-trip but is wiped by closing the tab).
  try {
    return sessionStorage.getItem('catalist.pendingInvite') || null;
  } catch {
    return null;
  }
}

export function rememberPendingInviteToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem('catalist.pendingInvite', token);
    else sessionStorage.removeItem('catalist.pendingInvite');
  } catch { /* ignore */ }
}

export function clearInviteFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('invite')) {
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
    }
  } catch { /* ignore */ }
}

// Suppress unused warning for the addDoc import — kept around in case we
// switch back to addDoc semantics for invite creation in a future revision.
void addDoc;
