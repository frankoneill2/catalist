import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, configurePersistence } from '../firebase';
import { ensureUserProfile, TERMS_VERSION } from '../users';
import { Shell, FormError } from './Shell';
import { friendlyAuthError } from '../errors';
import { logAuthEvent } from '../audit';

interface SignUpProps {
  onSignedUp: (user: User) => void;
  onSwitchToSignIn: () => void;
}

const TERMS_URL = 'https://wardround.app/terms';
const PRIVACY_URL = 'https://wardround.app/privacy';

export const SignUp: React.FC<SignUpProps> = ({ onSignedUp, onSwitchToSignIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!accepted) {
      setError('You need to accept the terms to create an account.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don\'t match.');
      return;
    }
    if (!displayName.trim()) {
      setError('Tell us what to call you.');
      return;
    }
    setBusy(true);
    try {
      // Default to local persistence at signup; the shared-device toggle is a sign-in concept.
      await configurePersistence(false);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = cred.user;
      await updateProfile(user, { displayName: displayName.trim() });
      await ensureUserProfile(user.uid, {
        email: user.email || email.trim(),
        displayName: displayName.trim(),
        acceptedTermsAt: Date.now(),
        termsVersion: TERMS_VERSION,
      });
      try {
        await sendEmailVerification(user);
      } catch (err) {
        console.warn('[signup] could not send verification email', err);
      }
      await logAuthEvent(user.uid, 'signup', { displayName: displayName.trim() });
      onSignedUp(user);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Create your wardround.app account"
      subtitle="One account per clinician. You'll verify your email and set up a second factor next. If you haven't been invited to a workspace yet, you'll land on a screen showing your email so you can pass it to whoever's inviting you."
      footer={
        <span>
          Already have an account?{' '}
          <button type="button" className="ag-link" onClick={onSwitchToSignIn}>
            Sign in
          </button>
        </span>
      }
    >
      <form onSubmit={onSubmit} autoComplete="on">
        <label className="ag-field">
          <span>Display name</span>
          <input
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
            placeholder="e.g. Frank O'Neill"
          />
        </label>
        <label className="ag-field">
          <span>Work email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="ag-field">
          <span>Password (min 8 characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="ag-field">
          <span>Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="ag-checkbox">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            disabled={busy}
          />
          <span>
            I accept the{' '}
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">terms of service</a>{' '}
            and{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">privacy policy</a>.
          </span>
        </label>
        <FormError>{error}</FormError>
        <button type="submit" className="ag-btn ag-btn-primary" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </Shell>
  );
};
