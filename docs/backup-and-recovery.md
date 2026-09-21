# Backup and recovery

Status as of 2026-09-20. Read [security-overview.md](security-overview.md) for
why this matters.

## Where things stand

Billing was enabled on `catalist-1` on 2026-09-20, which unblocked all of it.

| Control | Prod (`catalist-1`) | Dev (`catalist-dev`) |
|---|---|---|
| Delete protection | **Enabled** | **Enabled** |
| Point-in-time recovery | **Enabled** — 7-day window | Not enabled (free tier) |
| Daily backups | **Enabled** — 7-day retention | — |
| Weekly backups | **Enabled** — 14-week retention, Sundays | — |
| Manual JSON export | `npm run backup:prod` | `npm run backup:dev` |

Restore from a managed backup or a point in time:

```bash
gcloud firestore backups list --project=catalist-1
# restore into a NEW database, never over the live one
gcloud firestore databases restore --source-backup=<backup> \
  --destination-database=restore-test --project=catalist-1
```

`catalist-dev` is still on the free tier. It will need billing before the
KMS work can be exercised there, since Cloud KMS and Cloud Functions both
require it.

## The interim backup

Until managed backups are on, `scripts/backup-firestore.mjs` is the only
backup this project has. It walks every collection and subcollection over the
Firestore REST API using your gcloud credentials and writes one JSON file.

```bash
npm run backup:prod     # → backups/catalist-1-<timestamp>.json
npm run backup:dev
```

`backups/` is gitignored — these files contain real clinical data and must
never be committed. Keep them somewhere encrypted and off this machine.

Its limits, stated plainly: it is a snapshot taken when you run it, on the
machine you run it from, and nothing runs it on a schedule. It is strictly
better than nothing and strictly worse than managed backups.

## Restoring

There is deliberately no automated restore script. Writing 1,100 documents
back into a live clinical database is not something to trigger by accident,
and the shape of a recovery depends on what went wrong — one deleted case is
a very different job from a lost database.

To recover a small number of documents, read them out of the JSON export
(`documents` is keyed by full path, e.g. `groups/abc/cases/def`) and write
them back through the console or a short one-off script.

**Rehearsed:** 2026-09-20, against `catalist-dev`. The full export/verify
cycle was exercised, including the KEK rotation round-trip below.

## Key rotation

The encryption story has its own recovery dimension. Each group's clinical
fields are encrypted with a per-group DEK; the DEK is wrapped by a KEK derived
from `VITE_FIELD_KEK_SEED` and stored on the group document.

**If the seed is lost, and no backup holds the DEK wrapped under a key you
still have, that group's data is permanently unreadable.** The seed lives in
`.env.production.local`, which is gitignored and exists only on this machine.
Put it in a password manager.

`scripts/rotate-kek.mjs` rotates the KEK without data loss: it unwraps each
group's DEK with the old key, re-wraps it with the new one, verifies the
round-trip, and only then writes. The DEK itself never changes, so existing
ciphertext stays readable.

```bash
# dry run first — always
node scripts/rotate-kek.mjs --project catalist-dev --new-env .env.development.local
node scripts/rotate-kek.mjs --project catalist-dev --new-env .env.development.local --apply
npm run deploy:dev
```

**Ordering is not optional.** The seed is baked into the client bundle at
build time, so a browser holding the old seed cannot unwrap a newly wrapped
DEK. Rotate and deploy the matching build together, at a quiet time. Between
the two, and for any session that has not yet reloaded, decryption fails —
and because `encryptText()` falls back to a plaintext write, a note saved in
that window is stored unencrypted.

Rotation history:

| Date | Project | From | To |
|---|---|---|---|
| 2026-09-20 | `catalist-dev` | envelope.ts public fallback | `.env.development.local` |
| — | `catalist-1` | envelope.ts public fallback | staged, not yet applied |

## KMS migration status (2026-09-20)

The KEK has moved from the browser into Cloud KMS. Sequencing is deliberate
so no session ever loses decryption:

| Step | State |
|---|---|
| 1. KMS key `europe/catalist/field-kek` created | **Done** |
| 2. Functions `unwrapGroupDek` / `wrapGroupDek` deployed to prod | **Done** |
| 3. KMS IAM granted to the functions service account | **Done** |
| 4. Client understanding both v1 and v2 deployed | **Done** 2026-09-21 |
| 5. Prod group DEKs migrated v1 → v2 | **Done** 2026-09-21 |
| 6. Delete the v1 path and `VITE_FIELD_KEK_SEED` | **Blocked on dev** |

Production runs `index-BEKj6mTG.js` (tag `prod/BEKj6mTG`), byte-identical to
this repo's `dist/`. The one production group is wrapped by KMS.

Step 6 is deliberately not done. `catalist-dev` is still on the free tier, so
it has no KMS and its group is still v1 under a local seed. Removing the v1
path now would break dev. Enable billing on `catalist-dev`, migrate it the
same way, then delete `getKek`, `unwrapLocalV1`, `FALLBACK_SEED` and the env
var from `src/auth/envelope.ts`.

Until then the legacy fallback seed is still present in the production bundle.
It is inert there — the only prod group is v2, and new groups bootstrap
straight to v2 via `wrapGroupDek` — but it should not linger.

If step 5 goes wrong, back it out — the DEK is recoverable either way:

```bash
node scripts/migrate-kek-to-kms.mjs --project catalist-1 --rollback --apply
```

The production backup taken on 2026-09-20 also holds every `wrappedDek` in
its original v1 form, so the data keys survive even total loss of the KMS key.
