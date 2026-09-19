import React, { useState, useEffect } from 'react';
import { sendEmailVerification, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { Shell, FormError, Info } from './Shell';
import { friendlyAuthError } from '../errors';
import { logAuthEvent } from '../audit';

interface EmailVerifyProps {
  user: User;
  onVerified: () => void;
  onSignOut: () => void;
}

export const EmailVerify: React.FC<EmailVerifyProps> = ({ user, onVerified, onSignOut }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);

  // Auto-poll Firebase every few seconds to detect when the user clicks the
  // verification link in another tab. Stops once verified or after 2 min.
  useEffect(() => {
    let stopped = false;
    const start = Date.now();
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - start > 2 * 60 * 1000) return;
      try {
        await user.reload();
        if (auth.currentUser?.emailVerified) {
          await logAuthEvent(user.uid, 'email_verified');
          onVerified();
          return;
        }
      } catch { /* ignore */ }
      window.setTimeout(tick, 4000);
    };
    window.setTimeout(tick, 4000);
    return () => { stopped = true; };
  }, [user, onVerified]);

  const onResend = async () => {
    setError(null);
    setResent(false);
    setBusy(true);
    try {
      await sendEmailVerification(user);
      setResent(true);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const onCheck = async () => {
    setError(null);
    setChecking(true);
    try {
      await user.reload();
      if (auth.currentUser?.emailVerified) {
        await logAuthEvent(user.uid, 'email_verified');
        onVerified();
      } else {
        setError('Still not verified. Click the link in the email, then try again.');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setChecking(false);
    }
  };

  const onSignOutClick = async () => {
    try {
      await signOut(auth);
    } catch { /* ignore */ }
    onSignOut();
  };

  return (
    <Shell
      title="Verify your email"
      subtitle={user.email ? `We sent a link to ${user.email}. Click it, then come back here.` : 'We sent a verification link to your email. Click it, then come back here.'}
    >
      <p className="ag-paragraph">
        Email verification is required before you can use the app. The link will expire in
        an hour. If you don't see the email, check your spam folder.
      </p>
      <FormError>{error}</FormError>
      {resent ? <Info>Sent again. Try the latest email.</Info> : null}
      <div className="ag-actions">
        <button type="button" className="ag-btn ag-btn-primary" onClick={onCheck} disabled={checking || busy}>
          {checking ? 'Checking…' : 'I\'ve verified — continue'}
        </button>
        <button type="button" className="ag-btn ag-btn-ghost" onClick={onResend} disabled={busy || checking}>
          Resend email
        </button>
      </div>
      <button type="button" className="ag-link ag-link-block" onClick={onSignOutClick} disabled={busy || checking}>
        Sign out
      </button>
    </Shell>
  );
};
