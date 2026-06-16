from __future__ import annotations

import math
import random
from typing import Any, Dict, List, Optional

from dice import ability_modifier, roll_dice
from models import (
    AbilityScores,
    Armor,
    Character,
    CombatState,
    Condition,
    DeathSaves,
    EventLog,
    FightingStyle,
    Position,
    ReadiedAction,
    Resources,
    Room,
    Spell,
    TurnState,
    Weapon,
    WeaponMastery,
)
from spells import get_spell


# ─── Geometry ─────────────────────────────────────────────────────────────────


def chebyshev_ft(a: Character, b: Character) -> int:
    """Distance in feet using Chebyshev metric (diagonal = 5ft, same as straight)."""
    dx = abs(a.position.x - b.position.x)
    dy = abs(a.position.y - b.position.y)
    return max(dx, dy) * 5


def melee_reach(weapon: Optional[Weapon]) -> int:
    if weapon and weapon.reach:
        return 10
    return 5


def effective_ac(char: Character) -> int:
    """AC including the temporary Shield spell bonus."""
    ac = char.ac
    if char.active_buffs.get("shield"):
        ac += 5
    return ac


# ─── Attack resolution ────────────────────────────────────────────────────────


def resolve_single_attack(
    room: Room,
    attacker_id: str,
    target_id: str,
    weapon: Optional[Weapon],
    off_hand: bool = False,
) -> Dict[str, Any]:
    attacker = room.characters[attacker_id]
    target = room.characters[target_id]

    result: Dict[str, Any] = {
        "attacker": attacker.name,
        "target": target.name,
        "weapon": weapon.name if weapon else "Unarmed Strike",
        "hit": False,
        "critical": False,
        "damage": 0,
        "rolls": {},
        "effects": [],
        "message": "",
    }

    # ── Advantage / Disadvantage ──
    adv = False
    dis = False

    if Condition.PRONE in attacker.conditions:
        dis = True
    if Condition.PRONE in target.conditions:
        dist = chebyshev_ft(attacker, target)
        if dist <= 5:
            adv = True
        else:
            dis = True
    if Condition.DODGING in target.conditions:
        dis = True
    # Mirror Image: attack may strike an illusory duplicate instead
    images = target.active_buffs.get("mirror_image", 0)
    if images > 0:
        deflect_dc = {3: 6, 2: 8, 1: 11}.get(images, 11)
        if random.randint(1, 20) >= deflect_dc:
            target.active_buffs["mirror_image"] = images - 1
            result["hit"] = False
            result["message"] = (
                f"{attacker.name}'s attack strikes one of {target.name}'s mirror images! "
                f"({images - 1} images remain)"
            )
            result["effects"].append("Mirror Image absorbed the attack.")
            return result
    # Blur: attacks against the target have disadvantage
    if target.active_buffs.get("blur"):
        dis = True
    if Condition.BLINDED in attacker.conditions or Condition.INVISIBLE in target.conditions:
        dis = True
    if Condition.BLINDED in target.conditions or Condition.INVISIBLE in attacker.conditions:
        adv = True
    if attacker.sap_penalty:
        dis = True
        attacker.sap_penalty = False
    if attacker.helped_attack:
        adv = True
        attacker.helped_attack = False
    if attacker.turn_state.vex_target == target_id:
        adv = True
        attacker.turn_state.vex_target = None

    # ── Roll d20 ──
    r1, r2 = random.randint(1, 20), random.randint(1, 20)
    if adv and not dis:
        natural = max(r1, r2)
        result["rolls"]["d20"] = [r1, r2]
        result["rolls"]["mode"] = "advantage"
    elif dis and not adv:
        natural = min(r1, r2)
        result["rolls"]["d20"] = [r1, r2]
        result["rolls"]["mode"] = "disadvantage"
    else:
        natural = r1
        result["rolls"]["d20"] = r1
        result["rolls"]["mode"] = "normal"

    atk_bonus = attacker.attack_bonus(weapon)
    total = natural + atk_bonus
    tgt_ac = effective_ac(target)
    result["rolls"]["attack_bonus"] = atk_bonus
    result["rolls"]["total"] = total
    result["rolls"]["target_ac"] = tgt_ac

    is_crit = natural == 20
    is_fumble = natural == 1
    hit = is_crit or (not is_fumble and total >= tgt_ac)
    result["hit"] = hit
    result["critical"] = is_crit

    # ── Damage on hit ──
    if hit:
        if weapon:
            dmg_str = weapon.damage_dice
            if is_crit:
                # Double the number of dice
                count, sides = dmg_str.split("d")
                dmg_str = f"{int(count) * 2}d{sides}"

            dmg_total, dmg_rolls = roll_dice(dmg_str)

            # Great Weapon Fighting: reroll 1s and 2s on damage dice
            if attacker.fighting_style == FightingStyle.GREAT_WEAPON and weapon.two_handed:
                sides_val = int(weapon.damage_dice.split("d")[1])
                dmg_rolls = [
                    random.randint(1, sides_val) if r <= 2 else r
                    for r in dmg_rolls
                ]
                dmg_total = sum(dmg_rolls)

            dmg_bonus = attacker.damage_bonus(weapon, off_hand=off_hand)
            total_dmg = max(0, dmg_total + dmg_bonus)
            result["rolls"]["damage_dice"] = dmg_rolls
            result["rolls"]["damage_bonus"] = dmg_bonus
        else:
            # Unarmed Strike (D&D 2024): 1 + STR mod bludgeoning
            str_mod = attacker.ability_scores.mod("strength")
            dmg_rolls = [1]
            if is_crit:
                dmg_rolls = [1, 1]
            total_dmg = sum(dmg_rolls) + str_mod
            result["rolls"]["damage_dice"] = dmg_rolls
            result["rolls"]["damage_bonus"] = str_mod

        # Blade Ward: resistance to bludgeoning/piercing/slashing
        dmg_type = weapon.damage_type if weapon else "bludgeoning"
        if target.active_buffs.get("blade_ward") and dmg_type in ("bludgeoning", "piercing", "slashing"):
            total_dmg = total_dmg // 2

        result["damage"] = total_dmg
        old_hp = target.hp
        target.hp = max(0, target.hp - total_dmg)

        if is_crit:
            result["message"] = f"CRITICAL HIT! {attacker.name} hits {target.name} for {total_dmg} dmg! ({old_hp}→{target.hp} HP)"
        else:
            result["message"] = f"{attacker.name} hits {target.name} for {total_dmg} dmg! (roll {total} vs AC {tgt_ac}; {old_hp}→{target.hp} HP)"

        # ── Weapon mastery effects ──
        if weapon and weapon.mastery and weapon.mastery in attacker.weapon_masteries:
            effects = _apply_mastery_on_hit(room, attacker, target, weapon.mastery)
            result["effects"].extend(effects)

        # ── VEX: advantage on next attack vs same target ──
        if weapon and weapon.mastery == WeaponMastery.VEX and weapon.mastery in attacker.weapon_masteries:
            attacker.turn_state.vex_target = target_id
            result["effects"].append(f"VEX: {attacker.name} has advantage on their next attack vs {target.name}.")

        # ── Downed check ──
        if target.hp == 0 and Condition.DEAD not in target.conditions:
            if Condition.UNCONSCIOUS not in target.conditions:
                target.conditions.append(Condition.UNCONSCIOUS)
                target.death_saves = DeathSaves()
            result["effects"].append(f"{target.name} drops to 0 HP and falls UNCONSCIOUS!")
            # Massive damage instant kill
            if total_dmg >= target.max_hp:
                target.conditions.append(Condition.DEAD)
                if Condition.UNCONSCIOUS in target.conditions:
                    target.conditions.remove(Condition.UNCONSCIOUS)
                result["effects"].append(f"{target.name} is slain outright by massive damage!")

    else:
        # Miss
        # GRAZE mastery: deal ability modifier damage on miss
        if (
            weapon
            and weapon.mastery == WeaponMastery.GRAZE
            and weapon.mastery in attacker.weapon_masteries
        ):
            ability = attacker._weapon_ability(weapon)
            graze_dmg = max(0, attacker.ability_scores.mod(ability))
            if graze_dmg > 0:
                target.hp = max(0, target.hp - graze_dmg)
                result["effects"].append(
                    f"GRAZE: {graze_dmg} {weapon.damage_type} damage on miss."
                )
                result["damage"] = graze_dmg

        if is_fumble:
            result["message"] = f"{attacker.name} fumbles! (Natural 1 — automatic miss.)"
        else:
            result["message"] = f"{attacker.name} misses {target.name}. (Roll {total} vs AC {tgt_ac})"

    return result


