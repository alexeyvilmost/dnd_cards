"""D&D 2024 spell catalog — Wizard cantrips and level 1–2 spells.

Each entry is a Spell model (see models.py). Effects implemented by engine.cast_spell:
  - "attack":  spell attack roll vs AC, damage on hit (single or multi-projectile)
  - "save":    target makes a saving throw; damage and/or condition
  - "heal":    restore HP
  - "buff":    self/ally buff stored in active_buffs
  - "utility": narrative only (logged)
"""

from typing import Dict, List

from models import Spell


# ─── Cantrips (level 0) ─────────────────────────────────────────────────────────

CANTRIPS: List[Spell] = [
    Spell(
        name="Fire Bolt", level=0, school="Evocation", range_ft=120,
        effect="attack", targeting="single", damage_dice="1d10", damage_type="fire",
        description="A mote of fire streaks toward a creature or object. On hit, 1d10 fire damage.",
    ),
    Spell(
        name="Ray of Frost", level=0, school="Evocation", range_ft=60,
        effect="attack", targeting="single", damage_dice="1d8", damage_type="cold",
        condition="slow_speed",
        description="A frigid beam. 1d8 cold damage and the target's speed drops by 10ft until your next turn.",
    ),
    Spell(
        name="Shocking Grasp", level=0, school="Evocation", range_ft=5,
        effect="attack", targeting="single", damage_dice="1d8", damage_type="lightning",
        description="Lightning springs from your hand. 1d8 lightning; target can't take reactions until its next turn.",
    ),
    Spell(
        name="Acid Splash", level=0, school="Evocation", range_ft=60,
        effect="save", targeting="area", area_radius=5, area_shape="sphere",
        damage_dice="1d6", damage_type="acid", save_ability="dexterity",
        description="Acid bursts over creatures within 5ft of a point. DEX save or take 1d6 acid.",
    ),
    Spell(
        name="Poison Spray", level=0, school="Necromancy", range_ft=10,
        effect="save", targeting="single", damage_dice="1d12", damage_type="poison",
        save_ability="constitution",
        description="A puff of toxic gas. CON save or take 1d12 poison damage.",
    ),
    Spell(
        name="Chill Touch", level=0, school="Necromancy", range_ft=120,
        effect="attack", targeting="single", damage_dice="1d10", damage_type="necrotic",
        description="A ghostly hand. 1d10 necrotic; target can't regain HP until your next turn.",
    ),
    Spell(
        name="Mind Sliver", level=0, school="Enchantment", range_ft=60,
        effect="save", targeting="single", damage_dice="1d6", damage_type="psychic",
        save_ability="intelligence",
        description="Psychic energy. INT save or take 1d6 psychic and subtract 1d4 from its next save.",
    ),
    Spell(
        name="Frostbite", level=0, school="Evocation", range_ft=60,
        effect="save", targeting="single", damage_dice="1d6", damage_type="cold",
        save_ability="constitution",
        description="Numbing frost. CON save or take 1d6 cold and have disadvantage on its next attack.",
    ),
    Spell(
        name="Light", level=0, school="Evocation", range_ft=5, components="V, M",
        effect="utility", targeting="single", duration="1 hour",
        description="An object sheds bright light in a 20ft radius.",
    ),
    Spell(
        name="Mage Hand", level=0, school="Conjuration", range_ft=30,
        effect="utility", targeting="self", duration="1 minute",
        description="A spectral hand manipulates objects up to 10 lbs.",
    ),
    Spell(
        name="Prestidigitation", level=0, school="Transmutation", range_ft=10,
        effect="utility", targeting="self", duration="up to 1 hour",
        description="Minor magical tricks: sparks, sounds, cleaning, flavoring.",
    ),
    Spell(
        name="Minor Illusion", level=0, school="Illusion", range_ft=30, components="S, M",
        effect="utility", targeting="self", duration="1 minute",
        description="Create a sound or image of an object.",
    ),
    # ── Damage cantrips (attack roll) ──
    Spell(
        name="Eldritch Blast", level=0, school="Evocation", range_ft=120,
        effect="attack", targeting="single", damage_dice="1d10", damage_type="force",
        cantrip_scale=True,
        description="A beam of crackling energy. Ranged spell attack for 1d10 force damage.",
    ),
    Spell(
        name="Produce Flame", level=0, school="Conjuration", range_ft=30,
        effect="attack", targeting="single", damage_dice="1d8", damage_type="fire",
        cantrip_scale=True,
        description="Hurl flame from your hand. Ranged spell attack for 1d8 fire damage.",
    ),
    Spell(
        name="Sorcerous Burst", level=0, school="Evocation", range_ft=120,
        effect="attack", targeting="single", damage_dice="1d8", damage_type="force",
        cantrip_scale=True,
        description="A bolt of sorcerous energy. Ranged spell attack for 1d8 damage of a chosen type.",
    ),
    Spell(
        name="Starry Wisp", level=0, school="Evocation", range_ft=60,
        effect="attack", targeting="single", damage_dice="1d8", damage_type="radiant",
        cantrip_scale=True,
        description="A mote of starlight. Ranged spell attack for 1d8 radiant; the target glows and can't turn invisible.",
    ),
    # ── Damage cantrips (saving throw) ──
    Spell(
        name="Sacred Flame", level=0, school="Evocation", range_ft=60,
        effect="save", targeting="single", damage_dice="1d8", damage_type="radiant",
        save_ability="dexterity", cantrip_scale=True,
        description="Radiance descends on a creature. DEX save (ignores cover) or take 1d8 radiant.",
    ),
    Spell(
        name="Toll the Dead", level=0, school="Necromancy", range_ft=60,
        effect="save", targeting="single", damage_dice="1d8", damage_dice_wounded="1d12",
        damage_type="necrotic", save_ability="wisdom", cantrip_scale=True,
        description="A mournful bell. WIS save or take 1d8 necrotic (1d12 if the target is wounded).",
    ),
    Spell(
        name="Vicious Mockery", level=0, school="Enchantment", range_ft=60, components="V",
        effect="save", targeting="single", damage_dice="1d6", damage_type="psychic",
        save_ability="wisdom", condition="disadvantage_next_attack", cantrip_scale=True,
        description="Cutting words laced with magic. WIS save or take 1d6 psychic and disadvantage on its next attack.",
    ),
    Spell(
        name="Thunderclap", level=0, school="Evocation", range_ft=0, components="S",
        effect="save", targeting="area", area_radius=5, area_shape="sphere",
        damage_dice="1d6", damage_type="thunder", save_ability="constitution", cantrip_scale=True,
        description="A burst of thunder around you. Each creature within 5ft makes a CON save or takes 1d6 thunder.",
    ),
    Spell(
        name="Word of Radiance", level=0, school="Evocation", range_ft=5, components="V, M",
        effect="save", targeting="area", area_radius=5, area_shape="sphere",
        damage_dice="1d6", damage_type="radiant", save_ability="constitution", cantrip_scale=True,
        description="Burning radiance flares from you. Enemies within 5ft make a CON save or take 1d6 radiant.",
    ),
    # ── Defensive / buff cantrips ──
    Spell(
        name="Blade Ward", level=0, school="Abjuration", range_ft=0,
        effect="buff", targeting="self", duration="1 round",
        description="You ward yourself. Until the start of your next turn you have resistance to bludgeoning, piercing and slashing damage.",
    ),
    Spell(
        name="True Strike", level=0, school="Divination", range_ft=0, components="S, M",
        effect="buff", targeting="self",
        description="You gain insight into a foe's defenses, granting advantage on your next attack roll.",
    ),
    Spell(
        name="Shillelagh", level=0, school="Transmutation", casting_time="bonus", range_ft=5,
        components="V, S, M", effect="buff", targeting="self", duration="1 minute",
        description="Your club or staff becomes magical, dealing 1d8 force and using your spellcasting ability.",
    ),
    Spell(
        name="Guidance", level=0, school="Divination", range_ft=5, concentration=True,
        duration="up to 1 minute", effect="buff", targeting="single",
        description="A touched creature adds 1d4 to one ability check of its choice.",
    ),
    Spell(
        name="Resistance", level=0, school="Abjuration", range_ft=5, concentration=True,
        duration="up to 1 minute", effect="buff", targeting="single",
        description="A touched creature adds 1d4 to one saving throw of its choice.",
    ),
    Spell(
        name="Spare the Dying", level=0, school="Necromancy", range_ft=15,
        effect="heal", targeting="single",
        description="Stabilize a creature that has 0 hit points.",
    ),
    # ── Narrative / utility cantrips ──
    Spell(name="Dancing Lights", level=0, school="Illusion", range_ft=120, components="V, S, M",
        concentration=True, duration="up to 1 minute", effect="utility", targeting="self",
        description="Create up to four floating lights that you can move."),
    Spell(name="Druidcraft", level=0, school="Transmutation", range_ft=30,
        effect="utility", targeting="self",
        description="Whisper to nature: predict weather, bloom a flower, or make a harmless sensory effect."),
    Spell(name="Elementalism", level=0, school="Transmutation", range_ft=30,
        effect="utility", targeting="self",
        description="Conjure a minor elemental effect of air, earth, fire or water."),
    Spell(name="Friends", level=0, school="Enchantment", range_ft=0, components="S, M",
        concentration=True, duration="up to 1 minute", effect="utility", targeting="self",
        description="Gain advantage on Charisma checks against one non-hostile creature."),
    Spell(name="Mending", level=0, school="Transmutation", casting_time="action", range_ft=5,
        components="V, S, M", effect="utility", targeting="self",
        description="Repair a single break or tear in an object."),
    Spell(name="Message", level=0, school="Transmutation", range_ft=120, components="V, S, M",
        duration="1 round", effect="utility", targeting="self",
        description="Whisper a message to a creature you can see; it can whisper back."),
    Spell(name="Thaumaturgy", level=0, school="Transmutation", range_ft=30, components="V",
        duration="up to 1 minute", effect="utility", targeting="self",
        description="A minor wonder: amplify your voice, flicker flames, or shake the ground."),
]


