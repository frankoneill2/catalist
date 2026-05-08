import React, { useMemo, useRef, useState } from 'react';
import type { MultiFactorError, MultiFactorInfo, MultiFactorResolver, User } from 'firebase/auth';
import { Shell, FormError } from './Shell';
import { getResolver, pickTotpHint, resolveTotpChallenge } from '../mfa';
import { friendlyAuthError } from '../errors';
import { logAuthEvent } from '../audit';

interface MfaChallengeProps {
  error: MultiFactorError;
  onSolved: (user: User) => void;
  onCancel: () => void;
}

interface ResolverState {
  resolver: MultiFactorResolver | null;
  hint: MultiFactorInfo | null;
  failure: string | null;
}

export const MfaChallenge: React.FC<MfaChallengeProps> = ({ error, onSolved, onCancel }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Multi-factor resolvers are single-use — Firebase throws auth/argument-error
  // on the second call. A double-Enter or rapid double-click would otherwise
  // fire onSubmit twice. setBusy is async, so use a ref as the actual gate.
  const submittingRef = useRef(false);

  // getMultiFactorResolver throws synchronously if the error is stale (consumed
  // resolver, expired challenge, etc.). Memoize so React doesn't re-call it on
  // every render, and convert any throw into a recoverable UI state.
  const { resolver, hint, failure } = useMemo<ResolverState>(() => {
    try {
      const r = getResolver(error);
      const h = pickTotpHint(r);
      return { resolver: r, hint: h, failure: null };
    } catch (err) {
      console.warn('[mfa] could not build resolver', err);
      return { resolver: null, hint: null, failure: friendlyAuthError(err) };
    }
  }, [error]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolver || !hint) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorMsg(null);
    setBusy(true);
    try {
      const user = await resolveTotpChallenge(resolver, hint, code);
      try { await logAuthEvent(user.uid, 'signin_2fa_success'); } catch { /* non-blocking */ }
      onSolved(user);
    } catch (err) {
      setErrorMsg(friendlyAuthError(err));
      submittingRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  if (failure || !resolver) {
    return (
      <Shell
        title="Two-factor session expired"
        subtitle="Sign in again to receive a fresh challenge."
      >
        <p className="ag-paragraph">{failure || 'The previous two-factor challenge is no longer valid.'}</p>
        <button type="button" className="ag-btn ag-btn-primary" onClick={onCancel}>Start over</button>
      </Shell>
    );
  }

  if (!hint) {
    return (
      <Shell
        title="Unsupported second factor"
        subtitle="Your account requires a second factor we don't support yet."
      >
        <p className="ag-paragraph">
          Sign in to your account from a device where you originally enrolled the factor, or
          contact support to reset your authentication.
        </p>
        <button type="button" className="ag-btn ag-btn-ghost" onClick={onCancel}>Back</button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Two-factor code"
      subtitle="Enter the 6-digit code from your authenticator app."
    >
      <form onSubmit={onSubmit}>
        <label className="ag-field">
          <span>6-digit code</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy}
            autoFocus
          />
        </label>
        <FormError>{errorMsg}</FormError>
        <button type="submit" className="ag-btn ag-btn-primary" disabled={busy || code.length !== 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button type="button" className="ag-link ag-link-block" onClick={onCancel}>
          Cancel and start over
        </button>
      </form>
    </Shell>
  );
};
