# Catalist: Cross-Group Case Sharing — Design

## How to read this document

This is the design for adding **cross-group case sharing** to Catalist — the ability for a clinician in one group (e.g. a medical team) to share an individual patient's case with users in another group (e.g. the gastro consult team), without compromising the security model laid out in `security-rebuild-plan.md`.

It assumes you've read the security rebuild plan. Terms introduced there (group, DEK, KEK, envelope encryption, Phase 4 rules, etc.) are used here without re-explaining them. Where this design adds new structure on top, those terms are introduced as needed. The glossary below is a quick reference if any term is unfamiliar.

This is a **design document**, not yet a phase plan. The implementation is sized at the end (Part 10) with a recommendation for where it slots into the existing rebuild plan.

### Glossary

- **Plaintext / ciphertext** — Plaintext is the original data; ciphertext is the encrypted form. Encryption turns plaintext into ciphertext using a *key*; decryption reverses it.
- **DEK (Data Encryption Key)** — A random per-group key that encrypts that group's data. Stored in Firestore in *wrapped* (encrypted) form on `groups/{groupId}.wrappedDek`. Never stored in plaintext.
- **KEK (Key Encryption Key)** — The higher-level key that encrypts (wraps) DEKs. Lives in **Cloud KMS** in the production target (currently a client-side seed as an interim — see security rebuild plan, Phase 5). The KEK itself never leaves KMS.
- **CK (Content Key)** — *New in this design.* A random per-case key that encrypts a case's content. The CK is wrapped with each readers' group DEK and stored alongside the case as a `keyWraps` map.
- **Wrap / unwrap** — Shorthand for "encrypt the key" / "decrypt the key." Mathematically the same as encrypting any other data; the term emphasises that the thing being encrypted is itself a key.
- **Envelope encryption** — The pattern of nesting keys: KEK wraps DEK wraps CK wraps content. Each layer adds defence against a single-point compromise. AWS, Google, and Azure all use this pattern as their standard.
- **Cloud Function** — A small server program running on Google's infrastructure. Browser code calls it like an API. Functions have their own credentials (a *service account*) and can do privileged operations (e.g. talk to KMS) that a browser session cannot.
- **Service account** — A non-human Google identity attached to a Cloud Function. Has its own permissions independent of any user. Lets the function do things a user cannot.
- **Supergroup** — *New in this design.* A hospital-level entity that owns a set of groups. Bounds who can share with whom. Has no DEK of its own — administrative boundary only.
- **Team group / role group** — *New in this design.* A *team group* is the workspace a clinician belongs to as their primary work group (e.g. their medical team, their ward). A *role group* is a consult-receiving entity whose membership is the small set of clinicians currently holding a specific role — e.g. *"Gastro Consult Reg, this rotation."* It is **not** the whole specialty: the gastro consult reg role group does not include interns, SHOs, or attached CNSs. Same Firestore structure as a team group, distinguished by `kind: 'role'`. A clinician "steps into" a role group as a deliberate UX action (potentially with step-up re-auth); audit log records all actions as that individual *acting as* that role.

---

## Part 1 — The clinical problem

Catalist today silos patient cases inside a single group. If you're on the medical team and your patient needs a gastro review, there's no way to put up a consult inside the app — the gastro reg is in a different group, can't see your patient, and getting the information across happens through phone, paper, or another tool. Adoption suffers because the app stops at the team boundary, exactly where real clinical work crosses it.

The goal is to support the everyday hospital primitive — *put up a consult* — natively:

- A clinician on the **medical team** opens a case for patient X, taps a **"Request consult"** action, picks **gastro** from the list of services in the same hospital, and writes a consult question.
- The **gastro reg** sees the case appear in their team's consult inbox. They can read the patient details, the relevant notes, and the consult question. They can write a structured **consult response** back. They cannot edit the medical team's case body, tasks, or notes.
- The **original clinician** sees gastro's response in their own view of the case.
- When the consult is closed (manually or automatically on discharge), gastro's read access ends.

Three constraints make this non-trivial:

