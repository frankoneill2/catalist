# Backup and recovery

Status as of 2026-09-20. Read [security-overview.md](security-overview.md) for
why this matters.

## Where things stand

| Control | Prod (`catalist-1`) | Dev (`catalist-dev`) |
|---|---|---|
| Delete protection | **Enabled** | **Enabled** |
| Point-in-time recovery | Blocked — needs billing | Not needed |
| Scheduled backups | Blocked — needs billing | Not needed |
| Manual JSON export | `npm run backup:prod` | `npm run backup:dev` |

### The billing blocker

Firestore's managed backup features — point-in-time recovery and scheduled
exports — require billing to be enabled on the project. `catalist-1` is
currently on the free tier:

```
$ gcloud billing projects describe catalist-1
billingEnabled: False
```

This is also why the Cloud Functions have never been deployed.

**To unblock**, enable billing on `catalist-1` in the Google Cloud console,
then run:

```bash
gcloud firestore databases update --database='(default)' --project=catalist-1 --enable-pitr
gcloud firestore backups schedules create --database='(default)' --project=catalist-1 \
  --recurrence=daily --retention=7d
gcloud firestore backups schedules create --database='(default)' --project=catalist-1 \
  --recurrence=weekly --retention=14w --day-of-week=SUN
```

Firestore's free-tier quota is generous and the database is small (~1,100
documents), so expect a very small monthly bill rather than a step change.

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
