"""Data layer: multi-account CRUD over config['fb_accounts']."""
from __future__ import annotations

import copy
import re
import shutil
from pathlib import Path

from . import config as C


def _next_id(accounts: list[dict]) -> str:
    used = {a.get("id") for a in accounts}
    n = 1
    while "account-%d" % n in used:
        n += 1
    return "account-%d" % n


def ensure_accounts(cfg: dict) -> None:
    accounts = cfg.setdefault("fb_accounts", [])
    if not accounts:
        add_account(cfg, "บัญชี 1", login=False)
        return
    for acc in accounts:
        if not acc.get("id"):
            acc["id"] = _next_id(accounts)
        if not acc.get("dir"):
            acc["dir"] = str(Path("fb_profile") / acc["id"])
        if not acc.get("name"):
            acc["name"] = acc["id"]


def find_account(cfg: dict, account_id: str) -> dict | None:
    for acc in cfg.get("fb_accounts", []):
        if acc.get("id") == account_id:
            return acc
    return None


def active_account(cfg: dict) -> dict | None:
    acc = find_account(cfg, cfg.get("active_account", ""))
    if acc is None and cfg.get("fb_accounts"):
        acc = cfg["fb_accounts"][0]
        cfg["active_account"] = acc.get("id", "")
    return acc


def add_account(cfg: dict, name: str, login: bool = True) -> dict:
    accounts = cfg.setdefault("fb_accounts", [])
    acc = copy.deepcopy(C.DEFAULT_ACCOUNT)
    acc["id"] = _next_id(accounts)
    acc["name"] = (name or "").strip() or ("บัญชี %d" % (len(accounts) + 1))
    acc["dir"] = str(Path("fb_profile") / acc["id"])
    acc["settings"] = copy.deepcopy(C.DEFAULT_SETTINGS)
    accounts.append(acc)
    if not cfg.get("active_account"):
        cfg["active_account"] = acc["id"]
    return acc


def update_account(cfg: dict, account_id: str, patch: dict) -> dict | None:
    acc = find_account(cfg, account_id)
    if acc is None:
        return None
    for k in ("name", "webhook", "headless"):
        if k in patch:
            acc[k] = patch[k]
    if isinstance(patch.get("tasks"), dict):
        acc.setdefault("tasks", {}).update(patch["tasks"])
    if isinstance(patch.get("settings"), dict):
        acc["settings"] = C.deep_merge(acc.get("settings") or {}, patch["settings"])
    return acc


def remove_account(cfg: dict, account_id: str, purge: bool = False) -> bool:
    accounts = cfg.get("fb_accounts", [])
    idx = next((i for i, a in enumerate(accounts) if a.get("id") == account_id), None)
    if idx is None:
        return False
    accounts.pop(idx)
    if cfg.get("active_account") == account_id:
        cfg["active_account"] = accounts[0].get("id", "") if accounts else ""
    if purge:
        acc_dir = C.profile_dir({"id": account_id, "dir": ""})
        try:
            if acc_dir.is_dir() and acc_dir.is_relative_to(C.PROFILE_ROOT):
                shutil.rmtree(acc_dir, ignore_errors=True)
        except Exception:
            pass
        shutil.rmtree(C.DATA_DIR / account_id, ignore_errors=True)
    return True


def select_account(cfg: dict, account_id: str) -> bool:
    if find_account(cfg, account_id):
        cfg["active_account"] = account_id
        return True
    return False


def account_summary(cfg: dict, account: dict) -> dict:
    s = account.get("settings") or {}
    from . import storage
    from .fb_cookies import profile_has_login
    profile = C.profile_dir(account)
    logged = profile_has_login(profile)
    links = storage.read_post_links(account.get("id", ""))
    groups = storage.read_joined_groups(account.get("id", ""))["groups"]
    return {
        "id": account.get("id"),
        "name": account.get("name"),
        "exists": profile.is_dir(),
        "logged_in": logged,
        "headless": bool(account.get("headless")),
        "webhook": account.get("webhook") or "",
        "tasks": copy.deepcopy(account.get("tasks") or {}),
        "groups": len(s.get("group_urls") or []),
        "posts": len(s.get("comment_urls") or []),
        "shares": len(s.get("share_groups") or []),
        "joined": len(groups),
        "links": len(links),
        "loop_interval": int(float(s.get("loop_minutes") or 0) * 60),
        "share_gap": int(float(s.get("share_gap_hours") or 0) * 3600),
        "post_profile": s.get("post_profile") or "",
        "comment_profile": s.get("comment_profile") or "",
    }
