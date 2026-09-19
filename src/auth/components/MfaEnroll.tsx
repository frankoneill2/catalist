import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { User } from 'firebase/auth';
import { Shell, FormError, Info } from './Shell';
import { beginTotpEnrollment, completeTotpEnrollment, type TotpEnrollment } from '../mfa';
import { friendlyAuthError } from '../errors';
import { logAuthEvent } from '../audit';

interface MfaEnrollProps {
  user: User;
  onEnrolled: () => void;
  onSignOut: () => void;
}

export const MfaEnroll: React.FC<MfaEnrollProps> = ({ user, onEnrolled, onSignOut }) => {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const en = await beginTotpEnrollment(user);
        if (!active) return;
        setEnrollment(en);
        const dataUrl = await QRCode.toDataURL(en.qrCodeUrl, {
          margin: 1,
          width: 220,
          color: { dark: '#161616', light: '#ffffff' },
        });
        if (!active) return;
        setQrDataUrl(dataUrl);
      } catch (err: unknown) {
        if (!active) return;
        const code = (err as { code?: string }).code;
        if (code === 'auth/operation-not-allowed' || code === 'auth/unsupported-tenant-operation') {
          setSetupError(
            'Two-factor auth (TOTP) is not enabled for this Firebase project yet. Enable it in the Firebase Console under Authentication → Sign-in method → Multi-factor authentication.'
          );
        } else {
          setSetupError(friendlyAuthError(err));
        }
      }
    })();
    return () => { active = false; };
  }, [user]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollment) return;
    setError(null);
    setBusy(true);
    try {
      await completeTotpEnrollment(user, enrollment, code, 'Authenticator app');
      await logAuthEvent(user.uid, 'mfa_enroll', { method: 'totp' });
      onEnrolled();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  if (setupError) {
    return (
      <Shell
        title="Two-factor setup unavailable"
        subtitle="wardround.app needs TOTP enabled in the Firebase project before you can finish setup."
      >
        <p className="ag-paragraph">{setupError}</p>
        <p className="ag-paragraph ag-muted">
          Once it's enabled, sign out and back in to complete enrollment.
        </p>
        <button type="button" className="ag-btn ag-btn-ghost" onClick={onSignOut}>
          Sign out
        </button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Set up two-factor auth"
      subtitle="Scan the QR with an authenticator app (Google Authenticator, Authy, 1Password, etc.). Then enter the 6-digit code it shows."
    >
      <div className="ag-qr-wrap">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="QR code for authenticator app" className="ag-qr" />
        ) : (
          <div className="ag-qr-placeholder">Generating QR…</div>
        )}
      </div>
      {enrollment ? (
        <div className="ag-manual-toggle">
          <button type="button" className="ag-link" onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'Hide manual key' : 'Can\'t scan? Use manual key'}
          </button>
          {showManual ? (
            <code className="ag-code">{enrollment.manualKey}</code>
          ) : null}
        </div>
      ) : null}
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
            disabled={busy || !enrollment}
            autoFocus
          />
        </label>
        <FormError>{error}</FormError>
        <Info>You'll only set this up once. Keep recovery codes from your authenticator app somewhere safe.</Info>
        <button type="submit" className="ag-btn ag-btn-primary" disabled={busy || !enrollment || code.length !== 6}>
          {busy ? 'Verifying…' : 'Verify and enroll'}
        </button>
        <button type="button" className="ag-link ag-link-block" onClick={onSignOut}>
          Sign out
        </button>
      </form>
    </Shell>
  );
};
