"""Spell catalog backed by the database (``battle_spells``).

The in-code catalog in :mod:`spells` is used as *seed data*: on first use the
~64 built-in spells are written to the store (PostgreSQL or files). After that
the engine and the UI read spells from the store, so spells can be created and
edited at runtime. Lookups fall back to the in-code catalog if a name isn't in
the store (robustness).
"""

from __future__ import annotations

import hashlib
from typing import Dict, List, Optional

import spells as code_spells
from models import Spell
from spells_repo import spells as repo

_SPELL_FIELDS = set(Spell.model_fields.keys())
_seeded = False
_cache: Dict[str, Spell] = {}
_cache_loaded = False


def _slug_id(name: str) -> str:
    return hashlib.md5(name.encode("utf-8")).hexdigest()[:8]


def _to_spell(doc: dict) -> Spell:
    data = {k: v for k, v in doc.items() if k in _SPELL_FIELDS}
    return Spell(**data)


def _doc_from_spell(spell: Spell, spell_id: Optional[str] = None) -> dict:
    doc = spell.model_dump()
    doc["id"] = spell_id or _slug_id(spell.name)
    return doc


def ensure_seeded() -> None:
    global _seeded
    if _seeded:
        return
    existing = repo.list()
    if not existing:
        for s in code_spells.SPELLS.values():
            repo.save(_doc_from_spell(s))
    _seeded = True
    _invalidate()


def _invalidate() -> None:
    global _cache_loaded
    _cache_loaded = False


def _load() -> None:
    global _cache, _cache_loaded
    ensure_seeded()
    if _cache_loaded:
        return
    out: Dict[str, Spell] = {}
    for doc in repo.list():
        try:
            out[doc["name"]] = _to_spell(doc)
        except Exception:
            continue
    _cache = out
    _cache_loaded = True


# ─── public API ─────────────────────────────────────────────────────────────

def get_spell(name: str) -> Optional[Spell]:
    _load()
    return _cache.get(name) or code_spells.get_spell(name)


def list_spells() -> List[dict]:
    ensure_seeded()
    docs = repo.list()
    docs.sort(key=lambda d: (d.get("level", 0), d.get("name", "")))
    return docs


def spells_by_level(level: int) -> List[Spell]:
    _load()
    return [s for s in _cache.values() if s.level == level]


def get_doc(spell_id: str) -> Optional[dict]:
    ensure_seeded()
    return repo.get(spell_id)


def create_spell(payload: dict) -> dict:
    spell, err = validate(payload)
    if err:
        raise ValueError(err)
    doc = _doc_from_spell(spell)
    # Avoid duplicate names.
    for d in repo.list():
        if d.get("name") == spell.name:
            raise ValueError(f"Заклинание '{spell.name}' уже существует")
    saved = repo.save(doc)
    _invalidate()
    return saved


def update_spell(spell_id: str, payload: dict) -> dict:
    existing = repo.get(spell_id)
    if not existing:
        raise ValueError("Заклинание не найдено")
    merged = {**existing, **payload}
    spell, err = validate(merged)
    if err:
        raise ValueError(err)
    doc = _doc_from_spell(spell, spell_id=spell_id)
    doc["created_at"] = existing.get("created_at")
    saved = repo.save(doc)
    _invalidate()
    return saved


def delete_spell(spell_id: str) -> bool:
    ok = repo.delete(spell_id)
    _invalidate()
    return ok


def validate(payload: dict) -> tuple[Optional[Spell], Optional[str]]:
    """Validate a spell payload; returns (Spell, None) or (None, error)."""
    data = {k: v for k, v in payload.items() if k in _SPELL_FIELDS}
    try:
        spell = Spell(**data)
    except Exception as e:
        return None, f"Некорректные данные: {e}"
    if not spell.name.strip():
        return None, "Имя обязательно"
    valid_effects = {"attack", "save", "heal", "buff", "utility"}
    if spell.effect not in valid_effects:
        return None, f"effect должен быть одним из {sorted(valid_effects)}"
    # Battle-readiness checks for mechanical effects.
    if spell.battle_ready:
        if spell.effect == "attack" and not (spell.damage_dice or spell.auto_hit):
            return None, "Атакующее заклинание требует damage_dice (или auto_hit)"
        if spell.effect == "save":
            if not spell.save_ability:
                return None, "Заклинание со спасброском требует save_ability"
            if not spell.damage_dice and not spell.condition and not spell.effect_options:
                return None, "Заклинание со спасброском требует урон, состояние или варианты эффекта"
        if spell.effect == "heal" and not spell.heal_dice and spell.name not in ("Spare the Dying",):
            return None, "Лечащее заклинание требует heal_dice"
    return spell, None
