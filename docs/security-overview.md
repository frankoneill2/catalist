# Security overview

Assessed 2026-09-19 against the bundle served by wardround.app
(`index-D70QT7Ok.js`), the Firestore rules deployed to `catalist-1`, and the
GCP project configuration.

> Findings about anonymous sign-in, a shared passphrase or a hardcoded
> `'shared-salt'` refer to the pre-2026 client and are **not** in the deployed
> app. See [architecture.md](architecture.md).

## Summary

| Area | Verdict |
|---|---|
| Authorisation | Server-side via Firestore rules — three collections still un-scoped |
| Dependencies | Lean; 3 advisories, none reachable from the browser |
| Secrets | **Resolved** — KEK lives in Cloud KMS and never reaches the browser |
| Input handling | Strong server-side validation; output escaped; failures now reported |
| Authentication | **Mandatory** email verification + TOTP MFA; invite-only workspaces |
| Backup & recovery | **Resolved** — PITR, daily + weekly managed backups, delete protection, manual exports |

## 1. Authorisation — server-side

Enforced by Firestore rules on Google's servers, not in the browser. Clinical
records live under `groups/{groupId}/cases/…` and require membership of that
group. `isSignedIn()` requires `email_verified == true`. Group updates follow an
owner / additive-admin / self-leaving ladder. Audit logs are append-only
(`update, delete: if false`). The wrapped group key is immutable once set.

**Gaps:**

- `/updates`, `/locations`, `/tags` are `allow read, write: if isSignedIn()` —
  readable *and writable* by any verified account in any workspace. Clinical
  content in `/updates` is encrypted, but `username`, `authorUid`, `caseId`,
  `assignee`, `priority` and timestamps are plaintext, and entries can be
  forged or deleted by any account.
- Cloud Functions (`deleteCase`, `removeMember`) are written but **not
  deployed** — `gcloud functions list` returns zero. The client deletes cases
  recursively itself, and the rules let *any member* delete a case.
- The invite-only gate is UI-only; rules permit any signed-in user to create a
  group. Corollary: there is still no in-app way to create the first workspace.

## 2. Dependencies

Five direct runtime dependencies — `firebase`, `react`, `react-dom`,
`@sentry/browser`, `qrcode` — resolving to 169 packages. Three advisories
(`websocket-driver` critical, `protobufjs` and `@grpc/grpc-js` high) are
Firebase Node-side transitives with **zero occurrences in the shipped bundle**.
`npm audit fix` clears them. Sixteen more affect build tooling only.

Runtime third parties are constrained by a strict CSP in `firebase.json`
(verified live): script sources limited to self/gstatic/google/gtm, connections
to Google APIs and Sentry, plus HSTS, `X-Frame-Options: DENY`, `nosniff`,
Referrer-Policy and Permissions-Policy. No SRI on external scripts.

## 3. Secrets

Build-time environment variables; no secrets manager. `.env.development` and
`.env.production` are committed deliberately — Firebase web config is public by
design, and the key was rotated and restricted by referrer/API after the
February 2026 exposure notice. Real secrets belong in gitignored `.env.*.local`.

**Critical.** `VITE_FIELD_KEK_SEED` was blank in both environments, so
`envelope.ts` fell back to the literal
`'catalist-dev-kek-fallback-not-for-production-use'`. This was confirmed
empirically, not inferred: the dev KEK rotation on 2026-09-20 successfully
unwrapped the live DEK using that fallback.

