"""Character progression for the battle service (D&D 2024, MVP scope).

Scope for version 1:
  - Classes: Fighter and Wizard.
  - Species: Human (no ability bonuses; one extra skill proficiency, cosmetic).
  - Levels 1-3, with meaningful choices at each level.
  - XP-based advancement (award after combat -> level up with option picks).

A *character sheet* is a plain dict persisted in ``battle_characters``. It is
materialized into an in-combat :class:`models.Character` via
:func:`build_combat_character` when entering a room.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import engine
import spell_catalog
from models import AbilityScores, Character, FightingStyle, Position, WeaponMastery

# ─── XP / levels ────────────────────────────────────────────────────────────

XP_THRESHOLDS = {1: 0, 2: 300, 3: 900, 4: 2700}
MAX_LEVEL = 3  # v1 cap

POINT_BUY_COST = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9}
POINT_BUY_TOTAL = 27

CLASSES = ["Fighter", "Wizard"]
RACES = ["Human"]

ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]

FIGHTER_STYLES = [
    {"key": "dueling", "label": "Дуэлянт (+2 к урону одноручным)"},
    {"key": "great_weapon", "label": "Большое оружие (переброс 1–2 урона)"},
    {"key": "defense", "label": "Защита (+1 КД в доспехе)"},
    {"key": "archery", "label": "Стрельба (+2 к дальним атакам)"},
    {"key": "two_weapon", "label": "Бой двумя оружиями"},
]

WEAPON_MASTERIES = [
    {"key": "sap", "label": "Sap (помеха на след. атаку цели)"},
    {"key": "topple", "label": "Topple (сбивание с ног)"},
    {"key": "push", "label": "Push (отталкивание на 10 фт)"},
    {"key": "slow", "label": "Slow (−10 фт скорости)"},
    {"key": "vex", "label": "Vex (преимущество на след. атаку)"},
    {"key": "graze", "label": "Graze (урон при промахе)"},
    {"key": "cleave", "label": "Cleave (атака по соседу)"},
    {"key": "nick", "label": "Nick (доп. атака без бонусного действия)"},
]

WEAPON_LOADOUTS = [
    {"key": "longsword_shield", "label": "Длинный меч + щит (КД 18)"},
    {"key": "greatsword", "label": "Двуручный меч (КД 16)"},
]

FIGHTER_SUBCLASSES = [
    {"key": "champion", "label": "Чемпион (крит на 19–20)"},
    {"key": "battle_master", "label": "Мастер боя (тактик)"},
]
WIZARD_SUBCLASSES = [
    {"key": "evoker", "label": "Эвокатор (урон)"},
    {"key": "abjurer", "label": "Абьюратор (защита)"},
]

# Prepared-spell counts for the Wizard at levels 1-3 (2024 table).
WIZARD_PREPARED = {1: 4, 2: 5, 3: 6}
WIZARD_CANTRIPS_KNOWN = {1: 3, 2: 3, 3: 3}


# ─── helpers ────────────────────────────────────────────────────────────────

def level_for_xp(xp: int) -> int:
    lvl = 1
    for l in range(2, MAX_LEVEL + 1):
        if xp >= XP_THRESHOLDS[l]:
            lvl = l
    return lvl


def xp_to_next(xp: int, level: int) -> Optional[int]:
    if level >= MAX_LEVEL:
        return None
    return XP_THRESHOLDS[level + 1] - xp


def validate_point_buy(scores: Dict[str, int]) -> Optional[str]:
    total = 0
    for ab in ABILITIES:
        v = scores.get(ab)
        if v is None:
            return f"Не задана характеристика {ab}"
        if v not in POINT_BUY_COST:
            return f"{ab}={v}: допустимы значения 8–15 (point-buy)"
        total += POINT_BUY_COST[v]
    if total > POINT_BUY_TOTAL:
        return f"Превышен бюджет point-buy: {total} > {POINT_BUY_TOTAL}"
    return None


def cantrip_options() -> List[str]:
    return sorted(s.name for s in spell_catalog.spells_by_level(0))


def spell_options(max_level: int) -> List[str]:
    out: List[str] = []
    for lvl in range(1, max_level + 1):
        out += [s.name for s in spell_catalog.spells_by_level(lvl)]
    return sorted(set(out))


def max_spell_level(char_level: int) -> int:
    # Wizard gains 2nd-level slots at character level 3.
    return 2 if char_level >= 3 else 1


# ─── create options (for the builder UI) ────────────────────────────────────

def create_options() -> Dict[str, Any]:
    return {
        "classes": CLASSES,
        "races": RACES,
        "abilities": ABILITIES,
        "point_buy": {"cost": POINT_BUY_COST, "total": POINT_BUY_TOTAL},
        "fighter": {
            "fighting_styles": FIGHTER_STYLES,
            "weapon_masteries": WEAPON_MASTERIES,
            "weapon_loadouts": WEAPON_LOADOUTS,
            "masteries_to_pick": 2,
        },
        "wizard": {
            "cantrips": cantrip_options(),
            "cantrips_to_pick": WIZARD_CANTRIPS_KNOWN[1],
            "spells": spell_options(1),
            "spells_to_pick": WIZARD_PREPARED[1],
        },
    }


# ─── new character sheet ────────────────────────────────────────────────────

def new_sheet(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Validate creation payload and return a normalized level-1 sheet."""
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("Имя обязательно")
    class_name = payload.get("class_name")
    if class_name not in CLASSES:
        raise ValueError("Класс должен быть Fighter или Wizard")
    scores = payload.get("ability_scores") or {}
    err = validate_point_buy(scores)
    if err:
        raise ValueError(err)

    sheet: Dict[str, Any] = {
        "name": name,
        "owner": payload.get("owner"),
        "class_name": class_name,
        "race": "Human",
        "level": 1,
        "xp": 0,
        "ability_scores": {ab: int(scores[ab]) for ab in ABILITIES},
        "skill_proficiencies": payload.get("skill_proficiencies", []),
        "portrait": payload.get("portrait"),
        "background": payload.get("background"),
        "gold": int(payload.get("gold", 0)),
        "equipment": payload.get("equipment", []),
        "subclass": None,
        "features": [],
    }

    if class_name == "Fighter":
        style = payload.get("fighting_style")
        valid_styles = {s["key"] for s in FIGHTER_STYLES}
        if style not in valid_styles:
            raise ValueError("Выберите боевой стиль")
        masteries = payload.get("weapon_masteries", [])
        valid_m = {m["key"] for m in WEAPON_MASTERIES}
        if len(masteries) != 2 or any(m not in valid_m for m in masteries):
            raise ValueError("Выберите ровно 2 мастерства оружия")
        loadout = payload.get("weapon_choice", "longsword_shield")
        if loadout not in {w["key"] for w in WEAPON_LOADOUTS}:
            raise ValueError("Неверный набор снаряжения")
        sheet.update(
            fighting_style=style,
            weapon_masteries=masteries,
            weapon_choice=loadout,
            cantrips=[],
            spells_prepared=[],
        )
        sheet["features"] = ["second_wind", "weapon_mastery"]
    else:  # Wizard
        cantrips = payload.get("cantrips", [])
        if len(cantrips) != WIZARD_CANTRIPS_KNOWN[1]:
            raise ValueError(f"Выберите {WIZARD_CANTRIPS_KNOWN[1]} заговора")
        prepared = payload.get("spells_prepared", [])
        if len(prepared) != WIZARD_PREPARED[1]:
            raise ValueError(f"Подготовьте {WIZARD_PREPARED[1]} заклинания 1 круга")
        sheet.update(
            fighting_style=None,
            weapon_masteries=[],
            weapon_choice=None,
            cantrips=cantrips,
            spells_prepared=prepared,
        )
        sheet["features"] = ["arcane_recovery", "ritual_adept"]

    return sheet