1. **The system is encrypted at the application layer.** Per-group DEKs mean a user in group B physically cannot decrypt content stored under group A's DEK, no matter what the rules layer says.
2. **Sharing has to be bounded.** Hospital-A medical should never be able to share with Hospital-B's gastro team, even by accident. There's no concept of a hospital today.
3. **The audit story has to hold up.** A DPO has to be able to ask "who has read this patient's record?" and get a complete, tamper-evident answer that includes cross-group reads.

---

## Part 2 — The supergroup

The structural prerequisite is a **supergroup** — a hospital-level entity that owns a set of groups and defines the boundary of legitimate sharing.

A supergroup is:

- The **administrative boundary** for sharing. Cross-group shares are only allowed between groups that belong to the same supergroup. There is no cross-supergroup sharing in this design, by design — the gastro team in St James's cannot consult on a Beaumont patient.
- The **legal boundary** that maps to the GDPR controller. The supergroup represents the hospital, which is the controller; Catalist is the processor. This makes the controller-processor relationship in your DPA clean.
- **Cryptographically irrelevant.** A supergroup does *not* have its own DEK. There is no super-key that unlocks all groups in the hospital. The supergroup is purely an authorization-layer concept.

A supergroup is *not*:

- A super-admin role with read access to everything in the hospital. Supergroup admins manage *which groups exist and which users belong to them*, not the contents of those groups. They can audit shares, but cannot read case content unless they're members of the relevant group.
- Created by users. Supergroups are provisioned by Catalist (you) when a hospital signs on. A user cannot self-promote into running a hospital.

### Schema

```
supergroups/{hospitalId}
  name                        e.g. "St James's Hospital"
  createdAt
  adminUids[]                 supergroup admins (manage groups & members)
  groupIds[]                  groups that belong to this hospital
  status                      'active' | 'suspended'

groups/{groupId}              (existing collection — additive change)
  ...existing fields
  supergroupId?: string       NEW. Null for legacy/unaffiliated groups.
```

### Rules implications

- A group can belong to **at most one** supergroup at a time. Moving a group between supergroups is an admin operation that has to revoke any active cross-group shares first.
- Legacy groups that haven't joined a supergroup keep working exactly as they do today. Sharing simply isn't available to them. This is the migration on-ramp.
- Supergroup membership for a group can only be set/unset by Catalist admins (i.e. via Cloud Function with elevated context), not by group members or even group owners. This prevents a malicious group owner from joining a hospital they're not part of.

---

## Part 3 — The encryption model: per-case content keys

This is the load-bearing decision. The design is **per-case content keys, wrapped per recipient group**.

### How it works

Each case has its own random **content key** (CK), generated at case creation. The content fields of the case (title, summary, notes, tasks, etc.) are encrypted with the CK using AES-256-GCM, exactly as Phase 5 already does — but with the CK in place of the group DEK.

The CK itself is then wrapped (encrypted) with one or more group DEKs and stored alongside the case as a **keyWraps** map:

```
keyWraps: {
  "groupId_medical":   { wrappedKey, version, wrappedAt },
  "groupId_gastro":    { wrappedKey, version, wrappedAt }
}
```

To read the case, a member of either group:

1. Authenticates and obtains their group's DEK (via the existing envelope flow).
2. Looks up the wrap for their group in `keyWraps`.
3. Unwraps to get the CK.
4. Decrypts the case content with the CK.

To share, a Cloud Function (see Part 7) reads both groups' wrapped DEKs, unwraps them via the KEK, decrypts the existing wrap to recover the CK, re-wraps the CK with the recipient's DEK, and writes the new entry into `keyWraps`. The case content itself is never re-encrypted — only the key is rewrapped.

To revoke, the wrap entry for the revoked group is removed from `keyWraps`. The rules layer denies new reads. (See Part 9 on the limits of revocation against cached content.)

### Why this and not the alternatives

Three options were considered:

