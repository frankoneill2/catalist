# Hosting and Deployment

How Catalist is hosted, how to push changes safely, and how to keep test and production environments separate as the project matures.

## Where things live

- **Hosting:** Firebase Hosting, project `catalist-1`, EU multi-region (`eur3`).
- **Production domain:** `wardround.app` (custom domain, TLS auto-provisioned via Let's Encrypt).
- **Auto-generated URLs:** `catalist-1.web.app` and `catalist-1.firebaseapp.com` — both work permanently as fallbacks.
- **Database:** Firestore, same `catalist-1` project, `eur3` region.
- **Auth:** Firebase Auth (currently anonymous; per-user accounts planned in Phase 1 of the rebuild).
- **Source:** GitHub repo. Deploys are now manual via the Firebase CLI (the previous GitHub Pages auto-deploy has been disabled but left in place as a fallback).

The build is configured in `vite.config.ts` (base path `/`) and `firebase.json` (hosting public dir, security headers, SPA rewrite, asset caching). The build is invoked with `npm run build` and outputs to `dist/`.

## The four feedback loops

There are four distinct ways to run Catalist after a code change. They differ in speed, fidelity, and how realistic the test environment is. Use the fastest one that gives you the confidence you need.

### 1. Local dev — sub-second

Run once, leave running:

```
npm run dev
```

Opens at `http://localhost:5173`. Hot Module Replacement (HMR) updates the browser as you save files — usually before you look up. This is where 90%+ of testing should happen.

Caveat: HMR is permissive. It can mask bugs that the production build catches. Don't trust HMR alone for anything risky.

### 2. Local production build — ~1 second

Builds the actual minified bundle and serves it locally:

```
npm run build && npm run preview
```

Opens at `http://localhost:4173`. Catches the kinds of issues HMR hides — strict-mode violations, dead-code-elimination quirks, things that only show up after minification. Worth doing as a habit before any production deploy.

### 3. Firebase preview channel — ~30 seconds

A temporary, isolated frontend deploy at its own URL. Same Firestore backend, separate static files. Each preview gets a URL like `catalist-1--task-redesign-abc123.web.app`, lives for a configurable time (default 7 days, max 30), and doesn't affect production.

```
# Deploy a preview
firebase hosting:channel:deploy task-redesign --expires 7d

# List active previews
firebase hosting:channel:list

# Delete one
firebase hosting:channel:delete task-redesign
```

Use this for: showing a feature to a colleague before merging, testing on a real phone over real cellular, validating an iffy change in production-like conditions without affecting prod.

**Important caveat:** preview channels share the same Firestore as production. The preview is a different *frontend* but the same *backend*. Fine for cosmetic and logic changes; risky for anything that writes data structurally or runs migrations.

### 4. Production deploy — ~30 seconds

```
firebase deploy --only hosting
```

Replaces the live site atomically — either the whole new version is live, or the old one is. No partial states.

If something is wrong, instant rollback to the previous version:

```
firebase hosting:rollback
```

Worth memorising. It saves you the day a bad deploy goes out.

## Patterns for separating test and production

Three escalating patterns, in order of complexity. You'll move up them as the project gets serious.

### Pattern A — Single project + preview channels

What's in place today.

- Production at `wardround.app` (the `catalist-1` project's main site).
- Preview channels for things you want to look at on a real URL before merging.
- Local dev for everything else.

**Use this for:** cosmetic and frontend-only changes, low-risk feature work, anything you can verify locally first.

**Don't use this for:** anything that touches data structure, migrations, or destructive operations. Both production and preview channels share the same Firestore — you cannot test "delete this case" against fake data here.

### Pattern B — Two Firebase projects (dev + prod) — current setup

Two separate Firebase projects:

- **`catalist-1`** (default alias) — production. Real users, real data, `wardround.app`. Configured in `.env.production`.
- **`catalist-dev`** (alias `dev`) — staging. Empty Firestore in `eur3`, separate auth, separate hosting at `https://catalist-dev.web.app`. Configured in `.env.development`.

The mapping lives in `.firebaserc` at the project root. Switch between them with:

```
firebase use            # show current project
firebase use dev        # switch to catalist-dev
firebase use default    # switch back to catalist-1
```

`npm run dev` (Vite) automatically reads `.env.development`, so the local dev server always writes to `catalist-dev`. `npm run build` reads `.env.production` and produces a bundle pointing at `catalist-1`.

### Deploying to each project

```
# Production deploy
firebase use default
firebase deploy --only hosting

# Dev deploy (e.g. for showing a feature on a real URL without affecting prod)
firebase use dev
firebase deploy --only hosting
```

`firebase.json` no longer hard-codes a `site`, so `firebase deploy` uses the default hosting site for whichever project is active (`catalist-1` for prod, `catalist-dev` for dev).

### How the dev project was provisioned (one-time setup, already done)

For reference — this is what was run when the dev project was first created:

```
firebase projects:create catalist-dev --display-name "Catalist Dev"
firebase firestore:databases:create "(default)" --location eur3 --project catalist-dev
firebase apps:create web "Catalist Dev Web" --project catalist-dev
firebase apps:sdkconfig WEB <appId> --project catalist-dev    # to capture config
firebase deploy --only firestore:rules --project catalist-dev
```

The captured config from `apps:sdkconfig` was pasted into `.env.development` as `VITE_FIREBASE_*` values, and `catalist-dev` was added to `.firebaserc` as the `dev` alias.

### One manual step: enable Anonymous Auth on the dev project

Firebase CLI cannot toggle sign-in providers. Until this is done, `npm run dev` will hit `auth/configuration-not-found` and the app will stop at sign-in:

1. Open https://console.firebase.google.com/project/catalist-dev/authentication
2. Click **Get started**.
3. In the **Sign-in method** tab, click **Anonymous** → toggle **Enable** → **Save**.

This matches the production project's current auth setup. Replace with the proper email/password + 2FA model in Phase 1 of the [security rebuild](security-rebuild-plan.md).

### Why this matters

This pattern is what the security rebuild calls for in Phase 0 — the floor for anything that touches the data model. Phase 3 (data migration) in particular is irreversible in production; rehearsing it against `catalist-dev` first is the difference between a routine maintenance window and an incident.

### Pattern C — Branch → preview → staging → prod pipeline

The full version, for when there are collaborators or a release cadence.

- Every push to `main` auto-deploys to prod (via GitHub Actions).
- Every PR auto-deploys to a preview channel on dev.
- Promotion is gated by tests passing.

Firebase has built-in GitHub integration that generates the workflow files for you (`firebase init hosting:github`).

Probably overkill for a solo project right now. Worth knowing where it leads.

## Recommended workflow for the current stage

1. **Local dev for everything you can.** HMR is far faster than any deploy.
2. **`npm run build && npm run preview`** before any production push, as a habit.
3. **Preview channels** when you want a real URL, or to share with a beta tester. Don't bother for things you can verify locally.
4. **`firebase deploy --only hosting`** for production, when you're confident. Manual, deliberate, atomic.
5. **`firebase hosting:rollback`** memorised — the always-available undo button.

For the security rebuild work specifically:

6. **Set up the dev Firebase project before starting Phase 1.** Fifteen minutes of setup buys you weeks of safety. Once it exists, every feature that touches data shape gets tested there first; promotion to production is a deliberate switch.

## Different parts of the stack, different feedback loops

When you start using more of Firebase (later in the rebuild), the feedback-loop story changes per service:

- **Hosting deploys:** seconds.
- **Firestore rules deploys:** seconds.
- **Firestore index changes:** can take hours (Google has to backfill).
- **Cloud Functions deploys:** 3–10 minutes (Google spins up runtime environments).

Worth knowing which is which so you don't sit there refreshing wondering if a deploy worked.

## Reference — useful commands

```
# Daily
npm run dev                                          # local dev with HMR
npm run build                                        # build for production
npm run preview                                      # serve the built bundle locally

# Firebase Hosting
firebase use                                         # which project am I on
firebase use <alias>                                 # switch project
firebase deploy --only hosting                       # deploy to current project's hosting
firebase hosting:channel:deploy <name> --expires 7d  # preview channel
firebase hosting:channel:list                        # see active channels
firebase hosting:channel:delete <name>               # remove a channel
firebase hosting:rollback                            # undo last deploy

# Firebase project setup
firebase login                                       # auth (or --reauth to refresh)
firebase use --add                                   # add project alias
firebase init hosting                                # interactive hosting setup
```

## What changes when you start the rebuild

The hosting setup itself doesn't change much through the security rebuild — Firebase Hosting handles the new structure transparently. What changes:

- **Phase 0:** Set up the dev Firebase project. Move to env-var-driven config.
- **Phase 7:** Cloud Functions get deployed alongside hosting (`firebase deploy` without `--only hosting` will deploy everything). Slower deploys, but worth it for server-side enforcement.
- **Phase 8:** Tighten the Content Security Policy header in `firebase.json` once you've audited what scripts and styles the app actually needs. Defer until Phase 8 — adding CSP earlier is how you accidentally break your own app.
