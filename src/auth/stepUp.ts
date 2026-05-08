// Step-up re-authentication API for sensitive operations.
//
// Sensitive ops (deleting cases, removing members, viewing audit log,
// changing security settings) call requireStepUp() to bring up a modal that
// re-prompts for the password (and TOTP if enrolled). Returns true once
// reauthenticateWithCredential succeeds. The result is fresh — no caching —
// so each sensitive op gets its own prompt.

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import {
  isMfaError,
  getResolver,
  pickTotpHint,
  resolveTotpChallenge,
} from './mfa';
import { logAuthEvent } from './audit';

export type StepUpHandler = (config: StepUpRequest) => Promise<boolean>;

export interface StepUpRequest {
  reason: string;
  resolve: (ok: boolean) => void;
}

let activeHandler: StepUpHandler | null = null;

export function registerStepUpHandler(handler: StepUpHandler): void {
  activeHandler = handler;
}

export function unregisterStepUpHandler(): void {
  activeHandler = null;
}

export async function requireStepUp(reason: string): Promise<boolean> {
  if (!activeHandler) {
    console.warn('[stepUp] no handler registered; denying sensitive op');
    return false;
  }
  return new Promise<boolean>((resolve) => {
    activeHandler!({ reason, resolve });
  });
}

export interface StepUpAttempt {
  password: string;
  totpCode?: string;
}

export interface StepUpResult {
  ok: boolean;
  needsTotp?: boolean;
  error?: string;
}

export async function performStepUp(attempt: StepUpAttempt): Promise<StepUpResult> {
  const user: User | null = auth.currentUser;
  if (!user || !user.email) {
    return { ok: false, error: 'Not signed in.' };
  }
  const cred = EmailAuthProvider.credential(user.email, attempt.password);
  try {
    await reauthenticateWithCredential(user, cred);
    await logAuthEvent(user.uid, 'step_up_success');
    return { ok: true };
  } catch (err: unknown) {
    if (isMfaError(err)) {
      if (!attempt.totpCode) {
        return { ok: false, needsTotp: true };
      }
      try {
        const resolver = getResolver(err);
        const hint = pickTotpHint(resolver);
        if (!hint) return { ok: false, error: 'No supported second factor.' };
        await resolveTotpChallenge(resolver, hint, attempt.totpCode);
        await logAuthEvent(user.uid, 'step_up_success', { withTotp: true });
        return { ok: true };
      } catch (e: unknown) {
        return { ok: false, error: friendlyError(e) };
      }
    }
    return { ok: false, error: friendlyError(err) };
  }
}

function friendlyError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code;
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return 'Wrong password.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts. Try again in a few minutes.';
    }
    if (code === 'auth/invalid-verification-code') {
      return 'That code is wrong or expired.';
    }
  }
  return 'Could not verify. Try again.';
}
