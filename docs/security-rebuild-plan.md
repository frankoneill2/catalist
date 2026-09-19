# Catalist: Security and Architecture Rebuild Plan

## How to read this document

This is the plan we've reached after working through Catalist's security and architecture together. It covers:

- What's wrong with the current setup
- The strategic choices we considered
- The choice we've made and why
- The full phased plan to get there
- The supporting work that has to happen alongside
- What we're consciously deciding *not* to do

It's written so you can read it cold, six months from now, without remembering the conversation that produced it. Technical concepts get introduced as needed — you don't have to bring vocabulary in.

---

## Part 1 — How the current system works (and what's wrong with it)

### The current login flow, in plain language

When someone opens Catalist today, the app asks for a single passphrase. Whatever they type is fed into a mathematical process called **PBKDF2** (Password-Based Key Derivation Function) that produces a fixed-size scrambling key. That key is then used to scramble (and unscramble) every piece of patient data the app reads or writes — case titles, task descriptions, notes, comments.

This scrambling is called **encryption**. Encrypted data looks like random bytes; you need the correct key to turn it back into readable text.

The data itself lives in a Google service called **Firestore** — a database hosted in the cloud. Firestore stores the encrypted bytes; it never sees the unencrypted version, and it never sees the passphrase. This is genuinely useful: it means Google can't read your patient data even though Google is hosting it.

Once past the passphrase prompt, the user picks their name from a dropdown of all known users. That name gets attached to anything they create — tasks, comments, notes — so others can see who did what.

### The three things that are wrong

**Problem one: the passphrase is the key.** The string you type isn't a password in the normal sense. A normal password is checked against a record on a server: "is this string the right one for this account?" The Catalist passphrase isn't checked against anything. It's just turned into a key and used. Any string produces a valid key — the only question is whether that key can decrypt the existing data.

This is why typing the wrong passphrase doesn't show an error. The app dutifully derives a key from whatever you typed, tries to decrypt, and the decryption silently fails. The interface treats the failed decryptions as empty values, so you see an empty list. There's no "wrong password" message because the app has no concept of "wrong" — only "didn't decrypt to anything."

**Problem two: there's no real concept of identity.** When the user picks their name from the dropdown, the app trusts the choice without verification. There's no proof that the person clicking "Frank" actually is Frank. Any user can pick any name and write under it. For an app meant to provide a clinical audit trail, this is a serious gap.

**Problem three: everything is one shared room.** Anyone who knows the passphrase can read and modify everything. There's no concept of separate teams, wards, or hospitals — it's one shared collection of cases. Adding a new person means giving them the key, which gives them everything; removing them is impossible without changing the key, which would lock everyone else out too.

