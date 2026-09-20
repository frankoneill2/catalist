# What is actually deployed

This document exists because for four months the repository and the running app
disagreed, and a security review read the repository. If you are orienting
yourself in this codebase, start here.

## The short version

`wardround.app` runs a **Vite-built single-page app** combining a React auth and
workspace layer with a large vanilla-JS clinical UI. Accounts are
email-verified with TOTP two-factor. Workspaces are invite-only with admin
approval. Access control is enforced by Firestore rules on Google's servers.

## Verifying that for yourself

Do not infer the running app from the source tree alone — that is exactly the
mistake this document prevents. Check the deployed bundle:

```bash
curl -s https://wardround.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Then confirm this tree reproduces it:

```bash
npm run build && ls dist/assets/
```

The hashes should match. As of the `prod/D70QT7Ok` tag they do, byte for byte
(`sha256 c44793b2…7aea6`). If they ever diverge, something was deployed from an
uncommitted tree — which is the failure this whole document describes.

**One expected exception.** If `.env.production.local` exists on your machine,
Vite bakes its `VITE_FIELD_KEK_SEED` into the build and the hash will
legitimately differ from the deployed bundle — that file holds the rotated
encryption key, which production has not moved to yet. To reproduce the
deployed artifact exactly, build with that file temporarily renamed. See
[backup-and-recovery.md](backup-and-recovery.md#key-rotation) for where that
rotation stands.

## The two-layer design

```
                    ┌─────────────────────────────┐
  page load  ──────▶│  src/main.tsx               │
                    │    mounts <AuthGate/>       │  React 18 + TypeScript
                    │    full-screen overlay      │  src/auth/
                    └──────────────┬──────────────┘
                                   │
              signed in, verified, MFA satisfied,
                   member of at least one group
                                   │
                    dispatch `auth:ready` (DOM event)
                                   │
                    ┌──────────────▼──────────────┐
                    │  src/script.js              │  vanilla ES module
                    │  patients, tasks, ward       │  ~8,500 lines
                    │  notes, updates feed        │
                    └─────────────────────────────┘
```

The layers share a page but not an import graph. That coupling-by-event is
deliberate: it let the auth system be added in 2026 without rewriting clinical
code that had been working since 2025. The cost is that `script.js` cannot be
reasoned about in isolation — it assumes a gate has already run.

### The AuthGate state machine

`AuthGate.tsx` models the user's progress as explicit states, one screen each:

```
loading → signed-out → mfa-challenge → email-verify → mfa-enroll
        → pin-setup → awaiting-invite → awaiting-approval → ready
```

`ready` is the only state that lets `script.js` see data.

## Where the data lives

Cases are **group-scoped**: `groups/{groupId}/cases/{caseId}`. There is no
top-level `/cases` collection in the deployed model — a clinician in one
workspace cannot address another workspace's patients at all, independent of
whether the UI would let them try.

## History you will trip over

| Reference | What it is |
|---|---|
| `archive/legacy-trunk-2026-09-19` | The 2025 client: anonymous auth, shared passphrase. **Never deployed.** |
| `archive/main-new-2026-09-19` | The trunk before this app was merged onto it. |
| `wip/groups-recovery` | Where this app was rescued to in May 2026. Now merged. |
| `prod/D70QT7Ok` | The commit that builds the currently-live bundle. |

Anything describing a "shared passphrase", `signInAnonymously`, or a hardcoded
`'shared-salt'` refers to the pre-2026 design. None of it is in the deployed
bundle. Confirm with:

```bash
curl -s https://wardround.app/assets/index-D70QT7Ok.js | grep -c signInAnonymously   # 0
```

## Related

- [security-overview.md](security-overview.md) — the current security posture
- [firestore-rules-deploy.md](firestore-rules-deploy.md) — rules deploy discipline
- [security-rebuild-plan.md](security-rebuild-plan.md) — the plan this implements
