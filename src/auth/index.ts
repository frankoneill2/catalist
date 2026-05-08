// Public API surface that the legacy script.js (or any future module) calls
// into. Everything is exposed via window.__auth so vanilla JS can use it
// without import gymnastics.

import { signOut, type User } from 'firebase/auth';
import { auth, db } from './firebase';
import { requireStepUp } from './stepUp';
import { logAuthEvent } from './audit';
import { forceSignOut } from './session';
import { hasPin } from './pin';
import { isMfaEnrolled } from './mfa';

export interface AuthApi {
  currentUser(): User | null;
  signOut(): Promise<void>;
  requireStepUp(reason: string): Promise<boolean>;
  showSecurityPanel(): void;
  isMfaEnrolled(): boolean;
  hasPin(): boolean;
}

let openSecurityPanel: (() => void) | null = null;
export function registerOpenSecurityPanel(fn: () => void): void {
  openSecurityPanel = fn;
}

const api: AuthApi = {
  currentUser: () => auth.currentUser,
  signOut: async () => {
    const uid = auth.currentUser?.uid;
    if (uid) await logAuthEvent(uid, 'signout');
    await forceSignOut('user-initiated');
  },
  requireStepUp,
  showSecurityPanel: () => {
    if (openSecurityPanel) openSecurityPanel();
    else console.warn('[auth] security panel not yet mounted');
  },
  isMfaEnrolled: () => {
    const u = auth.currentUser;
    return u ? isMfaEnrolled(u) : false;
  },
  hasPin: () => {
    const u = auth.currentUser;
    return u ? hasPin(u.uid) : false;
  },
};

declare global {
  interface Window {
    __auth?: AuthApi;
  }
}
window.__auth = api;

export { auth, db };
