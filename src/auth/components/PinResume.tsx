import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Shell, FormError, Info } from './Shell';
import { verifyPin, clearPin } from '../pin';
import { logAuthEvent } from '../audit';

interface PinResumeProps {
  user: User;
  onUnlocked: () => void;
  onForgot: () => void;
  displayName: string;
}

export const PinResume: React.FC<PinResumeProps> = ({ user, onUnlocked, onForgot, displayName }) => {
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (pin.length !== 4) return;
    setBusy(true);
    try {
      const result = await verifyPin(user.uid, pin);
      if (result.ok) {
        onUnlocked();
        return;
      }
      if (result.resetRequired) {
        await logAuthEvent(user.uid, 'pin_lockout');
        clearPin(user.uid);
        setError('Too many wrong attempts. Sign in again.');
        setTimeout(onForgot, 1500);
        return;
      }
      await logAuthEvent(user.uid, 'pin_failure', { attemptsRemaining: result.attemptsRemaining });
      if (result.lockedUntil) {
        const seconds = Math.max(1, Math.ceil((result.lockedUntil - Date.now()) / 1000));
        setError(`Wrong PIN. Try again in ${seconds}s. ${result.attemptsRemaining} attempts left.`);
      } else {
        setError(`Wrong PIN. ${result.attemptsRemaining} attempts left.`);
      }
      setPinValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify PIN.');
    } finally {
      setBusy(false);
    }
  };

  const onForgotClick = async () => {
    setInfo('Signing out…');
    await logAuthEvent(user.uid, 'pin_reset');
    clearPin(user.uid);
    onForgot();
  };

  return (
    <Shell
      title={`Welcome back, ${displayName.split(' ')[0] || 'there'}`}
      subtitle="Enter your 4-digit PIN to continue."
    >
      <form onSubmit={onSubmit}>
        <label className="ag-field ag-field-pin">
          <span className="ag-visually-hidden">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            required
            value={pin}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, '').slice(0, 4);
              setPinValue(next);
            }}
            disabled={busy}
            autoFocus
            className="ag-pin-input"
          />
        </label>
        <FormError>{error}</FormError>
        {info ? <Info>{info}</Info> : null}
        <button type="submit" className="ag-btn ag-btn-primary" disabled={busy || pin.length !== 4}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <button type="button" className="ag-link ag-link-block" onClick={onForgotClick} disabled={busy}>
          Forgot PIN — sign in fresh
        </button>
      </form>
    </Shell>
  );
};