- **(a) Per-supergroup DEK** — one key per hospital, all cases readable by anyone in the hospital. Throws away per-group isolation. A breach of any one group's KEK access compromises every patient in the hospital. Wrong direction.
- **(b) Re-wrap content on share** — keep cases encrypted under the source group's DEK; on share, decrypt all the content fields and re-encrypt them under the recipient group's DEK. Requires re-encrypting every field on every share, requires maintaining divergent ciphertext per recipient, and complicates rotation. The only way to make (b) cheap is to give the recipient access to the source group's DEK — which is (a) in disguise.
- **(c) Per-case content keys, wrapped per recipient group** — the option chosen here. Standard pattern: it's how Signal does group conversations, how iCloud Keychain shares passwords, how Matrix does Megolm. One-time schema change to the case document. Sharing is one wrap operation, not a re-encryption. Revocation is one wrap deletion.

The cost of (c) is a one-time migration: every existing case needs its content lifted out from being directly DEK-encrypted into being CK-encrypted, with the CK wrapped under its owning group's DEK. Once that's done, the steady state is no more expensive than today, just with an indirection.

### Wrap targets: groups, not individual users, not shared accounts

The wraps in `keyWraps` are keyed by **group ID**, not user ID and not a shared service-account ID. This is a deliberate scoping choice for v1.

When you share a case with the gastro team, you wrap the CK with the gastro group's DEK; *any* member of the gastro group can then unwrap and read. The audit log records *which specific clinician opened the case*, but the cryptographic access is at the team level.

This matches clinical reality. The gastro consult is a service with a rota — the reg today is the covering reg tomorrow. Per-individual sharing would mean re-issuing wraps every shift, and would require a per-user public-key infrastructure (each user with a keypair, public keys published, recipient encrypts to specific user's public key). That's a Phase 9+ feature, not v1.

If individual-level sharing ever becomes necessary (e.g. sharing a sensitive case with a specific consultant outside their normal team), that's an additive layer on top of this design — add per-user wraps alongside per-group wraps in the same map. The schema doesn't preclude it.

#### Why not a shared "consults account"

An alternative considered: instead of wrapping to a group, wrap to a **shared service account** (a single account, e.g. "Gastro Consults," that multiple individuals can sign into and use to read shared cases). On the surface this looks attractive — it makes the consult inbox feel like a discrete thing the user *enters*, separate from their personal work.

This is rejected because:

- **Shared credentials are anathema in clinical IT.** HIQA, the DPC, and standard hospital information governance all require that every clinical action be attributable to a named individual. A shared password creates plausible deniability ("wasn't me, must have been one of the others"). It's the first thing a hospital procurement officer or DPO will refuse, and it reintroduces — in miniature — the exact problem the rebuild plan is fixing about the legacy passphrase.
- **The cryptography would be identical anyway.** Wrapping to a service account or to a group is the same operation — both wrap to one DEK that multiple humans can unwrap. The difference is purely the auth model on top, and the auth model on top is worse with shared credentials.
- **The experience the shared-account idea is reaching for is achievable without it.** See "Role groups" below — a clinician steps into a role context while remaining authenticated as themselves, gaining the consult permissions for the session and being audited as themselves throughout.

This rejection is specifically of *shared credentials*, not of the *experience* of entering a different work context. The role-group model below preserves that experience.

#### Team groups vs role groups

The single share-target abstraction is too blunt: a clinician's home team is not the same kind of entity as a consult-receiving inbox, and the membership of a consult inbox is not the same as the membership of a clinical service. This design therefore distinguishes two kinds of group, both backed by the same Firestore structure:

- A **team group** is the workspace where a clinician does their primary work — the medical team, a surgical team, ICU. A user is a member because they're on the rota for that team. Cases are created here. Most users live in their team groups all day.
- A **role group** is a small, controlled-membership entity that holds a *clinical role* within a service — e.g. "Gastro Consult Reg," "ICU Liaison Reg," "Microbiology Advice." Membership is *only* the clinicians currently holding that role (typically 1–4 people) — **not** the whole specialty's staff. Interns, SHOs, attached CNSs, and consultants who aren't on consult cover are *not* members of the consult-reg role group. When the rota turns over, the service admin updates the role group's membership: outgoing role-holders lose access, incoming ones gain it.

A `kind` field on the group document distinguishes the two: `'team'` or `'role'`. A role group additionally carries a `serviceName` field (e.g. `"Gastro"`) for UI grouping — the consult-target picker can show *"Gastro: Consult Reg, ICU Liaison, Outpatient Lead"* organised by service, even though each role is its own group.

##### "Stepping into" a role group

The UX intentionally treats role groups differently from team groups:

- **Separate surface.** A clinician's home view shows their team groups. Role groups they belong to surface in a separate "Consult cover" area, not the main group switcher. The intent is that you *opt into* a role context, you don't live in it.
- **Stepping in is a deliberate action.** Entering a role group can be configured to require step-up re-auth (PIN re-prompt, or full 2FA for sensitive services). The header changes colour or carries a "Acting as Gastro Consult Reg" banner so the context is unambiguous.
- **Audit tags every action with the role context.** Events while in a role group are recorded as `{ uid: <user>, actingAs: 'role:<roleGroupId>', action: ..., target: ... }`. The audit query *"who has read this patient?"* returns answers like *"Frank O'Neill, acting as Gastro Consult Reg, at 14:05."* The individual is always named; the role is always named.
- **Stepping out is explicit too.** Closing the role-group view returns the user to their team-group home. Idle timeout in a role-group view can be shorter than in a team-group view if desired.

This captures the experience the original "consults account" idea was reaching for — *"I'm now wearing my gastro hat"* — without ever using a shared credential. The clinician is always logged in as themselves; what changes is the *role context* their session is operating in.

##### Why this matters cryptographically: nothing changes

Role groups are structurally regular groups. They have their own DEK, wrapped under the KEK like any other group. Cases shared with a role group have a `keyWraps` entry for that role group's ID. Members of the role group unwrap the role's DEK using the same envelope mechanics as any other group. Sharing rules check `isGroupMember(roleGroupId)` exactly the same way they check team-group membership.

In other words: the team-vs-role distinction is a thin layer of UX, audit tagging, and admin-tooling on top of the existing primitives. The crypto model in Part 3 is unchanged.

### What this protects against and what it doesn't

This protects against:

- **Database-only breaches** of the source group's data. An attacker who exfiltrates Firestore but not KMS sees ciphertext for every case, including shared ones, with no way to recover any CK. Same property Phase 5 gave you, preserved through sharing.
- **Cross-group accidental access.** Without an explicit wrap entry for their group, a user can't decrypt a shared case even if rules let them read the document. (And rules don't let them read the document either — see Part 6.)
- **Cross-supergroup leakage.** The Cloud Function refuses to write a wrap if source and destination groups aren't in the same supergroup.

