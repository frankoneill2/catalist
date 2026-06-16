# Deploying Firestore security rules

`firestore.rules` (repo root) is the **single source of truth** for Firestore
security on **both** Firebase projects. Keep it in git and deploy it the same
way to each environment.

| Environment | Firebase project | URL |
|---|---|---|
| Dev sandbox | `catalist-dev` | catalist-dev.web.app |
| Production  | `catalist-1`   | wardround.app |

The **only** thing that legitimately differs between dev and prod is the
baked-in Firebase config (API key / project id, inlined into the JS bundle at
build time). The **rules must be identical** in both. They drifted apart once —
dev got a tighter membership model while prod kept an older one — purely because
rules were hand-edited / deployed separately. That drift is what broke the
workspace switcher in one place but not another.

## Deploy

Always deploy to **dev first**, confirm it behaves, then deploy the *same* file
to prod:

```sh
# 1. dev — validate here
firebase deploy --only firestore:rules --project catalist-dev

# 2. prod — only once dev looks right
firebase deploy --only firestore:rules --project catalist-1
```

`--project` is explicit on purpose: never rely on the default project for a
rules deploy.

## Check the two environments are in sync

```sh
scripts/check-rules-parity.sh
```

This fetches the *live* deployed rules from both projects and diffs them against
`firestore.rules`. Run it after any deploy, and any time something behaves
differently in prod than in dev.

## Never

- **Never edit rules in the Firebase console.** Console edits aren't in git and
  silently drift from this file — and the next `firebase deploy` (or the next
  developer) will either clobber them or be misled by them.
- **Never deploy rules from a branch whose `firestore.rules` you haven't
  checked.** A deploy overwrites whatever is currently live. Before today, the
  `wardround.app` branch carried a wide-open `allow read, write: if
  request.auth != null` ruleset; deploying it would have exposed all patient
  data.

## Recovering the live rules (if git ever falls behind)

The deployed ruleset can be fetched from the Firebase Rules REST API:

```sh
TOKEN=$(gcloud auth print-access-token)
PROJ=catalist-1   # or catalist-dev
REL=$(curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJ" \
  "https://firebaserules.googleapis.com/v1/projects/$PROJ/releases")
# -> find the cloud.firestore release's rulesetName, then GET
#    https://firebaserules.googleapis.com/v1/<rulesetName>
```

`scripts/check-rules-parity.sh` automates exactly this.
