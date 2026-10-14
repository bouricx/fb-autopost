"""Platform layer: cookie parsing (Cookie-Editor JSON / c_user=... strings) + login probe."""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

FB_DOMAIN = ".facebook.com"


class CookieError(ValueError):
    pass


def _norm_same_site(v) -> str:
    s = str(v or "").lower()
    if s in ("strict",):
        return "Strict"
    if s in ("lax",):
        return "Lax"
    if s in ("none",):
        return "None"
    if s in ("no_restriction", "unspecified", ""):
        return "Lax"
    return "Lax"


def _from_entry(e: dict) -> dict:
    name = e.get("name")
    value = e.get("value")
    if not name or value is None:
        raise CookieError("cookie ไม่มี name/value")
    cookie = {
        "name": str(name),
        "value": str(value),
        "domain": str(e.get("domain") or FB_DOMAIN),
        "path": str(e.get("path") or "/"),
        "httpOnly": bool(e.get("httpOnly") or e.get("http_only") or False),
        "secure": bool(e.get("secure") or False),
        "sameSite": _norm_same_site(e.get("sameSite") or e.get("same_site")),
    }
    exp = e.get("expires", e.get("expirationDate"))
    if exp is not None:
        try:
            expf = float(exp)
            if expf > 0:
                cookie["expires"] = expf
        except (TypeError, ValueError):
            pass
    return cookie


def parse_cookie_text(text: str) -> list[dict]:
    """รองรับ 3 รูปแบบ: JSON array (Cookie-Editor), JSON object, สตริง c_user=...; xs=..."""
    text = (text or "").strip()
    if not text:
        raise CookieError("วาง cookie ก่อน")
    if text[0] in "[{":
        # บางทีค้างมาหลาย object คั่นด้วยบรรทัดว่าง
        try:
            data = json.loads(text)
        except Exception:
            chunks = [c.strip() for c in re.split(r"\n\s*\n", text) if c.strip()]
            data = []
            for c in chunks:
                try:
                    item = json.loads(c)
                except Exception as exc:
                    raise CookieError("JSON cookie ไม่ถูกต้อง: %s" % exc) from exc
                data.extend(item if isinstance(item, list) else [item])
        entries = data if isinstance(data, list) else [data]
        if entries and isinstance(entries[0], dict) and "cookies" in entries[0] and "user_id" not in str(entries[0].get("cookies", ""))[:0]:
            pass
        out = []
        for e in entries:
            if not isinstance(e, dict):
                raise CookieError("JSON cookie ต้องเป็น object แต่ละรายการ")
            if isinstance(e.get("cookies"), list):
                for sub in e["cookies"]:
                    if isinstance(sub, dict):
                        out.append(_from_entry(sub))
            else:
                out.append(_from_entry(e))
        if not out:
            raise CookieError("ไม่พบ cookie ใน JSON")
        return out
    # สตริง HTTP cookie
    out = []
    for pair in text.split(";"):
        pair = pair.strip()
        if not pair or "=" not in pair:
            continue
        name, _, value = pair.partition("=")
        name = name.strip()
        if not name:
            continue
        out.append({
            "name": name,
            "value": value.strip(),
            "domain": FB_DOMAIN,
            "path": "/",
            "httpOnly": False,
            "secure": True,
            "sameSite": "Lax",
        })
    if not out:
        raise CookieError("ไม่พบคู่ name=value ในสตริง")
    if not any(c["name"] == "c_user" for c in out):
        raise CookieError("ไม่พบ c_user — ต้องเป็น cookie ของ facebook.com")
    return out


def _chrome_time_to_unix(v: int) -> float:
    return v / 1_000_000 - 11_644_473_600


def profile_has_login(profile_dir: Path) -> bool | None:
    """อ่าน DB Cookies ของ Chrome โดยตรง (c_user ไม่ถูกเข้ารหัส)
    True=ล็อกอินอยู่ False=ไม่มี None=อ่านไม่ได้"""
    db = Path(profile_dir) / "Default" / "Cookies"
    if not db.is_file():
        return False
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".db")
        import os
        os.close(fd)
        shutil.copyfile(db, tmp)
        conn = sqlite3.connect(tmp)
        try:
            row = conn.execute(
                "SELECT expires_utc FROM cookies "
                "WHERE name = 'c_user' AND host_key LIKE '%facebook.com'"
            ).fetchone()
        finally:
            conn.close()
        if not row or not row[0]:
            return False
        exp = _chrome_time_to_unix(int(row[0]))
        return exp > time.time() if exp > 0 else True
    except Exception:
        return None
    finally:
        if tmp:
            try:
                import os
                os.unlink(tmp)
            except OSError:
                pass
