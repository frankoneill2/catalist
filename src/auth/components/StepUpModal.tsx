import React, { useEffect, useState } from 'react';
import { performStepUp } from '../stepUp';
import { FormError } from './Shell';

interface StepUpModalProps {
  reason: string;
  onResolve: (ok: boolean) => void;
}

export const StepUpModal: React.FC<StepUpModalProps> = ({ reason, onResolve }) => {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResolve(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolve]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await performStepUp({ password, totpCode: needsTotp ? code : undefined });
      if (result.ok) {
        onResolve(true);
        return;
      }
      if (result.needsTotp) {
        setNeedsTotp(true);
        setError(null);
        setBusy(false);
        return;
      }
      setError(result.error || 'Could not verify.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ag-modal-scrim" role="dialog" aria-modal="true">
      <div className="ag-modal">
        <h2 className="ag-modal-title">Confirm it's you</h2>
        <p className="ag-paragraph">{reason}</p>
        <form onSubmit={onSubmit}>
          <label className="ag-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          {needsTotp ? (
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
          ) : null}
          <FormError>{error}</FormError>
          <div className="ag-actions">
            <button type="button" className="ag-btn ag-btn-ghost" onClick={() => onResolve(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="ag-btn ag-btn-primary" disabled={busy || !password || (needsTotp && code.length !== 6)}>
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
