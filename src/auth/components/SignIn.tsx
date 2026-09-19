import React, { useState } from 'react';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  type User,
  type MultiFactorError,
} from 'firebase/auth';
import { auth, configurePersistence } from '../firebase';
import { Shell, FormError, Info } from './Shell';
import { friendlyAuthError } from '../errors';
import { isMfaError } from '../mfa';
import { logAuthEvent } from '../audit';

interface SignInProps {
  onSignedIn: (user: User) => void;
  onMfaChallenge: (err: MultiFactorError) => void;
  onSwitchToSignUp: () => void;
}

export const SignIn: React.FC<SignInProps> = ({ onSignedIn, onMfaChallenge, onSwitchToSignUp }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await configurePersistence(shared);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      // Persist the shared toggle for the rest of the gate flow.
      sessionStorage.setItem('catalist.sharedDevice', shared ? '1' : '0');
      await logAuthEvent(cred.user.uid, 'signin_success', { shared });
      onSignedIn(cred.user);
    } catch (err: unknown) {
      if (isMfaError(err)) {
        sessionStorage.setItem('catalist.sharedDevice', shared ? '1' : '0');
        onMfaChallenge(err as MultiFactorError);
        return;
      }
      const friendly = friendlyAuthError(err);
      setError(friendly);
      // Best-effort log; no uid since signin failed
      try {
        await logAuthEvent('anonymous', 'signin_failure', { email: email.trim().toLowerCase(), code: (err as { code?: string }).code });
      } catch { /* ignore */ }
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    setError(null);
    setResetSent(false);
    if (!email) {
      setError('Enter your email above first, then tap "Forgot password".');
      return;
    }
    setBusy(true);
    try {
      // Intentionally NOT passing actionCodeSettings — that requires the
      // continue URL's domain to be on the project's Authorized Domains
      // allowlist (Firebase Console → Authentication → Settings → Authorized
      // domains). When the app is loaded from anything other than the
      // defaults (localhost, *.web.app, *.firebaseapp.com, plus any custom
      // domains added) — for example a LAN IP via `vite --host` — Firebase
      // rejects with `auth/unauthorized-continue-uri` and no email gets
      // sent. The default reset flow without continueUrl works from any
      // origin: Firebase's hosted handler serves the reset form, and the
      // user navigates back to the app manually after.
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch (err) {
      // Surface the underlying code so we can diagnose if it still misbehaves.
      // Note: modern Firebase Auth intentionally suppresses user-not-found
      // here (anti-enumeration), so a clean return is consistent with both
      // "email sent" and "no account exists".
      console.warn('[signin] sendPasswordResetEmail failed', err);
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Sign in"
      subtitle="Use your work email and the password you set when you signed up."
      footer={
        <span>
          New to wardround.app?{' '}
          <button type="button" className="ag-link" onClick={onSwitchToSignUp}>
            Create an account
          </button>
        </span>
      }
    >
      <form onSubmit={onSubmit} autoComplete="on">
        <label className="ag-field">
          <span>Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="ag-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="ag-checkbox">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
            disabled={busy}
          />
          <span>This is a shared device — sign me out when I close the tab.</span>
        </label>
        <FormError>{error}</FormError>
        {resetSent ? (
          <Info>
            If an account exists for that email, a reset link is on its way.
            Check your inbox <strong>and your spam folder</strong> — the
            sender is <code>noreply@{auth.app.options.authDomain}</code>.
          </Info>
        ) : null}
        <button type="submit" className="ag-btn ag-btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="ag-link ag-link-block" onClick={onForgot} disabled={busy}>
          Forgot password?
        </button>
      </form>
    </Shell>
  );
};