These three problems are connected. Fixing them requires building real **authentication** (proving who someone is) and real **authorisation** (controlling what they're allowed to see), neither of which the app currently has.

---

## Part 2 — The strategic choice we made

### Two genuine alternatives

Two architecturally different paths could fix the three problems above. They look similar on the surface — users log in with username and password, see the groups they're in, do their work — but underneath they make different trade-offs about who can read patient data.

**Path A — Server-side encryption.** Patient data is encrypted in transit (between browser and server) and at rest (in the database), but the encryption keys are managed by the server. The server can decrypt content when authorised users request it. Access is controlled by the authentication system: only users who are members of a group can read its data. This is how nearly every clinical SaaS works — Epic, Cerner, Meditech, and the major hospital EHRs in Ireland and elsewhere, and also Slack, Notion, every banking app.

**Path B — End-to-end encryption (E2EE).** Each user has their own personal key derived from their password. Data is encrypted with a key only group members hold. The server never sees the keys, never sees the unencrypted data, can't decrypt anything. This is how Signal, WhatsApp, Proton Drive, and Tresorit work.

### Why Path B sounds appealing but doesn't fit Catalist

E2EE has a real virtue: even Google, even you-the-developer, even a court order to Google, can't reveal patient content. That's a strong property for sensitive data.

But it comes with consequences that don't sit well with Catalist's goals:

- **Forgotten passwords are destructive.** A user's data is mathematically lost to them; only another group member can re-grant access through a complex re-onboarding process. There's no "reset password" email link.
- **Adding a new member requires an existing member to be online.** The new member can't be granted access by the server alone — an existing member has to perform a cryptographic ceremony to wrap the group's key for them.
- **Removing a member properly requires re-encrypting all the group's data.** Anything less leaves the ex-member able to read whatever they previously had.
- **You can't run cross-group analytics on content.** This is the dealbreaker. You've said you want to do hospital-wide analysis later — patterns of conditions, workload across wards, audit of clinical practice. E2EE makes content-level analytics impossible by definition.
- **The browser is a weak place to do E2EE.** Encryption code is delivered as JavaScript by your server, so anyone who can replace your JavaScript can defeat the encryption. WhatsApp Web has the same problem.

### Why we're choosing Path A

The deciding factor is the analytics goal. An app that builds E2EE only to compromise it later for analytics is in the worst position — it has paid the engineering cost of E2EE, lost the security property, and made misleading claims. Better to be honest from the start about what you're protecting.

Path A, done properly, is genuinely strong against the attackers that actually exist:

- **Random web visitors** — defeated by authentication.
- **Other authenticated users from different groups** — defeated by access rules enforced by Google's infrastructure on every read and write.
- **Phishing of a user account** — limited to that user's groups; mitigated by 2FA and audit logs.
- **Lost or stolen devices** — mitigated by session timeouts and remote logout.
- **Network attackers** — defeated by TLS encryption in transit.
- **Database breaches** — mitigated by encryption at rest plus an additional encryption layer described later (envelope encryption).
- **Quantum adversaries harvesting today's data for later** — Google's at-rest encryption uses AES-256, which is quantum-resistant.

What Path A does *not* defend against:

- Google internal staff with admin access (mitigated by Google's own internal controls and audit, but not cryptographically prevented).
- Compelled disclosure to a government via a court order to Google.
- You-the-developer going rogue or being coerced.

These are the trade-offs, made consciously. They're the same ones every other clinical SaaS makes.

### The honest framing

You're not picking the "lesser secure" option. You're picking the option whose security model matches your actual goals and whose claims you can defend in plain language. *"Encrypted in transit, encrypted at rest, access-controlled per group, audited"* is true and provable. *"End-to-end encrypted"* with a back door for analytics is a marketing claim that ends careers.

---

## Part 3 — The GDPR landscape

### What GDPR actually requires

GDPR is often discussed as if it were a single rule, but it's a framework. The pieces that matter for Catalist:

**Lawful basis.** You need a legal reason to process personal data. For health data — which GDPR calls *special category data* and protects more strictly — you need a basis under Article 9. The relevant one is **Article 9(2)(h)**: provision of healthcare or treatment, by a professional bound by professional secrecy. This basis means patients don't need to click a consent box for their care record to exist; their hospital's privacy notice covers that.

For your **users** (the clinicians), you need consent at signup to your terms and privacy policy — standard app consent.

**Lead supervisory authority.** Because the company is established in Ireland, the **Data Protection Commission (DPC)** is the lead supervisory authority for GDPR matters. The DPC handles complaints, investigations, and breach notifications. Under GDPR's one-stop-shop mechanism, the DPC remains the lead authority for users elsewhere in the EU, though local DPAs can be involved for issues affecting their residents.

**Controller vs processor.** The *controller* is the legal entity responsible for the data. The *processor* acts on the controller's instructions. For an HSE hospital or voluntary hospital using Catalist, the hospital is the controller of patient data; you are the processor. This requires a **Data Processing Agreement (DPA)** between you and each hospital.

In Catalist's current state — informal use by individual clinicians without hospital sanction — the lines are murkier. You may effectively be the controller, which carries more legal exposure. Resolving this is part of the path to legitimate hospital adoption.

**Data residency.** Personal data of EU residents should be stored in the EU or under approved transfer mechanisms. Firebase data in the `eur3` region (Belgium and Netherlands) satisfies this. Worth confirming Firebase Auth is also configured for EU residency — it has been an option since 2023 but isn't the default.

**DPA with Google.** Google's Data Processing Addendum is automatically incorporated into Cloud Terms when you accept them at project creation. You already have it. Action: download a dated PDF copy for your records.

**DPIA — Data Protection Impact Assessment.** A formal document required for high-risk processing (health data qualifies). The DPC publishes guidance and a template. It documents what data you process, why, what the risks are, how you mitigate them. Roughly 2–4 days of focused work for an app this size. *Not optional.* Failing to do one when required is itself a violation. A good DPIA is your strongest defence document if anything ever goes wrong.

**HIQA standards.** The Health Information and Quality Authority publishes the National Standards for Information Management in Health and Social Care, which are the relevant clinical-IT standards in Ireland (rough equivalent of the NHS DSP Toolkit). Worth a read once you're approaching a hospital pilot.

**Rights of data subjects.** Right to access, rectification, erasure, portability. Most are straightforward in a server-side encryption model. Right to erasure: when you "delete" data, you delete the encrypted blob from the database; backups age out per your retention policy. The technique is called **crypto-shredding** if you destroy encryption keys to make encrypted backups irrecoverable.

**Breach notification.** You must notify the DPC within 72 hours of becoming aware of a personal data breach. Have a documented runbook ready before you need it.

### The paperwork side, in summary

Before any code is written for the new system:

- DPIA written and filed
- Privacy policy and T&Cs drafted
- Sub-processor list (Google, anyone else)
- Breach response runbook
- Decision on legal structure — sole trader vs limited company (incorporating limits personal liability and is strongly advisable before going live publicly)
- Professional indemnity insurance once real users exist

This is a few days of work plus modest ongoing costs. It's also what a hospital procurement team will ask to see — without it, the conversation doesn't start.

---

## Part 4 — What we're building toward

### The target mental model

In its finished state:

- A clinician opens Catalist for the first time on a device and signs in with their **email and password** plus a second factor (a passkey or a code from an authenticator app). They set a **4-digit PIN** for fast resume, or opt into biometric (FaceID / TouchID) if they prefer. If they don't have an account, they need an invite from someone who already does.
- On subsequent opens — the everyday case — they enter their PIN (or use biometric) and they're in. No password, no 2FA codes. After 30 days of inactivity, after a device restart, on a new device, or on anything anomalous, they sign in fresh with the full ceremony. Sensitive operations like removing a member, deleting cases, or viewing the audit log re-prompt for full authentication.
- Once logged in, they see a list of the **groups** they belong to. A group is a workspace — a ward, a unit, a team — and contains its own set of patient cases.
- They pick a group (or it auto-opens if they're only in one) and see the familiar Catalist interface: patient cases, tasks, notes, ward notes.
- Everything they create is tagged with their **user identity** — a stable internal ID that links to their displayed name. Renaming themselves doesn't break the audit trail.
- An **admin** of each group can invite new members, remove members, and see an audit log of who accessed and changed what.
- All data is encrypted in transit (TLS), encrypted at rest (Google's automatic encryption plus your own additional encryption layer for the most sensitive fields), and access is controlled by rules enforced by Google's infrastructure on every read and write.

### The new data structure

Today's structure is roughly:

```
cases/                      ← shared by everyone with the passphrase
  {caseId}/
    tasks/
    notes/
    wardNotes/
users/                      ← list of names
```

The new structure is:

```
users/{uid}                 ← one document per real account
  email, displayName, publicProfile, createdAt

groups/{groupId}            ← workspaces
  name, ownerUid, memberUids[], adminUids[]
  members/{uid}             ← per-member metadata (joined date, role)

  cases/{caseId}            ← cases now nest under groups
    tasks/
    notes/
    wardNotes/

audit/{eventId}             ← append-only audit log
  uid, action, target, timestamp
```

The key structural change is that **cases nest under groups**. This is what makes membership-based access control enforceable — a security rule can say "you can read this case if you're a member of its parent group."

---

## Part 5 — The phased plan

The plan is broken into phases. Each phase is shippable on its own — at the end of every phase, the app still works, you've added something, and you can stop and resume later if life intervenes. Phases are ordered so that earlier ones unblock later ones, and so that risky steps come after safer rehearsals.

### Phase 0 — Foundations

**What:** All the non-code work that has to happen before building.

**Why first:** Some of these (data residency, hosting choice) are hard to change later. Some (DPIA, privacy policy) are required before you can legitimately handle real patient data. None are urgent in the day-to-day sense, which is why they tend to get skipped — and why apps end up in trouble.

**Concrete steps:**

- New Firebase project provisioned in `eur3`, with Firebase Auth configured for EU residency.
- DPIA written, using the DPC template / guidance.
- Privacy policy and T&Cs drafted.
- Sub-processor register started.
- Breach response runbook drafted.
- Decide on legal structure; if going limited, set it up.
- Decide on a real domain (e.g. `catalist.app`) and hosting that can serve it (Cloud Run, Vercel, or Netlify — moving off GitHub Pages).
- Set up a separate **dev** Firebase project as a staging environment.
- Wire up **Sentry** (or equivalent) for error tracking from the start.
- Lock in answers to the seven open decisions listed at the end of this document.

**Roughly:** a week of work, mostly writing and admin.

### Phase 1 — Identity layer

**What:** Real user accounts with a layered authentication model: full ceremony at risk moments, fast PIN-based resume the rest of the time. No groups yet, no encryption changes.

**Why second:** Every later phase depends on real users existing. You can't build group membership rules without users to put in groups; you can't audit-log "who did what" without knowing who. The layered auth model (rather than "2FA every time") is what makes the app actually usable for clinicians during ward rounds — without it, adoption dies.

#### The layered authentication model

The system distinguishes between **initial authentication** (full ceremony, required at risk moments) and **session resume** (fast, frictionless, for the 99% of opens that aren't risk moments).

- **Initial authentication** — email + password + 2FA — happens on: first sign-in on a device, after 30 days of inactivity, after a device restart, on a new IP country or other anomaly, when a user changes their password.
- **Session resume** — 4-digit PIN by default, with biometric (FaceID / TouchID / Android equivalent) as an opt-in alternative — happens on every app open within an active session, including after a short idle timeout.
- **Step-up re-auth** — re-prompt for password or 2FA — happens on: removing a member, deleting cases, exporting data, viewing the audit log, changing security settings.

#### Why PIN as default rather than biometric

A 4-digit PIN is the standard for clinical apps (Siilo and most clinical messaging / handover tools) because:

- It works with wet hands, gloves, and masks.
- It works on devices without biometric (older phones, locked-down hospital MDM policies).
- It's discreet in front of patients.
- It sidesteps any conversation about biometric data with hospital information governance, even though the OS-level biometric model doesn't actually involve the server seeing biometric data.

A 4-digit PIN's nominal weakness (10,000 combinations) is mitigated by rate limiting: 5 wrong attempts → short delay; 10 wrong → full re-auth required, PIN reset. The PIN never leaves the device. The actual cryptographic credential being unlocked is full-strength.

Biometric stays available as an opt-in for users who want zero-friction resume.

#### 2FA factor: passkeys preferred, TOTP as fallback

For the initial-authentication step, **passkeys** (WebAuthn) should be the primary 2FA factor where supported. They're better UX (one biometric tap, no codes to type) and stronger security (phishing-resistant, no shared secret stored on the server). TOTP via an authenticator app stays as fallback for users on browsers or devices that don't support passkeys.

#### Concrete steps

- Sign-up flow: email, password, displayed name, accept T&Cs.
- Mandatory email verification before the account can do anything.
- Initial sign-in: email + password + 2FA (passkey enrollment, or TOTP fallback).
- PIN setup at first sign-in on each device. Biometric offered as opt-in alternative.
- Resume flow: PIN (or biometric) on app open within an active session.
- Step-up re-auth on sensitive operations.
- Session management: 30-minute idle timeout, ~12-hour active session, 30-day refresh token. After the refresh token expires, full re-auth required.
- "Active sessions" page where users see all their logged-in devices and revoke any of them.
- "Shared device" toggle at sign-in that disables refresh-token persistence — useful for ward computers and shared tablets. Session ends on logout or short idle.
- Anomaly-based step-up: new IP country, return after >30 days, change in browser fingerprint → full re-auth.
- Account lockout after N failed password attempts.
- Audit log of authentication events (login, logout, 2FA challenge, password change, PIN reset).
- **Crucially:** this whole phase runs *alongside* the existing passphrase. New users get accounts but the app still uses the old shared passphrase for actual data. Nothing breaks.

**Roughly:** 3–4 weeks.

### Phase 2 — Groups and the data model shift

**What:** Introduce the concept of groups. Restructure the database so cases live under groups. Build a group switcher UI.

**Why third:** With users in place, you can now build groups around them. This phase is mostly model work — the access control rules come in Phase 4.

**Concrete steps:**

- Create the `groups` collection with the structure shown earlier.
- On migration, every existing user becomes a member of one default group ("Legacy data") so the app keeps working.
- Cases get a `groupId` field; UI reads from `groups/{gid}/cases/...` going forward.
- A group switcher appears in the UI, hidden if the user belongs to only one group.
- Basic group management: a group has an owner, a name, a creation date, a member list.

**Roughly:** 1–2 weeks.

### Phase 3 — Migrate existing data into the new structure

**What:** A one-time operation to move existing cases from the old `cases/` collection into `groups/{defaultGroup}/cases/`. Decrypt with the old passphrase, write the plaintext into the new location.

**Why fourth:** Until this happens, the new auth and group structure isn't actually protecting the real data — it's protecting an empty new collection while the real data sits in the old, weakly-protected location.

**Concrete steps:**

- Take a Firestore export to a separate Cloud Storage bucket as a backup.
- Schedule a maintenance window. Notify users.
- Run the migration: read every encrypted case, decrypt with the old passphrase, write the unencrypted (but still TLS-protected and Firestore at-rest-encrypted) version into the new location.
- Verify with item counts and spot checks.
- Switch the app to read from the new location.
- Keep the old `cases/` collection read-only for 30 days as a rollback option, then delete.

**Roughly:** 2–3 days of work, with a maintenance window of about an hour.

This is the one **irreversible** phase. The rehearsal in the staging environment is essential.

### Phase 4 — Tighten the rules and decommission the old passphrase

**What:** Replace the wide-open Firestore rules with membership-based ones, and remove the old passphrase prompt and shared encryption.

**Why fifth:** Now that data lives under groups and users have real accounts, you can write rules like *"you can read this case only if you're a member of the parent group."* Without the previous phases, this rule has nothing to check against.

**Concrete steps:**

- Write Firestore rules that enforce membership checks on every read and write.
- Write tests for those rules — every rule gets a "this should be allowed" and "this should be denied" test running against the Firestore emulator.
- Remove the passphrase prompt from app startup.
- Remove the shared encryption code (`deriveKey`, `encryptText`, `decryptText`, `safeDecryptText`).
- Replace the user dropdown with the logged-in user's identity — picking a different name is no longer possible.
- Replace plaintext `username` fields on tasks, notes, and comments with stable `authorUid` references; the UI looks up display names from the `users` collection at render time.

**Roughly:** 1–2 weeks.

After this phase, the new system *is* the system. The transition is complete.

### Phase 5 — Application-level envelope encryption

**What:** Add an additional layer of encryption for the most sensitive fields (case titles, SOAP notes, ward notes), with the encryption key held in **Google Cloud KMS** (a separate key management service), not in Firestore.

**Why sixth:** Firestore's built-in at-rest encryption uses keys Google manages internally. If a Firestore-only breach happens (misconfigured backup, rules bug, a Google-side incident), data is exposed. With envelope encryption, the breach gives the attacker ciphertext, not content — they'd need to also breach KMS, which is a separately-secured system. This is the pattern serious cloud apps with sensitive data use, and it's what makes Path A meaningfully strong rather than just adequate.

**Concrete steps:**

- Set up a Cloud KMS keyring in the EU region.
- The application authenticates to KMS using a service account; KMS encrypts and decrypts on demand.
- Identify the sensitive fields. Wrap them in encrypt-on-write, decrypt-on-read helpers.
- Each encrypted blob carries a small header indicating algorithm version (so future re-encryption with stronger algorithms is possible — this is called **algorithmic agility**, and it's the single most important property for staying ahead of cryptographic obsolescence).
- Use AES-256, which is quantum-resistant for the foreseeable future.

**Roughly:** 1 week.

### Phase 6 — Audit log and observability

**What:** Detailed logging of who did what when. Anomaly alerts. Visibility into how the system is actually behaving.

**Why seventh:** With auth and access control in place, there's now meaningful audit data to capture. Before this point, audit logs would mostly say "anonymous user did X."

**Concrete steps:**

- Append-only audit log: every read and write of patient data emits an event with `(uid, action, target, timestamp)`. Stored in a collection that no client can modify retrospectively.
- Alerts for anomalies: one user reading 50× their normal volume; failed access attempts spiking; unusual hours; bulk deletions.
- Sentry already wired up from Phase 0 — now we add structured logging of clinically relevant events.
- A simple dashboard showing system health (error rate, active users, response times).

**Roughly:** 1 week.

### Phase 7 — Server-side enforcement of business rules

**What:** Move the operations that really matter (case deletion, group membership changes, ward note finalisation, member removal) into Cloud Functions, so they're enforced server-side rather than relying on the browser to do the right thing.

**Why eighth:** Until this point, business rules live only in the browser, which a determined user could bypass by using the Firebase SDK directly. For the operations that have audit or safety implications, server-side enforcement is what hospital adoption requires.

**Concrete steps:**

- Identify the small set of operations that need server-side enforcement (probably 5–10).
- Implement each as a Cloud Function with proper input validation and audit logging.
- Update the UI to call these functions instead of writing directly to Firestore.
- Tighten Firestore rules so direct writes to the affected collections from clients are no longer allowed.

**Roughly:** 2–3 weeks.

### Phase 8 — Hardening

**What:** The defensive depth phase. Closing every smaller gap.

**Why ninth:** Doing these earlier would be premature; doing them after the system is otherwise stable lets you address them systematically.

**Concrete steps:**

- Strict **Content Security Policy** headers, served from your real hosting (which is why the move off GitHub Pages in Phase 0 mattered — GitHub Pages can't serve custom HTTP headers).
- **Subresource Integrity** on all script tags — the browser refuses to run JavaScript whose hash doesn't match expectations, defending against compromised CDN deliveries.
- **Rate limiting** on auth endpoints and write-heavy operations (Cloud Armor or Firebase App Check).
- **Backup strategy:** scheduled exports to a separate Cloud Storage bucket, retained per your retention policy, with documented restore procedures and at least one rehearsed restore.
- **Penetration test** by a reputable firm. Roughly £3–8k. Findings fed back into the system. The report itself becomes a procurement asset.
- **Modularise `script.js`** if not already done — break it into proper modules using the Vite + TypeScript scaffolding that's already configured but unused.

**Roughly:** 3–4 weeks plus pen test turnaround.

### Phase 9 — Adoption-readiness features

**What:** The features hospitals will ask for once they're seriously considering Catalist.

**Why last:** None of these are needed until you have real hospital interest, and prematurely building them slows down everything else.

- **SSO** (SAML or OIDC integration with hospital identity providers — typically Microsoft Entra ID for HSE and most Irish voluntary hospitals).
- **Offline support** as a Progressive Web App, leveraging Firestore's built-in offline cache.
- **Notifications** (email or push) when a task is assigned to you.
- **IHI (Individual Health Identifier) support** if Catalist evolves toward longitudinal records (rather than per-shift handover). The IHI was introduced under the Health Identifiers Act 2014 and is increasingly rolled out across HSE services.
- **Structured clinical data** (SNOMED CT tagging) for analytics queries.
- **Native mobile app** via Capacitor or Tauri, if browser delivery becomes a limiting factor.

These are sized in months, not weeks, and only get built if and when there's a real reason.

---

## Part 6 — Supporting work that runs alongside

These aren't phases but ongoing changes that happen across the plan:

- **Tests, written as you go.** Rules tests during Phase 4. Integration tests for any operation that touches patient data. End-to-end tests for the critical user journeys. This is one of the biggest divergences from clinical-software norms and the easiest one to start fixing immediately.
- **The `script.js` modularisation.** The codebase already has Vite + TypeScript scaffolding configured but unused; the main app is a single 8,500-line JS file. Pick this up early — Phase 1 or 2 — and do it incrementally. A natural moment is whenever you'd be touching a section of `script.js` for one of the planned phases anyway.
- **Documentation updates.** Each phase should leave the README in a state that reflects the system as it now is.
- **Threat model document.** Living document; revisit at least annually and on any material architecture change.

---

## Part 7 — What we're explicitly not doing

It's as important to be clear about what we're *not* doing, so you can defend the choices:

- **We are not building end-to-end encryption.** Data is encrypted in transit and at rest, with multiple layers, but the server (and you) can decrypt it. This is a deliberate choice to enable analytics and to keep the system simple enough to maintain reliably.
- **We are not promising "zero-knowledge" or "end-to-end encrypted" in marketing.** Any compliance or marketing claim should reflect what's actually true: encrypted, access-controlled, audited, GDPR-aligned.
- **We are not building a native mobile app yet.** It's on the roadmap (Phase 9) if browser delivery becomes a limiting factor. For now, a well-hardened web app is sufficient.
- **We are not adopting IHI or structured clinical coding yet.** Free-text patient names and notes are a known limitation; switching to structured data is a project of its own that only matters once Catalist's role goes beyond shift handover.
- **We are not building SSO yet.** Username + password + 2FA is fine for early adopters and pilot deployments; SSO comes when hospital procurement requires it.
- **We are not adding offline support yet.** Worth doing eventually, especially given clinicians often work in low-signal areas, but not on the critical path.

---

## Part 8 — Why this order

The phases aren't arbitrary. The dependencies are:

- **Phase 0** before everything because some choices (region, legal structure, hosting) are hard to undo.
- **Phase 1 (identity)** before everything that needs to know who a user is.
- **Phase 2 (groups)** before access control can have anything to control access to.
- **Phase 3 (migration)** before the new structure can replace the old one.
- **Phase 4 (rules + decommission)** before the old weakly-protected system can be turned off.
- **Phase 5 (envelope encryption)** at this point because earlier you have nothing meaningful to encrypt at the application layer.
- **Phase 6 (audit and observability)** once there are real users and meaningful actions to log.
- **Phase 7 (server-side enforcement)** once the system is stable enough to layer Cloud Functions onto.
- **Phase 8 (hardening)** once everything else is in place to harden.
- **Phase 9 (adoption features)** only when real demand justifies them.

Risk management is the other reason for this order. The most irreversible step (Phase 3) comes *after* the new structure is built and tested. The most complex new infrastructure (Phase 7) comes *after* the system is otherwise stable. Hardening comes last so it's hardening the actual final system, not a moving target.

---

## Part 9 — Decisions still open

Lock in answers to these before Phase 0 starts in earnest:

1. **Lead supervisory authority** — confirmed as the Irish DPC by virtue of the company's establishment in Ireland. No active decision required, but worth noting that DPC-specific templates and timelines apply.
2. **Legal structure** — sole trader or limited company?
3. **First hospital target** — even informally; knowing who you'd want as a first official deployment shapes the DPA and DPIA work.
4. **Existing users** — real clinicians who need careful onboarding into the new system, or test data we can drop?
5. **2FA from day one or opt-in?** Recommendation: required from day one for initial sign-in (passkey preferred, TOTP fallback), with a 4-digit PIN for fast resume on each device and biometric as an opt-in alternative.
6. **Open sign-up or invite-only?** Recommendation: invite-only.
7. **Recovery policy** — OK with "lose your password = recovery code, lose both = locked out, must be re-invited"? (No master key held by you.)

---

## Part 10 — Honest scope

This is real work. Realistic part-time estimate, with everything: **3–5 months**. Phase 0 alone is a week of writing. Phases 1–4 are the bulk of the engineering and probably 6–8 weeks. Phase 5 onward is another 6–8 weeks. Phase 9 is open-ended.

What can wait if you need to ship something sooner:

- **Phase 7 (server-side enforcement)** can ship after the system is publicly used, as long as Phase 4's rules are tight.
- **Phase 8 (hardening)** can be partially deferred — pen test in particular.
- **Phase 9 (adoption features)** only happens on demand.

What can't wait:

- **Phase 0's paperwork.** Skipping it means processing real patient data without a documented legal basis.
- **Phases 1–4.** Without these, the current "anyone with the passphrase has everything" model continues, which isn't acceptable for real clinical use.
- **A staging environment.** Migrating real production data without rehearsing on a copy is an avoidable disaster.

---

## Closing

The destination is a clinical web app with: real user accounts, real groups, multi-layer encryption, properly enforced access control, audit logging, observability, server-side business rule enforcement, and the documentation to back it all up. The same security posture as the major clinical SaaS systems — with several specific advantages: your real-time UX, your design taste, your willingness to actually invest in this work.

The path from here is not short, but every step is small, every step ships independently, and each one leaves the app in a better state than it was. The biggest practical risk is starting too many phases at once instead of finishing them one at a time.

The first concrete step is locking in answers to the seven decisions in Part 9. Once those are answered, Phase 0 begins.
