import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Shell, Info, FormError } from './Shell';
import { watchOwnJoinRequest, type JoinRequest } from '../joinRequests';

interface Props {
  user: User;
  groupId: string;
  groupName: string;
  onApproved: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  // When the user already has another workspace they could be working in
  // (e.g. they scanned a QR for a *second* group), pass these so we can
  // offer a "carry on in {existingGroupName}" escape hatch — no point
  // forcing them to stare at this screen until the admin acts.
  existingGroupName?: string;
  onContinueToExisting?: () => void | Promise<void>;
}

// Holding-pen screen shown after the user accepts an invite link. They
// don't have access yet — an admin of the group has to approve the
// pending join request first. We listen on the requester's own join
// request doc (the rule allows `isUser(requesterUid)` reads) and react
// when it flips to approved or denied.
//
// When `existingGroupName` is set, the user already has somewhere to go,
// so we soften the screen: still the primary acknowledgement of the new
// request, but with a clear "back to your existing workspace" affordance
// and copy that explains the request will keep waiting in the background.
export const AwaitingApproval: React.FC<Props> = ({
  user,
  groupId,
  groupName,
  onApproved,
  onSignOut,
  existingGroupName,
  onContinueToExisting,
}) => {
  const [status, setStatus] = useState<JoinRequest['status'] | 'missing'>('pending');
  const [error, setError] = useState<string | null>(null);
  // Brief celebration state: when the request flips to approved we show a
  // success message for ~1.5s before handing back to the AuthGate so the
  // user sees that their request was accepted (vs. just suddenly being
  // inside the workspace).
  const [showApproved, setShowApproved] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      unsub = watchOwnJoinRequest(groupId, user.uid, (req) => {
        if (!req) {
          setStatus('missing');
          return;
        }
        setStatus(req.status);
        if (req.status === 'approved') {
          // Show the confirmation banner first, then hand back. AuthGate
          // will land them in the new group on the next render.
          setShowApproved(true);
          timer = setTimeout(() => { void onApproved(); }, 1500);
        }
      });
    } catch (err) {
      setError((err as Error).message || 'Could not subscribe to your join request.');
    }
    return () => {
      if (unsub) unsub();
      if (timer) clearTimeout(timer);
    };
  }, [groupId, user.uid, onApproved]);

  const hasFallback = !!(existingGroupName && onContinueToExisting);

  // If we just hit "approved", drop everything else and show the success
  // state. Otherwise pick the right copy for the current status.
  let title: string;
  let subtitle: string;
  if (showApproved) {
    title = `Welcome to "${groupName}"`;
    subtitle = `An admin approved your request. Loading the workspace…`;
  } else if (status === 'denied') {
    title = 'Request declined';
    subtitle = `An admin reviewed your request to join "${groupName}" and declined it.`;
  } else if (status === 'missing') {
    title = 'Request not found';
    subtitle = `Your request for "${groupName}" was deleted. Ask the admin for a fresh invite link.`;
  } else {
    title = `Request to join "${groupName}" submitted`;
    subtitle = hasFallback
      ? `An admin of "${groupName}" needs to approve before you can see anything in there. You can carry on in "${existingGroupName}" while you wait.`
      : `An admin of "${groupName}" needs to approve before you can see anything in there.`;
  }

  return (
    <Shell title={title} subtitle={subtitle}>
      {showApproved ? (
        <Info>
          <strong>You're in.</strong> Switching you over now…
        </Info>
      ) : null}

      {!showApproved && status === 'pending' ? (
        <Info>
          The admin who sent you the invite will see your request in their{' '}
          <strong>Manage workspaces</strong> panel. {hasFallback
            ? <>You'll get a notification on screen the moment they approve — until then, head back to <strong>{existingGroupName}</strong> and keep working.</>
            : <>This screen will update as soon as they approve. You can leave the tab open or sign out and come back later — your request stays put either way.</>}
        </Info>
      ) : null}

      {!showApproved && status === 'denied' ? (
        <Info>
          You can ask the admin for a new invite link if you think this was
          a mistake. Each link is single-use and expires within an hour, so
          a fresh one is the easiest way forward.
        </Info>
      ) : null}

      {!showApproved && status === 'missing' ? (
        <Info>
          Either an admin removed the request, or it was never created
          successfully. Ask for a new invite link to try again.
        </Info>
      ) : null}

      <FormError>{error}</FormError>

      {!showApproved && hasFallback ? (
        <button
          type="button"
          className="ag-btn ag-btn-primary"
          style={{ width: '100%', marginTop: 4 }}
          onClick={() => void onContinueToExisting!()}
        >
          Continue to "{existingGroupName}"
        </button>
      ) : null}

      {!showApproved ? (
        <button
          type="button"
          className="ag-link ag-link-block"
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      ) : null}
    </Shell>
  );
};