# ─── Level 1 ────────────────────────────────────────────────────────────────────

LEVEL_1: List[Spell] = [
    Spell(
        name="Magic Missile", level=1, school="Evocation", range_ft=120,
        effect="attack", targeting="multi", auto_hit=True, num_targets=3, upcast_targets=1,
        damage_dice="1d4+1", damage_type="force",
        description="Three darts of force, each auto-hitting for 1d4+1. +1 dart per slot above 1st.",
    ),
    Spell(
        name="Burning Hands", level=1, school="Evocation", range_ft=15,
        effect="save", targeting="area", area_radius=15, area_shape="cone",
        damage_dice="3d6", damage_type="fire", save_ability="dexterity",
        save_for_half=True, half_on_save=True, upcast_damage_dice="1d6",
        description="A 15ft cone of flame. DEX save for half. 3d6 fire (+1d6 per slot above 1st).",
    ),
    Spell(
        name="Thunderwave", level=1, school="Evocation", range_ft=0,
        effect="save", targeting="area", area_radius=15, area_shape="cube",
        damage_dice="2d8", damage_type="thunder", save_ability="constitution",
        save_for_half=True, half_on_save=True, upcast_damage_dice="1d8",
        description="A wave of force in a 15ft cube. CON save for half; failures pushed 10ft. 2d8 thunder.",
    ),
    Spell(
        name="Chromatic Orb", level=1, school="Evocation", range_ft=90, components="V, S, M",
        effect="attack", targeting="single", damage_dice="3d8", damage_type="fire",
        upcast_damage_dice="1d8",
        description="A 4-inch sphere of energy (your chosen type). Spell attack, 3d8 (+1d8 per slot above 1st).",
    ),
    Spell(
        name="Witch Bolt", level=1, school="Evocation", range_ft=30, concentration=True,
        duration="up to 1 minute",
        effect="attack", targeting="single", damage_dice="2d12", damage_type="lightning",
        upcast_damage_dice="1d12",
        description="A beam of crackling energy. Spell attack, 2d12 lightning; sustain for 1d12 each turn.",
    ),
    Spell(
        name="Ice Knife", level=1, school="Conjuration", range_ft=60, components="S, M",
        effect="attack", targeting="single", damage_dice="1d10", damage_type="piercing",
        description="A shard of ice. Spell attack for 1d10 piercing, then 2d6 cold explosion (DEX save) nearby.",
    ),
    Spell(
        name="Ray of Sickness", level=1, school="Necromancy", range_ft=60,
        effect="attack", targeting="single", damage_dice="2d8", damage_type="poison",
        condition="poisoned", upcast_damage_dice="1d8",
        description="A ray of sickening energy. Spell attack, 2d8 poison; CON save or Poisoned until your next turn.",
    ),
    Spell(
        name="Sleep", level=1, school="Enchantment", range_ft=90, concentration=True,
        duration="up to 1 minute",
        effect="save", targeting="area", area_radius=5, area_shape="sphere",
        save_ability="wisdom", condition="unconscious",
        description="Creatures in a 5ft sphere make a WIS save or fall Unconscious (Incapacitated).",
    ),
    Spell(
        name="Color Spray", level=1, school="Illusion", range_ft=15, components="V, S, M",
        effect="save", targeting="area", area_radius=15, area_shape="cone",
        save_ability="constitution", condition="blinded",
        description="A dazzling cone of color. CON save or be Blinded until the end of your next turn.",
    ),
    Spell(
        name="Tasha's Hideous Laughter", level=1, school="Enchantment", range_ft=30,
        concentration=True, duration="up to 1 minute", components="V, S, M",
        effect="save", targeting="single", save_ability="wisdom", condition="prone",
        description="A creature falls Prone with laughter (Incapacitated) on a failed WIS save.",
    ),
    Spell(
        name="Mage Armor", level=1, school="Abjuration", range_ft=5,
        effect="buff", targeting="single", duration="8 hours",
        description="Touched creature's base AC becomes 13 + DEX while unarmored.",
    ),
    Spell(
        name="Shield", level=1, school="Abjuration", casting_time="reaction", range_ft=0,
        effect="buff", targeting="self", duration="1 round",
        description="Reaction: +5 AC until the start of your next turn, including vs the triggering attack.",
    ),
    Spell(
        name="False Life", level=1, school="Necromancy", range_ft=0,
        effect="heal", targeting="self", heal_dice="2d4",
        description="Gain 2d4 + 3 temporary hit points.",
    ),
    Spell(
        name="Expeditious Retreat", level=1, school="Transmutation", casting_time="bonus",
        range_ft=0, concentration=True, duration="up to 10 minutes",
        effect="buff", targeting="self",
        description="Bonus action: Dash. You can Dash again as a bonus action each turn.",
    ),
    Spell(
        name="Feather Fall", level=1, school="Transmutation", casting_time="reaction",
        range_ft=60, effect="utility", targeting="multi",
        description="Reaction: up to 5 falling creatures descend safely.",
    ),
    Spell(
        name="Detect Magic", level=1, school="Divination", concentration=True,
        duration="up to 10 minutes", effect="utility", targeting="self",
        description="Sense the presence of magic within 30ft.",
    ),
]