def _apply_mastery_on_hit(
    room: Room, attacker: Character, target: Character, mastery: WeaponMastery
) -> List[str]:
    effects = []

    if mastery == WeaponMastery.SAP:
        target.sap_penalty = True
        effects.append(f"SAP: {target.name} has disadvantage on their next attack roll.")

    elif mastery == WeaponMastery.PUSH:
        dc = 8 + attacker.proficiency_bonus + attacker.ability_scores.mod("strength")
        save = random.randint(1, 20) + target.ability_scores.mod("strength")
        if "strength" in target.save_proficiencies:
            save += target.proficiency_bonus
        if save < dc:
            dx = target.position.x - attacker.position.x
            dy = target.position.y - attacker.position.y
            dist = math.sqrt(dx * dx + dy * dy)
            if dist > 0:
                nx = min(room.grid_width - 1, max(0, target.position.x + round(dx / dist * 2)))
                ny = min(room.grid_height - 1, max(0, target.position.y + round(dy / dist * 2)))
                target.position = Position(x=nx, y=ny)
            effects.append(f"PUSH: {target.name} fails STR save ({save} vs DC {dc}) — pushed 10ft to ({target.position.x},{target.position.y}).")
        else:
            effects.append(f"PUSH: {target.name} resists ({save} vs DC {dc}).")

    elif mastery == WeaponMastery.TOPPLE:
        dc = 8 + attacker.proficiency_bonus + attacker.ability_scores.mod("strength")
        save = random.randint(1, 20) + target.ability_scores.mod("strength")
        if "strength" in target.save_proficiencies:
            save += target.proficiency_bonus
        if save < dc:
            if Condition.PRONE not in target.conditions:
                target.conditions.append(Condition.PRONE)
            effects.append(f"TOPPLE: {target.name} fails STR save ({save} vs DC {dc}) — knocked PRONE!")
        else:
            effects.append(f"TOPPLE: {target.name} resists ({save} vs DC {dc}).")

    elif mastery == WeaponMastery.SLOW:
        target.slow_penalty = max(target.slow_penalty, 10)
        effects.append(f"SLOW: {target.name}'s speed reduced by 10ft until {attacker.name}'s next turn.")

    return effects


# ─── Actions ──────────────────────────────────────────────────────────────────


def action_attack(room: Room, attacker_id: str, target_id: str) -> Dict[str, Any]:
    attacker = room.characters[attacker_id]
    target = room.characters.get(target_id)
    result: Dict[str, Any] = {"success": False, "attacks": [], "message": ""}

    if not attacker.can_use_action():
        result["message"] = f"{attacker.name} has no action available this turn."
        return result
    if target is None or not target.is_alive():
        result["message"] = "Target is dead or does not exist."
        return result

    weapon = attacker.main_hand
    dist = chebyshev_ft(attacker, target)

    if weapon and weapon.ranged:
        max_range = weapon.ranged_range[1] if weapon.ranged_range else 80
        if dist > max_range:
            result["message"] = f"{target.name} is out of range ({dist}ft, max {max_range}ft)."
            return result
    else:
        reach = melee_reach(weapon)
        if dist > reach:
            result["message"] = f"{target.name} is not in melee reach ({dist}ft, reach {reach}ft). Move closer."
            return result

    attacker.turn_state.action_used = True
    atk = resolve_single_attack(room, attacker_id, target_id, weapon)
    result["attacks"].append(atk)

    # NICK mastery: off-hand attack as part of Attack action (not bonus action)
    if (
        weapon and weapon.light and weapon.mastery == WeaponMastery.NICK
        and weapon.mastery in attacker.weapon_masteries
        and attacker.off_hand and attacker.off_hand.light
    ):
        nick_atk = resolve_single_attack(room, attacker_id, target_id, attacker.off_hand, off_hand=True)
        nick_atk["note"] = "NICK mastery off-hand attack (part of Attack action)"
        result["attacks"].append(nick_atk)

    # CLEAVE mastery: on hit, attack another creature within 5ft of attacker
    if weapon and weapon.mastery == WeaponMastery.CLEAVE and weapon.mastery in attacker.weapon_masteries:
        if atk["hit"]:
            for other_id, other in room.characters.items():
                if other_id in (attacker_id, target_id) or not other.is_conscious():
                    continue
                if chebyshev_ft(attacker, other) <= 5:
                    cleave_atk = resolve_single_attack(room, attacker_id, other_id, weapon)
                    cleave_atk["note"] = "CLEAVE mastery — no ability modifier to damage"
                    result["attacks"].append(cleave_atk)
                    break

    result["success"] = True
    result["message"] = " | ".join(a["message"] for a in result["attacks"])
    all_effects = [e for a in result["attacks"] for e in a.get("effects", [])]
    if all_effects:
        result["effects"] = all_effects
    return result