# ─── level-up ───────────────────────────────────────────────────────────────

def level_up_options(sheet: Dict[str, Any]) -> Dict[str, Any]:
    """Describe the choices required to advance to the next level."""
    cur = sheet["level"]
    if cur >= MAX_LEVEL:
        return {"can_level_up": False, "reason": "Достигнут максимальный уровень (v1: 3)"}
    needed = XP_THRESHOLDS[cur + 1]
    if sheet.get("xp", 0) < needed:
        return {
            "can_level_up": False,
            "reason": f"Недостаточно опыта: {sheet.get('xp', 0)}/{needed}",
            "xp_needed": needed,
        }

    target = cur + 1
    out: Dict[str, Any] = {"can_level_up": True, "target_level": target, "choices": []}

    if sheet["class_name"] == "Fighter":
        if target == 2:
            out["grants"] = ["Action Surge (1 использование)"]
        elif target == 3:
            out["choices"].append(
                {
                    "id": "subclass",
                    "label": "Архетип воина",
                    "type": "single",
                    "options": FIGHTER_SUBCLASSES,
                }
            )
    else:  # Wizard
        if target == 2:
            out["grants"] = ["Дополнительная ячейка 1 круга"]
            out["choices"].append(
                {
                    "id": "new_spell",
                    "label": f"Подготовить ещё заклинание (до {WIZARD_PREPARED[2]})",
                    "type": "single",
                    "options": [
                        {"key": s, "label": s}
                        for s in spell_options(max_spell_level(2))
                        if s not in sheet.get("spells_prepared", [])
                    ],
                }
            )
        elif target == 3:
            out["grants"] = ["Ячейки 2 круга"]
            out["choices"].append(
                {
                    "id": "subclass",
                    "label": "Школа магии",
                    "type": "single",
                    "options": WIZARD_SUBCLASSES,
                }
            )
            out["choices"].append(
                {
                    "id": "new_spell",
                    "label": f"Подготовить ещё заклинание (до {WIZARD_PREPARED[3]}, доступен 2 круг)",
                    "type": "single",
                    "options": [
                        {"key": s, "label": s}
                        for s in spell_options(max_spell_level(3))
                        if s not in sheet.get("spells_prepared", [])
                    ],
                }
            )
    return out


