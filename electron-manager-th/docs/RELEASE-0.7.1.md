# Cookie-first login — 0.7.1

Implemented in source, unit tests and local browser fixtures. **Live Facebook E2E has NOT passed. This is not a production-readiness claim.** No real cookies are included in tests or source.

## Use in Electron

1. Stop the queue and wait for the current send to finish.
2. Accounts → Add account → **เข้าด้วย cookie**. Paste `name=value; name=value` from your own Facebook session. `c_user` and `xs` are mandatory. Existing Cookie-Editor JSON and Netscape imports remain supported.
3. Click **เข้าด้วย cookie**; the account name is optional. Batch separator: a line containing `---ACCOUNT---`. Existing identities are reused rather than duplicated.
4. For an existing account, select it and use **เข้าด้วย cookie / เปลี่ยน Session**. Replacement must match the existing identity; there is no automatic replacement of another account.
5. **ตรวจสอบสถานะ** decrypts the saved cookie and runs the same verification. Before posting/group discovery/actions, the adapter loads the encrypted cookie and obtains a verified context from the same module.

A new browser context always runs `clearCookies()` before `addCookies()`. The persistent directory is `%LOCALAPPDATA%\FB-AutoPost\cookie-profiles\<c_user>`; non-Windows fallback is `~/.local/share/FB-AutoPost/cookie-profiles/<c_user>`. Legacy profile folders are not deleted. They are detached only when the user explicitly imports cookies for that account. Two app processes cannot use the same Chrome directory simultaneously.

รายการไฟล์ทั้งหมด: [COOKIE_LOGIN_FILES.md](COOKIE_LOGIN_FILES.md).

## Module API

Full TypeScript source: [cookie-login.ts](../electron/accounts/cookie-login.ts). Full Python source: [cookie_login.py](../../autopost/cookie_login.py).

Exports: `parseCookieString`, `hasCoreSession`, `toPlaywrightCookies`, `cookieProfileRoot`, `cookieProfileDir`, `blockedLoginUrl`, `loginWithCookies`, `openCookieSession`, `injectAndClose`, and the existing `CookieLogin` persistence wrapper.

```ts
const result = await loginWithCookies({ cookieRaw: rawFromLocalUI, headless: true });
if (!result.ok) {
  showFailure(result.reason); // fixed reason codes; no raw browser/credential exceptions
  return;
}
try {
  // result.userId, result.page and result.context refer to the verified session.
  await useVerifiedPage(result.page);
} finally {
  await result.context.close();
}
```

`injectAndClose` verifies, closes and returns `userId` + `profileDir`; reopen from that same directory next time. The desktop adapter currently reinjects saved encrypted credentials and verifies on each context creation; it does not silently retry submitted work.

| Result | Meaning |
| --- | --- |
| `ok: true` | Matching c_user + xs, Facebook host, no login/CAPTCHA gate and a visible authenticated account control |
| `missing_c_user_or_xs` | Missing/empty core session values |
| `invalid_cookie` | Invalid structure, conflicting duplicates, or unsafe identity |
| `checkpoint_or_login_required` | Login/checkpoint/challenge/2FA route or login/CAPTCHA gate; stop and notify the user |
| `session_rejected` | Cannot verify authenticated controls or identity; injected cookie presence alone is insufficient |
| `browser_unavailable` | Chrome unavailable, locked profile or launch failure; no login retry |
| `navigation_failed` | Navigation/verification error; sanitized result, context closed |

Only successful results transfer browser ownership to the caller. All failures wait for the context to close. A main-frame checkpoint/login redirect immediately starts closing the context; repeated close requests share one promise.

## Replaced entry points

- `AccountManager.importMultipleCookies` and `importCookieForAccount`: canonical per-user profile, explicit replacement, encrypted persistence; a failed account stops the batch.
- `AccountManager.checkSession`: encrypted storage → verifier; accounts with no cookie receive `missing_c_user_or_xs` rather than a manual login window.
- `AdapterRegistry` → `FacebookBrowserAdapter.context`: every post/comment/share/like/discovery uses verified cookie sessions. Legacy manual-only profiles cannot start new operations until explicitly imported.
- `accounts:login-facebook`, `accounts:login-and-check`, `accounts:create-and-login`, and adapter `openLogin` remain only as disabled compatibility entry points, returning `manual_login_disabled`. UI has no manual-login button.
- Renderer does not persist cookie text in localStorage or logs; it clears the textarea after a login attempt.

## Python root (still maintained as source)

`autopost.cookie_login` provides `parse_cookie_string`, `has_core_session`, `to_playwright_cookies`, `cookie_profile_dir`, `inspect_session`, `login_with_cookies` and an owned `CookieLoginResult.close()`.

Root UI → `POST /api/browser/accounts/{id}/cookie-login` with local JSON body `{"cookie_raw": "<entered locally>"}`. The endpoint uses the existing local authentication guard and never returns cookie data. Responses are `{ok, reason}` or `{ok: true, userId}`. Validation does not echo submitted body contents.

`BrowserManager` uses the same verified context for subsequent jobs, or restores from a DPAPI-encrypted local vault on next start. A failed gate persists `cookie_blocked` and requires explicit new input. It does not retry a submitted post. The old `login` and `launch_context` entry points are disabled.

Python credentials: `%LOCALAPPDATA%\FB-AutoPost\cookie-secrets\<c_user>.bin`, Windows user-bound DPAPI, atomic file replacement. No plaintext fallback on non-Windows; a secure backend is required there. Electron uses its existing safeStorage/DPAPI database. Browser profiles themselves remain Chrome-managed local state.

The older Python EXE/ZIP already in `downloads/` is historical and is not rewritten by a source change. Run the updated root source to use this module; Electron 0.7.1 is built separately.

## Verification commands

```sh
cd electron-manager-th
npm ci
npm run typecheck
npm test -- --maxWorkers 2
npm run build
```

For Linux fixtures where Chrome is not installed, test-only environment:

```sh
AUTOPOST_TEST_CHROME=/usr/bin/chromium AUTOPOST_TEST_NO_SANDBOX=1 npm test -- --maxWorkers 2
```

From repository root, with root requirements installed:

```sh
python -m unittest discover -s tests -v
node --check ui/app.js
```

Tests use fabricated cookies only. Browser requests are intercepted with local fixtures; no Facebook account is contacted. Covered: parser/core/conversion, clearing stale cookies, success ownership, login/checkpoint closure, CAPTCHA, wrong identity, rejected session, launch failures, explicit account replacement, batch stop, encrypted storage restoration and legacy-entry-point blocking. Windows CI also exercises DPAPI roundtrip with fabricated data and the packaged Electron cookie dialog.

## Pending verification

Live Facebook login → identity → group discovery → scheduled send → verified result still requires an authorized account. CAPTCHA/checkpoint/2FA are never bypassed. A cookie can expire or be revoked at any time. Selectors may reject legitimate layouts; rejection must stay visible rather than be turned into a success. No production-ready claim until live E2E passes.
