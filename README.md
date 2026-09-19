# Catalist — wardround.app

A ward-round handover and task-tracking app for hospital teams. Patients, jobs,
ward notes and a shared activity feed, built for use on a phone during a round
and on a desktop afterwards.

Live at **[wardround.app](https://wardround.app)** (Firebase project `catalist-1`).

> **Read this before auditing the security model.** Between May and September 2026
> this repository described an architecture that was not the one running in
> production. That is fixed — the trunk now builds byte-identically to the live
> bundle — but older branches and tags still contain the superseded design.
> See [docs/architecture.md](docs/architecture.md) for what is actually deployed.

## How it is put together

Two layers share one page, which is unusual enough to explain up front:

| Layer | What it is | Where |
|---|---|---|
| **Auth / workspaces** | React 18, TypeScript | `src/auth/` |
| **Clinical UI** | One large vanilla ES module | `src/script.js` |

`src/main.tsx` mounts `AuthGate` as a full-screen overlay that sits *over* the
clinical UI. Nothing in `script.js` runs against real data until the gate
dispatches an `auth:ready` DOM event. The two layers communicate by events
rather than imports, which is what allowed the auth system to be added without
rewriting 8,500 lines of working ward-round code.

```
src/
  main.tsx            bootstrap; mounts AuthGate, GroupSwitcher, SecurityPanel
  script.js           the clinical UI (patients, tasks, notes, updates feed)
  icons.js            IBM Carbon icon set — see CLAUDE.md
  sentry.ts           error tracking (patient data is scrubbed)
  auth/
    AuthGate.tsx      the state machine: signed-out -> mfa -> verify -> ready
    groups.ts         workspaces: membership, admins, ownership
    invites.ts        tokenised invite links
    joinRequests.ts   the admin-approval step between invite and membership
    envelope.ts       application-layer encryption over Firestore
    audit.ts          append-only record of who did what
    components/       one component per gate state
functions/            Cloud Functions (server-authoritative operations)
firestore.rules       the access-control model — enforced by Google, not the client
docs/                 architecture, deployment, design decisions
```

## Running it

```bash
npm install
npm run dev          # localhost:5173, talks to catalist-dev
```

Local dev uses `.env.development` and the **dev** Firebase project. It never
touches production data.

## Deploying

Build and deploy are two separate steps, and the build bakes in the target
project's config — so always build immediately before deploying:

```bash
npm run deploy:dev     # build with dev config -> catalist-dev.web.app
npm run deploy:prod    # build with prod config -> wardround.app
```

Use these rather than a bare `firebase deploy`. `dist/` is committed to the
repo and shared between both targets, so a plain deploy ships whatever happens
to be sitting there — which is how a dev build once reached production hosting.

Firestore rules deploy separately and have their own guardrails:
see [docs/firestore-rules-deploy.md](docs/firestore-rules-deploy.md) and run
`scripts/check-rules-parity.sh` to check the live rulesets against this repo.

## Environments

| | Hosting | Firebase project | Data |
|---|---|---|---|
| Production | wardround.app | `catalist-1` | Real clinical records |
| Dev sandbox | catalist-dev.web.app | `catalist-dev` | Throwaway |
| Local | localhost:5173 | `catalist-dev` | Throwaway |

To tell any running instance apart, open DevTools → Network → any
`identitytoolkit` or `firestore` request and read the `key=` parameter:
`…Ohcg` is production, `…ROO6c` is dev.

## Security

Access control is enforced by Firestore rules on Google's servers, not in the
browser. Accounts are email-verified with TOTP two-factor; workspaces are
invite-only with admin approval. Full write-up in
[docs/security-overview.md](docs/security-overview.md).

The Firebase `apiKey` in `.env.production` is **not** a secret — Firebase web
config is public by design, and the key is restricted by referrer and by API.
See [docs/incidents/2026-02-api-key-exposure.md](docs/incidents/2026-02-api-key-exposure.md).
