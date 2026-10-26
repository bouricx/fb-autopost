# Cookie login verification — 2026-10-26

No live Facebook account was used. **Live E2E is pending; this is not production-ready.** Test cookies are fabricated and browser requests are served by local fixtures.

- Local TypeScript: typecheck, build, 42 test files / 148 tests passed. Renderer verification: 8 views at 800/1024/1440px, profile save, cookie login success/rejection through mock IPC, textarea clearing and absence of the manual-login button.
- [Windows Electron build and packaged desktop verification](https://github.com/bouricx/fb-autopost/actions/runs/40285899120): passed. Includes 148 tests, installer build, native IPC with missing-xs rejection, optional account name, cookie textarea clearing, no fabricated account creation, and graceful shutdown. Worker is disabled; no social action is sent.
- [Windows Python source / DPAPI / historical desktop verification](https://github.com/bouricx/fb-autopost/actions/runs/40286071966): passed. Source tests explicitly load the checkout before the embedded runtime's historical bundled app. DPAPI roundtrip uses fabricated input and verifies that the stored file does not contain its plaintext. The historical desktop ZIP smoke test is separate and does not claim that ZIP contains the new source.
- Python local: 27 tests, 1 platform-dependent skip (Windows DPAPI). On Windows the DPAPI test runs and the non-Windows fail-closed test is skipped.
- Repository checks: no tracked private profile paths; the existing Windows ZIP contains no cookie-profiles, cookie-secrets, fb_profile or profiles directories. Added ignores also cover accidental custom Chromium profile directories.

Installer source commit: `228c0d7ff64c7bd5c5ffbdac70b71a615d69f39c`. The later `b58958f` changes Python/UI session-rejection reporting only; Electron runtime sources are identical. Version 0.7.1 installer is available in the [GitHub release](https://github.com/bouricx/fb-autopost/releases/tag/v0.7.1).

## Remaining

- Authorized live Facebook E2E: Cookie → identity → group discovery → scheduled send → verified publication. No production claim before this passes.
- Python cookie credential storage on non-Windows requires another secure backend; no plaintext fallback is supplied.
- Historical Python EXE/ZIP downloads are not rebuilt. Updated Python source and the new Electron installer are delivered separately.
