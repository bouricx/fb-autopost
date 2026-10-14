"""Data layer: config.json load/save with defaults merge and legacy migration."""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

APP_NAME = "AutoPost"
APP_VERSION = "1.0.0"


def base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


BASE_DIR = base_dir()
CONFIG_PATH = BASE_DIR / "config.json"
DATA_DIR = BASE_DIR / "data"
PROFILE_ROOT = BASE_DIR / "fb_profile"
IMAGES_DIR = BASE_DIR / "images"
IMAGES_DISCORD_DIR = BASE_DIR / "images_discord"

DEFAULT_SETTINGS: dict = {
    "post_content": "",
    "group_urls": [],
    "image_dir": str(IMAGES_DIR),
    "group_delay_min": 45,
    "group_delay_max": 90,
    "post_wait": 10,
    "loop_enabled": False,
    "loop_minutes": 0,
    "post_profile": "",
    "comment_profile": "",
    "comment": "",
    "comment_urls": [],
    "comment_rounds": 1,
    "comment_delay_min": 20,
    "comment_delay_max": 45,
    "comment_round_delay_min": 60,
    "comment_round_delay_max": 120,
    "comment_image": "",
    "like_post_urls": [],
    "like_delay_min": 10,
    "like_delay_max": 25,
    "share_post_url": "",
    "share_caption": "",
    "share_groups": [],
    "share_delay_min": 60,
    "share_delay_max": 120,
    "share_gap_enabled": False,
    "share_gap_hours": 0,
    "discord_token": "",
    "discord_message": "",
    "discord_channels": [],
    "discord_delay_min": 30,
    "discord_delay_max": 60,
    "discord_attach": False,
    "discord_image_dir": str(IMAGES_DISCORD_DIR),
    "discord_loop_enabled": False,
    "discord_loop_minutes": 0,
    "discord_webhook": "",
    "profiles": {"post": [], "comment": []},
}

DEFAULT_ACCOUNT: dict = {
    "id": "",
    "name": "",
    "dir": "",
    "webhook": "",
    "headless": False,
    "tasks": {"post": True, "comment": False, "share": False},
    "settings": {},
}

DEFAULT_CONFIG: dict = {
    "accounts_version": 1,
    "active_account": "",
    "webhook": "",
    "image_extensions": ".jpg,.jpeg,.png,.gif,.webp,.bmp",
    "fb_accounts": [],
}

# keys ที่ merge แบบ recursive (dict ระดับในสุด) นอกนั้นแทนที่ทั้งก้อน
NESTED_KEYS = {"profiles"}


def ensure_dirs() -> None:
    for p in (DATA_DIR, PROFILE_ROOT, IMAGES_DIR, IMAGES_DISCORD_DIR):
        p.mkdir(parents=True, exist_ok=True)


def deep_merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if k in NESTED_KEYS and isinstance(v, dict) and isinstance(out.get(k), dict):
            sub = copy.deepcopy(out[k])
            for sk, sv in v.items():
                sub[sk] = copy.deepcopy(sv)
            out[k] = sub
        else:
            out[k] = copy.deepcopy(v)
    return out


def normalize_settings(raw: dict) -> dict:
    """แปลงคีย์รุ่นเก่า (group_delay เดี่ยว, loop_interval วิ, comment_push) เป็นรุ่นใหม่"""
    d = copy.deepcopy(raw or {})
    for block in ("comment_push", "like_push", "share_push", "discord_promote"):
        b = d.get(block)
        if isinstance(b, dict):
            for k, v in b.items():
                d.setdefault(k, v)
            d.pop(block, None)
    if d.get("group_delay") is not None and d.get("group_delay_min") in (None, ""):
        gd = d.pop("group_delay")
        if isinstance(gd, dict):
            d["group_delay_min"] = gd.get("min")
            d["group_delay_max"] = gd.get("max")
        elif isinstance(gd, (list, tuple)) and len(gd) == 2:
            d["group_delay_min"], d["group_delay_max"] = gd
        else:
            d["group_delay_min"] = d["group_delay_max"] = gd
    d.pop("group_delay", None)
    if d.get("loop_minutes") in (None, "") and d.get("loop_interval") not in (None, ""):
        try:
            d["loop_minutes"] = round(float(d["loop_interval"]) / 60, 2)
        except (TypeError, ValueError):
            pass
    d.pop("loop_interval", None)
    for list_key in ("group_urls", "comment_urls", "post_urls", "like_post_urls",
                     "share_groups", "discord_channels"):
        v = d.get(list_key)
        if isinstance(v, str):
            d[list_key] = [ln.strip() for ln in v.splitlines() if ln.strip()]
        elif v is None:
            d[list_key] = []
    if isinstance(d.get("profiles"), str):
        try:
            d["profiles"] = json.loads(d["profiles"])
        except Exception:
            d["profiles"] = {"post": [], "comment": []}
    prof = d.get("profiles")
    if not isinstance(prof, dict):
        d["profiles"] = {"post": [], "comment": []}
    else:
        d["profiles"].setdefault("post", [])
        d["profiles"].setdefault("comment", [])
    return d


def load_config() -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if CONFIG_PATH.is_file():
        try:
            raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
            if isinstance(raw, dict):
                cfg = deep_merge(cfg, raw)
        except Exception:
            pass
    accounts = cfg.get("fb_accounts")
    if not isinstance(accounts, list):
        accounts = []
        cfg["fb_accounts"] = accounts
    for acc in accounts:
        if not isinstance(acc, dict):
            continue
        merged_acc = deep_merge(DEFAULT_ACCOUNT, acc)
        merged_acc["settings"] = normalize_settings(
            deep_merge(DEFAULT_SETTINGS, acc.get("settings") or {})
        )
        merged_acc["tasks"] = deep_merge(DEFAULT_ACCOUNT["tasks"], acc.get("tasks") or {})
        acc.clear()
        acc.update(merged_acc)
    if accounts and not cfg.get("active_account"):
        cfg["active_account"] = accounts[0].get("id", "")
    return cfg


def save_config(cfg: dict) -> None:
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, CONFIG_PATH)


def profile_dir(account: dict) -> Path:
    d = account.get("dir") or ""
    p = Path(d) if d else PROFILE_ROOT / (account.get("id") or "default")
    if not p.is_absolute():
        p = BASE_DIR / p
    return p


def ext_list(cfg: dict, settings: dict | None = None) -> list[str]:
    src = ""
    if settings and settings.get("image_extensions"):
        src = str(settings["image_extensions"])
    else:
        src = str(cfg.get("image_extensions") or "")
    out = []
    for e in src.replace(";", ",").split(","):
        e = e.strip().lower()
        if not e:
            continue
        out.append(e if e.startswith(".") else "." + e)
    return out or [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]
