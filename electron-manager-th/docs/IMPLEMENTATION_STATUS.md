# Current: 0.7.1 — Cookie-first Facebook login

Cookie login replaces manual Chrome login across account creation, session checks, discovery and the send adapter. Canonical per-c_user profiles, clear-before-inject, encrypted local storage, explicit cookie refresh and fail-closed checkpoint/login handling are implemented. Historical manual-login IPC remains disabled, not a hidden fallback.

Python root source also uses cookie login with Windows DPAPI. The older bundled Python downloads are historical artifacts; source changes do not rebuild those binaries.

**Live Facebook E2E has not passed. Not production-ready.** Local unit, database, browser fixture and packaged desktop checks are separate from live verification. No real cookie/token/profile is part of the tests or committed sources.

See [module API, replacement map, files and verification instructions](COOKIE_LOGIN.md).

---

The following sections are historical implementation snapshots, not current readiness claims.

# Implementation status

## 0.5.0 queue safety and verification update

- Migration 007 adds operation idempotency keys, submission phase tracking, and explicit overdue approval. Existing database receives a SQLite-consistent VACUUM INTO backup before migration.
- Worker startup and long event-loop/suspend gaps hold overdue pending jobs for user review. Unknown or interrupted submissions never requeue automatically.
- Overdue review UI supports skip, future reschedule, and native-confirmed catch-up for demonstrably not-submitted work only.
- Follow-up creation uses stable unique keys and commits together with successful parent completion; duplicate follow-up calls do not recreate steps.
- Original posts no longer succeed solely because the composer closed. Permalink evidence must match new post identity, destination group, configured/logged-in author, caption, and visible media count. Unsupported layouts fail closed as uncertain.
- Comment composer waits, opens the comment control, and excludes reply-labelled editors rather than rejecting every nested editor. Explicit comments-disabled evidence is separated from missing-selector failures.
- Comment result checking requires a new comment article, matching author/text and image evidence. Image-only evidence is supported in code but NOT yet verified against live Facebook.
- Local Chrome DOM-fixture integration tests exercise editor opening and disabled/missing distinction. These are NOT Facebook end-to-end tests.
- Notification delivery errors do not downgrade a successful action. Unsafe submissions do not automatically retry.

### Remaining limitations

- Live Facebook post/comment/share/like E2E is still required; selectors and evidence requirements may reject legitimate layouts.
- Media verification is based on visible media count, not cryptographic matching to Facebook uploads. It is not proof of exact uploaded image identity.
- No reliable pending-approval detector yet; unresolved submissions remain uncertain.
- Full group permission discovery, consolidated workflow notifications, and all Blueprint polish remain incomplete.
- Idempotency prevents duplicate logical queue entries, not server-side exactly-once Facebook operations. Ambiguous network/crash outcomes still require human review.
- Sending catch-up is an explicit user authorization; worker must remain open to execute it. Resume/start does not silently authorize legacy overdue work.
- Round summaries still focus on original posts rather than full workflow completion.

## 0.4.0 implementation update

- Multi-account project snapshots now synchronize project_accounts and group_content_mappings for existing local accounts/groups.
- Added per-account delay/headless settings and comment/share/like options in the composer.
- Added atomic multi-account project start, with account ownership validation and missing-media preflight in UI.
- Added persisted automation task queue sharing account concurrency limits with the legacy queue.
- Added Comment / Share / Like workspaces; each Start button creates the action for its current page.
- Added comment templates and post follow-up tasks; follow-ups require a verified new post permalink.
- Added native Share with repeat scheduling; native shares retain original media and cannot replace images.
- Added Like action with existing-like detection. Actions require exactly one visible target article and fail closed if ambiguous.
- Added encrypted Discord/Telegram channel CRUD, account/project/job routing, and result messages.
- Added tests covering task lifecycle, cancellation, interrupted work, recurring shares, channel routing, checkpoint/CAPTCHA protection, already-liked targets and multi-account export.

### Still not production-verified / incomplete

- No real Facebook Comment/Share/Like end-to-end run has been performed. Facebook selector compatibility remains unverified.
- Image-only commenting submits once but reports uncertain because image publication verification is not implemented; it does not retry automatically.
- Group permission discovery (can_post/can_share) is not implemented; default database flags must not be presented as verified permissions.
- Last-opened action tab is stored by ProjectManager but the toolbar still saves the post workspace only.
- Full separate project defaults editor, account-default fallback and cross-machine account/group remapping UI remain incomplete.
- Multi-account project start supports one-shot jobs, not daily/weekly recurring action workflows.
- Detailed upload progress, consolidated per-job summary notifications and persisted account colors for every log are incomplete.
- New action tasks currently fail without automatic retries, to avoid duplicate side effects. A verified pre-submission-only retry policy is still required.
- Do not label this release 100% Blueprint-complete.

## Historical 0.3.0 snapshot (superseded by update above)

- Additive migrations 002 and 003, tested against a seeded legacy database; repeated execution preserves rows.
- Project create, rename, save, duplicate, delete, versioned JSON import/export and last-used tracking.
- Post composer project toolbar with debounced auto-save.
- Project snapshots preserve caption, media paths, selected account/destinations and recurring schedule mode.
- Per-destination caption/media overrides with fallback to the composer defaults.
- Mapped jobs are created atomically in one SQLite transaction.
- Image/video preview, reload, reveal in Explorer and missing-file preflight.
- Queue lifecycle events via typed IPC; renderer polling replaced with debounced event refresh and focus refresh.
- Live status panel with deterministic account colors.
- Group discovery results merge into facebook_groups; force refresh and discovered counts in UI/events.
- Authentication failures no longer receive automatic retries.

## Historical 0.3.0 limits (see current update above)

- Project snapshots currently edit one active account at a time, not a complete multi-account workspace.
- The project_accounts and group_content_mappings relational tables are not yet the source of truth; mappings are stored in versioned project settings.
- Project export includes a media manifest, not embedded media. Imported account/destination references must be reselected when moving machines.
- Per-account delays, encrypted proxies and project headless overrides are not fully connected to the worker.
- Progress currently reports job lifecycle, not every upload/comment/share substep.
- UI account colors are available in the live panel, not all persisted historical log rows.
- Commenter, Sharer, repeat-share, Liker, Smart Start action pages and full notification routing remain unimplemented.
- Group can_post/can_share values are not verified permission results. Do not treat their default values as proof of access.
- Session import was reported working by the user; project/media/queue changes still need interactive end-to-end validation.

The application must not be described as 100% Blueprint-complete or fully production-validated.
