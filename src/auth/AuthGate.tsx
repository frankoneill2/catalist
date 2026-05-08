import React, { useEffect, useRef, useState } from 'react';
import './auth.css';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signOut,
  type MultiFactorError,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { SignIn } from './components/SignIn';
import { SignUp } from './components/SignUp';
import { EmailVerify } from './components/EmailVerify';
import { MfaEnroll } from './components/MfaEnroll';
import { MfaChallenge } from './components/MfaChallenge';
import { PinSetup } from './components/PinSetup';
import { PinResume } from './components/PinResume';
import { StepUpModal } from './components/StepUpModal';
import { isMfaEnrolled } from './mfa';
import { hasPin } from './pin';
import {
  evaluateSession,
  startNewSession,
  unlockSession,
  startActivityTracking,
  recordRemoteSession,
  watchOwnRevocation,
  forceSignOut,
  clearSession,
} from './session';
import { detectAnomalies, shouldStepUp, baselineFingerprint } from './anomaly';
import {
  registerStepUpHandler,
  unregisterStepUpHandler,
  type StepUpRequest,
} from './stepUp';
import { logAuthEvent } from './audit';
import { ensureUserProfile } from './users';
import { ensureDefaultGroup, ensureMembershipDoc, getGroup } from './groups';
import {
  getCurrentGroupId,
  readPersistedGroupId,
  setCurrentGroupId,
} from './groupContext';
import { activateGroup } from './envelope';
import {
  acceptInvite,
  clearInviteFromUrl,
  readPendingInviteToken,
  rememberPendingInviteToken,
} from './invites';
import { AwaitingInvite } from './components/AwaitingInvite';
import { AwaitingApproval } from './components/AwaitingApproval';
import { PendingJoinNotice } from './components/PendingJoinNotice';
import { recordPendingJoin } from './pendingJoinTracker';

type Stage =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signing-up' }
  | { kind: 'mfa-challenge'; error: MultiFactorError }
  | { kind: 'email-verify'; user: User }
  | { kind: 'mfa-enroll'; user: User }
  | { kind: 'pin-setup'; user: User }
  | { kind: 'pin-resume'; user: User }
  | { kind: 'awaiting-invite'; user: User }
  | {
      kind: 'awaiting-approval';
      user: User;
      groupId: string;
      groupName: string;
      // When set, the user already has another workspace they could fall
      // back to (i.e. they scanned a QR for a *second* group). The Awaiting
      // Approval screen surfaces a "Continue to {name}" button that drops
      // them straight into that group while the request stays pending in
      // the background.
      fallbackGroupId?: string;
      fallbackGroupName?: string;
    }
  | { kind: 'ready'; user: User };

