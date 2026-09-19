// Sentry error tracking. Loaded once at app startup from main.tsx, before any other
// app code runs, so unhandled errors (including those from script.js) get captured.
//
// Behaviour:
// - If VITE_SENTRY_DSN is empty/unset, Sentry is a no-op. The app behaves exactly
//   as if Sentry wasn't present. This is the default until the user has created a
//   Sentry project and pasted a DSN into .env.development.local / .env.production.local.
// - If VITE_SENTRY_DSN is set, Sentry initialises with conservative defaults: sample
//   100% of errors, 0% of performance traces, 0% of session replays.
//
// Tuning later (when there are real users): turn on tracesSampleRate / replays as
// needed. Filtering of known-noisy errors happens in the beforeSend hook below.

import * as Sentry from '@sentry/browser';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const ENVIRONMENT = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || (import.meta.env.DEV ? 'development' : 'production');

let initialised = false;

export function initSentry(): void {
  if (initialised) return;
  if (!DSN) {
    if (import.meta.env.DEV) {
      // One-line hint, only in dev, so it's obvious why no events are flowing.
      // eslint-disable-next-line no-console
      console.info('[sentry] VITE_SENTRY_DSN not set — error tracking disabled.');
    }
    return;
  }
  try {
    Sentry.init({
      dsn: DSN,
      environment: ENVIRONMENT,
      release: (import.meta.env.VITE_APP_VERSION as string | undefined) || undefined,
      sampleRate: 1.0,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Don't send PII. The app's data is health-related — Sentry must not see it.
      // Setting sendDefaultPii: false (the default) and stripping breadcrumbs that
      // could contain user-typed text. Adjust if/when policy allows.
      sendDefaultPii: false,
      beforeSend(event) {
        // Drop request bodies and form data which can contain patient data.
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
        }
        return event;
      },
      beforeBreadcrumb(crumb) {
        // Strip text content from UI breadcrumbs — input values, button labels with
        // patient names, etc. Keep the breadcrumb for context but lose the payload.
        if (crumb.category === 'ui.input' || crumb.category === 'ui.click') {
          if (crumb.message) crumb.message = '[redacted]';
          if (crumb.data) delete crumb.data;
        }
        return crumb;
      },
      ignoreErrors: [
        // Browser extension noise that we can't fix and don't want polluting the dashboard.
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',
      ],
    });
    initialised = true;
  } catch (err) {
    // Never let Sentry init crash the app.
    // eslint-disable-next-line no-console
    console.warn('[sentry] init failed:', err);
  }
}

// Tag the current user once we know who they are (anonymous uid for now; real
// account uid post-Phase-1). Call from script.js after auth resolves.
export function setSentryUser(uid: string | null): void {
  if (!initialised) return;
  if (uid) Sentry.setUser({ id: uid });
  else Sentry.setUser(null);
}

// Manually report an error. Most errors are caught by the global handler Sentry
// installs; this is for cases where script.js wants to report something explicitly.
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

// Expose a tiny shim on `window` so the legacy script.js (not bundled with main.tsx)
// can call into Sentry without importing the SDK twice. Kept narrow on purpose.
declare global {
  interface Window {
    __sentry?: {
      setUser: (uid: string | null) => void;
      reportError: (err: unknown, context?: Record<string, unknown>) => void;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__sentry = { setUser: setSentryUser, reportError };
}
