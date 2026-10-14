"""Service layer: Discord webhook notifications (results / round summaries)."""
from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request


def _post(url: str, payload: dict, timeout: float = 12.0) -> tuple[bool, str]:
    if not url or "discord.com/api/webhooks/" not in url:
        return False, "webhook ไม่ถูกต้อง"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "autopost-free/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if 200 <= resp.status < 300:
                return True, ""
            return False, "HTTP %s" % resp.status
    except urllib.error.HTTPError as exc:
        return False, "HTTP %s" % exc.code
    except Exception as exc:
        return False, str(exc)


async def send_webhook(url: str, text: str) -> tuple[bool, str]:
    if not text:
        return False, "ข้อความว่าง"
    text = text[:1900]
    ok, err = await asyncio.to_thread(_post, url, {"content": text})
    return ok, err


async def notify(url: str, title: str, body: str) -> None:
    if not url:
        return
    await send_webhook(url, "**%s**\n%s" % (title, body[:1700]))