interface AuthGateProps {
  onReady: (user: User) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onReady }) => {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [stepUpReq, setStepUpReq] = useState<StepUpRequest | null>(null);
  const initRef = useRef(false);
  const lastReadyUid = useRef<string | null>(null);
  const revocationUnsubRef = useRef<(() => void) | null>(null);

  // Wire up the global step-up handler for any consumer (this gate, security
  // panel, future sensitive-op call sites in script.js).
  useEffect(() => {
    registerStepUpHandler(async (req) => {
      return new Promise<boolean>((resolve) => {
        setStepUpReq({
          ...req,
          resolve: (ok) => {
            setStepUpReq(null);
            resolve(ok);
            req.resolve(ok);
          },
        });
      });
    });
    return () => unregisterStepUpHandler();
  }, []);

  // Activity tracking once at boot
  useEffect(() => {
    startActivityTracking();
  }, []);

  // Auth state observer — drives every transition into this gate.
  // The async callback's rejections become unhandled-promise warnings if not
  // caught here, which can also tear down the React tree if Sentry's handler
  // re-throws. Catch and log instead.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          if (revocationUnsubRef.current) { revocationUnsubRef.current(); revocationUnsubRef.current = null; }
          lastReadyUid.current = null;
          setStage({ kind: 'signed-out' });
          return;
        }
        await routeFromUser(user);
      } catch (err) {
        console.error('[auth-gate] routeFromUser failed', err);
      }
    });
    return unsub;
  }, []);

  // After id-token refresh (e.g. after MFA enroll), re-route in case we now pass.
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (user) => {
      if (!user) return;
      // Only re-route if we're parked on a stage that depends on token claims.
      setStage((current) => {
        if (current.kind === 'mfa-enroll' && isMfaEnrolled(user)) {
          // refreshing of token is fine; routeFromUser will be called explicitly elsewhere
        }
        return current;
      });
    });
    return unsub;
  }, []);

  async function routeFromUser(user: User) {
    // Anonymous Firebase users are leftover state from the pre-Phase-1 flow
    // when script.js called signInAnonymously() on every load. They have no
    // email and no MFA, so the gate can't route them anywhere useful — sign
    // them out cleanly so they land on the real Sign In screen and can create
    // an account.
    if (user.isAnonymous) {
      console.info('[auth-gate] clearing legacy anonymous session');
      await forceSignOut('legacy-anonymous');
      return;
    }

    // Refresh the user object (emailVerified, enrolledFactors).
    try { await user.reload(); } catch { /* ignore */ }

    if (!user.emailVerified) {
      setStage({ kind: 'email-verify', user });
      return;
    }

    // Force a fresh ID token so the `email_verified` claim Firestore rules
    // depend on is up to date. Without this, a user who just clicked the
    // verification link this turn still holds the *old* (unverified) ID
    // token until Firebase's hourly auto-refresh, which means every
    // Firestore read/write between now and then would be denied by the
    // tightened `isSignedIn()` rule. The forced refresh issues a new token
    // synchronously off the back of the verification, so the claims are
    // consistent before the gate hands off to script.js.
    try { await user.getIdToken(true); } catch { /* ignore */ }

    if (!isMfaEnrolled(user)) {
      setStage({ kind: 'mfa-enroll', user });
      return;
    }

    // We have a fully authenticated user (email verified + MFA enrolled).
    // Decide whether they need PIN setup, PIN resume, or can go straight in.
    const sharedPref = sessionStorage.getItem('catalist.sharedDevice') === '1';

    // Anomaly check on resume: if the session is "fresh" (i.e. the user just
    // signed in this turn), take that as the baseline; otherwise an anomaly
    // forces a fresh sign-in.
    const sessionState = evaluateSession();
    const justSignedIn = sessionState === 'fresh';

    if (!justSignedIn) {
      const signals = await detectAnomalies();
      if (shouldStepUp(signals)) {
        await logAuthEvent(user.uid, 'anomaly_detected', signals as unknown as Record<string, unknown>);
        // Wipe local session and force full sign-in
        clearSession();
        await signOut(auth);
        return;
      }
    }

    // Make sure the profile doc exists (in case the user was created before
    // ensureUserProfile was added, or the doc was hand-deleted).
    try {
      await ensureUserProfile(user.uid, {
        email: user.email || '',
        displayName: user.displayName || '',
      });
    } catch { /* ignore */ }

    // Record this device + record fingerprint baseline if first time
    try { await recordRemoteSession(user.uid, sharedPref); } catch { /* ignore */ }
    try { await baselineFingerprint(); } catch { /* ignore */ }

    if (justSignedIn) {
      startNewSession(user.uid, sharedPref);
      // Shared device → never store a PIN, never show resume
      if (sharedPref) {
        await enterReady(user);
        return;
      }
      if (!hasPin(user.uid)) {
        setStage({ kind: 'pin-setup', user });
        return;
      }
      // Already has PIN; treat as unlocked.
      unlockSession();
      await enterReady(user);
      return;
    }

    // Returning visit — evaluate idle / refresh
    if (sessionState === 'expired') {
      await forceSignOut('session-expired');
      return;
    }
    if (sessionState === 'idle-locked') {
      // PIN required if one is set, else full re-auth.
      if (hasPin(user.uid) && !sharedPref) {
        setStage({ kind: 'pin-resume', user });
      } else {
        await forceSignOut('idle-no-pin');
      }
      return;
    }
    // active
    await enterReady(user);
  }

  async function enterReady(user: User) {
    // Step 1 — pending invite, if any. acceptInvite no longer self-grants
    // membership; it creates a join request that an admin must approve. So
    // the result here is "request submitted for group X" not "I'm now in X".
    let pendingApprovalGroup: { groupId: string; groupName: string } | null = null;
    const pendingInvite = readPendingInviteToken();
    if (pendingInvite) {
      try {
        const accepted = await acceptInvite(pendingInvite);
        pendingApprovalGroup = { groupId: accepted.groupId, groupName: accepted.groupName };
        // Track the request so the dashboard banner / approval celebration
        // can find it across reloads — without this we'd silently drop the
        // user back into their existing workspace once they decide to
        // "continue to existing", and there'd be no surface that ever
        // tells them the admin acted on their request.
        recordPendingJoin(user.uid, accepted.groupId, accepted.groupName);
        rememberPendingInviteToken(null);
        clearInviteFromUrl();
        console.info('[auth-gate] submitted join request for', pendingApprovalGroup);
      } catch (err) {
        console.warn('[auth-gate] pending invite could not be claimed (expired or invalid)', err);
        rememberPendingInviteToken(null);
        clearInviteFromUrl();
      }
    }

    // Step 2 — pick a group to land in. Prefer the persisted last-used
    // choice, falling back to any membership ensureDefaultGroup can find.
    let next: string | null = null;
    try {
      const persisted = readPersistedGroupId(user.uid);
      const found = await ensureDefaultGroup(user.uid, user.displayName || '');
      next = (persisted && persisted.length > 0) ? persisted : found;
      console.info('[auth-gate] selected group', next, '(persisted=', persisted, 'found=', found, ')');
    } catch (err) {
      console.warn('[auth-gate] could not resolve a group for', user.uid, err);
    }

    // If the user just submitted a join request, route to AwaitingApproval
    // — even when they already have another group to fall back to. The old
    // behaviour silently dropped them straight back into their existing
    // workspace, which left them with no acknowledgement that the new
    // request was even in flight. The screen is now the explicit
    // confirmation step; if they have a fallback group we surface a
    // "continue to {existing}" button so they're not stranded.
    if (pendingApprovalGroup) {
      if (lastReadyUid.current !== user.uid) {
        lastReadyUid.current = user.uid;
        if (revocationUnsubRef.current) { revocationUnsubRef.current(); revocationUnsubRef.current = null; }
        revocationUnsubRef.current = watchOwnRevocation(user.uid, async () => {
          await forceSignOut('revoked');
        });
      }
      let fallbackGroupId: string | undefined;
      let fallbackGroupName: string | undefined;
      if (next) {
        fallbackGroupId = next;
        try {
          const fallbackDoc = await getGroup(next);
          fallbackGroupName = fallbackDoc?.name || 'your other workspace';
        } catch {
          fallbackGroupName = 'your other workspace';
        }
      }
      setStage({
        kind: 'awaiting-approval',
        user,
        groupId: pendingApprovalGroup.groupId,
        groupName: pendingApprovalGroup.groupName,
        fallbackGroupId,
        fallbackGroupName,
      });
      return;
    }

    if (!next) {
      // Invite-only posture: signed in but with nothing to do. Show a
      // dedicated screen rather than the empty app shell.
      if (lastReadyUid.current !== user.uid) {
        lastReadyUid.current = user.uid;
        if (revocationUnsubRef.current) { revocationUnsubRef.current(); revocationUnsubRef.current = null; }
        revocationUnsubRef.current = watchOwnRevocation(user.uid, async () => {
          await forceSignOut('revoked');
        });
      }
      setStage({ kind: 'awaiting-invite', user });
      return;
    }

    // Activate the envelope DEK BEFORE we tell setCurrentGroupId to fan out
    // the change. setCurrentGroupId also kicks off activateGroup, but
    // awaiting it here ensures script.js never sees a "group ready,
    // envelope not ready" window on first load.
    try {
      await activateGroup(next);
    } catch (err) {
      console.warn('[auth-gate] envelope activation failed for', next, err);
    }
    // Self-heal: write our own member subdoc if it's missing. This handles
    // accounts that joined via invite before that flow learned to write
    // the subdoc. Best-effort — the legacy path hasn't blocked anything in
    // a long time, just made the membership UI under-report.
    void ensureMembershipDoc(next, user.uid);
    if (getCurrentGroupId() !== next) {
      setCurrentGroupId(next);
    }

    if (lastReadyUid.current !== user.uid) {
      lastReadyUid.current = user.uid;
      if (revocationUnsubRef.current) { revocationUnsubRef.current(); revocationUnsubRef.current = null; }
      revocationUnsubRef.current = watchOwnRevocation(user.uid, async () => {
        await forceSignOut('revoked');
      });
    }
    setStage({ kind: 'ready', user });
    onReady(user);
  }

  // Initial trigger is just waiting for onAuthStateChanged
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
  }, []);

  const renderStage = () => {
    switch (stage.kind) {
      case 'loading':
        return null;
      case 'signed-out':
        return (
          <SignIn
            onSignedIn={async (user) => { await routeFromUser(user); }}
            onMfaChallenge={(err) => setStage({ kind: 'mfa-challenge', error: err })}
            onSwitchToSignUp={() => setStage({ kind: 'signing-up' })}
          />
        );
      case 'signing-up':
        return (
          <SignUp
            onSignedUp={async (user) => { await routeFromUser(user); }}
            onSwitchToSignIn={() => setStage({ kind: 'signed-out' })}
          />
        );
      case 'mfa-challenge':
        return (
          <MfaChallenge
            error={stage.error}
            onSolved={async (user) => { await routeFromUser(user); }}
            onCancel={async () => { await signOut(auth); setStage({ kind: 'signed-out' }); }}
          />
        );
      case 'email-verify':
        return (
          <EmailVerify
            user={stage.user}
            onVerified={async () => { await routeFromUser(stage.user); }}
            onSignOut={async () => { await signOut(auth); setStage({ kind: 'signed-out' }); }}
          />
        );
      case 'mfa-enroll':
        return (
          <MfaEnroll
            user={stage.user}
            onEnrolled={async () => { await routeFromUser(stage.user); }}
            onSignOut={async () => { await signOut(auth); setStage({ kind: 'signed-out' }); }}
          />
        );
      case 'pin-setup':
        return (
          <PinSetup
            user={stage.user}
            onSet={async () => { await enterReady(stage.user); }}
            onSkip={async () => { await enterReady(stage.user); }}
          />
        );
      case 'pin-resume':
        return (
          <PinResume
            user={stage.user}
            displayName={stage.user.displayName || stage.user.email || ''}
            onUnlocked={async () => { unlockSession(); await enterReady(stage.user); }}
            onForgot={async () => { await forceSignOut('pin-forgot'); }}
          />
        );
      case 'awaiting-invite':
        return (
          <AwaitingInvite
            user={stage.user}
            onSignOut={async () => { await forceSignOut('user-initiated'); }}
            onRetry={async () => { await routeFromUser(stage.user); }}
          />
        );
      case 'awaiting-approval':
        return (
          <AwaitingApproval
            user={stage.user}
            groupId={stage.groupId}
            groupName={stage.groupName}
            existingGroupName={stage.fallbackGroupName}
            onContinueToExisting={
              stage.fallbackGroupId
                ? async () => {
                    // Drop into the fallback group. Pin the persisted choice
                    // first so the AuthGate's group resolution lands here on
                    // any subsequent reload, then activate the envelope and
                    // hand off to the Ready state without re-running the
                    // pending-invite branch (which would otherwise re-record
                    // the same join request needlessly).
                    setCurrentGroupId(stage.fallbackGroupId!);
                    try { await activateGroup(stage.fallbackGroupId!); } catch { /* best-effort */ }
                    setStage({ kind: 'ready', user: stage.user });
                    onReady(stage.user);
                  }
                : undefined
            }
            onApproved={async () => { await routeFromUser(stage.user); }}
            onSignOut={async () => { await forceSignOut('user-initiated'); }}
          />
        );
      case 'ready':
        return null;
    }
  };

  // The auth gate has two visible states: blocking the app entirely (most stages)
  // or invisible (ready stage — app revealed). The step-up modal can appear in
  // either case. The PendingJoinNotice piggybacks on the Ready stage so the
  // user sees a banner when one of their submitted join requests is approved
  // (or denied) by an admin while they're working in an existing workspace.
  return (
    <>
      {stage.kind !== 'ready' ? <div className="ag-overlay">{renderStage()}</div> : null}
      {stage.kind === 'ready' ? <PendingJoinNotice user={stage.user} /> : null}
      {stepUpReq ? (
        <StepUpModal reason={stepUpReq.reason} onResolve={(ok) => stepUpReq.resolve(ok)} />
      ) : null}
    </>
  );
};
