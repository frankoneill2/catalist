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
| Secrets | **Encryption key is a hardcoded fallback, published in the bundle** |
| Input handling | Strong server-side validation; one live XSS; encryption fails open |
| Authentication | **Mandatory** email verification + TOTP MFA; invite-only workspaces |
| Backup & recovery | **None exist** — no backups, no PITR, no delete protection |

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

**Critical:** `VITE_FIELD_KEK_SEED` is blank in `.env.production`, so
`envelope.ts` falls back to the literal
`'catalist-dev-kek-fallback-not-for-production-use'` — present in the live
bundle, and shared with dev. Note that *any* `VITE_` variable is inlined into
the client bundle, so a browser-held KEK cannot be confidential; filling the
variable in separates environments but does not make the key private. The real
fix is the planned Cloud KMS + Cloud Function wrap/unwrap (Phase 7).

Also unset: `VITE_SENTRY_DSN` (error tracking dormant) and
`VITE_APP_CHECK_RECAPTCHA_KEY` (App Check not enforcing).

## 4. Input handling and errors

Rules validate the *shape* of sensitive writes, not just the writer:
`membershipUnchanged`, `adminAdditiveOnly`, `isSelfLeaving`,
`envelopeKeyImmutable`, `isClaimedValidInvite`, and uid-tagged audit events.

Client-side: 380 `textContent` against 60 `innerHTML`, and no escaping helper
exists anywhere. `src/script.js:6982-6984` interpolates a user-controlled
display name into `innerHTML` via the assignee filter — a **stored XSS**
exploitable by one workspace member against another.

Two fail-open paths: `encryptText()` writes **plaintext** to Firestore if
encryption throws (documented as intentional so edits aren't lost), and
`audit.ts` swallows write failures to `console.warn`. Both are silent.

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

**None.** Verified on `catalist-1`:

```
pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_DISABLED
deleteProtectionState:         DELETE_PROTECTION_DISABLED
backups schedules list:        Listed 0 items.
backups list:                  Listed 0 items.
```

`security-rebuild-plan.md` specifies scheduled exports with a rehearsed
restore; none was implemented. Nothing has been tested because nothing exists.

The *application* is recoverable — Firebase Hosting keeps prior releases, and
source is tagged (`archive/*`, `prod/D70QT7Ok`). Patient data is not.

Data residency is correct: the database is in `eur3`, Google's European
multi-region.

## Priorities

1. Enable Firestore PITR, a daily backup schedule and delete protection —
   then rehearse one restore into `catalist-dev`.
2. Set a distinct high-entropy `VITE_FIELD_KEK_SEED` per environment.
3. Group-scope `/updates`, `/locations`, `/tags` (the write side especially).
4. Fix the assignee-name XSS; add a shared `escapeHtml()`.
5. Set `VITE_SENTRY_DSN`.
6. Deploy the Cloud Functions, or tighten delete rules to admins.
7. Move the KEK to Cloud KMS (Phase 7).
