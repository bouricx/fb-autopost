"""Data layer: per-account text stores (post_links, joined_groups, cookies)."""
from __future__ import annotations

import json
import time
from pathlib import Path

from .config import DATA_DIR


def account_dir(account_id: str) -> Path:
    p = DATA_DIR / (account_id or "default")
    p.mkdir(parents=True, exist_ok=True)
    return p


def links_path(account_id: str) -> Path:
    return account_dir(account_id) / "post_links.txt"


def groups_path(account_id: str) -> Path:
    return account_dir(account_id) / "joined_groups.json"


def cookies_path(account_id: str) -> Path:
    return account_dir(account_id) / "cookies.json"


def append_post_link(account_id: str, group_name: str, url: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = "%s\t%s\t%s\n" % (ts, group_name or "-", url or "-")
    with links_path(account_id).open("a", encoding="utf-8") as f:
        f.write(line)


def read_post_links(account_id: str) -> list[dict]:
    p = links_path(account_id)
    if not p.is_file():
        return []
    out = []
    for raw in p.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = raw.split("\t")
        if len(parts) == 3:
            out.append({"time": parts[0], "group": parts[1], "url": parts[2]})
    return list(reversed(out))


def clear_post_links(account_id: str) -> list[dict]:
    links_path(account_id).write_text("", encoding="utf-8")
    return []


def save_joined_groups(account_id: str, groups: list[dict], fetched_at: str = "") -> None:
    payload = {"groups": groups, "fetched_at": fetched_at or time.strftime("%Y-%m-%dT%H:%M:%S")}
    groups_path(account_id).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def read_joined_groups(account_id: str) -> dict:
    p = groups_path(account_id)
    if not p.is_file():
        return {"groups": [], "fetched_at": ""}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("groups", [])
            data.setdefault("fetched_at", "")
            return data
    except Exception:
        pass
    return {"groups": [], "fetched_at": ""}


def save_cookies(account_id: str, cookies: list[dict]) -> None:
    cookies_path(account_id).write_text(
        json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_cookies(account_id: str) -> list[dict]:
    p = cookies_path(account_id)
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []
