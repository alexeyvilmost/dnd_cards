from __future__ import annotations

import uuid
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def gen_id() -> str:
    return str(uuid.uuid4())[:8]


# ─── Enums ────────────────────────────────────────────────────────────────────


class Condition(str, Enum):
    PRONE = "prone"
    RESTRAINED = "restrained"
    FRIGHTENED = "frightened"
    POISONED = "poisoned"
    BLINDED = "blinded"
    DEAFENED = "deafened"
    CHARMED = "charmed"
    PARALYZED = "paralyzed"
    STUNNED = "stunned"
    INCAPACITATED = "incapacitated"
    INVISIBLE = "invisible"
    HIDDEN = "hidden"
    DODGING = "dodging"
    DISENGAGING = "disengaging"
    UNCONSCIOUS = "unconscious"
    DEAD = "dead"


class FightingStyle(str, Enum):
    DUELING = "dueling"          # +2 damage, one-handed, no other weapon in hand
    GREAT_WEAPON = "great_weapon"  # reroll 1s and 2s on damage
    DEFENSE = "defense"          # +1 AC while wearing armor
    ARCHERY = "archery"          # +2 to ranged attack rolls
    TWO_WEAPON = "two_weapon"    # add ability modifier to off-hand damage
    PROTECTION = "protection"    # reaction: impose disadv on attack vs adjacent ally
    BLIND_FIGHTING = "blind_fighting"  # no disadv attacking blind/invisible


class WeaponMastery(str, Enum):
    SAP = "sap"        # on hit: target has disadv on their next attack roll
    PUSH = "push"      # on hit: push target 10ft (STR save vs DC 8+prof+STR)
    TOPPLE = "topple"  # on hit: knock prone (STR save vs DC 8+prof+STR)
    SLOW = "slow"      # on hit: target speed -10ft until start of your next turn
    NICK = "nick"      # light weapon: off-hand attack as part of Attack action, not bonus action
    GRAZE = "graze"    # on miss: deal STR/DEX mod damage of same type
    CLEAVE = "cleave"  # on hit: attack another adjacent creature with same weapon
    VEX = "vex"        # on hit: advantage on next attack roll vs same target this turn


# ─── Equipment ────────────────────────────────────────────────────────────────


class Weapon(BaseModel):
    name: str
    damage_dice: str
    damage_type: str
    ability: str = "strength"
    finesse: bool = False
    light: bool = False
    two_handed: bool = False
    versatile_dice: Optional[str] = None
    reach: bool = False
    ranged: bool = False
    ranged_range: Optional[tuple[int, int]] = None  # (normal_ft, long_ft)
    mastery: Optional[WeaponMastery] = None


class Armor(BaseModel):
    name: str
    base_ac: int
    armor_type: str  # "light", "medium", "heavy"
    max_dex_bonus: Optional[int] = None  # None = unlimited


# ─── Spells ───────────────────────────────────────────────────────────────────


class EffectOption(BaseModel):
    """A selectable variant for a "spell with a choice of effect" (e.g. choose
    the damage type, or which condition to apply). Chosen at cast time."""
    key: str
    label: str
    damage_type: Optional[str] = None
    condition: Optional[str] = None


class Spell(BaseModel):
    name: str
    level: int                       # 0 = cantrip
    school: str
    casting_time: str = "action"     # "action" | "bonus" | "reaction"
    range_ft: int = 0                # 0 = self/touch
    components: str = "V, S"
    duration: str = "Instantaneous"
    concentration: bool = False

    # Mechanics
    effect: str                      # "attack" | "save" | "heal" | "buff" | "utility"
    targeting: str = "single"        # "single" | "multi" | "area" | "self"
    damage_dice: Optional[str] = None
    damage_type: Optional[str] = None
    save_ability: Optional[str] = None     # e.g. "dexterity"
    save_for_half: bool = False
    half_on_save: bool = False
    condition: Optional[str] = None        # condition applied on failed save
    heal_dice: Optional[str] = None
    auto_hit: bool = False                  # no attack roll (Magic Missile)
    num_targets: int = 1                    # darts/rays/etc. for "multi"
    area_radius: int = 0                    # ft radius for "area"
    area_shape: Optional[str] = None        # "sphere" | "cone" | "cube" | "line"
    # Per-slot-level scaling (upcasting)
    upcast_damage_dice: Optional[str] = None   # extra dice per slot level above base
    upcast_targets: int = 0                    # extra darts/rays per slot above base
    damage_dice_wounded: Optional[str] = None  # alt dice if target is below max HP (Toll the Dead)
    cantrip_scale: bool = False                # damage dice scale with caster level (5/11/17)
    # "Spell with a choice of effect": if present, the caster picks one variant
    # at cast time (overrides damage_type / condition for that casting).
    effect_options: List[EffectOption] = []
    battle_ready: bool = True                   # validated mechanics; usable in combat
    description: str = ""


