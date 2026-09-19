// Accept-invite modal — shows when the URL carries `?invite=<token>` and
// the user is signed in. Reads the invite, displays who's inviting and to
// which workspace, and either accepts (joining the group) or dismisses.

import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  acceptInvite,
  clearInviteFromUrl,
  loadInvite,
  rememberPendingInviteToken,
  type Invite,
} from '../invites';
import { setCurrentGroupId } from '../groupContext';

interface Props {
  user: User;
  token: string;
  onClose: () => void;
}

export const AcceptInviteModal: React.FC<Props> = ({ user, token, onClose }) => {
  const [invite, setInvite] = useState<Invite | null | 'loading' | 'missing'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inv = await loadInvite(token);
        if (cancelled) return;
        setInvite(inv ?? 'missing');
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load this invite.');
        setInvite('missing');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  function close() {
    clearInviteFromUrl();
    rememberPendingInviteToken(null);
    onClose();
  }

  async function onAccept() {
    if (!invite || invite === 'loading' || invite === 'missing') return;
    setError(null);
    setBusy(true);
    try {
      const accepted = await acceptInvite(token);
      // Switch the user into the joined group right away so they can see
      // the cases they were invited to.
      setCurrentGroupId(accepted.groupId);
      clearInviteFromUrl();
      rememberPendingInviteToken(null);
      onClose();
      // Reload to rebind every Firestore listener under the new group.
      window.location.reload();
    } catch (err) {
      setError((err as Error).message || 'Could not accept this invite.');
    } finally {
      setBusy(false);
    }
  }

  if (invite === 'loading') {
    return (
      <div className="ag-modal-scrim" role="dialog" aria-modal="true">
        <div className="ag-modal">
          <p className="ag-paragraph">Checking invite…</p>
        </div>
      </div>
    );
  }

  if (invite === 'missing') {
    return (
      <div className="ag-modal-scrim" role="dialog" aria-modal="true" onClick={close}>
        <div className="ag-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ag-modal-head">
            <h2 className="ag-modal-title">Invite not found</h2>
            <button type="button" className="ag-icon-btn" onClick={close} aria-label="Close">×</button>
          </div>
          <p className="ag-paragraph">
            That invite link isn't valid. It may have expired, been revoked, or already been used.
          </p>
          <div className="ag-modal-foot">
            <button type="button" className="ag-btn ag-btn-ghost" onClick={close}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  // If the invite was created for a specific email and it's not this user's,
  // warn them — but don't block. Their Firebase Auth uid is what matters
  // for the rule check; the email field is just an inviter-side note.
  const emailMismatch =
    invite.invitedEmail
    && user.email
    && invite.invitedEmail.toLowerCase() !== user.email.toLowerCase();

  return (
    <div className="ag-modal-scrim" role="dialog" aria-modal="true" onClick={busy ? undefined : close}>
      <div className="ag-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ag-modal-head">
          <h2 className="ag-modal-title">Join workspace</h2>
          <button type="button" className="ag-icon-btn" onClick={close} aria-label="Close" disabled={busy}>×</button>
        </div>

        <p className="ag-paragraph">
          <strong>{invite.invitedByName || 'Someone'}</strong> invited you to join{' '}
          <strong>{invite.groupName || 'a workspace'}</strong>.
        </p>

        {emailMismatch ? (
          <p className="ag-paragraph ag-muted">
            Note: this invite was addressed to <strong>{invite.invitedEmail}</strong>, but you're signed in as{' '}
            <strong>{user.email}</strong>. You can still accept; the invite just records the original email for reference.
          </p>
        ) : null}

        {invite.status === 'revoked' ? (
          <p className="ag-error">This invite has been revoked. Ask for a new link.</p>
        ) : null}
        {invite.status === 'accepted' && invite.acceptedByUid && invite.acceptedByUid !== user.uid ? (
          <p className="ag-error">This link has already been used by someone else.</p>
        ) : null}

        {error ? <p className="ag-error" role="alert">{error}</p> : null}

        <div className="ag-modal-foot">
          <button
            type="button"
            className="ag-btn ag-btn-ghost"
            onClick={close}
            disabled={busy}
          >
            Not now
          </button>
          <button
            type="button"
            className="ag-btn ag-btn-primary"
            onClick={onAccept}
            disabled={busy
              || invite.status === 'revoked'
              || (invite.status === 'accepted' && invite.acceptedByUid !== user.uid)}
          >
            {busy ? 'Joining…' : 'Accept invite'}
          </button>
        </div>
      </div>
    </div>
  );
};
