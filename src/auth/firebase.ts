// Single source of truth for the Firebase app instance.
//
// Both the new auth code (TypeScript) and the legacy script.js import from
// here, so they share a single Firebase app + auth state. Without this both
// halves of the bundle would call initializeApp() independently and end up
// with separate, unsynchronised auth instances.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    'Firebase config missing — check that .env.development or .env.production exists at the project root with VITE_FIREBASE_* values.'
  );
}

export const app: FirebaseApp = initializeApp(firebaseConfig);

// Phase 8 — App Check. Protects Firestore + Cloud Functions from being
// hammered with valid-shaped requests from outside our app (scripts, scrapers,
// API replay). Gated on a build-time env var so:
//   - dev clones without a reCAPTCHA key boot normally (and stay unprotected,
//     which is fine for local dev against catalist-dev).
//   - production picks it up automatically once the key is provisioned.
//
// To enable: create a reCAPTCHA v3 site key for the Firebase project (Console
// → App Check → Apps → Web → reCAPTCHA v3), set VITE_APP_CHECK_RECAPTCHA_KEY
// in `.env.production.local`, then add Enforcement under Console → App Check
// for Firestore and (when Phase 7 functions ship) Cloud Functions. Note that
// enabling enforcement before all client builds carry the key locks legit
// users out — soft-launch first.
const appCheckKey = (import.meta.env.VITE_APP_CHECK_RECAPTCHA_KEY as string | undefined) || '';
if (appCheckKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('[firebase] App Check init failed', err);
  }
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

// Persistence is set later by the auth gate based on the "shared device"
// toggle. Default to local (survives browser restarts) until told otherwise.
let persistencePromise: Promise<void> | null = null;
export function configurePersistence(shared: boolean): Promise<void> {
  const target = shared ? browserSessionPersistence : browserLocalPersistence;
  persistencePromise = setPersistence(auth, target);
  return persistencePromise;
}
// Apply default persistence eagerly so initial auth state restoration uses it.
configurePersistence(false);

// Expose to legacy script.js so it doesn't need to re-init Firebase.
declare global {
  interface Window {
    __firebase?: { app: FirebaseApp; auth: Auth; db: Firestore };
  }
}
window.__firebase = { app, auth, db };
