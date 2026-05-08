// Focused invite dialog. Rendered as a second modal layered over the
// Manage workspaces modal so the QR + link + countdown can dominate the
// screen — important on mobile, where the surrounding workspace list
// otherwise crowds the field of view.
//
// Behaviour:
//   - Mounts → creates a fresh invite immediately. No "Create invite link"
//     intermediate button; the user already committed by tapping Invite.
//   - Renders the QR code (the existing `qrcode` dep, same toDataURL
//     approach as MfaEnroll) + the URL + a big Copy button + a live
//     "expires in N min" countdown that ticks every 15 seconds.
//   - "Regenerate" issues a fresh invite (and revokes the old one) so a
//     dropped link / stale screenshot is rebuilt in one tap.
//   - Pending invites for the same workspace are listed at the bottom so
//     the admin can revoke any older ones still in flight.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  type Invite,
  INVITE_TTL_MS,
  createInvite,
  revokeInvite,
  watchGroupInvites,
} from '../invites';
import { type Group } from '../groups';

interface Props {
  group: Group;
  onClose: () => void;
}

interface ActiveInvite {
  url: string;
  token: string;
  expiresAt: number;
  qrDataUrl: string | null;
}

const QR_SIZE = 224;
const TICK_MS = 15 * 1000;

export const InviteDialog: React.FC<Props> = (props) => {
  return createPortal(<InviteDialogInner {...props} />, document.body);
};

const InviteDialogInner: React.FC<Props> = ({ group, onClose }) => {
  const [invite, setInvite] = useState<ActiveInvite | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<Invite[]>([]);
  const previousTokenRef = useRef<string | null>(null);

  const generate = useCallback(async () => {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      // Revoke the previous invite from this dialog session — we don't want
      // multiple equally-valid links floating around for the same admin/visit.
      const previous = previousTokenRef.current;
      if (previous) {
        revokeInvite(previous).catch(() => { /* best effort */ });
      }
      const { url, token } = await createInvite({
        groupId: group.id,
        groupName: group.name,
      });
      previousTokenRef.current = token;
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: QR_SIZE,
        color: { dark: '#161616', light: '#ffffff' },
      });
      setInvite({
        url,
        token,
        expiresAt: Date.now() + INVITE_TTL_MS,
        qrDataUrl: dataUrl,
      });
    } catch (err) {
      setError((err as Error).message || 'Could not create the invite link.');
    } finally {
      setCreating(false);
    }
  }, [group.id, group.name]);

  // Generate the first invite on mount.
  useEffect(() => {
    void generate();
    // No cleanup of the invite itself — once created it's a real Firestore
    // doc that the recipient might be about to use. Closing the dialog
    // doesn't (and shouldn't) auto-revoke the link they're holding.
  }, [generate]);

  // Live tick for the countdown so "Expires in N min" is honest. Cheap;
  // 15-second cadence is plenty.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Live list of pending invites for this workspace so the admin can spot
  // and revoke older ones still in flight.
  useEffect(() => {
    const unsub = watchGroupInvites(group.id, (rows) => {
      setPending(rows.filter((r) => r.status === 'pending'));
    });
    return () => unsub();
  }, [group.id]);

  async function copyUrl() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setInfo('Link copied.');
      setError(null);
      window.setTimeout(() => setInfo(null), 2000);
    } catch {
      setError('Couldn\'t copy automatically — select the URL and copy manually.');
    }
  }

  async function shareUrl() {
    if (!invite) return;
    try {
      await (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share?.({
        title: `Join ${group.name} on wardround.app`,
        text: `Join the "${group.name}" workspace on wardround.app — link valid for 1 hour.`,
        url: invite.url,
      });
    } catch {
      /* user cancelled or share unsupported — silent */
    }
  }

  async function revokeOne(token: string) {
    try {
      await revokeInvite(token);
    } catch (err) {
      setError((err as Error).message || 'Could not revoke that invite.');
    }
  }

  const minutesLeft = useMemo(() => {
    if (!invite) return 0;
    return Math.max(0, Math.ceil((invite.expiresAt - now) / 60000));
  }, [invite, now]);

  const expired = invite ? invite.expiresAt - now <= 0 : false;
  // Pending list excluding the freshly-created one we already render large.
  const otherPending = pending.filter((p) => p.id !== invite?.token);
  const canShare = typeof (navigator as Navigator & { share?: unknown }).share === 'function';

  return (
    <div className="invd-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="invd-card" onClick={(e) => e.stopPropagation()}>
        <header className="invd-header">
          <div className="invd-header-text">
            <h2>Invite to {group.name}</h2>
            <p>Show this QR or share the link. Valid for one hour, single use.</p>
          </div>
          <button className="invd-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        {error ? <p className="invd-error" role="alert">{error}</p> : null}

        <div className="invd-qr-wrap">
          {creating && !invite ? (
            <div className="invd-qr-skeleton" aria-label="Creating invite link…" />
          ) : invite?.qrDataUrl ? (
            <img
              className={`invd-qr${expired ? ' invd-qr-expired' : ''}`}
              src={invite.qrDataUrl}
              alt={`QR code for joining ${group.name}`}
              width={QR_SIZE}
              height={QR_SIZE}
            />
          ) : null}
          <div className="invd-meta" aria-live="polite">
            {expired ? (
              <span className="invd-meta-expired">Expired — tap Regenerate.</span>
            ) : invite ? (
              <span>Expires in <strong>{minutesLeft} min</strong></span>
            ) : null}
          </div>
        </div>

        <div className="invd-link-row">
          <input
            type="text"
            readOnly
            value={invite?.url || ''}
            placeholder={creating ? 'Creating…' : ''}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Invite link"
          />
          <button type="button" className="invd-btn" onClick={copyUrl} disabled={!invite}>
            Copy
          </button>
        </div>

        <div className="invd-actions">
          {canShare ? (
            <button type="button" className="invd-btn invd-btn-primary" onClick={shareUrl} disabled={!invite}>
              Share…
            </button>
          ) : null}
          <button type="button" className="invd-btn" onClick={generate} disabled={creating}>
            {creating ? 'Generating…' : 'Regenerate'}
          </button>
        </div>

        {info ? <p className="invd-info">{info}</p> : null}

        {otherPending.length > 0 ? (
          <details className="invd-pending">
            <summary>Other pending invites for this workspace ({otherPending.length})</summary>
            <ul>
              {otherPending.map((inv) => (
                <li key={inv.id}>
                  <span className="invd-pending-meta">
                    {inv.invitedEmail || '(no email)'}
                    {inv.expiresAtClient ? ` · expires ${formatExpires(inv.expiresAtClient)}` : ''}
                  </span>
                  <button type="button" className="invd-btn invd-btn-small" onClick={() => revokeOne(inv.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
};

function formatExpires(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'expired';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return `in ${days} d`;
}
