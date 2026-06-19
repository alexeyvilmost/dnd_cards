"""Monster statblocks, validation and combat materialization."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from models import AbilityScores, Character, Position, Weapon

CR_XP = {
    0: 10,
    0.125: 25,
    0.25: 50,
    0.5: 100,
    1: 200,
    2: 450,
    3: 700,
    4: 1100,
}


def xp_for_cr(cr: float) -> int:
    if cr in CR_XP:
        return CR_XP[cr]
    # Fallback approximation for unsupported CR values.
    return max(10, int(200 * cr))


def validate_monster(doc: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    required = ["name", "cr", "ability_scores", "max_hp", "ac", "speed", "attacks"]
    for k in required:
        if k not in doc:
            return False, f"Поле '{k}' обязательно"
    if not isinstance(doc["attacks"], list) or len(doc["attacks"]) == 0:
        return False, "У монстра должна быть хотя бы одна атака"
    if doc.get("battle_ready", True):
        for a in doc["attacks"]:
            if not a.get("name") or not a.get("damage_dice"):
                return False, "Для battle_ready атаки обязательны name и damage_dice"
    return True, None


def default_monster_doc() -> Dict[str, Any]:
    return {
        "name": "Goblin",
        "cr": 0.25,
        "size": "Small",
        "type": "humanoid",
        "ability_scores": {
            "strength": 8,
            "dexterity": 14,
            "constitution": 10,
            "intelligence": 10,
            "wisdom": 8,
            "charisma": 8,
        },
        "max_hp": 7,
        "ac": 15,
        "speed": 30,
        "attacks": [
            {
                "name": "Scimitar",
                "attack_bonus": 4,
                "reach": 5,
                "damage_dice": "1d6+2",
                "damage_type": "slashing",
            }
        ],
        "multiattack": 1,
        "save_proficiencies": [],
        "features": [],
        "battle_ready": True,
        "portrait": "👹",
        "description": "Небольшой, но опасный противник.",
    }


def to_combat_character(monster: Dict[str, Any], position: Optional[Position] = None) -> Character:
    pos = position or Position(x=0, y=0)
    scores = AbilityScores(**monster["ability_scores"])
    attacks = monster.get("attacks") or []
    main = attacks[0]
    weapon = Weapon(
        name=main.get("name", "Claws"),
        damage_dice=main.get("damage_dice", "1d6"),
        damage_type=main.get("damage_type", "slashing"),
        ability="strength",
        reach=(main.get("reach", 5) or 5) > 5,
    )
    save_profs = monster.get("save_proficiencies") or []
    c = Character(
        name=monster["name"],
        class_name="Monster",
        level=max(1, int(monster.get("cr", 1))),
        proficiency_bonus=max(2, int(2 + float(monster.get("cr", 0)) // 4)),
        ability_scores=scores,
        max_hp=int(monster.get("max_hp", 1)),
        hp=int(monster.get("max_hp", 1)),
        ac=int(monster.get("ac", 10)),
        speed=int(monster.get("speed", 30)),
        position=pos,
        main_hand=weapon,
        save_proficiencies=save_profs,
        portrait=monster.get("portrait") or "👾",
        team="monsters",
        is_monster=True,
        monster_xp=int(monster.get("xp") or xp_for_cr(float(monster.get("cr", 0)))),
    )
    return c


def auto_turn(room, monster_id: str) -> Dict[str, Any]:
    """Simple monster AI: attack nearest party target in range, else move towards it."""
    import engine

    me = room.characters[monster_id]
    targets = [
        (cid, c)
        for cid, c in room.characters.items()
        if cid != monster_id and not c.is_monster and c.is_conscious()
    ]
    if not targets:
        return {"acted": False, "message": f"{me.name} не видит целей."}

    targets.sort(key=lambda t: engine.chebyshev_ft(me, t[1]))
    target_id, target = targets[0]
    dist = engine.chebyshev_ft(me, target)
    reach = engine.melee_reach(me.main_hand)

    if dist <= reach:
        res = engine.action_attack(room, monster_id, target_id)
        end = engine.end_turn(room, monster_id)
        msg = f"{res.get('message', '')} | {end.get('message', '')}"
        return {"acted": True, "message": msg}

    # Move towards target within available movement.
    cells = max(1, me.movement_remaining() // 5)
    nx, ny = me.position.x, me.position.y
    tx, ty = target.position.x, target.position.y
    dx = (tx > nx) - (tx < nx)
    dy = (ty > ny) - (ty < ny)
    for _ in range(cells):
        cand_x, cand_y = nx + dx, ny + dy
        if max(abs(cand_x - tx), abs(cand_y - ty)) * 5 < reach:
            break
        # avoid occupied cells
        occupied = any(
            o.id != me.id and o.is_conscious() and o.position.x == cand_x and o.position.y == cand_y
            for o in room.characters.values()
        )
        if occupied:
            break
        nx, ny = cand_x, cand_y

    move = engine.move_character(room, monster_id, nx, ny)
    dist2 = engine.chebyshev_ft(me, target)
    atk_msg = ""
    if dist2 <= reach:
        atk = engine.action_attack(room, monster_id, target_id)
        atk_msg = atk.get("message", "")
    end = engine.end_turn(room, monster_id)
    msg = " | ".join(x for x in [move.get("message"), atk_msg, end.get("message")] if x)
    return {"acted": True, "message": msg}

