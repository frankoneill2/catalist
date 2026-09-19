# Catalist / Wardround — Project Documentation

This folder is the canonical reference for how the project is built, hosted, and run. Each document is written to be readable cold — you (or anyone you share it with) shouldn't need to remember the conversation that produced it.

## Contents

- **[security-rebuild-plan.md](security-rebuild-plan.md)** — The full multi-phase plan to move from the current shared-passphrase model to a proper system with per-user accounts, groups, encrypted data, audit logging, and GDPR posture. Includes the strategic decisions (server-side encryption vs E2EE, jurisdiction, etc.) and the supporting infrastructure work.

- **[case-sharing-design.md](case-sharing-design.md)** — Design for cross-group case sharing within a hospital "supergroup" — the gastro-consult flow. Adds a supergroup primitive, per-case content keys with per-recipient-group key wraps, a server-side share function, and triple-written audit. Slots in around Phase 6.5 of the rebuild plan.

- **[hosting-and-deployment.md](hosting-and-deployment.md)** — How the app is hosted (Firebase Hosting on `wardround.app`), the four feedback loops between writing code and seeing it live, and how to maintain separate dev and production environments as the project matures.

- **[error-tracking.md](error-tracking.md)** — How Sentry is wired into the app, how to activate it (paste a DSN), and the privacy posture chosen so patient data never reaches the Sentry servers.

- **[irish-company-setup.md](irish-company-setup.md)** — Practical guide to setting up an Irish limited company for Catalist: why, when, the step-by-step process, costs, and ongoing obligations.

## When to update these

These docs reflect deliberate architectural and process decisions, not transient notes. Update them when:

- A decision documented here changes (e.g. you decide to move off Firebase, or pick a different jurisdiction).
- A new phase of the rebuild plan ships and the "current state" descriptions need to catch up.
- A practical step in one of the guides turns out to be wrong or out of date.

For temporary notes, in-progress work, or session summaries, use `SESSION_CHANGES.md` at the project root or the in-conversation memory system — not these documents.
