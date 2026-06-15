"""Persistence for saved character templates.

Uses PostgreSQL when a database is configured (``DATABASE_URL`` or ``DB_*`` env,
same convention as the main dnd_cards backend); otherwise falls back to one JSON
file per character under ``saved_characters/`` so local dev works without a DB.

Public interface (save / list / get / delete) is backend-agnostic.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

import db

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "saved_characters")


# ─── helpers ──────────────────────────────────────────────────────────────────


def _ensure_dir() -> None:
    os.makedirs(_DIR, exist_ok=True)


def _path(char_id: str) -> str:
    return os.path.join(_DIR, f"{char_id}.json")


def _stamp(template: Dict) -> Dict:
    """Assign id + timestamps before persisting."""
    template["id"] = template.get("id") or uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()
    template.setdefault("created_at", now)
    template["updated_at"] = now
    return template


# ─── public API (DB when enabled, files otherwise) ────────────────────────────


def backend() -> str:
    return "postgres" if db.enabled() else "files"


def save_character(template: Dict) -> Dict:
    _stamp(template)
    if db.enabled():
        return db.save_character(template)
    _ensure_dir()
    with open(_path(template["id"]), "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    return template


def list_characters() -> List[Dict]:
    if db.enabled():
        return db.list_characters()
    _ensure_dir()
    out: List[Dict] = []
    for fn in os.listdir(_DIR):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(_DIR, fn), encoding="utf-8") as f:
                out.append(json.load(f))
        except (OSError, json.JSONDecodeError):
            continue
    out.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return out


def get_character(char_id: str) -> Optional[Dict]:
    if db.enabled():
        return db.get_character(char_id)
    try:
        with open(_path(char_id), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def delete_character(char_id: str) -> bool:
    if db.enabled():
        return db.delete_character(char_id)
    try:
        os.remove(_path(char_id))
        return True
    except OSError:
        return False
