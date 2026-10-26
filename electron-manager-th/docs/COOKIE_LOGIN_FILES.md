# Cookie login change manifest — 0.7.1

All paths are relative to the repository root. The full TypeScript module is [`electron/accounts/cookie-login.ts`](../electron/accounts/cookie-login.ts); the full Python module is [`autopost/cookie_login.py`](../../autopost/cookie_login.py). No code is omitted from those files.

| File | Purpose |
| --- | --- |
| `.github/workflows/windows-desktop.yml` | Windows DPAPI and desktop verification |
| `.gitignore` | Prevent committing private browser state |
| `README.md` | Documentation / delivery |
| `autopost/api.py` | Account, authentication or UI integration |
| `autopost/browser.py` | Account, authentication or UI integration |
| `autopost/browser_manager.py` | Account, authentication or UI integration |
| `autopost/cookie_login.py` | Cookie session module / encrypted storage |
| `autopost/cookie_vault.py` | Cookie session module / encrypted storage |
| `electron-manager-th/.gitignore` | Prevent committing private browser state |
| `electron-manager-th/README.md` | Documentation / delivery |
| `electron-manager-th/docs/COOKIE_LOGIN.md` | Documentation / delivery |
| `electron-manager-th/docs/COOKIE_LOGIN_FILES.md` | Documentation / delivery |
| `electron-manager-th/docs/IMPLEMENTATION_STATUS.md` | Documentation / delivery |
| `electron-manager-th/docs/RELEASE-0.7.1.md` | Documentation / delivery |
| `electron-manager-th/electron/accounts/account-manager.ts` | Account, authentication or UI integration |
| `electron-manager-th/electron/accounts/cookie-login.ts` | Cookie session module / encrypted storage |
| `electron-manager-th/electron/accounts/cookie-parser.ts` | Account, authentication or UI integration |
| `electron-manager-th/electron/accounts/session-checker.ts` | Account, authentication or UI integration |
| `electron-manager-th/electron/adapters/facebook-browser.ts` | Account, authentication or UI integration |
| `electron-manager-th/electron/adapters/registry.ts` | Account, authentication or UI integration |
| `electron-manager-th/electron/main.ts` | Account, authentication or UI integration |
| `electron-manager-th/package-lock.json` | Version metadata |
| `electron-manager-th/package.json` | Version metadata |
| `electron-manager-th/scripts/check-desktop.mjs` | Desktop / renderer verification |
| `electron-manager-th/scripts/check-renderer.mjs` | Desktop / renderer verification |
| `electron-manager-th/src/App.tsx` | Account, authentication or UI integration |
| `electron-manager-th/src/styles/macos.css` | Account, authentication or UI integration |
| `electron-manager-th/tests/account-cookie-login.test.ts` | Tests / fixture verification |
| `electron-manager-th/tests/cookie-login.integration.test.ts` | Tests / fixture verification |
| `electron-manager-th/tests/cookie-login.test.ts` | Tests / fixture verification |
| `electron-manager-th/tests/facebook-discovery.test.ts` | Tests / fixture verification |
| `tests/test_browser.py` | Tests / fixture verification |
| `tests/test_cookie_login.py` | Tests / fixture verification |
| `ui/app.js` | Account, authentication or UI integration |
| `ui/index.html` | Account, authentication or UI integration |
| `scripts/check_python_source.py` | Force embedded Windows runtime to verify checked-out source instead of the historical bundled app |