It does *not* protect against:

- **A revoked recipient with cached content.** Once a member of the recipient group has decrypted a case, they have the plaintext locally. Removing their wrap stops new reads but cannot recall a copy in their browser cache or screenshot. This is a fundamental limit of any sharing system, addressed below in Part 9.
- **A compromised KEK.** Same as today — the KEK is the root of trust. Phase 5+ moves it to KMS; until then, all the same caveats apply.

---

## Part 4 — The case document, after this change

```
groups/{groupId}/cases/{caseId}
  // existing fields
  authorUid, createdAt, caseTags, dischargedAt, ...

  // existing encrypted fields, but encrypted with CK now (not group DEK)
  titleCipher, titleIv               (Iv [1] = envelope, but key is CK)
  summaryCipher, summaryIv

  // NEW
  ownerGroupId: string               canonical home group; only this group's
                                     members can write to the case body, tasks,
                                     and notes
  keyWraps: {                        map of groupId → wrap of CK
    [groupId]: {
      wrappedKey: string             base64
      wrapVersion: 1
      wrappedAt: timestamp
      wrappedByUid: string           who initiated this wrap
    }
  }
  shareState: {                      denormalised for rules & UI
    sharedWithGroupIds: string[]     keys(keyWraps) minus ownerGroupId
    activeConsults: [                open consult requests
      {
        toGroupId, byUid, question, openedAt, status
      }
    ]
  }
```

Subcollections (`tasks`, `notes`, `wardNotes`) inherit the same encryption — every doc encrypted with the case's CK, readable by any group with a wrap.

A new subcollection `consultResponses/{responseId}` lets shared-with groups append responses without writing to the case body. See Part 5.

