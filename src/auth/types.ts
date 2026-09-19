// Shared types across auth modules.

import type { User } from 'firebase/auth';

export type AuthStage =
  | 'loading'           // restoring auth state from storage
  | 'signed-out'        // showing sign-in / sign-up
  | 'email-unverified'  // signed in but email not verified yet
  | 'mfa-challenge'     // password ok, awaiting second factor
  | 'mfa-enroll'        // signed in but MFA not enrolled (required from day one)
  | 'pin-setup'         // first time on this device, set a PIN
  | 'pin-resume'        // returning visit, enter PIN to unlock
  | 'step-up'           // re-prompt for password before a sensitive op
  | 'ready';            // pass the gate and reveal the app

export interface SessionMeta {
  deviceId: string;
  deviceName: string;
  userAgent: string;
  fingerprint: string;
  shared: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface AuthEvent {
  type:
    | 'signin_success'
    | 'signin_failure'
    | 'signin_2fa_success'
    | 'signin_2fa_failure'
    | 'signup'
    | 'email_verified'
    | 'password_change'
    | 'password_reset_request'
    | 'mfa_enroll'
    | 'mfa_unenroll'
    | 'pin_set'
    | 'pin_reset'
    | 'pin_failure'
    | 'pin_lockout'
    | 'session_revoked'
    | 'signout'
    | 'step_up_success'
    | 'anomaly_detected';
  uid: string;
  deviceId?: string;
  detail?: Record<string, unknown>;
  createdAt: number;
}

export interface AuthGateProps {
  onReady: (user: User) => void;
}