def action_dash(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    char.turn_state.action_used = True
    char.turn_state.dash_bonus += char.speed
    return {
        "success": True,
        "message": (
            f"{char.name} Dashes! Gained {char.speed}ft of extra movement. "
            f"({char.movement_remaining()}ft remaining)"
        ),
    }


def action_disengage(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    char.turn_state.action_used = True
    if Condition.DISENGAGING not in char.conditions:
        char.conditions.append(Condition.DISENGAGING)
    return {
        "success": True,
        "message": f"{char.name} Disengages. Movement this turn won't provoke Opportunity Attacks.",
    }


def action_dodge(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    char.turn_state.action_used = True
    if Condition.DODGING not in char.conditions:
        char.conditions.append(Condition.DODGING)
    return {
        "success": True,
        "message": (
            f"{char.name} Dodges. Attacks against them have disadvantage, "
            "and they have advantage on DEX saving throws until their next turn."
        ),
    }


def action_hide(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    char.turn_state.action_used = True

    stealth = random.randint(1, 20) + char.ability_scores.mod("dexterity")
    enemies = [c for cid, c in room.characters.items() if cid != char_id and c.is_conscious()]
    spotted_by = []
    for e in enemies:
        passive_perception = 10 + e.ability_scores.mod("wisdom")
        if stealth <= passive_perception:
            spotted_by.append(f"{e.name} (PP {passive_perception})")

    if not spotted_by:
        if Condition.HIDDEN not in char.conditions:
            char.conditions.append(Condition.HIDDEN)
        return {
            "success": True,
            "message": f"{char.name} hides successfully! (Stealth: {stealth})",
            "stealth_roll": stealth,
        }
    else:
        return {
            "success": False,
            "message": f"{char.name} fails to hide (Stealth: {stealth}). Spotted by: {', '.join(spotted_by)}",
            "stealth_roll": stealth,
        }


def action_search(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    char.turn_state.action_used = True

    perception = random.randint(1, 20) + char.ability_scores.mod("wisdom")
    found = []
    for other_id, other in room.characters.items():
        if other_id == char_id:
            continue
        if Condition.HIDDEN in other.conditions:
            # Active Perception vs their Stealth (use DEX mod as stand-in for their prior stealth roll)
            if perception >= 10 + other.ability_scores.mod("dexterity"):
                other.conditions.remove(Condition.HIDDEN)
                found.append(other.name)

    if found:
        return {
            "success": True,
            "message": f"{char.name} searches and reveals: {', '.join(found)}. (Perception: {perception})",
        }
    return {
        "success": True,
        "message": f"{char.name} searches the area. (Perception: {perception}) No hidden creatures found.",
    }


def action_help(room: Room, helper_id: str, target_id: str) -> Dict[str, Any]:
    helper = room.characters[helper_id]
    target = room.characters.get(target_id)
    if not helper.can_use_action():
        return {"success": False, "message": f"{helper.name} has no action available."}
    if target is None or not target.is_conscious():
        return {"success": False, "message": "Target is not conscious."}
    helper.turn_state.action_used = True
    target.helped_attack = True
    return {
        "success": True,
        "message": (
            f"{helper.name} helps {target.name}! "
            f"{target.name} has advantage on their next attack roll this turn."
        ),
    }


def action_ready(
    room: Room,
    char_id: str,
    trigger: str,
    action_type: str,
    target_id: Optional[str] = None,
    params: Dict[str, Any] = {},
) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    char.turn_state.action_used = True
    char.readied_action = ReadiedAction(
        action_type=action_type,
        target_id=target_id,
        trigger_description=trigger,
        params=params,
    )
    return {
        "success": True,
        "message": f"{char.name} readies '{action_type}'. Trigger: \"{trigger}\"",
    }


def action_shove(room: Room, char_id: str, target_id: str, mode: str = "prone") -> Dict[str, Any]:
    """Replace one attack: STR (Athletics) contest. Knock prone or push 5ft."""
    char = room.characters[char_id]
    target = room.characters.get(target_id)
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    if target is None or not target.is_conscious():
        return {"success": False, "message": "Target is not conscious."}
    if chebyshev_ft(char, target) > 5:
        return {"success": False, "message": "Target must be within 5ft to Shove."}

    char.turn_state.action_used = True
    atk_roll = random.randint(1, 20) + char.ability_scores.mod("strength") + char.proficiency_bonus
    tgt_roll = max(
        random.randint(1, 20) + target.ability_scores.mod("strength"),
        random.randint(1, 20) + target.ability_scores.mod("dexterity"),
    )

    rolls = {"attacker_athletics": atk_roll, "target_contest": tgt_roll}

    if atk_roll > tgt_roll:
        if mode == "prone":
            if Condition.PRONE not in target.conditions:
                target.conditions.append(Condition.PRONE)
            return {
                "success": True,
                "message": f"{char.name} shoves {target.name} PRONE! ({atk_roll} vs {tgt_roll})",
                "rolls": rolls,
            }
        else:
            dx = target.position.x - char.position.x
            dy = target.position.y - char.position.y
            dist = math.sqrt(dx * dx + dy * dy)
            if dist > 0:
                nx = min(room.grid_width - 1, max(0, target.position.x + round(dx / dist)))
                ny = min(room.grid_height - 1, max(0, target.position.y + round(dy / dist)))
                target.position = Position(x=nx, y=ny)
            return {
                "success": True,
                "message": f"{char.name} pushes {target.name} 5ft to ({target.position.x},{target.position.y})! ({atk_roll} vs {tgt_roll})",
                "rolls": rolls,
            }
    return {
        "success": False,
        "message": f"{char.name} fails to shove {target.name}. ({atk_roll} vs {tgt_roll})",
        "rolls": rolls,
    }


def action_grapple(room: Room, char_id: str, target_id: str) -> Dict[str, Any]:
    """Replace one attack: STR (Athletics) vs STR/DEX. On success: target RESTRAINED."""
    char = room.characters[char_id]
    target = room.characters.get(target_id)
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    if target is None or not target.is_conscious():
        return {"success": False, "message": "Target is not conscious."}
    if chebyshev_ft(char, target) > 5:
        return {"success": False, "message": "Target must be within 5ft to Grapple."}

    char.turn_state.action_used = True
    atk_roll = random.randint(1, 20) + char.ability_scores.mod("strength") + char.proficiency_bonus
    tgt_roll = max(
        random.randint(1, 20) + target.ability_scores.mod("strength"),
        random.randint(1, 20) + target.ability_scores.mod("dexterity"),
    )

    rolls = {"attacker_athletics": atk_roll, "target_contest": tgt_roll}

    if atk_roll > tgt_roll:
        if Condition.RESTRAINED not in target.conditions:
            target.conditions.append(Condition.RESTRAINED)
        char.grappling = target_id
        target.grappled_by = char_id
        return {
            "success": True,
            "message": f"{char.name} grapples {target.name}! {target.name} is RESTRAINED. ({atk_roll} vs {tgt_roll})",
            "rolls": rolls,
        }
    return {
        "success": False,
        "message": f"{char.name} fails to grapple {target.name}. ({atk_roll} vs {tgt_roll})",
        "rolls": rolls,
    }


def action_escape_grapple(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_action():
        return {"success": False, "message": f"{char.name} has no action available."}
    if char.grappled_by is None:
        return {"success": False, "message": f"{char.name} is not grappled."}

    grappler = room.characters.get(char.grappled_by)
    if grappler is None:
        char.grappled_by = None
        if Condition.RESTRAINED in char.conditions:
            char.conditions.remove(Condition.RESTRAINED)
        return {"success": True, "message": f"{char.name} is free (grappler is gone)."}

    char.turn_state.action_used = True
    escape_roll = max(
        random.randint(1, 20) + char.ability_scores.mod("strength"),
        random.randint(1, 20) + char.ability_scores.mod("dexterity"),
    )
    grappler_roll = random.randint(1, 20) + grappler.ability_scores.mod("strength") + grappler.proficiency_bonus
    rolls = {"escape_roll": escape_roll, "grappler_roll": grappler_roll}

    if escape_roll >= grappler_roll:
        if Condition.RESTRAINED in char.conditions:
            char.conditions.remove(Condition.RESTRAINED)
        grappler.grappling = None
        char.grappled_by = None
        return {
            "success": True,
            "message": f"{char.name} escapes the grapple! ({escape_roll} vs {grappler_roll})",
            "rolls": rolls,
        }
    return {
        "success": False,
        "message": f"{char.name} fails to escape the grapple. ({escape_roll} vs {grappler_roll})",
        "rolls": rolls,
    }


# ─── Bonus actions ────────────────────────────────────────────────────────────


def bonus_second_wind(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if not char.can_use_bonus_action():
        return {"success": False, "message": f"{char.name} has no bonus action available."}
    if char.resources.second_wind_used:
        return {"success": False, "message": f"{char.name}'s Second Wind is expended (recover on Short/Long Rest)."}
    if char.class_name != "Fighter":
        return {"success": False, "message": "Only Fighters have Second Wind."}

    char.turn_state.bonus_action_used = True
    char.resources.second_wind_used = True
    heal_val, heal_rolls = roll_dice("1d10")
    total_heal = heal_val + char.level
    old_hp = char.hp
    char.hp = min(char.max_hp, char.hp + total_heal)

    return {
        "success": True,
        "message": (
            f"{char.name} uses Second Wind! Regains {char.hp - old_hp} HP "
            f"({heal_val} [1d10] + {char.level} level = {total_heal}). HP: {old_hp}→{char.hp}"
        ),
        "rolls": {"d10": heal_rolls, "level_bonus": char.level, "total": total_heal},
    }


def action_surge(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if char.action_surge_max <= 0:
        return {"success": False, "message": f"{char.name} doesn't have Action Surge (Fighter 2+)."}
    if char.action_surge_used >= char.action_surge_max:
        return {"success": False, "message": f"{char.name}'s Action Surge is expended (recover on rest)."}
    if not char.is_conscious():
        return {"success": False, "message": f"{char.name} is not conscious."}
    char.action_surge_used += 1
    char.turn_state.action_used = False  # regain a full action
    return {
        "success": True,
        "message": f"{char.name} uses Action Surge — gains an extra action this turn!",
    }


def bonus_two_weapon_attack(room: Room, char_id: str, target_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    target = room.characters.get(target_id)
    if not char.can_use_bonus_action():
        return {"success": False, "message": f"{char.name} has no bonus action available."}
    if char.off_hand is None:
        return {"success": False, "message": f"{char.name} has no off-hand weapon."}
    if not char.off_hand.light:
        return {"success": False, "message": "Off-hand weapon must be Light for Two-Weapon Fighting."}
    if char.main_hand is None or not char.main_hand.light:
        return {"success": False, "message": "Main-hand weapon must also be Light for Two-Weapon Fighting."}
    if target is None or not target.is_conscious():
        return {"success": False, "message": "Target is not conscious."}
    if chebyshev_ft(char, target) > melee_reach(char.off_hand):
        return {"success": False, "message": "Target is out of reach."}

    char.turn_state.bonus_action_used = True
    atk = resolve_single_attack(room, char_id, target_id, char.off_hand, off_hand=True)
    return {
        "success": True,
        "message": f"{char.name} makes an off-hand attack! {atk['message']}",
        "attack": atk,
    }


# ─── Spellcasting ─────────────────────────────────────────────────────────────


def _apply_damage(target: Character, amount: int) -> List[str]:
    """Apply damage to a target, handling temp HP and downed/death checks."""
    effects: List[str] = []
    amount = max(0, amount)
    if target.temp_hp > 0:
        absorbed = min(target.temp_hp, amount)
        target.temp_hp -= absorbed
        amount -= absorbed
    target.hp = max(0, target.hp - amount)
    if target.hp == 0 and Condition.DEAD not in target.conditions:
        # Concentration drops when downed
        target.concentrating_on = None
        if Condition.UNCONSCIOUS not in target.conditions:
            target.conditions.append(Condition.UNCONSCIOUS)
            target.death_saves = DeathSaves()
        effects.append(f"{target.name} drops to 0 HP and falls UNCONSCIOUS!")
    return effects


def _saving_throw(target: Character, ability: str, dc: int) -> tuple[bool, int]:
    roll = random.randint(1, 20)
    bonus = target.ability_scores.mod(ability)
    if ability in target.save_proficiencies:
        bonus += target.proficiency_bonus
    total = roll + bonus
    return total >= dc, total


def _break_concentration(caster: Character) -> Optional[str]:
    """Drop whatever the caster was concentrating on; return its name."""
    prev = caster.concentrating_on
    if prev:
        caster.concentrating_on = None
        # Clear concentration-linked self buffs
        for b in ("blur", "witch_bolt"):
            caster.active_buffs.pop(b, None)
    return prev


# Buffs that are applied directly to a character's active_buffs map
_SELF_BUFFS = {
    "Blur": ("blur", True),
    "Mirror Image": ("mirror_image", 3),
    "Shield": ("shield", True),
}


def cast_spell(
    room: Room,
    caster_id: str,
    spell_name: str,
    target_ids: Optional[List[str]] = None,
    slot_level: Optional[int] = None,
    point: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    caster = room.characters[caster_id]
    target_ids = target_ids or []
    result: Dict[str, Any] = {"success": False, "message": "", "effects": [], "attacks": []}

    spell = get_spell(spell_name)
    if spell is None:
        result["message"] = f"Unknown spell '{spell_name}'."
        return result

    # Knows the spell?
    known = spell.name in caster.cantrips or spell.name in caster.spells_prepared
    if not known:
        result["message"] = f"{caster.name} doesn't know {spell.name}."
        return result

    # Action economy
    if spell.casting_time == "action" and not caster.can_use_action():
        result["message"] = f"{caster.name} has no action available."
        return result
    if spell.casting_time == "bonus" and not caster.can_use_bonus_action():
        result["message"] = f"{caster.name} has no bonus action available."
        return result
    if spell.casting_time == "reaction" and not caster.can_use_reaction():
        result["message"] = f"{caster.name} has no reaction available."
        return result

    # Spell slot
    if spell.level > 0:
        lvl = slot_level or spell.level
        if lvl < spell.level:
            result["message"] = f"{spell.name} requires at least a level {spell.level} slot."
            return result
        if caster.spell_slots.get(lvl, 0) <= 0:
            result["message"] = f"{caster.name} has no level {lvl} spell slots remaining."
            return result
        caster.spell_slots[lvl] -= 1
        extra = lvl - spell.level
    else:
        lvl = 0
        extra = 0

    # Spend the action economy
    if spell.casting_time == "action":
        caster.turn_state.action_used = True
    elif spell.casting_time == "bonus":
        caster.turn_state.bonus_action_used = True
    elif spell.casting_time == "reaction":
        caster.turn_state.reaction_used = True

    # Concentration handover
    conc_note = ""
    if spell.concentration:
        prev = _break_concentration(caster)
        caster.concentrating_on = spell.name
        if prev and prev != spell.name:
            conc_note = f" (drops concentration on {prev})"

    slot_txt = f" (L{lvl} slot)" if spell.level > 0 else " (cantrip)"
    header = f"{caster.name} casts {spell.name}{slot_txt}{conc_note}."
    result["effects"].append(header)

    dc = caster.spell_save_dc()
    atk_bonus = caster.spell_attack_bonus()

    # ── Resolve by effect ──
    if spell.effect == "buff":
        _resolve_buff(room, caster, spell, target_ids, result)
    elif spell.effect == "heal":
        heal_target = room.characters.get(target_ids[0]) if target_ids else caster
        _resolve_heal(caster, spell, extra, result, target=heal_target)
    elif spell.effect == "utility":
        result["effects"].append(spell.description)
    elif spell.effect == "attack":
        _resolve_spell_attack(room, caster, spell, target_ids, extra, atk_bonus, result)
    elif spell.effect == "save":
        targets = _gather_targets(room, caster, spell, target_ids, point)
        _resolve_spell_save(room, caster, spell, targets, extra, dc, result)

    result["success"] = True
    result["message"] = " | ".join(result["effects"])
    return result


def _scaled_dice(base: str, extra_each: Optional[str], times: int) -> str:
    """Combine base dice with `times` copies of extra dice of the same die size."""
    if not extra_each or times <= 0:
        return base
    # base like "3d6" or "1d4+1"; extra like "1d6"
    import re

    def parse(d):
        m = re.match(r"(\d+)d(\d+)(?:\+(\d+))?", d)
        return int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)

    bc, bs, bf = parse(base)
    ec, es, _ = parse(extra_each)
    if es != bs:
        return base
    total = bc + ec * times
    flat = bf  # flat bonus stays per-base only (Magic Missile handled per-dart elsewhere)
    return f"{total}d{bs}" + (f"+{flat}" if flat else "")


def _level_multiplier(level: int) -> int:
    """Cantrip damage scales at character levels 5, 11 and 17."""
    return 1 + (level >= 5) + (level >= 11) + (level >= 17)


def _scale_cantrip(base: str, caster: Character, spell: Spell) -> str:
    """Multiply the dice count of a scaling cantrip by the caster's level tier."""
    if not (base and spell.cantrip_scale):
        return base
    import re
    m = re.match(r"(\d+)d(\d+)", base)
    if not m:
        return base
    mult = _level_multiplier(caster.level)
    return f"{int(m.group(1)) * mult}d{m.group(2)}"


def _resolve_spell_attack(room, caster, spell, target_ids, extra, atk_bonus, result):
    n = spell.num_targets + extra * spell.upcast_targets if spell.targeting == "multi" else 1
    if not target_ids:
        result["effects"].append("No target specified.")
        return

    for i in range(n):
        tid = target_ids[i % len(target_ids)]
        target = room.characters.get(tid)
        if target is None or not target.is_alive():
            continue

        # Per-projectile damage (cantrips scale by level; Magic Missile 1d4+1; others upcast)
        if spell.level == 0:
            dmg_str = _scale_cantrip(spell.damage_dice, caster, spell)
        elif spell.targeting != "multi":
            dmg_str = _scaled_dice(spell.damage_dice, spell.upcast_damage_dice, extra)
        else:
            dmg_str = spell.damage_dice

        if spell.auto_hit:
            dmg_total, rolls = roll_dice(dmg_str)
            eff = _apply_damage(target, dmg_total)
            result["effects"].append(
                f"{spell.name} dart hits {target.name} for {dmg_total} {spell.damage_type}."
            )
            result["effects"].extend(eff)
            result["attacks"].append({"target": target.name, "hit": True, "damage": dmg_total})
            continue

        # Spell attack roll
        nat = random.randint(1, 20)
        tgt_ac = effective_ac(target)
        total = nat + atk_bonus
        is_crit = nat == 20
        hit = is_crit or (nat != 1 and total >= tgt_ac)
        if hit:
            if is_crit:
                c, s = dmg_str.split("d")[0], dmg_str.split("d")[1].split("+")[0]
                crit_str = f"{int(c) * 2}d{s}"
                if "+" in dmg_str:
                    crit_str += "+" + dmg_str.split("+")[1]
                dmg_total, _ = roll_dice(crit_str)
            else:
                dmg_total, _ = roll_dice(dmg_str)
            eff = _apply_damage(target, dmg_total)
            tag = "CRIT! " if is_crit else ""
            result["effects"].append(
                f"{tag}{spell.name} hits {target.name} for {dmg_total} {spell.damage_type} "
                f"(roll {total} vs AC {tgt_ac})."
            )
            result["effects"].extend(eff)
            if spell.condition:
                _apply_spell_condition(caster, target, spell, result)
            result["attacks"].append({"target": target.name, "hit": True, "damage": dmg_total})
        else:
            result["effects"].append(
                f"{spell.name} misses {target.name} (roll {total} vs AC {tgt_ac})."
            )
            result["attacks"].append({"target": target.name, "hit": False, "damage": 0})


def _resolve_spell_save(room, caster, spell, targets, extra, dc, result):
    if not targets:
        result["effects"].append("No creatures in the area.")
        return

    for target in targets:
        if not target.is_alive():
            continue
        saved, total = _saving_throw(target, spell.save_ability, dc)
        ab = spell.save_ability[:3].upper()
        # Per-target damage dice: Toll the Dead hits harder on wounded targets; cantrips scale by level.
        dmg_str = None
        if spell.damage_dice:
            base = spell.damage_dice
            if spell.damage_dice_wounded and target.hp < target.max_hp:
                base = spell.damage_dice_wounded
            dmg_str = _scale_cantrip(base, caster, spell) if spell.level == 0 \
                else _scaled_dice(base, spell.upcast_damage_dice, extra)
        if dmg_str:
            dmg_total, _ = roll_dice(dmg_str)
            if saved:
                dmg_total = dmg_total // 2 if spell.half_on_save else 0
            eff = _apply_damage(target, dmg_total)
            verb = "saves" if saved else "fails"
            result["effects"].append(
                f"{target.name} {verb} {ab} {total} vs DC {dc}: {dmg_total} {spell.damage_type}."
            )
            result["effects"].extend(eff)
            if not saved and spell.condition:
                _apply_spell_condition(caster, target, spell, result)
        else:
            # Pure condition spell (Hold Person, Sleep, Web, ...)
            if saved:
                result["effects"].append(f"{target.name} saves ({ab} {total} vs DC {dc}) — unaffected.")
            else:
                result["effects"].append(f"{target.name} fails ({ab} {total} vs DC {dc}).")
                _apply_spell_condition(caster, target, spell, result)


def _apply_spell_condition(caster, target, spell, result):
    cond_name = spell.condition
    if cond_name == "slow_speed":
        target.slow_penalty = max(target.slow_penalty, 10)
        result["effects"].append(f"{target.name}'s speed is reduced by 10ft.")
        return
    if cond_name == "disadvantage_next_attack":
        target.sap_penalty = True
        result["effects"].append(f"{target.name} has disadvantage on its next attack roll.")
        return
    if cond_name == "unconscious":
        # Sleep: Incapacitated + Unconscious but NOT dying
        for c in (Condition.UNCONSCIOUS, Condition.INCAPACITATED):
            if c not in target.conditions:
                target.conditions.append(c)
        result["effects"].append(f"{target.name} falls asleep (Unconscious & Incapacitated)!")
        return
    try:
        cond = Condition(cond_name)
    except ValueError:
        return
    if cond not in target.conditions:
        target.conditions.append(cond)
    # Some conditions also incapacitate
    if cond in (Condition.PARALYZED, Condition.STUNNED):
        if Condition.INCAPACITATED not in target.conditions:
            target.conditions.append(Condition.INCAPACITATED)
    result["effects"].append(f"{target.name} is {cond.value.upper()}!")


def _resolve_heal(caster, spell, extra, result, target=None):
    if spell.name == "Spare the Dying":
        t = target or caster
        if t.hp == 0 and Condition.DEAD not in t.conditions:
            t.death_saves.stable = True
            t.death_saves.successes = 0
            t.death_saves.failures = 0
            result["effects"].append(f"{t.name} is stabilized (no longer dying).")
        else:
            result["effects"].append(f"{t.name} isn't dying — Spare the Dying has no effect.")
        return
    if spell.name == "False Life":
        amt, _ = roll_dice(spell.heal_dice)
        amt += 3 + extra * 2
        caster.temp_hp = max(caster.temp_hp, amt)
        result["effects"].append(f"{caster.name} gains {amt} temporary HP.")
        return
    heal, _ = roll_dice(spell.heal_dice or "1d8")
    heal += caster.ability_scores.mod(caster.spellcasting_ability or "intelligence")
    old = caster.hp
    caster.hp = min(caster.max_hp, caster.hp + heal)
    result["effects"].append(f"{caster.name} regains {caster.hp - old} HP.")


def _resolve_buff(room, caster, spell, target_ids, result):
    name = spell.name
    target = caster
    if spell.targeting == "single" and target_ids:
        t = room.characters.get(target_ids[0])
        if t:
            target = t

    if name == "Mage Armor":
        dex = target.ability_scores.mod("dexterity")
        if target.armor is None:
            target.ac = max(target.ac, 13 + dex)
            target.active_buffs["mage_armor"] = True
            result["effects"].append(f"{target.name}'s AC is now {target.ac} (Mage Armor).")
        else:
            result["effects"].append(f"{target.name} is wearing armor; Mage Armor has no effect.")
    elif name == "Shield":
        caster.active_buffs["shield"] = True
        result["effects"].append(f"{caster.name} gains +5 AC until their next turn (AC {effective_ac(caster)}).")
    elif name == "Blur":
        caster.active_buffs["blur"] = True
        result["effects"].append(f"Attacks against {caster.name} have disadvantage.")
    elif name == "Mirror Image":
        caster.active_buffs["mirror_image"] = 3
        result["effects"].append(f"{caster.name} is surrounded by 3 mirror images.")
    elif name == "Invisibility":
        if Condition.INVISIBLE not in target.conditions:
            target.conditions.append(Condition.INVISIBLE)
        result["effects"].append(f"{target.name} turns invisible.")
    elif name == "Misty Step":
        # Teleport handled via point in API; flavor here
        result["effects"].append(f"{caster.name} blinks away in silvery mist (teleport up to 30ft).")
    elif name == "Expeditious Retreat":
        caster.turn_state.dash_bonus += caster.speed
        caster.active_buffs["expeditious_retreat"] = True
        result["effects"].append(f"{caster.name} Dashes ({caster.movement_remaining()}ft remaining).")
    elif name == "False Life":
        _resolve_heal(caster, spell, 0, result)
    elif name == "Blade Ward":
        caster.active_buffs["blade_ward"] = True
        result["effects"].append(f"{caster.name} is warded — resistance to weapon damage until their next turn.")
    elif name == "True Strike":
        caster.helped_attack = True
        result["effects"].append(f"{caster.name} gains advantage on their next attack roll.")
    elif name == "Shillelagh":
        caster.active_buffs["shillelagh"] = True
        result["effects"].append(f"{caster.name}'s weapon is imbued with nature's power (1d8 force).")
    else:
        result["effects"].append(spell.description)


def _gather_targets(room, caster, spell, target_ids, point) -> List[Character]:
    """Resolve which characters an area/single save spell affects."""
    if spell.targeting in ("single",):
        out = []
        for tid in target_ids:
            t = room.characters.get(tid)
            if t and t.is_alive():
                out.append(t)
        return out
    # Area: explicit target_ids take priority; otherwise gather by point + radius
    if target_ids:
        return [room.characters[t] for t in target_ids if t in room.characters and room.characters[t].is_alive()]
    affected: List[Character] = []
    if point is not None:
        cx, cy = point.get("x"), point.get("y")
    else:
        cx, cy = caster.position.x, caster.position.y
    cells = max(1, spell.area_radius // 5)
    for cid, c in room.characters.items():
        if cid == caster.id or not c.is_alive():
            continue
        d = max(abs(c.position.x - cx), abs(c.position.y - cy))
        if d <= cells:
            affected.append(c)
    return affected


# ─── Movement ─────────────────────────────────────────────────────────────────


def move_character(room: Room, char_id: str, tx: int, ty: int) -> Dict[str, Any]:
    char = room.characters[char_id]
    result: Dict[str, Any] = {"success": False, "message": "", "opportunity_attacks": []}

    if not char.is_conscious():
        result["message"] = f"{char.name} is unconscious and cannot move."
        return result
    if Condition.RESTRAINED in char.conditions or Condition.PARALYZED in char.conditions:
        result["message"] = f"{char.name} cannot move (condition prevents it)."
        return result
    if not (0 <= tx < room.grid_width and 0 <= ty < room.grid_height):
        result["message"] = f"Position ({tx},{ty}) is out of bounds."
        return result

    # Occupied check
    for oid, other in room.characters.items():
        if oid != char_id and other.is_conscious() and other.position.x == tx and other.position.y == ty:
            result["message"] = f"({tx},{ty}) is occupied by {other.name}."
            return result

    extra_cost = 0
    notes = []

    # Standing up from prone costs half speed
    if Condition.PRONE in char.conditions:
        stand_cost = char.speed // 2
        if char.movement_remaining() < stand_cost:
            result["message"] = f"{char.name} needs {stand_cost}ft to stand up but only has {char.movement_remaining()}ft."
            return result
        char.conditions.remove(Condition.PRONE)
        char.turn_state.movement_used += stand_cost
        extra_cost = stand_cost
        notes.append(f"stood up ({stand_cost}ft)")

    dx = abs(tx - char.position.x)
    dy = abs(ty - char.position.y)
    move_cost = max(dx, dy) * 5  # Chebyshev

    if move_cost > char.movement_remaining():
        result["message"] = (
            f"{char.name} needs {move_cost}ft but only has {char.movement_remaining()}ft remaining."
        )
        return result

    old_pos = Position(x=char.position.x, y=char.position.y)
    new_pos = Position(x=tx, y=ty)

    # Opportunity attacks when leaving melee reach
    opp_attacks = []
    if Condition.DISENGAGING not in char.conditions and room.combat.active:
        for eid, enemy in room.characters.items():
            if eid == char_id or not enemy.is_conscious() or not enemy.can_use_reaction():
                continue
            e_reach = melee_reach(enemy.main_hand)
            old_dist = max(abs(old_pos.x - enemy.position.x), abs(old_pos.y - enemy.position.y)) * 5
            new_dist = max(abs(new_pos.x - enemy.position.x), abs(new_pos.y - enemy.position.y)) * 5
            if old_dist <= e_reach < new_dist:
                enemy.turn_state.reaction_used = True
                opp = resolve_single_attack(room, eid, char_id, enemy.main_hand)
                opp["trigger"] = "Opportunity Attack"
                opp_attacks.append(opp)

    char.position = new_pos
    char.turn_state.movement_used += move_cost
    notes.append(f"moved {move_cost}ft to ({tx},{ty})")

    result["success"] = True
    result["message"] = f"{char.name} {', '.join(notes)}. ({char.movement_remaining()}ft remaining)"
    result["opportunity_attacks"] = opp_attacks
    return result


# ─── Turn management ──────────────────────────────────────────────────────────


def start_turn(room: Room, char_id: str) -> None:
    char = room.characters[char_id]
    char.turn_state = TurnState()
    # Clear per-turn conditions
    for cond in [Condition.DODGING, Condition.DISENGAGING]:
        if cond in char.conditions:
            char.conditions.remove(cond)
    # Clear SLOW penalty (it lasts until start of attacker's next turn; simplified: clear at own turn start)
    char.slow_penalty = 0
    # Shield and Blade Ward last until the start of the caster's next turn
    char.active_buffs.pop("shield", None)
    char.active_buffs.pop("blade_ward", None)
    # Expeditious Retreat: may Dash again as a bonus action each turn (auto-applied)
    if char.active_buffs.get("expeditious_retreat"):
        char.turn_state.dash_bonus += char.speed


def make_death_save(room: Room, char_id: str) -> Dict[str, Any]:
    char = room.characters[char_id]
    if Condition.DEAD in char.conditions or Condition.UNCONSCIOUS not in char.conditions:
        return {"message": f"{char.name} is not making death saves."}

    roll_val = random.randint(1, 20)

    if roll_val == 20:
        char.hp = 1
        char.conditions.remove(Condition.UNCONSCIOUS)
        char.death_saves = DeathSaves()
        return {"roll": roll_val, "message": f"⭐ {char.name} rolls a 20 on their death save and regains 1 HP!"}

    if roll_val == 1:
        char.death_saves.failures += 2
    elif roll_val >= 10:
        char.death_saves.successes += 1
    else:
        char.death_saves.failures += 1

    msg = (
        f"💀 {char.name} death save: {roll_val} "
        f"({'success' if roll_val >= 10 else 'failure'}). "
        f"Successes: {char.death_saves.successes}/3  Failures: {char.death_saves.failures}/3"
    )

    if char.death_saves.successes >= 3:
        char.death_saves.stable = True
        msg += f" — {char.name} is STABLE (unconscious but no longer dying)."
    elif char.death_saves.failures >= 3:
        char.conditions.append(Condition.DEAD)
        char.conditions.remove(Condition.UNCONSCIOUS)
        msg += f" — {char.name} is DEAD."

    return {"roll": roll_val, "message": msg, "saves": char.death_saves.model_dump()}


def end_turn(room: Room, char_id: str) -> Dict[str, Any]:
    if room.combat.current_character_id() != char_id:
        return {"success": False, "message": "It is not this character's turn."}

    char = room.characters[char_id]
    # Remove disengaging at end of turn (already cleared in start_turn but clean here too)
    if Condition.DISENGAGING in char.conditions:
        char.conditions.remove(Condition.DISENGAGING)

    n = len(room.combat.initiative_order)
    room.combat.turn_index = (room.combat.turn_index + 1) % n

    # If we wrapped around to index 0, new round
    if room.combat.turn_index == 0:
        room.combat.round += 1

    # Advance past incapacitated characters (make death saves for unconscious ones)
    for _ in range(n):
        nid = room.combat.current_character_id()
        nchar = room.characters[nid]
        if nchar.is_conscious():
            break
        if Condition.UNCONSCIOUS in nchar.conditions and Condition.DEAD not in nchar.conditions:
            ds = make_death_save(room, nid)
            room.log.append(EventLog(round=room.combat.round, turn_char=nchar.name, message=ds["message"]))
        room.combat.turn_index = (room.combat.turn_index + 1) % n

    # Combat over?
    conscious_ids = [cid for cid, c in room.characters.items() if c.is_conscious()]
    if len(conscious_ids) <= 1:
        room.combat.active = False
        winner = room.characters[conscious_ids[0]].name if conscious_ids else "nobody"
        return {
            "success": True,
            "combat_over": True,
            "winner": winner,
            "message": f"{char.name} ends their turn. ⚔️  Combat over! {winner} wins!",
        }

    next_id = room.combat.current_character_id()
    start_turn(room, next_id)
    next_char = room.characters[next_id]

    return {
        "success": True,
        "combat_over": False,
        "message": f"{char.name} ends their turn. Round {room.combat.round} — it's {next_char.name}'s turn!",
        "next_character_id": next_id,
        "next_character_name": next_char.name,
        "round": room.combat.round,
    }


# ─── Combat start ─────────────────────────────────────────────────────────────


def start_combat(room: Room) -> List[EventLog]:
    logs = []
    initiatives: list[tuple[int, int, str]] = []

    for char_id, char in room.characters.items():
        if not char.is_alive():
            continue
        roll_val = random.randint(1, 20)
        init = roll_val + char.ability_scores.mod("dexterity")
        char.initiative = init
        logs.append(
            EventLog(round=0, turn_char=char.name, message=f"{char.name} rolls initiative: {roll_val}+{char.ability_scores.mod('dexterity')}={init}")
        )
        # Tiebreak: higher DEX first, then random
        initiatives.append((init, char.ability_scores.dexterity, char_id))

    initiatives.sort(key=lambda x: (x[0], x[1]), reverse=True)
    order = [x[2] for x in initiatives]

    room.combat = CombatState(active=True, round=1, turn_index=0, initiative_order=order)

    order_names = " → ".join(room.characters[cid].name for cid in order)
    logs.append(EventLog(round=1, turn_char="System", message=f"Combat begins! Initiative order: {order_names}"))

    start_turn(room, order[0])
    return logs


# ─── Character factory ────────────────────────────────────────────────────────


WIZARD_SLOTS = {
    1: {1: 2},
    2: {1: 3},
    3: {1: 4, 2: 2},
    4: {1: 4, 2: 3},
}

DEFAULT_FIGHTER_SCORES = dict(strength=16, dexterity=12, constitution=14, intelligence=10, wisdom=12, charisma=10)
DEFAULT_WIZARD_SCORES = dict(strength=8, dexterity=14, constitution=14, intelligence=16, wisdom=12, charisma=10)

DEFAULT_WIZARD_CANTRIPS = ["Fire Bolt", "Ray of Frost", "Mind Sliver", "Shocking Grasp"]
DEFAULT_WIZARD_L1 = ["Magic Missile", "Burning Hands", "Shield", "Mage Armor", "Thunderwave", "Ray of Sickness"]
DEFAULT_WIZARD_L2 = ["Scorching Ray", "Misty Step", "Mirror Image", "Hold Person", "Blur"]


def _prof_bonus(level: int) -> int:
    return 2 + (level - 1) // 4


def _avg_hp(level: int, hit_die: int, con_mod: int) -> int:
    first = hit_die + con_mod
    per = (hit_die // 2 + 1) + con_mod
    return first + (level - 1) * per


def create_character(
    name: str,
    class_name: str,
    level: int = 1,
    position: Optional[Position] = None,
    ability_scores: Optional[Dict[str, int]] = None,
    weapon_choice: str = "longsword_shield",
    cantrips: Optional[List[str]] = None,
    spells: Optional[List[str]] = None,
    background: Optional[str] = None,
    portrait: Optional[str] = None,
    saved_id: Optional[str] = None,
) -> Character:
    """Generic factory for Fighter and Wizard, levels 1–4 (D&D 2024)."""
    position = position or Position()
    level = max(1, min(4, level))
    prof = _prof_bonus(level)
    extra = dict(background=background, portrait=portrait, saved_id=saved_id)

    if class_name == "Wizard":
        scores = AbilityScores(**(ability_scores or DEFAULT_WIZARD_SCORES))
        con_mod = scores.mod("constitution")
        dex_mod = scores.mod("dexterity")
        max_hp = _avg_hp(level, 6, con_mod)

        slots = {lvl: cnt for lvl, cnt in WIZARD_SLOTS[level].items()}
        known_cantrips = cantrips or DEFAULT_WIZARD_CANTRIPS[: (3 if level < 4 else 4)]
        if spells is not None:
            prepared = spells
        else:
            prepared = list(DEFAULT_WIZARD_L1)
            if level >= 3:
                prepared += DEFAULT_WIZARD_L2

        dagger = Weapon(
            name="Dagger", damage_dice="1d4", damage_type="piercing",
            ability="dexterity", finesse=True, light=True,
        )
        return Character(
            name=name, class_name="Wizard", level=level, proficiency_bonus=prof,
            ability_scores=scores,
            max_hp=max_hp, hp=max_hp,
            ac=10 + dex_mod,  # unarmored; cast Mage Armor for 13+DEX
            speed=30, position=position,
            main_hand=dagger,
            save_proficiencies=["intelligence", "wisdom"],
            spellcasting_ability="intelligence",
            spell_slots_max=dict(slots), spell_slots=dict(slots),
            cantrips=known_cantrips, spells_prepared=prepared,
            **extra,
        )

    # ── Fighter ──
    scores = AbilityScores(**(ability_scores or DEFAULT_FIGHTER_SCORES))
    con_mod = scores.mod("constitution")
    max_hp = _avg_hp(level, 10, con_mod)
    chain_mail = Armor(name="Chain Mail", base_ac=16, armor_type="heavy", max_dex_bonus=0)
    action_surge_uses = 1 if level >= 2 else 0

    if weapon_choice == "greatsword":
        weapon = Weapon(
            name="Greatsword", damage_dice="2d6", damage_type="slashing",
            ability="strength", two_handed=True, mastery=WeaponMastery.GRAZE,
        )
        return Character(
            name=name, class_name="Fighter", level=level, proficiency_bonus=prof,
            ability_scores=scores, max_hp=max_hp, hp=max_hp,
            ac=16, speed=30, position=position,
            armor=chain_mail, shield=False, main_hand=weapon,
            fighting_style=FightingStyle.GREAT_WEAPON,
            weapon_masteries=[WeaponMastery.GRAZE, WeaponMastery.CLEAVE],
            save_proficiencies=["strength", "constitution"],
            action_surge_max=action_surge_uses,
            **extra,
        )
    # longsword_shield (default)
    weapon = Weapon(
        name="Longsword", damage_dice="1d8", damage_type="slashing",
        ability="strength", versatile_dice="1d10", mastery=WeaponMastery.SAP,
    )
    return Character(
        name=name, class_name="Fighter", level=level, proficiency_bonus=prof,
        ability_scores=scores, max_hp=max_hp, hp=max_hp,
        ac=18, speed=30, position=position,
        armor=chain_mail, shield=True, main_hand=weapon,
        fighting_style=FightingStyle.DUELING,
        weapon_masteries=[WeaponMastery.SAP, WeaponMastery.TOPPLE],
        save_proficiencies=["strength", "constitution"],
        action_surge_max=action_surge_uses,
        **extra,
    )


def create_fighter_1(name: str, position: Position, weapon_choice: str = "longsword_shield") -> Character:
    """
    Preset Fighter level 1 (D&D 2024).
    weapon_choice: 'longsword_shield' (Dueling, SAP+TOPPLE) or 'greatsword' (GWF, GRAZE+CLEAVE)
    """
    scores = dict(strength=16, dexterity=12, constitution=14, intelligence=10, wisdom=12, charisma=10)
    from models import AbilityScores
    ability_scores = AbilityScores(**scores)
    chain_mail = Armor(name="Chain Mail", base_ac=16, armor_type="heavy", max_dex_bonus=0)

    if weapon_choice == "longsword_shield":
        weapon = Weapon(
            name="Longsword", damage_dice="1d8", damage_type="slashing",
            ability="strength", versatile_dice="1d10", mastery=WeaponMastery.SAP,
        )
        return Character(
            name=name, class_name="Fighter", level=1, proficiency_bonus=2,
            ability_scores=ability_scores,
            max_hp=12, hp=12,
            ac=18,  # Chain Mail 16 + Shield +2
            speed=30, position=position,
            armor=chain_mail, shield=True,
            main_hand=weapon,
            fighting_style=FightingStyle.DUELING,
            weapon_masteries=[WeaponMastery.SAP, WeaponMastery.TOPPLE],
            save_proficiencies=["strength", "constitution"],
        )
    else:  # greatsword
        weapon = Weapon(
            name="Greatsword", damage_dice="2d6", damage_type="slashing",
            ability="strength", two_handed=True, mastery=WeaponMastery.GRAZE,
        )
        return Character(
            name=name, class_name="Fighter", level=1, proficiency_bonus=2,
            ability_scores=ability_scores,
            max_hp=12, hp=12,
            ac=16,  # Chain Mail only (two-handed)
            speed=30, position=position,
            armor=chain_mail, shield=False,
            main_hand=weapon,
            fighting_style=FightingStyle.GREAT_WEAPON,
            weapon_masteries=[WeaponMastery.GRAZE, WeaponMastery.CLEAVE],
            save_proficiencies=["strength", "constitution"],
        )