---

## Part 5 — What "shared" means in practice

The recipient of a share gets:

- **Read** access to the case document, its title, its summary, and its existing tasks, notes, ward notes, and consult responses.
- **Append** access to a single subcollection: `consultResponses/`. They can write a structured response with their assessment, plan, and follow-up. They cannot edit responses written by other groups (including their own past ones).

The recipient does *not* get:

- Write access to the case body itself.
- Write access to tasks, notes, or ward notes (those belong to the owning team).
- The ability to share the case onward to a third group. Re-sharing is a per-design refusal — if a third team needs the case, the originating team adds them.
- The ability to add new members to their own group and have those members automatically see the case. (They do, in fact — the wrap is at the group level. But this is a property of group-level wrapping, not a design feature.)

The asymmetry — the original team owns the case, the consultee can read and respond — matches how clinical consults actually work. The medical team is the patient's primary team; gastro is offering an opinion, not taking over the chart.

### The consult lifecycle

1. **Open.** Clinician on the owning team taps "Request consult," picks a service from their hospital's services, writes a question. A `consult` is created on the case (`shareState.activeConsults`), and a wrap is added to `keyWraps` for the recipient group.
2. **Visible.** The recipient group sees the case in a "Pending consults" inbox — a filtered view of cases where their group has a wrap and `shareState.activeConsults` has an open entry for them.
3. **Respond.** Recipient writes a `consultResponse` with their assessment and plan. The consult's status moves to `responded`.
4. **Acknowledge.** Owning team sees the response, can ask follow-up questions (which appends another consult question), or close the consult.
5. **Close.** Either side can close. Closing removes the recipient's wrap from `keyWraps` (revoking access), and the consult moves to a closed-consults archive on the case.
6. **Auto-close on discharge.** When a case is discharged, all active consults auto-close.

### What happens to the response after close

