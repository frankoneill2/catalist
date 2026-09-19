import React, { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  type Unsubscribe,
} from 'firebase/firestore';
import { signOut, sendPasswordResetEmail, type User } from 'firebase/auth';
import { auth, db } from '../firebase';
import { revokeRemoteSession } from '../session';
import { unenrollMfa, isMfaEnrolled } from '../mfa';
import { hasPin, clearPin } from '../pin';
import { logAuthEvent } from '../audit';
import { getDeviceId, getDeviceName, setDeviceName } from '../device';
import { requireStepUp } from '../stepUp';
import { friendlyAuthError } from '../errors';
import { getCurrentGroupId } from '../groupContext';
// Migration helpers (`detectLegacyData`, `runMigration`) intentionally not
// imported — see security review Vuln 3 and the explanatory comment near
// the removed migration UI section below.

interface SecurityPanelProps {
  user: User;
  onClose: () => void;
}

interface DeviceRow {
  id: string;
  deviceName: string;
  userAgent: string;
  shared: boolean;
  lastActiveAtClient?: number;
  createdAtClient?: number;
}

interface AuthEventRow {
  id: string;
  type: string;
  deviceId?: string;
  detail?: Record<string, unknown> | null;
  clientCreatedAt?: number;
}

export const SecurityPanel: React.FC<SecurityPanelProps> = ({ user, onClose }) => {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [events, setEvents] = useState<AuthEventRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [deviceName, setDeviceNameState] = useState(getDeviceName());
  const myDeviceId = getDeviceId();

  useEffect(() => {
    const unsubs: Unsubscribe[] = [];
    unsubs.push(
      onSnapshot(collection(db, 'users', user.uid, 'devices'), (snap) => {
        const rows: DeviceRow[] = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          rows.push({
            id: d.id,
            deviceName: String(data.deviceName || 'Unknown device'),
            userAgent: String(data.userAgent || ''),
            shared: Boolean(data.shared),
            lastActiveAtClient: typeof data.lastActiveAtClient === 'number' ? (data.lastActiveAtClient as number) : undefined,
            createdAtClient: typeof data.createdAtClient === 'number' ? (data.createdAtClient as number) : undefined,
          });
        });
        rows.sort((a, b) => (b.lastActiveAtClient ?? 0) - (a.lastActiveAtClient ?? 0));
        setDevices(rows);
      })
    );
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'users', user.uid, 'authEvents'),
          orderBy('clientCreatedAt', 'desc'),
          limit(25)
        ),
        (snap) => {
          const rows: AuthEventRow[] = [];
          snap.forEach((d) => {
            const data = d.data() as Record<string, unknown>;
            rows.push({
              id: d.id,
              type: String(data.type || ''),
              deviceId: typeof data.deviceId === 'string' ? (data.deviceId as string) : undefined,
              detail: (data.detail as Record<string, unknown> | null) ?? null,
              clientCreatedAt: typeof data.clientCreatedAt === 'number' ? (data.clientCreatedAt as number) : undefined,
            });
          });
          setEvents(rows);
        }
      )
    );
    return () => { unsubs.forEach((u) => u()); };
  }, [user.uid]);

  const onRevoke = async (deviceId: string) => {
    setError(null); setInfo(null);
    if (deviceId === myDeviceId) {
      const ok = window.confirm('Revoking this device signs you out here. Continue?');
      if (!ok) return;
    } else {
      const ok = window.confirm('Revoke this device? It will be signed out next time it tries to sync.');
      if (!ok) return;
    }
    const stepped = await requireStepUp('Confirm your identity to revoke a device.');
    if (!stepped) {
      setError('Step-up cancelled.');
      return;
    }
    setBusy('revoke-' + deviceId);
    try {
      await revokeRemoteSession(user.uid, deviceId);
      if (deviceId === myDeviceId) {
        await signOut(auth);
      } else {
        setInfo('Device revoked.');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  };

  const onChangePassword = async () => {
    setError(null); setInfo(null);
    const stepped = await requireStepUp('Confirm your identity to change your password.');
    if (!stepped) { setError('Step-up cancelled.'); return; }
    if (!user.email) { setError('No email on this account.'); return; }
    setBusy('password');
    try {
      await sendPasswordResetEmail(auth, user.email);
      await logAuthEvent(user.uid, 'password_reset_request');
      setInfo('We\'ve emailed you a password-change link.');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  };

  const onUnenrollMfa = async () => {
    setError(null); setInfo(null);
    const stepped = await requireStepUp('Confirm your identity to remove two-factor auth.');
    if (!stepped) { setError('Step-up cancelled.'); return; }
    setBusy('mfa');
    try {
      await unenrollMfa(user);
      await logAuthEvent(user.uid, 'mfa_unenroll');
      setInfo('Two-factor auth removed. You\'ll be asked to set it up again next sign-in.');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(null);
    }
  };

  const onResetPin = async () => {
    setError(null); setInfo(null);
    if (!window.confirm('Forget the PIN on this device?')) return;
    clearPin(user.uid);
    await logAuthEvent(user.uid, 'pin_reset');
    setInfo('PIN cleared on this device. You\'ll be asked to set a new one next sign-in.');
  };

  const onSaveName = async () => {
    setDeviceName(deviceName.trim() || 'This device');
    setDeviceNameState(getDeviceName());
    setEditingName(false);
    setInfo('Updated.');
  };

  const fmt = (ts?: number) => (ts ? new Date(ts).toLocaleString() : '—');

  const mfaOn = isMfaEnrolled(user);
  const pinOn = hasPin(user.uid);

  return (
    <div className="ag-modal-scrim" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ag-modal ag-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="ag-modal-head">
          <h2 className="ag-modal-title">Security &amp; sessions</h2>
          <button type="button" className="ag-icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <section className="ag-section">
          <h3>Account</h3>
          <p className="ag-paragraph ag-muted">
            {user.displayName || '—'} · {user.email}
          </p>
          <div className="ag-actions">
            <button type="button" className="ag-btn ag-btn-ghost" onClick={onChangePassword} disabled={busy === 'password'}>
              {busy === 'password' ? 'Sending…' : 'Change password'}
            </button>
            <button type="button" className="ag-btn ag-btn-ghost" onClick={onUnenrollMfa} disabled={busy === 'mfa' || !mfaOn}>
              {mfaOn ? (busy === 'mfa' ? 'Working…' : 'Remove 2FA') : '2FA not enrolled'}
            </button>
            <button type="button" className="ag-btn ag-btn-ghost" onClick={onResetPin} disabled={!pinOn}>
              {pinOn ? 'Forget PIN on this device' : 'No PIN set'}
            </button>
          </div>
        </section>

        <section className="ag-section">
          <h3>This device</h3>
          {editingName ? (
            <div className="ag-row">
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceNameState(e.target.value)}
                maxLength={40}
              />
              <button type="button" className="ag-btn ag-btn-ghost" onClick={onSaveName}>Save</button>
              <button type="button" className="ag-btn ag-btn-ghost" onClick={() => { setEditingName(false); setDeviceNameState(getDeviceName()); }}>Cancel</button>
            </div>
          ) : (
            <p className="ag-paragraph">
              <strong>{getDeviceName()}</strong>{' '}
              <button type="button" className="ag-link" onClick={() => setEditingName(true)}>Rename</button>
            </p>
          )}
        </section>

        <section className="ag-section">
          <h3>Active devices</h3>
          {devices.length === 0 ? (
            <p className="ag-paragraph ag-muted">No devices recorded yet.</p>
          ) : (
            <ul className="ag-list">
              {devices.map((d) => (
                <li key={d.id} className="ag-list-item">
                  <div>
                    <div className="ag-list-title">
                      {d.deviceName} {d.id === myDeviceId ? <span className="ag-pill">This device</span> : null}
                      {d.shared ? <span className="ag-pill ag-pill-warn">Shared</span> : null}
                    </div>
                    <div className="ag-list-meta">
                      Last active {fmt(d.lastActiveAtClient)} · added {fmt(d.createdAtClient)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ag-btn ag-btn-danger"
                    onClick={() => onRevoke(d.id)}
                    disabled={busy === 'revoke-' + d.id}
                  >
                    {busy === 'revoke-' + d.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ag-section">
          <h3>Recent auth events</h3>
          {events.length === 0 ? (
            <p className="ag-paragraph ag-muted">Nothing logged yet.</p>
          ) : (
            <ul className="ag-list ag-list-compact">
              {events.map((e) => (
                <li key={e.id} className="ag-list-item-compact">
                  <span className="ag-evt-type">{prettyEventType(e.type)}</span>
                  <span className="ag-evt-meta">{fmt(e.clientCreatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Legacy data migration UI removed.
            Phase 3 migration is complete and the legacy /cases collection
            has been deleted from production (see scripts/delete-legacy-cases.mjs).
            Firestore rules now deny all reads/writes to /cases — keeping
            the migration button visible would only ever produce a
            permission-denied error and surfaced an attack path where any
            signed-in user could call runMigration into their own group
            (security review Vuln 3). The runMigration code is retained in
            git history if a future deployment needs to re-introduce it
            with proper admin gating + Cloud Function enforcement. */}

        {error ? <p className="ag-error" role="alert">{error}</p> : null}
        {info ? <p className="ag-info">{info}</p> : null}

        <div className="ag-modal-foot">
          <button type="button" className="ag-btn ag-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

function prettyEventType(t: string): string {
  return t
    .replace(/_/g, ' ')
    .replace(/\bsignin\b/, 'sign in')
    .replace(/\bsignout\b/, 'sign out')
    .replace(/\bmfa\b/i, '2FA')
    .replace(/\bpin\b/i, 'PIN')
    .replace(/^./, (c) => c.toUpperCase());
}
