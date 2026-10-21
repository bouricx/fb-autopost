# AutoPost Manager TH 0.5.0 — Veltshop

This folder contains the Electron edition. The existing Python application at the repository root is preserved and remains independent.

## Stack

Electron, TypeScript, React, SQLite (`better-sqlite3`), Playwright Core, and Windows DPAPI through Electron safeStorage.

## Development (Windows)

Use Node.js 24 and install Google Chrome. Native SQLite must be rebuilt for the Electron ABI before launching:

```powershell
cd electron-manager-th
npm ci
npx electron-builder install-app-deps
npm run typecheck
npm test
npm run dev
```

Some integration tests launch installed Chrome against local HTML fixtures. They do not post to Facebook.

## Build the Windows installer

```powershell
npm run dist
```

## Current safety improvements

- Explicit review of overdue queues: skip, reschedule, or confirmed catch-up.
- Submission phase tracking and idempotency keys for queued operations and follow-ups.
- Interrupted or uncertain submissions are not silently retried.
- Post permalink verification and post-scoped comment handling.
- Thai UI, projects, schedules, account sessions, media previews and queue management.

Read [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for current limitations. Passing tests and successful packaging do **not** establish complete live Facebook compatibility. Comment/share/like still require authorized real-world end-to-end verification.

## Private local data is not included

No cookies, account databases, browser profiles, backups, logs, screenshots, installer binaries, or user media are uploaded. Add your own session only in the local application; never paste cookies or tokens into GitHub issues or commits.

For Cookie login use only your own accounts. The application must stop on CAPTCHA, checkpoint, or restriction; it does not bypass Facebook security.