def apply_level_up(sheet: Dict[str, Any], choices: Dict[str, Any]) -> Dict[str, Any]:
    opts = level_up_options(sheet)
    if not opts.get("can_level_up"):
        raise ValueError(opts.get("reason", "Повышение уровня недоступно"))
    target = opts["target_level"]

    # Validate required choices were provided.
    for ch in opts.get("choices", []):
        if ch["id"] not in choices or not choices[ch["id"]]:
            raise ValueError(f"Не сделан выбор: {ch['label']}")
        valid = {o["key"] for o in ch["options"]}
        if choices[ch["id"]] not in valid:
            raise ValueError(f"Неверный выбор для '{ch['label']}'")

    sheet["level"] = target
    if sheet["class_name"] == "Fighter":
        if target == 2:
            _add_feature(sheet, "action_surge")
        elif target == 3:
            sheet["subclass"] = choices["subclass"]
            _add_feature(sheet, f"subclass:{choices['subclass']}")
    else:  # Wizard
        if "new_spell" in choices and choices.get("new_spell"):
            prepared = sheet.setdefault("spells_prepared", [])
            if choices["new_spell"] not in prepared:
                prepared.append(choices["new_spell"])
        if target == 3 and "subclass" in choices:
            sheet["subclass"] = choices["subclass"]
            _add_feature(sheet, f"subclass:{choices['subclass']}")
    return sheet


def _add_feature(sheet: Dict[str, Any], feat: str) -> None:
    feats = sheet.setdefault("features", [])
    if feat not in feats:
        feats.append(feat)


# ─── materialize a combat Character ─────────────────────────────────────────

def build_combat_character(
    sheet: Dict[str, Any],
    position: Optional[Position] = None,
    team: str = "party",
) -> Character:
    """Turn a stored sheet into an in-combat Character via the engine factory,
    then apply progression-specific overrides (style, masteries, subclass)."""
    char = engine.create_character(
        name=sheet["name"],
        class_name=sheet["class_name"],
        level=sheet.get("level", 1),
        position=position,
        ability_scores=sheet.get("ability_scores"),
        weapon_choice=sheet.get("weapon_choice") or "longsword_shield",
        cantrips=sheet.get("cantrips") or None,
        spells=sheet.get("spells_prepared") if sheet["class_name"] == "Wizard" else None,
        background=sheet.get("background"),
        portrait=sheet.get("portrait"),
        saved_id=sheet.get("id"),
    )
    char.sheet_id = sheet.get("id")
    char.team = team
    char.is_monster = False
    char.subclass = sheet.get("subclass")

    if sheet["class_name"] == "Fighter":
        style = sheet.get("fighting_style")
        if style:
            try:
                char.fighting_style = FightingStyle(style)
            except ValueError:
                pass
            if style == "defense" and char.armor is not None:
                char.ac += 1
        masteries = sheet.get("weapon_masteries") or []
        parsed: List[WeaponMastery] = []
        for m in masteries:
            try:
                parsed.append(WeaponMastery(m))
            except ValueError:
                continue
        if parsed:
            char.weapon_masteries = parsed
            # Align the main weapon's mastery with one of the chosen masteries.
            if char.main_hand and parsed:
                char.main_hand.mastery = parsed[0]

    # Champion subclass: crit on 19-20.
    if sheet.get("subclass") == "champion":
        char.crit_threshold = 19

    # Apply imported equipment bonuses from main dnd_cards item API.
    _apply_equipment(char, sheet.get("equipment") or [])

    return char


def _apply_equipment(char: Character, equipment: List[Dict[str, Any]]) -> None:
    for item in equipment:
        if not item or not item.get("ready"):
            continue
        ac_bonus = item.get("ac_bonus")
        if isinstance(ac_bonus, int):
            char.ac += ac_bonus
        to_hit = item.get("to_hit_bonus")
        if isinstance(to_hit, int):
            char.item_attack_bonus += to_hit
        dmg_bonus = item.get("damage_bonus")
        if isinstance(dmg_bonus, int):
            char.item_damage_bonus += dmg_bonus
        kind = item.get("kind")
        if kind == "weapon" and item.get("damage_dice") and char.main_hand:
            char.main_hand.damage_dice = item["damage_dice"]
            if item.get("damage_type"):
                char.main_hand.damage_type = item["damage_type"]
