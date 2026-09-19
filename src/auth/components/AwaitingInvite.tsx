import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Shell, Info, FormError } from './Shell';

interface Props {
  user: User;
  onSignOut: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}

// Shown to a fully-authenticated user who isn't a member of any workspace
// yet. Under the invite-only model this is the resting state for accounts
// that exist but haven't been invited anywhere — they can't see or create
// any patient data until an admin shares an invite link with them. The
// user's email is shown front-and-centre so they can paste it to whoever
// is going to invite them.
export const AwaitingInvite: React.FC<Props> = ({ user, onSignOut, onRetry }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const email = user.email || '';

  async function copyEmail() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically — select your email above and copy manually.');
    }
  }

  async function handleRetry() {
    setBusy(true); setError(null);
    try { await onRetry(); }
    catch (err) { setError((err as Error).message || 'Could not refresh — try again.'); }
    finally { setBusy(false); }
  }

  async function handleSignOut() {
    setBusy(true); setError(null);
    try { await onSignOut(); }
    catch (err) { setError((err as Error).message || 'Could not sign out — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <Shell
      title="Waiting for an invite"
      subtitle="Your account is ready, but you're not a member of any workspace yet. wardround.app is invite-only — ask an admin on your team to share an invite link with you."
    >
      <div className="ag-field">
        <span>Your email</span>
        <div className="ag-link-row">
          <input type="email" readOnly value={email} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="ag-btn" onClick={copyEmail} disabled={busy || !email}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <Info>
        Once an admin sends you an invite link, open it on this device and you'll
        land in the workspace automatically. If you've already accepted an invite
        but you're still seeing this screen, click <strong>Refresh</strong> below.
      </Info>

      <FormError>{error}</FormError>

      <button type="button" className="ag-btn ag-btn-primary" onClick={handleRetry} disabled={busy}>
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
      <button type="button" className="ag-link ag-link-block" onClick={handleSignOut} disabled={busy}>
        Sign out
      </button>
    </Shell>
  );
};