*Dev* has since been rotated onto a distinct 32-byte random seed in
`.env.development.local` and redeployed; the fallback no longer appears in the
dev bundle. *Production is still on the fallback* — rotation is staged but
requires a coordinated deploy (see
[backup-and-recovery.md](backup-and-recovery.md#key-rotation)).

**Resolved by moving to Cloud KMS (2026-09-20).** Rotating the seed was never
going to fix this — any `VITE_` variable is inlined into the public bundle, so
whatever value is set is downloadable. The fix was to remove the browser from
the equation entirely.

The KEK is now a Cloud KMS key (`europe/catalist/field-kek`) that never leaves
Google. The client calls `unwrapGroupDek`, which verifies membership
server-side and asks KMS to decrypt the group's wrapped key. KMS access is
granted to the functions service account alone, scoped to that one key, and
every unwrap is recorded in Cloud Audit Logs.

What that buys: a database-only breach — stolen backup, rules bug,
Firestore-side incident — now yields ciphertext and nothing usable. That is
exactly the threat model `envelope.ts` claims, and it now holds. The key can
also be disabled to revoke access to all content at once.

What it does not buy: the *data* key still reaches the browser of an
authenticated member, because the client decrypts. A compromised member
session still exposes that group's patients. Closing that needs server-side
decryption on every read, or true E2EE (Path B, deliberately not chosen).

**Status: live as of 2026-09-21.** The client is deployed
(`index-BEKj6mTG.js`, tag `prod/BEKj6mTG`) and the production group's key is
wrapped by KMS. The legacy v1 path is retained only because `catalist-dev` is
still free-tier and has no KMS; see
[backup-and-recovery.md](backup-and-recovery.md#kms-migration-status-2026-09-20).

Also unset: `VITE_SENTRY_DSN` (error tracking dormant) and
`VITE_APP_CHECK_RECAPTCHA_KEY` (App Check not enforcing).

## 4. Input handling and errors

Rules validate the *shape* of sensitive writes, not just the writer:
`membershipUnchanged`, `adminAdditiveOnly`, `isSelfLeaving`,
`envelopeKeyImmutable`, `isClaimedValidInvite` (which re-fetches the invite
server-side rather than trusting a claim), and uid-tagged audit events. The
Cloud Functions repeat the membership and email-verification checks, since
rules cannot gate a function call.

**Sanitisation — fixed 2026-09-21.** An audit of every HTML sink (60
`innerHTML` assignments, 3 `document.write` calls, and the React layer) found
two that took user data: the Updates user filter, which interpolated a
username into both an attribute and element text, and the task list header,
which interpolated a colleague's display name. Both now build DOM nodes with
`textContent`. A shared `escapeHtml()` exists for the cases where a string of
HTML is unavoidable — its absence was what made this a category rather than a
one-off. Ward notes and print windows were already safe: they build DOM with
`textContent` and serialise.

Severity note, because the first assessment overstated this: the live CSP
carries no `'unsafe-inline'` on `script-src`, so inline handlers were already
refused execution. These were real bugs sitting behind a working second layer,
not open script execution.

The five remaining interpolating sinks are closed sets — a hardcoded label
map, the platform modifier key, and the Carbon icon helper, which looks up a
fixed table and returns `''` for anything unknown.

**Error handling — improved 2026-09-21.** Three silent paths were made loud:

- `encryptText` falling back to a plaintext write was a `console.warn`. It is
  now an error, a Sentry report and a user-facing toast. The fail-open
  behaviour is deliberate — losing a ward note mid-round is a real clinical
  harm — but it is no longer invisible, and affected records stay identifiable
  by their empty `iv`.
- `audit.ts` and `dataAudit.ts` swallowed write failures; both now report.
- `MfaEnroll` asserted TOTP was disabled on the project for *any* enrolment
  failure, which was usually wrong and misdirected a real investigation in
  June. It now leads with the mapped error.

**Validation.** Clinical text is bounded at `encryptText`, the single
chokepoint every field passes through: 100,000 characters against a largest
real document of ~18KB, capped rather than refused, with the user told and the
event reported. Firestore's own 1MB document limit remains the hard backstop.

Note that all of the above reporting is inert until `VITE_SENTRY_DSN` is set.

## 5. Authentication

Email and password with **mandatory** email verification and **mandatory** TOTP
two-factor — `MfaEnroll` offers only enrol or sign out, and the gate loops back
while `!isMfaEnrolled(user)`. Verification is enforced twice: in the gate, and
in the rules via the `email_verified` claim, so bypassing the overlay still
fails at Firestore.

Also present: PIN resume (convenience, skippable), step-up re-auth for
destructive actions, device recognition and anomaly checks, invite-only
workspaces where a tokenised link creates a *join request* requiring admin
approval, and an append-only per-user auth event log.

## 6. Backup and recovery

Was: nothing at all. Now: partially addressed, with one blocker outside the
codebase. Full detail and runbook in
[backup-and-recovery.md](backup-and-recovery.md).

- **Delete protection: enabled** on both projects (2026-09-20). The database
  can no longer be deleted by accident.
- **Point-in-time recovery and scheduled backups: still absent**, because they
  require billing and `catalist-1` is on the free tier
  (`gcloud billing projects describe catalist-1` → `billingEnabled: False`).
  This is also why the Cloud Functions in Q1 have never been deployed.
- **Manual JSON export: working.** `npm run backup:prod` walks every
  collection and subcollection over the REST API. First production backup taken
  2026-09-20 — 1,120 documents. `backups/` is gitignored.
- **Rehearsed** 2026-09-20 against `catalist-dev`, including a full KEK
  rotation round-trip.

The export is a snapshot taken by hand, not a schedule. Enabling billing and
turning on PITR is still the real fix.

### Legacy data still in production

The export surfaced something the rules comment gets wrong. `firestore.rules`
states that legacy top-level data "has been deleted from production". It has
not. Production still holds **73 top-level `cases`** with 203 tasks, 32 ward
notes and 5 notes, plus 535 `updates`. The rules deny all access, so the app
cannot reach it — but the documents exist, and they are encrypted under the
retired shared-passphrase scheme (12-byte `iv` arrays), so nothing in the
current app can decrypt them either.

That is retained patient data that is unreachable, undecryptable and
undocumented — a GDPR retention question rather than an access-control one.
Decide deliberately whether to delete it (`scripts/delete-legacy-cases.mjs`
exists) or to record why it is kept.

The *application* is recoverable — Firebase Hosting keeps prior releases, and
source is tagged (`archive/*`, `prod/D70QT7Ok`). Patient data is not.

Data residency is correct: the database is in `eur3`, Google's European
multi-region.

## Priorities

Reassessed 2026-09-21.

- Technical posture, with evidence: https://claude.ai/artifact/Uxjk3anGWYfnwADdJG3ywS
- Plain-language explanation of the whole model, and how to answer a security
  reviewer: https://claude.ai/artifact/7iydhcSxF4E9S8zVCobhTi

1. **Set `VITE_SENTRY_DSN`.** Already wired, needs one value. It is what would
   surface a KMS failure, an audit-write failure, or the plaintext fallback.
3. **Group-scope `/updates`, `/locations`, `/tags`.** Cross-workspace read and
   write. Needs rules + client + migration together — the deployed client
   writes to the top-level paths.
3. **Finish the KMS tail.** Billing on `catalist-dev`, migrate it, then delete
   `getKek` / `unwrapLocalV1` / `FALLBACK_SEED` / `VITE_FIELD_KEK_SEED`.
4. **Wire or gate the Cloud Functions.** Deployed but unused; any member can
   still delete a case.
5. **Rehearse a managed-backup restore** into a scratch database.
6. Loose ends: the retained legacy `/cases` data, App Check, `npm audit fix`.

### Resolved

- ~~Firestore backups~~ — PITR (7 days), daily (7d) and weekly (14w) managed
  backups, delete protection, manual export script. 2026-09-20.
- ~~Encryption key published in the bundle~~ — moved to Cloud KMS. 2026-09-21.
  Rotating `VITE_FIELD_KEK_SEED` was abandoned as no fix at all: Vite inlines
  every `VITE_` variable into the public bundle.
- ~~Cloud Functions never deployed~~ — all four live in europe-west1, though
  two remain unwired (see 6).
- ~~Output escaping / silent failures~~ — two XSS sinks fixed, `escapeHtml()`
  added, encryption and audit failures now reported, input bounded. 2026-09-21.
- ~~Rules drift~~ — repo, dev and prod byte-identical; `npm run rules:check`.
- ~~KMS path unverified~~ — confirmed 2026-09-21: six successful
  `unwrapGroupDek` unwraps logged in production, no errors. A real signed-in
  session decrypts through Cloud KMS end to end.
