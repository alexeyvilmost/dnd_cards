"""Rebuild the reviewed feat manifest from the pinned, local production export.

The notes below are authored per description, not inferred from entity names.
The output is also the immutable data fixture of featCatalogAudit.test.ts.
Run from the repository root; no database/network writes are performed.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import uuid

SNAPSHOT_SHA = "079b69c5cdcbff81d9346a97a3717ef2abf48c54306d62778824bcbc96a3f291"
TEST = "frontend/src/character/rules/featCatalogAudit.test.ts"
RUNTIME_TEST = "frontend/src/engine/featCatalogAudit.test.ts"
ABILITIES = ["str", "dex", "con", "int", "wis", "cha"]
SKILLS = ["acrobatics", "animal_handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight_of_hand", "stealth", "survival"]

# Implemented part, precise remaining limitations. Ordinary general-feat ASIs
# and every boon ASI are independently exercised for every offered ability.
NOTES = {
 1: ("Initiative adds the current proficiency bonus; the existing consent-based initiative-swap capability is preserved.", "The exchange UI, incapacitation and consent replay are outside this focused test; the initiative projection is tested at three levels."),
 2: ("Luck points and the two existing paid actions are preserved.", "The disadvantage action is still a generic next-attack debuff with an invented 60-foot/visibility gate; it does not prove that this creature is currently attacking the owner. Decision timing and rest replenishment need a new authoritative influence action."),
 3: ("Improvised-weapon proficiency, the d4 unarmed profile and rerolling damage ones are retained; push remains an optional separate action.", "Push does not declare the full own-turn/Attack-action/once-per-turn restrictions. Damage reroll and push chronology are not declared fully checked by this audit."),
 4: ("The damage reroll now covers base melee and ranged weapon damage, once per turn, comparing the complete eligible dice totals rather than cherry-picking each die.", "The generic rule applies automatically; choosing whether to spend the once-per-turn reroll still needs a pending damage choice. Weapons with multiple separate base damage lines need broader grouping coverage."),
 5: ("Maximum hit points increase by twice character level through the canonical projection.", "Level 1, 4 and 19 projections are tested; existing saved characters require normal recalculation to display the new projection."),
 6: ("Battle Medic consumes one healer-kit charge and a target Hit Die, using the healer's proficiency bonus. Healing ones reroll for spells and Battle Medic, excluding ordinary potions and unrelated Hit Die healing.", "Multiclass choice of target Hit Die remains limited to the runtime's primary hit-die field. The generic reroll is automatic, while the description permits the player to decline it."),
 7: ("Three instrument proficiencies and the existing capped inspiration action are preserved.", "The song still uses a fixed six-target limit and an invented 60-foot range instead of proficiency bonus and hearing; instrument possession/proficiency and immediate post-rest timing are not enforced."),
 8: ("Three independently selected skills/tools are projected from the explicit shared catalog choices.", "Repeated feat acquisitions and every individual tool option are not end-to-end tested; mixed skill/tool projection is checked."),
 9: ("The existing wizard-list variant keeps its chosen casting ability, two cantrips and one prepared first-level spell with a free long-rest use. A false spellbook/INT-only narrative is removed.", "This generic-titled record represents the wizard variant only; cleric/druid use separate existing records. Repeated-class exclusion and replacing a spell on level-up are not fully enforced."),
 10: ("Tool selection is restricted to the eight crafts in the description. The existing discount declaration and temporary-item action are retained.", "Shopping does not consume the discount declaration. Crafting lacks tool ownership gates and three table options, and must verify temporary-item expiry after rest before it can be considered complete."),
 11: ("Strength/Dexterity increase and existing dual-wielding declarations/capability are preserved.", "The audit tests the ability choice only; Attack-action history, off-hand damage suppression, additional-attack budget and double draw/stow still need complete combat coverage."),
 12: ("Charisma increase, impersonation advantage and mimicry detection DC are preserved.", "Only the Charisma projection is newly tested. Identity, remembered voices and adjudication of impersonation are narrative inputs; conditional advantage/DC execution still needs scenario coverage."),
 13: ("Strength/Dexterity increase and climb speed equal to current speed project correctly.", "Standing for five feet and the five-foot running-jump approach remain declarations not consumed by every movement path."),
 14: ("Mental ability increase, concentration advantage, somatic-component override and opportunity-spell declarations are preserved.", "The fresh test checks ability choice; target-count, action casting time, reaction timing and occupied-hands paths require full execution scenarios."),
 15: ("Strength/Dexterity increase and the grapple capability are preserved.", "Damage plus grapple once per own Attack action, advantage against one's own grappled target and movement with different target sizes need coordinated combat tests."),
 16: ("Dexterity/Constitution increase and ten-foot speed increase now reach the canonical movement projection.", "Difficult-terrain immunity specifically after Dash and disadvantage on opportunity attacks are still not represented by complete generic execution filters."),
 17: ("Strength/Dexterity/Wisdom increase and existing mounted-combat capability are preserved.", "Mount size/incapacitation, controlled mount ownership, damage evasion and redirecting an attack are not verified by an ability-score test."),
 18: ("Intelligence/Wisdom increase and selected skill proficiency-or-expertise are projected, including an already proficient skill.", "Bonus-action Search remains a declaration; the ability/skill projection does not prove encounter action-cost handling."),
 19: ("Strength/Dexterity increase and martial-weapon proficiency project from the entity data.", "Weapon attack construction is outside this focused projection test."),
 20: ("Wisdom/Charisma choice retains the matching speech action; its targeting is corrected from unsupported sphere to up to six selected creatures.", "Rest availability, ten-minute performance/hearing and temporary-hit-point delivery to every selected creature still require encounter-level coverage."),
 21: ("Chosen mental ability, prepared Invisibility and the first-level illusion/necromancy selection are retained.", "Free-use restoration, level-up replacement, spell-component costs and every eligible spell are not newly executed here."),
 22: ("Chosen mental ability, prepared Misty Step and the first-level divination/enchantment selection are retained.", "Free-use restoration, level-up replacement and every eligible spell remain outside the ability projection test."),
 23: ("Strength/Dexterity increase and light-armor/shield proficiency are projected.", "Armor equipment interaction is not an additional source of an ability increase; proficiency checks are tested separately from equipped armor combat."),
 24: ("Strength/Dexterity increase and medium-armor proficiency are projected.", "The prerequisite still depends on the existing acquisition validator; importing a pre-existing invalid character is not repaired by this data patch."),
 25: ("Strength/Constitution increase and heavy-armor proficiency are projected.", "The medium-armor prerequisite and movement/stealth consequences of actual equipment are outside the projection test."),
 26: ("Strength/Constitution increase and the existing push/critical capability are retained.", "The existing combat adapter focuses on weapon attacks; bludgeoning spell/unarmed attacks and critical expiry require broader coverage."),
 27: ("Strength increase and heavy-weapon damage/extra-attack capability are preserved.", "The added proficiency damage must be restricted to a heavy weapon in the Attack action on the owner's turn, not any bonus-action weapon hit; all trigger branches are not newly verified."),
 28: ("Strength/Dexterity increase and the existing butt attack/reach-entry reaction are preserved.", "Eligible weapon properties, own-turn Attack-action history, reaction window and damage modifiers need full combat scenarios."),
 29: ("Strength/Dexterity increase and the proficient-weapon mastery choice are retained.", "Swapping the selected mastery after a long rest and every weapon mastery execution are not covered by the ability test."),
 30: ("Strength/Dexterity increase and the conditional medium-armor Dexterity cap declaration are preserved.", "The Dexterity-16 threshold and actual worn medium-armor KД calculation need targeted equipment tests beyond the ability projection."),
 31: ("Strength/Constitution increase and the existing heavy-armor physical attack reduction are preserved.", "Reduction depends on actual heavy armor and one application per incoming attack; unrelated damage must not qualify. The broader static reduction primitive has separate tests."),
 32: ("Strength increase and the existing shield bash/evasion capability are preserved.", "Attack-action history, once-per-turn use, worn shield, push/prone choice and reaction-based Dexterity evasion are not all newly verified."),
 33: ("Chosen mental ability and spell attack cover/range/adjacency rules are retained. An extra cantrip choice absent from the description is removed.", "The unchanged spell-attack adapters still require encounter tests for each cover and minimum-base-range branch."),
 34: ("Dexterity increase and weapon ranged-attack cover/adjacency/long-range declarations are preserved.", "Their complete weapon-versus-spell scope and visibility context are not established by the ability projection test."),
 35: ("Strength/Dexterity increase and existing charge damage/push choices are preserved.", "Straight-line movement distance, Dash speed, target size, once-per-turn and optional choice timing still need complete encounter coverage."),
 36: ("Dexterity increase and the existing paid defensive reaction are preserved.", "The produced KД modifier must cover only melee attacks until the next turn; its current general KД buff can affect ranged attacks. Finesse-weapon possession and trigger chronology also need correction."),
 37: ("Intelligence increase and the chosen knowledge skill's proficiency-or-expertise are projected.", "Bonus-action Study is still only a declaration outside the tested skill projection."),
 38: ("Dexterity/Intelligence increase, poison resistance bypass and the existing poison action are retained; tool proficiency now uses the canonical poisoner_kit key.", "The existing resource grant does not enforce one hour, 50 GP and tools when making doses; chosen-ability poison DC and poison expiry still need a complete craft/use flow."),
 39: ("Strength/Dexterity increase and the existing piercing reroll/critical-die capability are retained.", "The critical extra die currently filters weapon attacks; piercing spell attacks are omitted. Optional single-die selection and once-per-turn decision timing are not newly verified."),
 40: ("Dexterity increase and ten-foot blindsight project correctly.", "Combat Hide advantage uses a legacy declaration and remaining hidden after a missed attack needs authoritative detection-state support."),
 41: ("Chosen mental ability and the proficiency-scaled first-level ritual selection are retained, with the shared quick-ritual resource declaration.", "This audit tests the ability choice, not rest recovery, preparation growth, the ritual tag or casting each eligible ritual without a slot."),
 42: ("Strength/Dexterity increase and existing slashing slow/critical disadvantage are preserved.", "Attack source scope, once-per-turn player choice and expiry at the source's next turn need full encounter coverage."),
 43: ("Chosen mental ability and selected spell-damage resistance/minimum-die rules are preserved.", "The selected elemental policy, repeated feat uniqueness and exclusion of non-spell damage need execution coverage beyond the ability projection."),
 44: ("Constitution increase and the bonus-action Hit Die healing action are retained; healing now equals the die alone, without an undeclared Constitution or proficiency bonus.", "Death-saving-throw advantage and multiclass Hit Die selection are not fully tested by the healing-action test."),
 45: ("Strength/Dexterity increase and existing sentinel reactions/stopping action are preserved.", "The creature's Disengage/attack-other triggers, exact reaction timing and current-turn speed-zero expiry still need coordinated encounter tests."),
 46: ("Mental ability choice still grants the matching push/pull DC actions and component-free Mage Hand.", "Invisible-hand choice and the rule granting extra range only when Mage Hand was already known are not fully represented; existing range_bonus_ft is unconditional."),
 47: ("Mental ability choice, component-free Detect Thoughts and the existing telepathic utterance action are retained.", "Language comprehension, one-way conversation and message contents are narrative inputs. Free-use rest restoration and the full Detect Thoughts interaction are not newly verified."),
 48: ("Strength/Dexterity increase, concentration disruption and the protected-mind resource/outcome declaration are preserved.", "Source-caused damage, choosing success after a failed mental save, atomic resource spending and short-rest restoration require pending-roll command tests."),
 49: ("Both nested ability choices work: +2 to one score or +1 to two, with a maximum of 20.", "The fresh tests cover both branches and the cap; repeated acquisition uses existing instance-key handling rather than rewriting saved selections."),
 50: ("The chosen ability increase and proficiency in that same saving throw are projected together.", "Already proficient saving-throw choices must remain excluded by acquisition validation; this projection test does not certify all selection UI paths."),
 51: ("Constitution/Wisdom increase and the existing treats/short-rest declarations are retained; cooking proficiency now uses the shared cook key.", "Ingredient/tool possession, one-hour preparation, distributing treats and eight-hour expiry are not enforced by the free resource grant. The extra short-rest die needs a full rest-choice flow."),
 52: ("Dexterity increase and existing crossbow loading/adjacency/light-attack capability are preserved.", "The ammunition free-hand exception, eligible crossbow identification and modifier on the additional Light attack require targeted encounter coverage."),
 53: ("Any ability increase, two skill proficiencies as specified by this record, and one expertise choice are projected.", "The selected expertise must already be proficient and not expert; acquisition availability and repeat/import cases remain distinct from projection."),
 54: ("The existing +2 damage rule retains melee weapon, base damage, one-hand and no-other-weapon filters.", "This audit tests the numeric rule and negative filters through the modifier collector; weapon assembly/equipment changes are not a complete combat certification."),
 55: ("The existing shield-protection reaction capability is retained.", "Protecting another creature within five feet, visibility, reaction payment and persistent disadvantage until the next turn need encounter tests; no new verification claim is made."),
 56: ("The +1 KД modifier is retained with the worn-armor condition.", "The numeric rule is tested with and without the armor fact; the style acquisition prerequisite remains managed by the class-choice flow."),
 57: ("The existing interception reaction, 1d10 plus proficiency reduction and equipment declaration are retained.", "The other-target/visible-attacker/range/equipment gate and authoritative reaction decision are not newly executed in this audit."),
 58: ("The existing d6 unarmed profile, d8 with empty hands and start-of-turn grapple damage are preserved.", "Hand equipment, choosing one grappled target and automatic-versus-optional damage at turn start still need encounter scenarios."),
 59: ("The existing minimum weapon damage die of three retains melee/two-hand filters.", "This audit checks the modifier predicate; only two-handed or versatile weapons should be eligible, which also relies on weapon construction."),
 60: ("Ten-foot blindsight reaches the canonical character senses projection.", "The board's perception, darkness and line-of-sight use of this sense is outside this projection test."),
 61: ("The existing weapon ability modifier applies only to the extra Light-property attack when it was not already included.", "The modifier collector is tested positively and against an already-included modifier; extra attack assembly and resource budget remain separate concerns."),
 62: ("The +2 base-damage rule is preserved for ranged thrown-weapon attacks.", "The modifier collector verifies thrown/ranged/base-line filters; equipped weapon construction is outside this test."),
 63: ("The +2 attack bonus is retained for ranged weapon attacks.", "The collector rejects a melee weapon or spell attack; complete weapon loading/range/cover execution is outside this audit."),
 64: ("A chosen ability now increases by one, up to 30, through the shared cap-aware resolver.", "Turning a miss into a hit once until the next turn has no authoritative pending-roll action yet."),
 65: ("A chosen ability now increases by one, up to 30.", "Zero-HP recovery, healing half maximum HP, a ten-d10 pool and choosing dice as a bonus action require a new resource/decision flow; none is faked by passive healing."),
 66: ("Intelligence/Wisdom/Charisma can increase by one, up to 30.", "Rolling a d4 after spending a level 1–4 slot and atomically retaining that slot on an equal result is not implemented."),
 67: ("A chosen ability increases by one, up to 30; truesight 60 feet is declared and projected.", "Perception/rendering consequences of truesight are not fully simulated by the sense projection."),
 68: ("A chosen ability now increases by one, up to 30.", "A visible unoccupied destination within 30 feet after Attack or Magic needs a post-action teleport decision; no unrestricted teleport is granted."),
 69: ("Strength/Dexterity increases by one, up to 30; physical damage ignores resistance through generic typed resistance declarations.", "On a natural 20, the extra damage equal to the selected ability score and its damage-type choice still need an explicit optional damage step."),
 70: ("A chosen ability now increases by one, up to 30.", "Dim-light/darkness facts, bonus-action invisibility that ends on action/bonus/reaction, and conditional resistance except radiant/psychic are not implemented. Unconditional resistance would contradict the description."),
 71: ("A chosen ability increases by one, up to 30; walking speed increases by 30 feet.", "Bonus-action Disengage and ending grapple conditions together need an authoritative combined action; speed is the newly tested implemented portion."),
 72: ("A chosen ability increases by one, up to 30; two different selected nonphysical energy resistances are declared.", "Changing both resistances on long rest and the retaliatory reaction with visibility, cover, Dexterity save and Constitution-based damage are not implemented."),
 73: ("A chosen ability increases by one, up to 30; maximum hit points increase by 40.", "Choosing extra Constitution-modifier healing once until the next turn needs an after-healing decision and usage ledger."),
 74: ("A chosen ability now increases by one, up to 30.", "Choosing plus/minus 2d4 after a visible nearby d20 outcome and refreshing on initiative/short/long rest requires a new pending-roll action."),
 75: ("A chosen ability increases by one, up to 30; all eighteen skills receive proficiency and one selected skill receives expertise.", "Acquisition must reject an already expert skill; projection validates all eighteen grants and the chosen expertise, not every acquisition UI path."),
 77: ("The cleric-list Magic Initiate variant keeps chosen casting ability, two cantrips and one prepared first-level spell with a free long-rest use.", "The common description still presents a class choice; this record is the cleric variant. Repeat-class exclusion and level-up spell replacement are not fully enforced."),
 78: ("The druid-list Magic Initiate variant keeps chosen casting ability, two cantrips and one prepared first-level spell with a free long-rest use.", "The common description still presents a class choice; this record is the druid variant. Repeat-class exclusion and level-up spell replacement are not fully enforced."),
}

def digest(row):
    pair = [row.get("description"), row.get("detailed_description")]
    return hashlib.sha256(json.dumps(pair, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()

def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from walk(child)
    elif isinstance(value, list):
        for child in value: yield from walk(child)

def review(n):
    text, gap = NOTES[n]
    untested = {2, 7, 55, 57, 58}
    mixed = {12, 47}
    status = "not_verified" if n in untested else "partial_narrative_verified_partial" if n in mixed else "verified_partial"
    if n in untested: tested = []
    elif 11 <= n <= 53 or 64 <= n <= 75:
        tested = ["Actual guarded effect data: every offered ability increase is projected with its declared cap; unselected choices do not grant an increase."]
    else:
        tested = ["Actual guarded effect/action data is exercised by the focused feat catalog test for the implemented portion stated above."]
    return dict(status=status, summary=text, implemented=[text], tested=tested, limitations=[gap], evidence=[TEST, RUNTIME_TEST])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default="outputs/mechanics-20260929")
    ap.add_argument("--output", default="backend/migrations/data/catalog-audit-20260929/feats.json")
    args = ap.parse_args()
    root = Path(args.snapshot)
    catalog = {}
    for plural, typ in [("feats", "feat"), ("effects", "effect"), ("actions", "action"), ("resources", "resource"), ("spells", "spell"), ("cards", "card")]:
        catalog[typ] = json.loads((root / f"{plural}.json").read_text(encoding="utf-8"))
    feats = sorted((x for x in catalog["feat"] if not x.get("deleted_at")), key=lambda x: x["card_number"])
    assert len(feats) == 77
    assert {int(x["card_number"][-4:]) for x in feats} == set(NOTES)
    by_type = {k: {x["id"]: x for x in v} for k, v in catalog.items()}
    by_number = {k: {x.get("card_number", x.get("resource_id")): x for x in v} for k, v in catalog.items()}
    patches = {}
    owners = {}
    new = []
    def mutate(typ, number, n):
        original = by_number[typ][number]
        key = (typ, original["id"])
        owners[key] = n
        if key not in patches: patches[key] = copy.deepcopy(original)
        return patches[key]
    # Correct declarations against the actual description and interpreter.
    m = mutate("effect", "EFF-savage-attacker", 4)["mechanics"]
    m["effects"][0]["result"][0]["applies_to"]["filter"] = {"attackKind": "weapon", "weaponDamageLine": "base"}
    m = mutate("action", "ACT-feat-healer-medic", 6)["mechanics"]
    m["activation"]["cost"][1] = {"resource": "uses_CARD-0491", "amount": 1}
    m["effects"][0]["result"][0].update(hit_die_modifier="prof", hit_die_modifier_source="source", healing_source="battle_medic")
    m = mutate("effect", "EFF-feat-healer-reroll", 6)["mechanics"]
    m["effects"][0]["result"][0]["applies_to"]["filter"] = {"healingSource": ["spell", "battle_medic"]}
    m = mutate("effect", "magic_initiate_wizard", 9)["mechanics"]
    m["effects"][0]["result"] = [p for p in m["effects"][0]["result"] if p.get("kind") != "narrative"]
    tools = ["carpenter", "leatherworker", "mason", "potter", "smith", "tinker", "weaver", "woodcarver"]
    all_tools = by_number["effect"]["EFF-skilled"]["mechanics"]["effects"][0]["options"]["items"]
    names = {x["id"].removeprefix("tool:"): x["name"] for x in all_tools if x["id"].startswith("tool:")}
    mutate("effect", "EFF-feat-crafter-tools", 10)["mechanics"]["effects"][0]["options"] = {"source": "explicit", "items": [{"id": t, "name": names[t]} for t in tools]}
    m = mutate("effect", "EFF-general-FEAT-0016", 16)["mechanics"]
    m["effects"][1]["result"][0]["applies_to"] = {"roll": "speed"}
    for suffix in ["wis", "cha"]:
        mutate("action", f"ACT-general-inspiring-leader-{suffix}", 20)["mechanics"]["targeting"]["shape"] = "multiple"
    m = mutate("effect", "EFF-general-FEAT-0033", 33)["mechanics"]
    m["effects"] = [x for x in m["effects"] if x.get("id") != "spell_sniper_cantrip"]
    for n, wrong, correct in [(38, "poisoners_kit", "poisoner_kit"), (51, "cooks_utensils", "cook")]:
        for p in walk(mutate("effect", f"EFF-general-FEAT-{n:04d}", n)["mechanics"]):
            if p.get("kind") == "grant_proficiency" and p.get("prof") == "tool" and p.get("value") == wrong: p["value"] = correct
    m = mutate("action", "ACT-general-durable", 44)["mechanics"]
    for p in walk(m):
        if p.get("kind") == "healing": p["hit_die_modifier"] = "none"
    # One ordinary data-owned passive per previously undeclared epic boon.
    for feat in feats:
        n = int(feat["card_number"][-4:])
        if not 64 <= n <= 75: continue
        assert not feat.get("related_effects") and not feat.get("related_actions")
        abilities = ["int", "wis", "cha"] if n == 66 else ["str", "dex"] if n == 69 else ABILITIES
        effect_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"dnd-cards:catalog-audit-20260929:{feat['card_number']}:passive"))
        effects = [{"kind": "choice", "id": "epic_boon_ability_increase", "count": 1, "resolution": "on_acquire", "prompt": "Выберите характеристику (+1, максимум 30)", "options": {"source": "explicit", "items": [{"id": a, "name": a.upper()} for a in abilities]}, "grant": {"kind": "grant_ability_score", "amount": 1, "cap": 30}}]
        payloads = []
        if n == 67: payloads.append({"kind": "grant_sense", "sense": "truesight", "range": 60})
        if n == 69: payloads.extend({"kind": "modifier", "op": "ignore", "applies_to": {"resistance": t}} for t in ["bludgeoning", "piercing", "slashing"])
        if n == 71: payloads.append({"kind": "modifier", "op": "add", "value": 30, "applies_to": {"roll": "speed"}})
        if n == 72:
            effects.append({"kind": "choice", "id": "epic_boon_energy_resistances", "count": 2, "prompt": "Выберите два сопротивления", "options": {"source": "explicit", "items": [{"id": t, "name": t, "grants": [{"kind": "resistance", "damage_type": t, "value": "resistance"}]} for t in ["thunder", "radiant", "acid", "necrotic", "fire", "psychic", "cold", "lightning", "poison"]]}})
        if n == 73: payloads.append({"kind": "modifier", "op": "add", "value": 40, "applies_to": {"roll": "max_hp"}})
        if n == 75:
            payloads.extend({"kind": "grant_proficiency", "prof": "skill", "value": s} for s in SKILLS)
        if payloads: effects.insert(0, {"resolution": "auto", "result": payloads})
        if n == 75:
            effects.append({"kind": "choice", "id": "epic_boon_skill_expertise", "count": 1, "prompt": "Выберите экспертность в навыке", "options": {"source": "skill", "filter": "proficient_not_expert"}, "grant": {"kind": "grant_expertise", "prof": "skill"}})
        extra = {67: "Истинное зрение 60 фт.", 69: "Дробящий, колющий и рубящий урон игнорирует сопротивление.", 71: "Скорость увеличивается на 30 фт.", 72: "Выберите два сопротивления из девяти типов энергии.", 73: "Максимум хитов увеличивается на 40.", 75: "Владение всеми навыками и экспертность в одном выбранном навыке."}.get(n, "")
        description = "Одна выбранная характеристика увеличивается на 1, максимум до 30." + (" " + extra if extra else "")
        effect = dict(id=effect_id, card_number=f"EFF-audit-FEAT-{n:04d}", name=feat["name"], name_en=feat["name_en"], description=description, detailed_description="Этот эффект реализует перечисленные постоянные изменения. Остальные возможности дара описаны в черте и пока требуют ручного разрешения.", image_url="", rarity="common", effect_type="feat_ability", mechanics={"activation": {"mode": "passive"}, "effects": effects}, repeatable=False, author="System", source=feat.get("source") or "Player's Handbook")
        new.append((effect, n))
        mutate("feat", feat["card_number"], n)["related_effects"] = [effect_id]
    common = ["description", "detailed_description", "name", "name_en", "mechanics", "related_effects", "related_actions", "related_cards", "deleted_at"]
    fields = {"feat": common + ["category", "prerequisite", "ability_increase", "repeatable"], "effect": common + ["effect_type", "repeatable"], "action": common + ["action_type", "resource", "recharge", "recharge_custom"], "resource": common + ["category", "recharge", "sort_order"], "spell": common + ["level", "classes", "school", "ritual", "casting_time", "range", "duration", "component_verbal", "component_somatic", "component_material"], "card": common + ["type", "properties", "weight", "price"]}
    def entry(typ, row, changed=False, owner=None):
        out = dict(entity_type=typ, id=row["id"], card_number=row.get("card_number", row.get("resource_id")), name=row["name"], description_sha256=digest(row), preimage={k: copy.deepcopy(row[k]) for k in fields[typ] if k in row})
        if changed:
            after = patches.get((typ, row["id"]), row)
            out["patch"] = {k: v for k, v in after.items() if row.get(k) != v}
            out["review"] = review(owner)
        return out
    entities = [entry("feat", f, True, int(f["card_number"][-4:])) for f in feats]
    for (typ, rid), row in patches.items():
        if typ != "feat": entities.append(entry(typ, by_type[typ][rid], True, owners[(typ, rid)]))
    for row, n in new:
        entities.append(dict(entity_type="effect", id=row["id"], card_number=row["card_number"], name=row["name"], description_sha256=digest(row), preimage=None, patch=row, review=review(n)))
    # Only read-only dependencies here. Shared entities changed by another
    # manifest may have the same guard; preflight checks every original value.
    changed_keys = {(x["entity_type"], x["id"]) for x in entities}
    refs = {}
    for typ, rows in catalog.items():
        for row in rows:
            for key in [row["id"], row.get("card_number"), row.get("resource_id")]:
                if isinstance(key, str) and len(key) > 4: refs[key] = (typ, row)
    guards = {}
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key not in {"description", "detailed_description", "name", "name_en", "support", "source"}: visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
        elif isinstance(value, str) and value in refs:
            typ, row = refs[value]; key = (typ, row["id"])
            if key in changed_keys or key in guards: return
            if row.get("deleted_at"): raise ValueError(f"Deleted dependency: {row['id']}")
            guards[key] = entry(typ, row)
            visit(row.get("mechanics")); visit(row.get("related_effects")); visit(row.get("related_actions"))
    for feat in feats:
        visit(feat.get("related_effects")); visit(feat.get("related_actions"))
    for row in patches.values(): visit(row.get("mechanics"))
    result = dict(schema_version=1, audit_id="catalog-feats-20260929", source_snapshot_sha256=SNAPSHOT_SHA, entities=entities, guards=sorted(guards.values(), key=lambda x: (x["entity_type"], x["card_number"])))
    dest = Path(args.output); dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",newline="\n")
    print(f"Prepared {len(feats)} feats, {len(entities)-len(feats)} related changes, {len(guards)} dependency guards: {dest}")

if __name__ == "__main__": main()
