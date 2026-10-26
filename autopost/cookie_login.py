"""Cookie-first Facebook sessions. Never bypass login, checkpoint, CAPTCHA or 2FA."""
from __future__ import annotations

import os
import asyncio
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright


def parse_cookie_string(raw: str) -> dict[str, str]:
    if not isinstance(raw, str) or len(raw) > 2_000_000:
        raise ValueError("invalid_cookie")
    out: dict[str, str] = {}
    cleaned = re.sub(r"^Cookie:\s*", "", raw.strip(), flags=re.I).replace("\r\n", " ").replace("\n", " ")
    for part in cleaned.split(";"):
        if not part.strip():
            continue
        name, sep, value = part.partition("=")
        name, value = name.strip(), value.strip()
        if not sep or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name) or re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError("invalid_cookie")
        if name in out and out[name] != value:
            raise ValueError("invalid_cookie")
        out[name] = value
    return out


def has_core_session(cookies: dict[str, str]) -> bool:
    return bool(re.fullmatch(r"[0-9]+", cookies.get("c_user", "")) and cookies.get("xs", "").strip())


def to_playwright_cookies(cookies: dict[str, str]) -> list[dict]:
    return [{"name": name, "value": value, "domain": ".facebook.com", "path": "/", "secure": True,
             "httpOnly": name in ("c_user", "xs", "datr", "sb"), "sameSite": "None"} for name, value in cookies.items()]


def cookie_profile_dir(user_id: str) -> Path:
    if not re.fullmatch(r"[0-9]+", user_id):
        raise ValueError("invalid_cookie")
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share") / "FB-AutoPost" / "cookie-profiles" / user_id


def blocked_login_url(value: str) -> bool:
    return bool(re.search(r"/(?:checkpoint|login|challenge|two_step_verification)(?:/|$|\.php)", urlparse(value).path, re.I))


async def inspect_session(page, context, expected_user_id: str) -> str | None:
    if blocked_login_url(page.url):
        return "checkpoint_or_login_required"
    if urlparse(page.url).hostname not in ("facebook.com", "www.facebook.com", "m.facebook.com"):
        return "session_rejected"
    if await page.locator('input[name="email"],input[name*="captcha"],iframe[src*="captcha"]').first.is_visible():
        return "checkpoint_or_login_required"
    cookies = {row["name"]: row["value"] for row in await context.cookies("https://www.facebook.com/")}
    control = page.get_by_role("button", name=re.compile(r"Your profile|Account|โปรไฟล์ของคุณ|บัญชีของคุณ", re.I)).first
    if cookies.get("c_user") != expected_user_id or not cookies.get("xs") or not await control.is_visible():
        return "session_rejected"
    headings = " ".join(await page.locator('h1,h2,[role="alert"]').all_text_contents())
    if re.search(r"account.{0,30}(restricted|disabled)|บัญชี.{0,30}(ถูกจำกัด|ถูกปิด)", headings, re.I):
        return "session_rejected"
    return None


@dataclass(repr=False)
class CookieLoginResult:
    ok: bool
    reason: str | None = None
    user_id: str | None = None
    page: object = None
    context: object = None
    playwright: object = None
    profile_dir: Path | None = None

    async def close(self):
        try:
            if self.context:
                await self.context.close()
        finally:
            if self.playwright:
                await self.playwright.stop()


async def login_with_cookies(cookie_raw: str, *, chrome_path: str | None = None,
                             user_data_dir: Path | None = None, headless: bool = True,
                             timeout_ms: int = 45000) -> CookieLoginResult:
    try:
        cookies = parse_cookie_string(cookie_raw)
    except ValueError:
        return CookieLoginResult(False, "invalid_cookie")
    if not has_core_session(cookies):
        return CookieLoginResult(False, "missing_c_user_or_xs")
    directory = user_data_dir or cookie_profile_dir(cookies["c_user"])
    pw = context = None
    try:
        directory.mkdir(parents=True, exist_ok=True)
        pw = await async_playwright().start()
        options = {"executable_path": chrome_path} if chrome_path else {"channel": "chrome"}
        context = await pw.chromium.launch_persistent_context(str(directory), headless=headless,
            viewport={"width": 1365, "height": 900}, locale="th-TH", timezone_id="Asia/Bangkok", **options)
    except Exception:
        if pw:
            await pw.stop()
        return CookieLoginResult(False, "browser_unavailable")
    blocked = False
    closing = None
    async def close_once():
        nonlocal closing
        if closing is None:
            closing = asyncio.create_task(context.close())
        await closing
    async def guard(frame):
        nonlocal blocked
        if frame == page.main_frame and blocked_login_url(frame.url):
            blocked = True
            await close_once()
    try:
        await context.clear_cookies()
        await context.add_cookies(to_playwright_cookies(cookies))
        page = await context.new_page()
        page.on("framenavigated", guard)
        await page.goto("https://www.facebook.com/", wait_until="domcontentloaded", timeout=timeout_ms)
        if blocked_login_url(page.url):
            blocked = True
        if not blocked:
            try:
                await page.get_by_role("button", name=re.compile(r"Your profile|Account|โปรไฟล์ของคุณ|บัญชีของคุณ", re.I)).first.wait_for(state="visible", timeout=min(timeout_ms, 5000))
            except Exception:
                pass
        reason = "checkpoint_or_login_required" if blocked else await inspect_session(page, context, cookies["c_user"])
        if not reason:
            return CookieLoginResult(True, user_id=cookies["c_user"], page=page, context=context, playwright=pw, profile_dir=directory)
    except Exception:
        reason = "checkpoint_or_login_required" if blocked else "navigation_failed"
    try:
        await close_once()
    finally:
        await pw.stop()
    return CookieLoginResult(False, reason)
