// Floating notice rendered while the user is in the Ready stage with one or
// more outstanding join requests submitted from a previous QR scan. Two
// jobs:
//
//   1. Reassurance — show a small persistent banner so the user can see at
//      a glance that their request is in flight and hasn't been forgotten.
//   2. Celebration — when the admin approves, surface a clear "you're in"
//      call-to-action with a button that switches them into the newly-
//      joined workspace. Without this the new membership lands silently
//      (the live group list listener notices the new entry but nothing
//      in the UI tells the user what just happened).
//
// State is driven by:
//   * pendingJoinTracker (localStorage) — the requests we know we
//     submitted in past sessions / from past reloads.
//   * watchOwnJoinRequest (Firestore) — live status flips per request.

import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { setCurrentGroupId } from '../groupContext';
import { watchOwnJoinRequest, type JoinRequest } from '../joinRequests';
import {
  listPendingJoins,
  markApprovalAcknowledged,
  removePendingJoin,
} from '../pendingJoinTracker';

interface TrackedRequest {
  groupId: string;
  groupName: string;
  status: JoinRequest['status'] | 'pending' | 'missing';
  acknowledged: boolean;
}

interface Props {
  user: User;
}

export const PendingJoinNotice: React.FC<Props> = ({ user }) => {
  const [requests, setRequests] = useState<TrackedRequest[]>([]);

  // Hydrate the initial list from localStorage and keep a live listener per
  // group so status changes show up here without a reload.
  useEffect(() => {
    const initial = listPendingJoins(user.uid).map((p) => ({
      groupId: p.groupId,
      groupName: p.groupName,
      status: 'pending' as JoinRequest['status'],
      acknowledged: !!p.approvalAcknowledged,
    }));
    setRequests(initial);

    const unsubs: Array<() => void> = [];
    for (const p of initial) {
      try {
        unsubs.push(
          watchOwnJoinRequest(p.groupId, user.uid, (req) => {
            setRequests((prev) =>
              prev.map((r) =>
                r.groupId === p.groupId
                  ? { ...r, status: req ? req.status : 'missing' }
                  : r
              )
            );
          })
        );
      } catch (err) {
        console.warn('[PendingJoinNotice] could not watch', p.groupId, err);
      }
    }
    return () => { unsubs.forEach((u) => u()); };
  }, [user.uid]);

  if (requests.length === 0) return null;

  // Surface at most one item at a time — approval celebrations win, then
  // denials, then the persistent pending banner. Keeps the chrome tidy.
  const approved = requests.find((r) => r.status === 'approved' && !r.acknowledged);
  const denied = requests.find((r) => r.status === 'denied');
  const pending = requests.find((r) => r.status === 'pending');

  if (approved) {
    return (
      <div className="ag-pending-join ag-pending-join-approved" role="status">
        <div className="ag-pending-join-body">
          <strong>You've been added to "{approved.groupName}"</strong>
          <span className="ag-pending-join-sub">An admin approved your request.</span>
        </div>
        <div className="ag-pending-join-actions">
          <button
            type="button"
            className="ag-btn ag-btn-primary"
            onClick={() => {
              markApprovalAcknowledged(user.uid, approved.groupId);
              removePendingJoin(user.uid, approved.groupId);
              setCurrentGroupId(approved.groupId);
              // Reload so every listener rebinds under the new group, same
              // as elsewhere in the app on group switches.
              window.location.reload();
            }}
          >
            Switch to it
          </button>
          <button
            type="button"
            className="ag-btn ag-btn-ghost"
            onClick={() => {
              markApprovalAcknowledged(user.uid, approved.groupId);
              removePendingJoin(user.uid, approved.groupId);
              setRequests((prev) => prev.filter((r) => r.groupId !== approved.groupId));
            }}
            aria-label="Dismiss"
          >
            Stay here
          </button>
        </div>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="ag-pending-join ag-pending-join-denied" role="status">
        <div className="ag-pending-join-body">
          <strong>Your request to join "{denied.groupName}" was declined</strong>
          <span className="ag-pending-join-sub">Ask the admin for a new invite link if this was a mistake.</span>
        </div>
        <div className="ag-pending-join-actions">
          <button
            type="button"
            className="ag-btn ag-btn-ghost"
            onClick={() => {
              removePendingJoin(user.uid, denied.groupId);
              setRequests((prev) => prev.filter((r) => r.groupId !== denied.groupId));
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="ag-pending-join ag-pending-join-pending" role="status">
        <div className="ag-pending-join-body">
          <strong>Awaiting approval to join "{pending.groupName}"</strong>
          <span className="ag-pending-join-sub">You'll see a notification here as soon as an admin approves.</span>
        </div>
      </div>
    );
  }

  return null;
};
