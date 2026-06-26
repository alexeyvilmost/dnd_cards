"""Effect engine — the shared core behind the universal definition constructor.

A *definition* (background / origin feat / general feat / fighting style) carries a
list of typed ``effects``. This module:

  * describes the effect schema (for the builder UI / validation),
  * validates a definition document,
  * applies build-time grants to a character sheet (ability scores, proficiencies,
    granted feats), and
  * applies numeric combat effects to a materialized ``models.Character``.

Per design: numeric/simple effects are applied for real; complex effects (special
reactions, bonus attacks, triggers) are stored as data + description and surfaced
in the UI, but not simulated by the current engine.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]

SKILLS = [
    "acrobatics", "animal_handling", "arcana", "athletics", "deception", "history",
    "insight", "intimidation", "investigation", "medicine", "nature", "perception",
    "performance", "persuasion", "religion", "sleight_of_hand", "stealth", "survival",
]

KINDS = ["background", "origin_feat", "general_feat", "fighting_style"]

# Combat stats a `combat_mod` effect may target → how they map onto models.Character.
COMBAT_STATS = [
    "ac", "hp", "hp_per_level", "attack", "melee_attack", "ranged_attack",
    "damage", "speed", "initiative",
]

# Effect type schema (also returned by the meta endpoint so the builder UI can render
# the right inputs for each effect type).
EFFECT_SCHEMA: Dict[str, Dict[str, Any]] = {
    "ability_score": {
        "label": "Характеристики",
        "fields": {
            "mode": ["fixed", "choose"],
            "ability": ABILITIES,            # mode=fixed
            "from": ABILITIES,               # mode=choose (list)
            "amount": "int",
            "count": "int",                  # mode=choose: how many picks
        },
    },
    "skill_proficiency": {
        "label": "Владение навыками",
        "fields": {"fixed": SKILLS, "choose_from": SKILLS, "choose_count": "int"},
    },
    "tool_proficiency": {
        "label": "Владение инструментами",
        "fields": {"fixed": "str[]", "choose_count": "int"},
    },
    "saving_throw_proficiency": {
        "label": "Владение спасбросками",
        "fields": {"abilities": ABILITIES},
    },
    "proficiency": {
        "label": "Владения (доспехи/оружие)",
        "fields": {"category": ["armor", "weapon"], "values": "str[]"},
    },
    "grant_origin_feat": {
        "label": "Выдать черту происхождения",
        "fields": {"feat": "definition_id|name"},
    },
    "grant_cantrip": {
        "label": "Выдать заговоры",
        "fields": {"count": "int", "list": "str[]"},
    },
    "grant_spell": {
        "label": "Выдать заклинания",
        "fields": {"count": "int", "max_level": "int", "list": "str[]"},
    },
    "grant_fighting_style": {
        "label": "Выдать боевой стиль",
        "fields": {"count": "int"},
    },
    "combat_mod": {
        "label": "Боевой модификатор",
        "fields": {
            "stat": COMBAT_STATS,
            "amount": "int",
            "condition": ["always", "wearing_armor", "unarmored", "two_handed", "ranged"],
        },
    },
    "resource": {
        "label": "Ресурс",
        "fields": {"key": "str", "amount": "int", "recharge": ["short", "long", "day"]},
    },
    "feature": {
        "label": "Особенность (текст/флаг)",
        "fields": {"key": "str", "label": "str"},
    },
}


def schema() -> Dict[str, Any]:
    return {
        "kinds": KINDS,
        "abilities": ABILITIES,
        "skills": SKILLS,
        "effect_types": EFFECT_SCHEMA,
    }


# ─── validation ──────────────────────────────────────────────────────────────

def validate_definition(doc: Dict[str, Any]) -> Optional[str]:
    if not isinstance(doc, dict):
        return "Определение должно быть объектом"
    kind = doc.get("kind")
    if kind not in KINDS:
        return f"kind должен быть одним из: {', '.join(KINDS)}"
    if not (doc.get("name") or "").strip():
        return "Не задано название (name)"
    effects = doc.get("effects", [])
    if not isinstance(effects, list):
        return "effects должен быть списком"
    for i, eff in enumerate(effects):
        err = _validate_effect(eff)
        if err:
            return f"effects[{i}]: {err}"
    # background must offer 3 ability options + grant an origin feat
    if kind == "background":
        opts = doc.get("ability_options") or []
        if len(opts) != 3 or any(a not in ABILITIES for a in opts):
            return "background: ability_options должен содержать ровно 3 характеристики"
    return None


def _validate_effect(eff: Any) -> Optional[str]:
    if not isinstance(eff, dict):
        return "эффект должен быть объектом"
    t = eff.get("type")
    if t not in EFFECT_SCHEMA:
        return f"неизвестный тип эффекта '{t}'"
    if t == "ability_score":
        if eff.get("mode") not in ("fixed", "choose"):
            return "ability_score.mode: fixed|choose"
        if eff.get("mode") == "fixed" and eff.get("ability") not in ABILITIES:
            return "ability_score.ability неверна"
        if not isinstance(eff.get("amount", 1), int):
            return "ability_score.amount должен быть числом"
    if t == "combat_mod":
        if eff.get("stat") not in COMBAT_STATS:
            return f"combat_mod.stat должен быть из: {', '.join(COMBAT_STATS)}"
        if not isinstance(eff.get("amount", 0), int):
            return "combat_mod.amount должен быть числом"
    if t == "skill_proficiency":
        for s in eff.get("fixed", []) or []:
            if s not in SKILLS:
                return f"неизвестный навык '{s}'"
    return None


# ─── build-time application (character sheet) ────────────────────────────────

def apply_background(sheet: Dict[str, Any], bg: Dict[str, Any], ability_choice: Dict[str, int]) -> None:
    """Apply a background to a fresh sheet: ability bonuses (player's distribution),
    skill/tool proficiencies, and record the granted origin feat id."""
    _validate_ability_choice(bg, ability_choice)
    scores = sheet.setdefault("ability_scores", {})
    for ab, bonus in ability_choice.items():
        scores[ab] = int(scores.get(ab, 10)) + int(bonus)

    for eff in bg.get("effects", []):
        _apply_sheet_effect(sheet, eff)
    sheet["background"] = bg["id"]


def _validate_ability_choice(bg: Dict[str, Any], choice: Dict[str, int]) -> None:
    opts = set(bg.get("ability_options") or [])
    if not choice:
        raise ValueError("Не выбрано распределение характеристик предыстории")
    if any(ab not in opts for ab in choice):
        raise ValueError("Характеристики вне списка предыстории")
    vals = sorted(choice.values(), reverse=True)
    if vals not in ([2, 1], [1, 1, 1]):
        raise ValueError("Распределение должно быть +2/+1 или +1/+1/+1 среди трёх характеристик")


def _apply_sheet_effect(sheet: Dict[str, Any], eff: Dict[str, Any]) -> None:
    t = eff.get("type")
    if t == "skill_proficiency":
        skills = sheet.setdefault("skill_proficiencies", [])
        for s in eff.get("fixed", []) or []:
            if s not in skills:
                skills.append(s)
    elif t == "tool_proficiency":
        tools = sheet.setdefault("tool_proficiencies", [])
        for tname in eff.get("fixed", []) or []:
            if tname not in tools:
                tools.append(tname)
    elif t == "grant_origin_feat":
        feats = sheet.setdefault("feats", [])
        feat = eff.get("feat")
        if feat and feat not in feats:
            feats.append(feat)


def apply_feat_grants(sheet: Dict[str, Any], feat: Dict[str, Any], sign: int = 1) -> None:
    """Apply (sign=+1) or revert (sign=-1) a feat's one-time sheet grants:
    fixed ability score increases and fixed skill proficiencies. Combat effects
    are applied separately at materialization. Records the feat id in sheet.feats."""
    scores = sheet.setdefault("ability_scores", {})
    skills = sheet.setdefault("skill_proficiencies", [])
    for eff in feat.get("effects", []):
        t = eff.get("type")
        if t == "ability_score" and eff.get("mode") == "fixed":
            ab = eff.get("ability")
            if ab in ABILITIES:
                scores[ab] = int(scores.get(ab, 10)) + sign * int(eff.get("amount", 1))
        elif t == "skill_proficiency":
            for s in eff.get("fixed", []) or []:
                if sign > 0 and s not in skills:
                    skills.append(s)
                elif sign < 0 and s in skills:
                    skills.remove(s)
    feats = sheet.setdefault("feats", [])
    if sign > 0 and feat["id"] not in feats:
        feats.append(feat["id"])
    elif sign < 0 and feat["id"] in feats:
        feats.remove(feat["id"])


# ─── combat application (materialized Character) ─────────────────────────────

def apply_definitions_to_combat(char: Any, defs: List[Dict[str, Any]]) -> None:
    """Apply numeric combat effects from a list of definitions onto a Character."""
    for d in defs:
        for eff in (d or {}).get("effects", []):
            if eff.get("type") == "combat_mod":
                _apply_combat_mod(char, eff)


def _condition_ok(char: Any, condition: str) -> bool:
    if condition in (None, "always"):
        return True
    if condition == "wearing_armor":
        return getattr(char, "armor", None) is not None
    if condition == "unarmored":
        return getattr(char, "armor", None) is None
    if condition == "two_handed":
        mh = getattr(char, "main_hand", None)
        return bool(mh and getattr(mh, "two_handed", False))
    if condition == "ranged":
        return True  # ranged handled via stat=ranged_attack
    return True


def _apply_combat_mod(char: Any, eff: Dict[str, Any]) -> None:
    if not _condition_ok(char, eff.get("condition", "always")):
        return
    stat = eff.get("stat")
    amount = int(eff.get("amount", 0))
    level = getattr(char, "level", 1) or 1
    if stat == "ac":
        char.ac += amount
    elif stat == "hp":
        char.max_hp += amount
        char.hp += amount
    elif stat == "hp_per_level":
        char.max_hp += amount * level
        char.hp += amount * level
    elif stat == "attack":
        char.item_attack_bonus += amount
    elif stat == "melee_attack":
        char.melee_attack_bonus = getattr(char, "melee_attack_bonus", 0) + amount
    elif stat == "ranged_attack":
        char.ranged_attack_bonus = getattr(char, "ranged_attack_bonus", 0) + amount
    elif stat == "damage":
        char.item_damage_bonus += amount
    elif stat == "speed":
        char.speed += amount
    elif stat == "initiative":
        char.initiative_bonus = getattr(char, "initiative_bonus", 0) + amount