Once closed, the recipient group loses read access. The consult response itself remains visible to the owning team (it's part of the case record). This is the intended behaviour — the response is part of the patient's care record from the owning team's perspective; the consultee's job ended at "respond."

If the consultee needs to refer back to a past response (for their own audit purposes), they can request the case be re-shared. This is a deliberate friction: it keeps shared-read access tied to active clinical need rather than indefinite history.

---

## Part 6 — Firestore rules

The current rule for cases is:

```
match /groups/{groupId}/cases/{caseId} {
  allow read, write: if isGroupMember(groupId);
}
```

After this change:

```
match /groups/{groupId}/cases/{caseId} {
  // Reads: members of any group in keyWraps can read.
  allow read: if isGroupMember(groupId)
              || hasShareWrap(resource.data, request.auth.uid);

  // Writes to the case body: only owning group, and only if the share
  // shape is unchanged (sharing is done via Cloud Function, not direct).
  allow update: if isGroupMember(resource.data.ownerGroupId)
                && shareStructureUnchanged()
                && encryptionStructureUnchanged();

  allow create: if isGroupMember(groupId)
                && request.resource.data.ownerGroupId == groupId
                && hasOwnGroupWrap(request.resource.data, groupId);

  allow delete: if isGroupOwner(resource.data.ownerGroupId);
}

match /groups/{groupId}/cases/{caseId}/{sub}/{docId} {
  // Tasks, notes, wardNotes: writes restricted to owning group.
  allow read: if /* same read predicate as above */;
  allow write: if isGroupMember(get(/databases/$(database)/documents/groups/$(groupId)/cases/$(caseId)).data.ownerGroupId);
}

match /groups/{groupId}/cases/{caseId}/consultResponses/{responseId} {
  // Consult responses: any group with an active consult wrap can append.
  allow read: if /* same read predicate */;
  allow create: if hasActiveConsult(/* this group, this case */);
}
```

Helpers:

```
function hasShareWrap(caseData, uid) {
  // Iterate keyWraps map keys; return true if the user is a member of any
  // group whose ID appears as a key.
  return caseData.keyWraps.keys().hasAny(getUserGroupIds(uid));
}

function shareStructureUnchanged() {
  return request.resource.data.keyWraps == resource.data.keyWraps
      && request.resource.data.shareState == resource.data.shareState;
}

function encryptionStructureUnchanged() {
  // Once set, ownerGroupId never changes via client write; only Cloud
  // Function can change it (which it shouldn't — that's a re-home, not a share).
  return request.resource.data.ownerGroupId == resource.data.ownerGroupId;
}
```

The fundamental rule pattern is: **"members of any group in `keyWraps` can read; only the owning group can write the case body; only Cloud Functions can modify `keyWraps`."**

The "only Cloud Functions can modify keyWraps" property is enforced by `shareStructureUnchanged()` blocking any client write that touches the share fields. Cloud Functions bypass rules by virtue of running with admin credentials, so they're the only way a `keyWraps` entry gets added or removed.

---

## Part 7 — The share Cloud Function

Sharing must run server-side. The reason is mechanical: wrapping a CK for group B requires access to group B's DEK, which a client logged into group A does not (and should not) have. The function is the only place with the elevated context to read both groups' wrapped DEKs and the KEK to unwrap them.

### What the function does

```
shareCase({ caseId, ownerGroupId, recipientGroupId, consultQuestion })
  authenticate caller; require caller is member of ownerGroupId
  load case; verify ownerGroupId matches case's ownerGroupId
  load source group; load recipient group
  verify both groups exist, are active, and share the same non-null supergroupId
  verify recipient group has a wrappedDek (i.e. is on the new system)
  verify caller is not already in recipientGroupId (no self-share)
  verify case isn't already shared with recipientGroupId
  unwrap source group's DEK using KEK
  unwrap case's CK using source DEK
  unwrap recipient group's DEK using KEK
  re-wrap CK using recipient DEK → recipientWrappedKey
  in a transaction:
    add recipientWrappedKey to case.keyWraps
    push consult to case.shareState.activeConsults
    write audit event to source group, recipient group, and supergroup audit logs
  return success
```

Symmetrically, `revokeShare({ caseId, ownerGroupId, recipientGroupId })` removes the wrap and emits an audit event. `closeConsult` does the same plus archives the consult.

### Why this is a hard prerequisite on Phase 5+/Phase 7

This function needs:

- **KEK access** for unwrapping group DEKs. Currently the KEK is `VITE_FIELD_KEK_SEED`, embedded in the client. To run the wrap server-side, the function needs access to the KEK without the seed shipping in client JS. This effectively forces the KEK move to KMS that's already on the Phase 5 roadmap as the "production target."
- **Cloud Function infrastructure**. The repo has a `functions/` directory, but server-side enforcement is itself a Phase 7 concept. Sharing is the natural first server-side feature, ahead of the broader Phase 7 work.

So this design isn't fully shippable until Phase 5's KMS migration completes and a `functions/` deployment exists. See Part 10 for sequencing.

---

## Part 8 — Audit trail

Cross-group sharing makes the per-group audit log insufficient. A consult event is meaningful to three audiences: the source group, the recipient group, and the hospital (supergroup). The design writes to all three:

```
groups/{ownerGroupId}/audit/{eventId}
  action: 'consult_opened' | 'consult_responded' | 'consult_closed' |
          'shared_case_read' | 'consult_revoked'
  caseId, byUid, atGroupId, supergroupId
  actingAs: 'role:<roleGroupId>' | 'team:<teamGroupId>'   // role context
  recipientGroupId (for share/revoke events)
  timestamp

groups/{recipientGroupId}/audit/{eventId}
  action: 'consult_received' | 'consult_response_written' | 'shared_case_read' | ...
  byUid, actingAs                                         // always the individual + role
  /* mirror */

supergroups/{supergroupId}/audit/{eventId}
  /* hospital-wide audit; queryable by supergroup admins */
```

The `actingAs` field captures the context the user was in when the action happened. A read by Frank from his medical team's view records `actingAs: 'team:medA'`; the same Frank reading the same case while stepped into the gastro consult reg role records `actingAs: 'role:gastroConsultReg'`. Audit queries can answer *"what has Frank done as a consult reg this month?"* directly, without inferring context from session state.

Triple-writing is fine — Firestore writes in a Cloud Function are cheap, the audit volume is low (one per consult event), and the redundancy makes the query side simple: "who in the gastro team has read this case?" lives entirely in the gastro group's audit log; "what consults has this hospital handled this month?" lives in the supergroup audit.

The supergroup audit log gives a DPO a single place to answer the GDPR question: *"show me everyone who has accessed this patient's record."* Without the supergroup-level log, that query has to fan out across every group that ever held a wrap, which is fragile and slow.

### Read-event logging granularity

Logging every read of a shared case is verbose but correct — it's the granularity a hospital DPO will actually want. To keep volume manageable:

- Log the *first read* per user per case per session (not every individual GET).
- Aggregate at write-time using a "session-scoped" read marker on the user's device.
- Periodic flush (every 15 min, or on session end) writes the consolidated read events.

This is consistent with how clinical EHRs typically log reads.

---

## Part 9 — Revocation and its limits

Removing a wrap from `keyWraps`:

- **Stops new reads.** The Firestore rules deny GETs from members of the unwrapped group from that point on.
- **Does not** invalidate copies the recipient has already decrypted and cached locally (in browser memory, in IndexedDB if you've enabled offline, in a screenshot, in their head).

This is the standard limit of any sharing system that doesn't include a forced re-encryption on revoke. **In v1, we accept this limit.** Revoking is a soft "no more access from this point" — sufficient for the everyday consult-close case, where the gastro reg saw the patient an hour ago and we just don't want them seeing tomorrow's progress.

For *hard* revocation — true cryptographic crypto-shredding of all past content for a removed group — the operation would be:

1. Generate a new CK.
2. Decrypt every encrypted field with the old CK; re-encrypt with the new CK.
3. Wrap the new CK with the remaining groups' DEKs.
4. Replace the case's `keyWraps` entirely.

This is expensive (proportional to the case size) and rare (only on adversarial revoke, not on normal consult close). It can be added later as an explicit `hardRevoke` operation. It is not in v1.

A worth-flagging gotcha: if you implement offline support (Phase 9), the revoke story gets weaker still — a recipient could have a full encrypted-and-key-wrapped offline copy that survives revocation indefinitely. Worth holding the offline feature off until the revoke model is decided.

---

## Part 10 — How this fits the phased plan

This design adds work to the existing rebuild plan. It does not replace any phase. The rough mapping:

- **Pre-requisites** — the existing plan's Phase 1 (identity), Phase 2 (groups), Phase 3 (migration), Phase 4 (rules + decommission). All must be complete first; cross-group sharing assumes a working membership-based system.
- **Soft prerequisite — KMS migration.** The share Cloud Function needs KEK access without the seed being in client JS. This is the Phase 5 production target, currently noted as "not yet built." It needs to be done before sharing can ship.
- **Sharing slots in as roughly Phase 6.5** — between observability (Phase 6) and broad server-side enforcement (Phase 7). It depends on the audit infrastructure from Phase 6 to land its events in the right place, and it builds early Cloud Functions that Phase 7 will then expand on.

### A possible ordering

1. **Phase 6.5a — Supergroup primitive.** Schema, rules, no sharing yet. Provision a supergroup for testing. Add `supergroupId` to existing groups (still null for legacy). ~1 week.
2. **Phase 6.5b — Per-case content keys.** Migrate existing cases from group-DEK encryption to per-case CK encryption with one wrap (the owning group). No sharing yet — this is just changing the encryption shape. Has to be rehearsed in staging before production, like Phase 3 was. ~2 weeks including rehearsal.
3. **Phase 6.5c — Share Cloud Function and consult UI.** Function for share/revoke/close. UI for "Request consult" action. Pending-consults inbox. Consult response form. ~3 weeks.
4. **Phase 6.5d — Cross-group audit and DPO views.** Triple-write audit. Supergroup admin view of cross-group access. ~1 week.

Total: ~7 weeks of focused work, plus rehearsal time and a maintenance window for step 2.

This sits well after Phase 5 (KMS) and Phase 6 (audit/observability). Doing it before Phase 5 means the Cloud Function shares the same client-side seed as the rest of the system, which works but doesn't really earn the "server-side wrapping" property — the wrap could equally happen client-side. It would still be worth doing, but the security story is muddier.

---

## Part 11 — What we're explicitly not doing

- **No per-individual user wraps.** v1 wraps to groups only. Per-user public-key sharing is a Phase 9+ feature.
- **No shared service accounts.** Considered and rejected (see Part 3). Multiple-clinician access to a consult inbox is achieved via *role groups* with per-individual membership and a "step into a role" UX, not via shared credentials. Every action remains attributable to a named individual, with the role context captured alongside it, which is non-negotiable for clinical IT.
- **No supergroup superadmin with read access to content.** Supergroup admins manage groups and audit logs, not data. There is no break-glass key.
- **No re-sharing.** A group that has been shared a case cannot share it onward to a third group. The originating team is the only sharer.
- **No write access for shared groups beyond consult responses.** Shared groups read the case and append structured responses. They do not edit the case body, tasks, or notes.
- **No hard cryptographic revocation in v1.** Removing a wrap stops new reads; it does not invalidate already-cached copies. Hard revoke is a future operation.
- **No cross-supergroup sharing.** A case never crosses hospital boundaries via the share mechanism. Inter-hospital referrals, if they ever exist in Catalist, are a separate feature with separate rules.
- **No automatic sharing rules** (e.g. "always share my surgical cases with anaesthesia"). Every share is an explicit clinician action.
- **No offline access for shared cases** until the revoke model is decided. Tied to Phase 9's offline support discussion.

---

## Part 12 — Open decisions

To lock in before Phase 6.5a starts:

1. **Who creates and manages role groups?** Role groups have to be created and their memberships maintained as rotas turn over. Two viable models:
   - **Service-admin-driven.** Each clinical service has one or more designated admins (the gastro service admin, the ICU service admin) who create the service's role groups, set their consult-receiving status, and update membership when the rota changes. Recommendation: this for v1. Catalist provisions the supergroup; supergroup admins create service-level admin assignments; service admins manage their own role groups.
   - **Rota-integrated.** Role-group membership is driven automatically from a hospital rota system. Cleaner in theory but requires an integration that doesn't exist; deferred to Phase 9+.
2. **Step-up re-auth on entering a role group.** Always required, configurable per role group, or never? Recommendation: **configurable per role group**, with a sensible default of "PIN re-prompt on entry" for any role group that receives consults.
2. **Read-event logging cadence.** Log every read, log first-read-per-session, log first-read-per-day? Recommendation: **first-read-per-user-per-case-per-session**, flushed periodically.
3. **Consult response visibility.** When a consult is closed, does the recipient retain the ability to see the response they wrote (for their own audit purposes)? Recommendation: **no by default; recipient can request re-share if they need to revisit.** This is friction by design.
4. **Discharge-driven auto-close.** On case discharge, do we auto-close all active consults? Recommendation: **yes, with a 7-day grace period during which the consultee retains read-only access for follow-up notes.**
5. **Supergroup provisioning.** How do hospitals get provisioned? Recommendation: **manual by Catalist admin** (via Cloud Function with bootstrap credentials) until Phase 9, then potentially self-service for SSO-integrated hospitals.
6. **Hard-revoke trigger.** Is there ever an automatic hard revoke (e.g. on member-removed-for-cause)? Recommendation: **no automatic hard revoke in v1; it's a manual admin operation.**

---

## Closing

The design is conservative. It picks the standard cryptographic primitive (per-conversation keys), it bounds sharing within a hospital boundary that maps to your legal model, it routes writes through a Cloud Function so the security-sensitive operation isn't dependent on client behaviour, and it accepts the soft-revoke limit instead of overengineering hard revoke for v1.

It also deliberately constrains the feature surface. No re-sharing, no per-user wraps, no break-glass admin, no automatic shares. Each of these is worth not doing because each one weakens a property a DPO would want defended. They can be added later if real demand justifies them.

The hardest part isn't the cryptography — that's well-understood. The hardest part is the migration of existing case content from group-DEK encryption to per-case CK encryption. That's a Phase-3-shaped operation: irreversible, requires rehearsal, requires a maintenance window. The rest is incremental.
