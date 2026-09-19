# Error Tracking (Sentry)

Catalist uses [Sentry](https://sentry.io) for client-side error tracking — unhandled exceptions, network failures, and explicit `reportError(...)` calls from the app surface in a single dashboard with stack traces and breadcrumbs.

This was wired up early (Phase 0 of the [security rebuild](security-rebuild-plan.md)) so that as the app grows the error history is already being captured. Without it, regressions in production are invisible until a user happens to mention them.

## Status

- **SDK installed:** `@sentry/browser` is in `package.json`.
- **Init code:** `src/sentry.ts`, called from `src/main.tsx` at the very top so it loads before any other app code.
- **Default behaviour:** if `VITE_SENTRY_DSN` is not set (the current default), Sentry is a no-op. The app behaves exactly as if Sentry weren't there. In dev you'll see one console line: `[sentry] VITE_SENTRY_DSN not set — error tracking disabled.`
- **Activation:** create a Sentry project, paste the DSN into `.env.production.local` (and optionally `.env.development.local`), redeploy.

## One-time activation

Sentry account creation has to happen via Sentry's UI — Claude can't create accounts on your behalf. Once that's done, the rest is just env vars.

1. Create a free [sentry.io](https://sentry.io) account (or log in).
2. Create a new project → platform **Browser JavaScript**. Name it `catalist` (or similar).
3. Sentry will show a DSN that looks like `https://<key>@o<org>.ingest.sentry.io/<project>`. Copy it.
4. At the project root, create `.env.production.local` (gitignored) and add:

   ```
   VITE_SENTRY_DSN=https://<your-dsn>
   VITE_SENTRY_ENVIRONMENT=production
   ```

5. Optional: create a separate Sentry project for dev (or reuse the same one with `environment: development`), and add the DSN to `.env.development.local`. Useful so dev errors don't pollute production stats.
6. Rebuild + redeploy:

   ```
   npm run build
   firebase deploy --only hosting
   ```

7. Verify: visit the deployed app, open the browser console, run `throw new Error('sentry test')`. The error should appear in Sentry within a minute.

## How it's wired

- `src/sentry.ts` exports `initSentry()`, `setSentryUser(uid)`, and `reportError(err, context)`.
- `src/main.tsx` calls `initSentry()` as its first action.
- `src/sentry.ts` also exposes `window.__sentry = { setUser, reportError }` so the legacy `script.js` can report from outside the bundle without re-importing the SDK.
- `script.js` calls `window.__sentry?.setUser(uid)` after `signInAnonymously` resolves, and `window.__sentry?.reportError(err, ...)` from the catch block. Add similar calls anywhere else you want explicit reporting.

## Privacy posture

Catalist handles patient data — Sentry must never see it. The init in `src/sentry.ts` enforces this:

- `sendDefaultPii: false` (the SDK default, made explicit).
- `beforeSend` strips `request.data` and cookies from outgoing events.
- `beforeBreadcrumb` redacts the `message` and `data` of `ui.input` / `ui.click` breadcrumbs — these otherwise capture the text of buttons clicked and values typed, which on Catalist would be patient names / clinical notes.
- `tracesSampleRate: 0` and `replaysSessionSampleRate: 0` — performance traces and session replays are off. Replays especially would leak patient data; revisit only with a strict masking policy in place.

When the security rebuild reaches Phase 6 (audit & observability), revisit this file: structured clinical events should go to your own audit collection, not to Sentry.

## Useful patterns

```js
// Inside the codebase, when you want to report an error explicitly:
try {
  await something();
} catch (err) {
  console.error('something failed', err);
  window.__sentry?.reportError(err, { stage: 'something' });
}

// Marking the current user (already done after sign-in, but useful in tests):
window.__sentry?.setUser('uid-123');
```

## Tuning the noise floor

Sentry's free tier covers ~5k events/month. If errors start spamming the dashboard, the lever is `ignoreErrors` in `src/sentry.ts`. The list there already filters the worst browser-extension noise; add to it as new patterns emerge.

Don't filter what you don't recognise — investigate first. A high-volume "harmless" error often turns out to be the smoke from a real bug.
