import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Shell, FormError } from './Shell';
import { setPin } from '../pin';
import { logAuthEvent } from '../audit';

interface PinSetupProps {
  user: User;
  onSet: () => void;
  onSkip: () => void;
}

export const PinSetup: React.FC<PinSetupProps> = ({ user, onSet, onSkip }) => {
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    if (pin !== confirm) {
      setError('PINs don\'t match.');
      return;
    }
    if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '0000') {
      setError('Pick something less guessable.');
      return;
    }
    setBusy(true);
    try {
      await setPin(user.uid, pin);
      await logAuthEvent(user.uid, 'pin_set');
      onSet();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save PIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Set a 4-digit PIN"
      subtitle="You'll use this to unlock wardround.app quickly on this device. Your password and 2FA still gate the full sign-in."
    >
      <form onSubmit={onSubmit}>
        <label className="ag-field">
          <span>New PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="new-password"
            required
            value={pin}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
            disabled={busy}
            autoFocus
          />
        </label>
        <label className="ag-field">
          <span>Confirm PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
            disabled={busy}
          />
        </label>
        <FormError>{error}</FormError>
        <button type="submit" className="ag-btn ag-btn-primary" disabled={busy || pin.length !== 4 || confirm.length !== 4}>
          {busy ? 'Saving…' : 'Save PIN'}
        </button>
        <button type="button" className="ag-link ag-link-block" onClick={onSkip} disabled={busy}>
          Skip for this session — I'll re-sign-in next time
        </button>
      </form>
    </Shell>
  );
};
