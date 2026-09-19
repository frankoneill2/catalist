# Firestore rules test matrix

**Status:** Phase 4 manual test plan. Automated tests using
`@firebase/rules-unit-testing` against the Firestore emulator are queued
for Phase 6 (audit + observability) once the rest of the test infra is in
place. Until then, use this matrix as a checklist when you change
`firestore.rules`.

How to run a quick manual check:

1. Start the emulator: `firebase emulators:start --only firestore` (or, in a
   pinch, run against `catalist-dev` by signing in as two test users in two
   browsers — both flows surface the same allow/deny outcomes).
2. For each row, attempt the action and confirm the outcome.

Symbols:

- ✅ allowed
- ❌ denied (deliberate)
- ⚠️ allowed today, will tighten later (deferred to a phase noted in the row)

---

## /users/{uid}

| As                | Action                                    | Expected | Notes |
| ----------------- | ----------------------------------------- | -------- | ----- |
| Same user         | Read own profile                          | ✅       | needed for ensureUserProfile |
| Other signed-in   | Read another user's profile               | ✅       | needed to resolve `authorUid` → displayName |
| Same user         | Create / update / delete own profile      | ✅       | |
| Other signed-in   | Update another user's profile             | ❌       | `addMember`'s userRef write fails silently here; profile self-heals on next sign-in |
| Anonymous         | Any read or write                         | ❌       | |

### /users/{uid}/devices/{id} and /users/{uid}/authEvents/{id}

| As           | Action          | Expected |
| ------------ | --------------- | -------- |
| Owner        | read / write    | ✅       |
| Other user   | read / write    | ❌       |
| `authEvents` | update / delete | ❌ (anyone, including owner) — append-only |

---

## /groups/{groupId}

| As                | Action                                     | Expected | Notes |
| ----------------- | ------------------------------------------ | -------- | ----- |
| Member            | Read group doc                             | ✅       | |
| Non-member        | Read group doc                             | ❌       | enforces workspace isolation |
| Signed-in         | Create new group with self as owner+admin+member | ✅ | covers `createGroup` |
| Signed-in         | Create group with someone else as owner    | ❌       | rule checks `ownerUid == request.auth.uid` |
| Owner             | Add a member to memberUids                 | ✅       | invite/approve flow |
| Owner             | Remove a member from memberUids (kick)     | ✅       | covers `handleKick` |
| Owner             | Promote/demote admins (change adminUids)   | ✅       | reserved to owner |
| Owner             | Transfer ownership (change ownerUid)       | ✅       | reserved to owner |
| Admin (non-owner) | Add a member to memberUids                 | ✅       | `adminAdditiveOnly` allows additions |
| Admin (non-owner) | Remove another member from memberUids      | ❌       | kick is owner-only at the rules layer |
| Admin (non-owner) | Change adminUids (promote / demote anyone) | ❌       | reserved to owner |
| Admin (non-owner) | Change ownerUid                            | ❌       | reserved to owner |
| Admin (non-owner) | Self-leave (remove only self from member/admin lists) | ✅ | covered by `isSelfLeaving` |
| Member (non-admin)| Self-leave (remove only self from memberUids) | ✅    | covered by `isSelfLeaving` |
| Member (non-admin)| Remove someone else from memberUids        | ❌       | not self → `isSelfLeaving` fails |
| Member (non-admin)| Update name (no membership change)         | ✅       | |
| Owner             | Delete group                               | ✅       | |
| Admin (non-owner) | Delete group                               | ❌       | |

### /groups/{groupId}/members/{memberUid}

| As                  | Action       | Expected |
| ------------------- | ------------ | -------- |
| Group member        | Read         | ✅       |
| Non-member          | Read         | ❌       |
| Admin               | Write any    | ✅       |
| Self                | Write own    | ✅       |
| Member (other doc)  | Write        | ❌       |

### /groups/{groupId}/cases/...

| As           | Action  | Expected |
| ------------ | ------- | -------- |
| Member       | read / write any case + tasks + comments + notes + wardNotes | ✅ |
| Non-member   | any                                                            | ❌ |

---

## /invites/{token}

| As                       | Action                                                                  | Expected | Notes |
| ------------------------ | ----------------------------------------------------------------------- | -------- | ----- |
| Group admin              | Create invite for own group with status='pending', invitedByUid=self    | ✅       | covers `createInvite` |
| Group admin              | Create invite with `invitedByUid` ≠ self                                | ❌       | prevents impersonation |
| Group member (non-admin) | Create invite                                                           | ❌       | |
| Outside user             | Create invite for someone else's group                                  | ❌       | |
| Anyone signed-in         | get(/invites/{token}) — must know the token                             | ✅       | enables the recipient flow |
| Anyone signed-in         | list /invites                                                           | ❌       | non-enumerable |
| Recipient                | Update pending → accepted, set `acceptedByUid` to self                  | ✅       | unlocks the group self-add |
| Recipient                | Update setting `acceptedByUid` to a different user                      | ❌       | |
| Recipient                | Update changing `groupId` or `invitedByUid`                             | ❌       | |
| Recipient                | Update an already-accepted invite                                       | ❌       | one-shot acceptance |
| Group admin              | Delete (revoke) any invite for own group                                | ✅       | |
| Other admin              | Delete an invite for a group they don't admin                           | ❌       | |

### /groups/{groupId} membership self-add via invite

| As            | Action                                                                                | Expected | Notes |
| ------------- | ------------------------------------------------------------------------------------- | -------- | ----- |
| Recipient     | Update group adding *only* self to memberUids + `_claimedFromInvite: <valid token>`   | ✅       | second step of accept |
| Recipient     | Same write but `_claimedFromInvite` references an invite for a *different* group      | ❌       | rule re-checks invite.groupId |
| Recipient     | Same write but invite.acceptedByUid ≠ self                                            | ❌       | |
| Recipient     | Same write but invite.status is 'pending' (not yet accepted)                          | ❌       | step 1 must precede step 2 |
| Recipient     | Update adding self **and** changing adminUids                                         | ❌       | privilege-escalation guard |
| Outside user  | Update referencing a `_claimedFromInvite` they don't own                              | ❌       | |

## /cases/{id} (legacy top-level — read-only window)

| As            | Action                                | Expected | Notes |
| ------------- | ------------------------------------- | -------- | ----- |
| Signed-in     | Read                                  | ✅       | needed for migration detection + 30-day rollback |
| Signed-in     | Update only `migratedTo` + `migratedAt` | ✅     | rule uses `affectedKeys().hasOnly` |
| Signed-in     | Update any other field                | ❌       | |
| Signed-in     | Create or delete                      | ❌       | |
| Anonymous     | Any                                   | ❌       | |

Subcollections `tasks`, `notes`, `wardNotes`, `tasks/.../comments`:

| As            | Action | Expected |
| ------------- | ------ | -------- |
| Signed-in     | Read   | ✅       |
| Signed-in     | Write  | ❌       |
| Anonymous     | Read   | ❌       |

---

## /locations, /tags (+ subtags), /updates

| As            | Action       | Expected | Notes |
| ------------- | ------------ | -------- | ----- |
| Signed-in     | Read / write | ⚠️ (Phase 6) | still workspace-shared; group-scoping deferred |
| Anonymous     | Any          | ❌       | |

---

## Anything not listed

The catch-all has been removed. Reads or writes to any path not enumerated
above must return permission-denied. If you add a new collection, add a
matching `match` block and extend this matrix.
