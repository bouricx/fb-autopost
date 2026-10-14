"""Data layer: import settings from the exported files of the original program."""
from __future__ import annotations

import csv
import json
from pathlib import Path

from . import config as C


class ImportFormatError(ValueError):
    pass


EXPORT_MAP = {
    "post.content": "post_content",
    "post.group_urls": "group_urls",
    "post.image_dir": "image_dir",
    "post.image_extensions": "image_extensions",
    "post.profile_id": "post_profile",
    "timing.group_delay_min": "group_delay_min",
    "timing.group_delay_max": "group_delay_max",
    "timing.post_wait": "post_wait",
    "timing.loop_minutes": "loop_minutes",
    "timing.loop_enabled": "loop_enabled",
    "comment.text": "comment",
    "comment.post_urls": "comment_urls",
    "comment.rounds": "comment_rounds",
    "comment.delay_min": "comment_delay_min",
    "comment.delay_max": "comment_delay_max",
    "comment.round_delay_min": "comment_round_delay_min",
    "comment.round_delay_max": "comment_round_delay_max",
    "comment.image": "comment_image",
    "comment.profile_id": "comment_profile",
    "like.post_urls": "like_post_urls",
    "like.delay_min": "like_delay_min",
    "like.delay_max": "like_delay_max",
    "share.post_url": "share_post_url",
    "share.caption": "share_caption",
    "share.groups": "share_groups",
    "share.delay_min": "share_delay_min",
    "share.delay_max": "share_delay_max",
    "share.gap_hours": "share_gap_hours",
    "share.gap_enabled": "share_gap_enabled",
    "discord.message": "discord_message",
    "discord.channels": "discord_channels",
    "discord.image_dir": "discord_image_dir",
    "discord.loop_minutes": "discord_loop_minutes",
    "discord.loop_enabled": "discord_loop_enabled",
    "discord.delay_min": "discord_delay_min",
    "discord.delay_max": "discord_delay_max",
    "discord.attach_images": "discord_attach",
}

LIST_FIELDS = {
    "group_urls", "comment_urls", "like_post_urls", "share_groups",
    "discord_channels", "image_extensions",
}


def _coerce(key: str, value):
    if key in LIST_FIELDS:
        if isinstance(value, list):
            return [str(v) for v in value]
        return [ln.strip() for ln in str(value or "").splitlines() if ln.strip()]
    if key in ("loop_enabled", "share_gap_enabled", "discord_attach", "discord_loop_enabled"):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "y", "on")
    if key.endswith(("_min", "_max", "_wait", "_rounds", "_minutes", "_hours")):
        try:
            f = float(value)
            return int(f) if f.is_integer() else f
        except (TypeError, ValueError):
            return value
    return value


def _export_json_to_settings(data: dict) -> list[tuple[str, dict]]:
    """autopost_settings_export.json → [(account_name, settings), ...]"""
    out = []
    for acc in data.get("accounts") or []:
        if not isinstance(acc, dict):
            continue
        settings: dict = {}
        for src, dst in EXPORT_MAP.items():
            node = acc
            ok = True
            for part in src.split("."):
                if isinstance(node, dict) and part in node:
                    node = node[part]
                else:
                    ok = False
                    break
            if ok and node not in (None, "", []):
                settings[dst] = _coerce(dst, node)
        if acc.get("profiles"):
            settings["profiles"] = acc["profiles"]
        out.append((str(acc.get("account_name") or "imported"), settings))
    return out


def _export_csv_to_settings(path: Path) -> list[tuple[str, dict]]:
    grouped: dict[str, dict] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            acct = row.get("account") or "imported"
            field = (row.get("field") or "").strip()
            value = row.get("value") or ""
            dst = EXPORT_MAP.get(field)
            if not dst:
                continue
            grouped.setdefault(acct, {})[dst] = _coerce(dst, value)
    if not grouped:
        raise ImportFormatError("CSV ไม่มีคอลัมน์ account/field/value ที่รู้จัก")
    return list(grouped.items())


def _legacy_config_to_settings(data: dict) -> list[tuple[str, dict]]:
    """config.json รุ่นเดิม (flat หรือ fb_accounts) → [(name, settings), ...]"""
    out = []
    accounts = data.get("fb_accounts")
    if isinstance(accounts, list) and accounts:
        for acc in accounts:
            if not isinstance(acc, dict):
                continue
            merged = dict(acc)
            if isinstance(acc.get("settings"), dict):
                for k, v in acc["settings"].items():
                    merged.setdefault(k, v)
            out.append((str(acc.get("name") or acc.get("id") or "imported"), merged))
        top_keys = ("discord_token", "discord_webhook_url", "webhook", "image_extensions")
        for k in top_keys:
            if data.get(k) and out:
                dst = "discord_webhook" if k == "discord_webhook_url" else k
                for _, st in out:
                    st.setdefault(dst, data[k])
    else:
        out.append((str(data.get("name") or "imported"), data))
    return out


def import_file(path: str | Path) -> list[tuple[str, dict]]:
    """คืน [(account_name, settings_dict), ...] — settings ผ่าน normalize แล้ว"""
    p = Path(path)
    if not p.is_file():
        raise ImportFormatError("ไม่พบไฟล์: %s" % p)
    suffix = p.suffix.lower()
    if suffix == ".csv":
        pairs = _export_csv_to_settings(p)
    else:
        try:
            data = json.loads(p.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            raise ImportFormatError("อ่าน JSON ไม่ได้: %s" % exc) from exc
        if not isinstance(data, dict):
            raise ImportFormatError("JSON ต้องเป็น object")
        if "accounts" in data and data.get("schema"):
            pairs = _export_json_to_settings(data)
        else:
            pairs = _legacy_config_to_settings(data)
    cleaned = []
    for name, raw in pairs:
        settings = C.normalize_settings(C.deep_merge(C.DEFAULT_SETTINGS, raw))
        # ลบที่คีย์นี้ไม่ใช่ settings (กันคีย์บัญชีไหลเข้า)
        for junk in ("id", "name", "dir", "webhook", "headless", "tasks", "settings"):
            if junk in settings and not isinstance(C.DEFAULT_SETTINGS.get(junk), (dict, list)):
                settings.pop(junk, None)
        cleaned.append((name, settings))
    if not cleaned:
        raise ImportFormatError("ไม่พบข้อมูลที่นำเข้าได้ในไฟล์นี้")
    return cleaned


def apply_import(cfg: dict, pairs: list[tuple[str, dict]], mode: str = "merge") -> list[str]:
    """mode='merge': เข้าทับบัญชี active | mode='accounts': สร้าง/อัปเดตบัญชีตามชื่อ"""
    done = []
    if mode == "accounts":
        from . import fb_accounts as A
        for name, settings in pairs:
            acc = next(
                (a for a in cfg.get("fb_accounts", []) if a.get("name") == name), None
            )
            if acc is None:
                acc = A.add_account(cfg, name, login=False)
            base = acc.get("settings") or {}
            acc["settings"] = C.normalize_settings(C.deep_merge(base, settings))
            done.append(acc["name"])
        return done
    from . import fb_accounts as A
    acc = A.active_account(cfg)
    if acc is None:
        acc = A.add_account(cfg, pairs[0][0], login=False)
    for _, settings in pairs[:1]:
        acc["settings"] = C.normalize_settings(
            C.deep_merge(acc.get("settings") or {}, settings)
        )
    done.append(acc["name"])
    return done