# ─── Level 2 ────────────────────────────────────────────────────────────────────

LEVEL_2: List[Spell] = [
    Spell(
        name="Scorching Ray", level=2, school="Evocation", range_ft=120,
        effect="attack", targeting="multi", num_targets=3, upcast_targets=1,
        damage_dice="2d6", damage_type="fire",
        description="Three rays of fire, each a separate spell attack for 2d6. +1 ray per slot above 2nd.",
    ),
    Spell(
        name="Misty Step", level=2, school="Conjuration", casting_time="bonus", range_ft=0,
        effect="buff", targeting="self",
        description="Bonus action: teleport up to 30ft to an unoccupied space you can see.",
    ),
    Spell(
        name="Shatter", level=2, school="Evocation", range_ft=60, components="V, S, M",
        effect="save", targeting="area", area_radius=10, area_shape="sphere",
        damage_dice="3d8", damage_type="thunder", save_ability="constitution",
        save_for_half=True, half_on_save=True, upcast_damage_dice="1d8",
        description="A ringing burst in a 10ft sphere. CON save for half. 3d8 thunder (+1d8 per slot above 2nd).",
    ),
    Spell(
        name="Melf's Acid Arrow", level=2, school="Evocation", range_ft=90, components="V, S, M",
        effect="attack", targeting="single", damage_dice="4d4", damage_type="acid",
        upcast_damage_dice="1d4",
        description="An arrow of acid. Spell attack, 4d4 acid + 2d4 next turn (half on miss).",
    ),
    Spell(
        name="Mirror Image", level=2, school="Illusion", range_ft=0, duration="1 minute",
        effect="buff", targeting="self",
        description="Three illusory duplicates make attacks against you likely to miss.",
    ),
    Spell(
        name="Blur", level=2, school="Illusion", range_ft=0, concentration=True,
        duration="up to 1 minute", effect="buff", targeting="self",
        description="Attack rolls against you have disadvantage (attacker must see normally).",
    ),
    Spell(
        name="Hold Person", level=2, school="Enchantment", range_ft=60, concentration=True,
        duration="up to 1 minute", components="V, S, M",
        effect="save", targeting="single", save_ability="wisdom", condition="paralyzed",
        description="A humanoid is Paralyzed on a failed WIS save (repeats save each turn).",
    ),
    Spell(
        name="Ray of Enfeeblement", level=2, school="Necromancy", range_ft=60, concentration=True,
        duration="up to 1 minute",
        effect="attack", targeting="single",
        description="Spell attack; on hit the target deals half damage with STR attacks (save ends).",
    ),
    Spell(
        name="Blindness/Deafness", level=2, school="Transmutation", range_ft=30, components="V",
        effect="save", targeting="single", save_ability="constitution", condition="blinded",
        duration="1 minute",
        description="A creature is Blinded on a failed CON save (repeats each turn).",
    ),
    Spell(
        name="Flaming Sphere", level=2, school="Conjuration", range_ft=60, concentration=True,
        duration="up to 1 minute", components="V, S, M",
        effect="save", targeting="single", damage_dice="2d6", damage_type="fire",
        save_ability="dexterity", save_for_half=True, half_on_save=True, upcast_damage_dice="1d6",
        description="A 5ft sphere of flame you can roll. Adjacent creatures make DEX save for half of 2d6 fire.",
    ),
    Spell(
        name="Cloud of Daggers", level=2, school="Conjuration", range_ft=60, concentration=True,
        duration="up to 1 minute", components="V, S, M",
        effect="save", targeting="area", area_radius=5, area_shape="cube",
        damage_dice="4d4", damage_type="slashing", save_ability="dexterity",
        upcast_damage_dice="2d4",
        description="A 5ft cube filled with spinning daggers. 4d4 slashing to creatures inside.",
    ),
    Spell(
        name="Mirror Image", level=2, school="Illusion", range_ft=0, duration="1 minute",
        effect="buff", targeting="self",
        description="Three illusory duplicates make attacks against you likely to miss.",
    ),
    Spell(
        name="Invisibility", level=2, school="Illusion", range_ft=5, concentration=True,
        duration="up to 1 hour", components="V, S, M",
        effect="buff", targeting="single",
        description="A creature you touch becomes Invisible until it attacks or casts a spell.",
    ),
    Spell(
        name="Web", level=2, school="Conjuration", range_ft=60, concentration=True,
        duration="up to 1 hour", components="V, S, M",
        effect="save", targeting="area", area_radius=20, area_shape="cube",
        save_ability="dexterity", condition="restrained",
        description="Sticky webs fill a 20ft cube. DEX save or be Restrained.",
    ),
    Spell(
        name="Levitate", level=2, school="Transmutation", range_ft=60, concentration=True,
        duration="up to 10 minutes", components="V, S, M",
        effect="utility", targeting="single",
        description="A creature or object rises vertically up to 20ft.",
    ),
]


# ─── Lookup ─────────────────────────────────────────────────────────────────────

_ALL = CANTRIPS + LEVEL_1 + LEVEL_2
SPELLS: Dict[str, Spell] = {}
for _s in _ALL:
    SPELLS[_s.name] = _s  # later duplicate (e.g. Mirror Image) just overwrites identically


def get_spell(name: str) -> Spell | None:
    return SPELLS.get(name)


def spells_by_level(level: int) -> List[Spell]:
    return [s for s in SPELLS.values() if s.level == level]


def catalog() -> List[dict]:
    """All spells as plain dicts, sorted by level then name (for the UI)."""
    return [s.model_dump() for s in sorted(SPELLS.values(), key=lambda s: (s.level, s.name))]
