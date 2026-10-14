"""Platform layer: persistent Chrome/Chromium context per account."""
from __future__ import annotations

from pathlib import Path

from playwright.async_api import async_playwright

from .stealth import apply_stealth

LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-default-browser-check",
    "--no-first-run",
]


async def launch_context(profile_dir: Path, headless: bool = False):
    """คืน (playwright, context) — ลอง Chrome ก่อน ไม่มีค่อยใช้ chromium"""
    profile_dir.mkdir(parents=True, exist_ok=True)
    pw = await async_playwright().start()
    common = dict(
        user_data_dir=str(profile_dir),
        headless=headless,
        args=LAUNCH_ARGS,
        viewport={"width": 1366, "height": 900},
        locale="th-TH",
        accept_downloads=False,
    )
    try:
        ctx = await pw.chromium.launch_persistent_context(channel="chrome", **common)
    except Exception:
        ctx = await pw.chromium.launch_persistent_context(**common)
    await apply_stealth(ctx)
    return pw, ctx


async def close_context(pw, ctx) -> None:
    try:
        await ctx.close()
    except Exception:
        pass
    try:
        await pw.stop()
    except Exception:
        pass