# ─── Character sub-models ─────────────────────────────────────────────────────


class AbilityScores(BaseModel):
    strength: int = 10
    dexterity: int = 10
    constitution: int = 10
    intelligence: int = 10
    wisdom: int = 10
    charisma: int = 10

    def mod(self, ability: str) -> int:
        return (getattr(self, ability) - 10) // 2


class Position(BaseModel):
    x: int = 0
    y: int = 0


class TurnState(BaseModel):
    """Resets at the start of each turn."""
    action_used: bool = False
    bonus_action_used: bool = False
    reaction_used: bool = False
    movement_used: int = 0       # feet used this turn
    dash_bonus: int = 0          # extra feet from Dash
    vex_target: Optional[str] = None  # character_id that has VEX advantage against


class Resources(BaseModel):
    """Short/long rest resources."""
    second_wind_used: bool = False
    hit_dice_remaining: int = 1


class DeathSaves(BaseModel):
    successes: int = 0
    failures: int = 0
    stable: bool = False


class ReadiedAction(BaseModel):
    action_type: str
    target_id: Optional[str] = None
    trigger_description: str
    params: Dict[str, Any] = {}


# ─── Character ────────────────────────────────────────────────────────────────


class Character(BaseModel):
    id: str = Field(default_factory=gen_id)
    name: str
    class_name: str = "Fighter"
    level: int = 1
    proficiency_bonus: int = 2
    background: Optional[str] = None   # cosmetic (Soldier, Sage, ...)
    portrait: Optional[str] = None     # cosmetic emoji/icon
    saved_id: Optional[str] = None     # source template id, if created from a saved character
    sheet_id: Optional[str] = None     # persistent battle_characters id, if materialized from a sheet

    # Team / NPC flags (PvE). Default party member; monsters set is_monster=True.
    team: str = "party"                # "party" | "monsters"
    is_monster: bool = False
    subclass: Optional[str] = None     # chosen subclass key (level 3)
    crit_threshold: int = 20           # natural roll >= this is a critical hit (Champion: 19)
    monster_xp: int = 0                # XP granted when this monster is defeated (PvE)
    item_attack_bonus: int = 0         # from equipped imported items
    item_damage_bonus: int = 0         # from equipped imported items
    melee_attack_bonus: int = 0        # from definitions/feats (e.g. melee-only bonuses)
    ranged_attack_bonus: int = 0       # from definitions/feats (e.g. Archery style)
    initiative_bonus: int = 0          # from definitions/feats (e.g. Alert)

    ability_scores: AbilityScores = Field(default_factory=AbilityScores)

    max_hp: int = 12
    hp: int = 12
    temp_hp: int = 0
    ac: int = 16
    speed: int = 30  # ft

    position: Position = Field(default_factory=Position)
    initiative: int = 0

    conditions: List[Condition] = []

    main_hand: Optional[Weapon] = None
    off_hand: Optional[Weapon] = None
    armor: Optional[Armor] = None
    shield: bool = False

    fighting_style: Optional[FightingStyle] = None
    weapon_masteries: List[WeaponMastery] = []
    save_proficiencies: List[str] = ["strength", "constitution"]

    turn_state: TurnState = Field(default_factory=TurnState)
    resources: Resources = Field(default_factory=Resources)
    death_saves: DeathSaves = Field(default_factory=DeathSaves)
    readied_action: Optional[ReadiedAction] = None

    # ── Spellcasting ──
    spellcasting_ability: Optional[str] = None   # e.g. "intelligence"
    spell_slots_max: Dict[int, int] = {}         # {level: count}
    spell_slots: Dict[int, int] = {}             # current remaining
    cantrips: List[str] = []                      # known cantrip names
    spells_prepared: List[str] = []               # prepared/known leveled spell names
    concentrating_on: Optional[str] = None        # spell name currently concentrated on
    active_buffs: Dict[str, Any] = {}             # {"mage_armor": True, "blur": True, "mirror_image": 3, "shield": round}

    # Action Surge (Fighter 2+)
    action_surge_max: int = 0
    action_surge_used: int = 0

    # Persistent per-character flags (not reset each turn)
    sap_penalty: bool = False   # has disadvantage on next attack roll (from SAP)
    helped_attack: bool = False  # has advantage on next attack roll (from Help)
    slow_penalty: int = 0       # speed reduction in ft (from SLOW mastery)
    grappling: Optional[str] = None
    grappled_by: Optional[str] = None

    def spell_save_dc(self) -> int:
        if not self.spellcasting_ability:
            return 0
        return 8 + self.proficiency_bonus + self.ability_scores.mod(self.spellcasting_ability)

    def spell_attack_bonus(self) -> int:
        if not self.spellcasting_ability:
            return 0
        return self.proficiency_bonus + self.ability_scores.mod(self.spellcasting_ability)

    def is_alive(self) -> bool:
        return Condition.DEAD not in self.conditions

    def is_conscious(self) -> bool:
        return self.is_alive() and Condition.UNCONSCIOUS not in self.conditions

    def movement_remaining(self) -> int:
        if Condition.RESTRAINED in self.conditions:
            return 0
        if Condition.PARALYZED in self.conditions or Condition.STUNNED in self.conditions:
            return 0
        effective_speed = max(0, self.speed - self.slow_penalty)
        return max(0, effective_speed + self.turn_state.dash_bonus - self.turn_state.movement_used)

    def can_use_action(self) -> bool:
        if not self.is_conscious():
            return False
        if Condition.PARALYZED in self.conditions or Condition.STUNNED in self.conditions:
            return False
        return not self.turn_state.action_used

    def can_use_bonus_action(self) -> bool:
        if not self.is_conscious():
            return False
        if Condition.PARALYZED in self.conditions or Condition.STUNNED in self.conditions:
            return False
        return not self.turn_state.bonus_action_used

    def can_use_reaction(self) -> bool:
        if not self.is_conscious():
            return False
        if Condition.PARALYZED in self.conditions or Condition.STUNNED in self.conditions:
            return False
        return not self.turn_state.reaction_used

    def attack_bonus(self, weapon: Optional[Weapon] = None) -> int:
        w = weapon or self.main_hand
        if w is None:
            return (
                self.proficiency_bonus
                + self.ability_scores.mod("strength")
                + self.item_attack_bonus
                + self.melee_attack_bonus
            )
        ability = self._weapon_ability(w)
        style = self.ranged_attack_bonus if w.ranged else self.melee_attack_bonus
        return self.proficiency_bonus + self.ability_scores.mod(ability) + self.item_attack_bonus + style

    def damage_bonus(self, weapon: Optional[Weapon] = None, off_hand: bool = False) -> int:
        w = weapon or self.main_hand
        if w is None:
            return self.ability_scores.mod("strength")
        ability = self._weapon_ability(w)
        bonus = self.ability_scores.mod(ability)
        # Off-hand attack: no ability modifier unless Two-Weapon Fighting style
        if off_hand and self.fighting_style != FightingStyle.TWO_WEAPON:
            bonus = 0
        # Dueling: +2 if one-handed weapon, no off-hand held
        if (
            not off_hand
            and self.fighting_style == FightingStyle.DUELING
            and not w.two_handed
            and self.off_hand is None
        ):
            bonus += 2
        return bonus + self.item_damage_bonus

    def _weapon_ability(self, weapon: Weapon) -> str:
        if weapon.finesse:
            str_mod = self.ability_scores.mod("strength")
            dex_mod = self.ability_scores.mod("dexterity")
            return "strength" if str_mod >= dex_mod else "dexterity"
        if weapon.ranged:
            return "dexterity"
        return weapon.ability


# ─── Combat state ─────────────────────────────────────────────────────────────


class CombatState(BaseModel):
    active: bool = False
    round: int = 0
    turn_index: int = 0
    initiative_order: List[str] = []

    def current_character_id(self) -> Optional[str]:
        if not self.initiative_order:
            return None
        return self.initiative_order[self.turn_index % len(self.initiative_order)]


# ─── Room ─────────────────────────────────────────────────────────────────────


class EventLog(BaseModel):
    round: int = 0
    turn_char: str = ""
    message: str = ""
    rolls: Dict[str, Any] = {}


class Room(BaseModel):
    id: str = Field(default_factory=gen_id)
    name: str = "Battle Room"
    characters: Dict[str, Character] = {}
    combat: CombatState = Field(default_factory=CombatState)
    log: List[EventLog] = []
    grid_width: int = 20   # squares → 100ft
    grid_height: int = 20  # squares → 100ft
