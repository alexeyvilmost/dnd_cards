# Mini-MVP through level 5: exact scope and test contract

Date: 2026-09-03
Rules baseline: [D&D SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) (2024 rules)
Executable denominator: `scripts/content/level5-mini-mvp-manifest.mjs`

## Decision

The level-5 expansion is a cumulative level 3-5 release. Its fixed denominator is **266 rows**:

| Collection | Count | Gate |
| --- | ---: | --- |
| Base classes | 12 | complete level-3, 4, and 5 progression |
| Base-class feature gates | 33 | named non-subclass features, including 12 Ability Score Improvement gates |
| PHB subclasses | 48 | selected at class level 3; all level-3 features and level-3/5 always-prepared spell grants |
| Species unlocks | 15 | 7 at character level 3 and 8 at character level 5 |
| General feats | 43 | every level-4 General feat, including prerequisites, ability increases and signature mechanics |
| Level-2 PHB spells | 63 | cumulative spell catalog |
| Level-3 PHB spells | 52 | newly castable by full casters and level-5 Warlocks |

`SPELL-0483` (homebrew Empowerment) and `SPELL-0485` (homebrew Area of Hope) are explicitly excluded. Pugilist and other custom classes/subclasses remain outside the mini-MVP. The 48-subclass denominator is inherited from the reviewed PHB manifest. SRD 5.2.1 validates the level gate and progression shape but publishes only one example subclass per class, so it is not evidence for the unpublished text of the other 36 PHB subclasses.

## Class gates through level 5

The subclass selection itself is counted in the 48 subclass rows, not duplicated among the 33 base-class feature gates.

| Class | Level 3 | Level 4 | Level 5 | Scaling that must also be checked |
| --- | --- | --- | --- | --- |
| Barbarian | Primal Knowledge | Ability Score Improvement | Extra Attack; Fast Movement | 3 Rages, 3 masteries at level 5, +3 proficiency |
| Bard | subclass | Ability Score Improvement | Font of Inspiration | Bardic die becomes d8; 9 prepared spells; slots 4/3/2 |
| Cleric | subclass | Ability Score Improvement | Sear Undead | 2 Channel Divinity; 4 cantrips; 9 prepared spells; slots 4/3/2 |
| Druid | subclass | Ability Score Improvement | Wild Resurgence | 2 Wild Shape; 3 cantrips; 9 prepared spells; slots 4/3/2 |
| Fighter | subclass | Ability Score Improvement | Extra Attack; Tactical Shift | 3 Second Wind; 4 masteries; +3 proficiency |
| Monk | Deflect Attacks; subclass | Ability Score Improvement; Slow Fall | Extra Attack; Stunning Strike | 5 Focus Points; Martial Arts die d8; +3 proficiency |
| Paladin | Channel Divinity; subclass | Ability Score Improvement | Extra Attack; Faithful Steed | 2 Channel Divinity; 6 prepared spells; slots 4/2 |
| Ranger | subclass | Ability Score Improvement | Extra Attack | 3 free Hunter's Mark casts; 6 prepared spells; slots 4/2 |
| Rogue | Steady Aim; subclass | Ability Score Improvement | Cunning Strike; Uncanny Dodge | Sneak Attack 3d6; +3 proficiency |
| Sorcerer | subclass | Ability Score Improvement | Sorcerous Restoration | 5 Sorcery Points; 5 cantrips; 9 prepared spells; slots 4/3/2 |
| Warlock | subclass | Ability Score Improvement | no named feature | 5 invocations; 3 cantrips; 6 prepared spells; two level-3 Pact slots |
| Wizard | subclass | Ability Score Improvement | Memorize Spell | 4 cantrips; 9 prepared spells; slots 4/3/2 |

There are **five**, not four, two-attack classes at level 5: Barbarian, Fighter, Monk, Paladin, and Ranger. Extra Attack must provide exactly two attacks per Attack action, not two complete actions. It must compose correctly with Action Surge, Nick/Light attacks, Flurry of Blows, Horde Breaker, reaction attacks, and multiclassing. Extra Attack from multiple classes must not stack.

Every class-level-4 Ability Score Improvement gate must support either the legal ability-score increase or selection of an eligible General feat. The gate is counted once per class (12 rows). The 43 individual General feats are a separate explicit denominator because their acquisition and signature mechanics must each be tested and certified.

## Level-4 General feats

The complete General-feat denominator is: Ambidextrous (`FEAT-0011`), Actor (`FEAT-0012`), Athlete (`FEAT-0013`), War Caster (`FEAT-0014`), Grappler (`FEAT-0015`), Speedy (`FEAT-0016`), Mounted Combatant (`FEAT-0017`), Observant (`FEAT-0018`), Martial Weapon Training (`FEAT-0019`), Inspiring Leader (`FEAT-0020`), Shadow Touched (`FEAT-0021`), Fey Touched (`FEAT-0022`), Lightly Armored (`FEAT-0023`), Moderately Armored (`FEAT-0024`), Heavily Armored (`FEAT-0025`), Crusher (`FEAT-0026`), Great Weapon Master (`FEAT-0027`), Polearm Master (`FEAT-0028`), Weapon Master (`FEAT-0029`), Medium Armor Master (`FEAT-0030`), Heavy Armor Master (`FEAT-0031`), Shield Master (`FEAT-0032`), Spell Sniper (`FEAT-0033`), Sharpshooter (`FEAT-0034`), Charger (`FEAT-0035`), Defensive Duelist (`FEAT-0036`), Keen Mind (`FEAT-0037`), Poisoner (`FEAT-0038`), Piercer (`FEAT-0039`), Skulker (`FEAT-0040`), Ritual Caster (`FEAT-0041`), Slasher (`FEAT-0042`), Elemental Adept (`FEAT-0043`), Durable (`FEAT-0044`), Sentinel (`FEAT-0045`), Telekinetic (`FEAT-0046`), Telepathic (`FEAT-0047`), Mage Slayer (`FEAT-0048`), Ability Score Improvement (`FEAT-0049`), Resilient (`FEAT-0050`), Chef (`FEAT-0051`), Crossbow Expert (`FEAT-0052`) and Skill Expert (`FEAT-0053`).

Storage/schema validation is not certification. Each feat stays `untested` until its prerequisite and ability cap are proven in Forge, its sheet presentation is clear, and every relevant action, reaction, roll modifier, movement rule, condition or consumable is executed in combat.

## Species gates

Level 3 (7): Aasimar Celestial Revelation; Drow Faerie Fire; High Elf Detect Magic; Wood Elf Longstrider; Abyssal Tiefling Ray of Sickness; Chthonic Tiefling False Life; Infernal Tiefling Hellish Rebuke.

Level 5 (8): Dragonborn Draconic Flight; Goliath Large Form; Drow Darkness; High Elf Misty Step; Wood Elf Pass without Trace; Abyssal Tiefling Hold Person; Chthonic Tiefling Ray of Enfeeblement; Infernal Tiefling Darkness.

Shared spell entities (notably Darkness) remain one spell implementation, but each species grant is a distinct unlock contract with its own level, free-cast recovery, spellcasting ability, and preparation visibility.

## Spell denominator

The cumulative PHB spell denominator is **115**: 63 level-2 spells and 52 level-3 spells. The complete card-number lists and Russian display labels are pinned in the executable manifest rather than repeated here. This reconciles with the in-progress level-five spell migration's `expectedLevelFivePHBSpells = 115` predicate.

Certification requires more than a valid activation and slot cost. Each spell must be checked for:

- exact target count, relation, range, line of sight, and area geometry;
- attack/save/automatic resolution, success behavior, damage/healing, and upcasting;
- data-driven conditions with visible icons and useful hover cards on full and mini sheets;
- concentration ownership and termination;
- event-driven areas (creation, entry, movement, start/end turn, exit) rather than fake actor effects;
- repeatable/reaction/choice timing, summon lifecycle, and ritual/out-of-combat clarity;
- availability and preparation for every eligible class/subclass/species source.

## Support and certification readiness

At scope-audit time, this release is **not ready for blanket certification**:

- the manifest and its focused structural tests are complete;
- the in-progress spell migration covers the intended 115 PHB level-2/3 rows and explicitly excludes both homebrew rows;
- level-3 base-class runtime work exists, but the level-4/5 feature gates and their event timing still require implementation evidence;
- the 48 subclasses require a catalog-to-manifest closure check, executable mechanics for active features, and browser evidence;
- no row should be promoted to `verified_mechanical` solely because it appears in this manifest or passes schema validation.

Certification is per entity after: focused automated contract test, Forge creation/level-up evidence, sheet evidence when relevant, combat evidence when relevant, and a clarity check from the acting character and affected ally/target perspectives.

## Tricky manual browser matrix

Retain every QA character and record its ID in the final report.

| Scenario | Builds | Expected failure modes to probe |
| --- | --- | --- |
| Extra Attack baseline | pure level-5 Barbarian/Fighter/Monk/Paladin/Ranger | second strike absent, extra action granted, action resource spent twice, mastery not offered on second strike |
| Non-stacking Extra Attack | Fighter 3 / Ranger 2 and Fighter 2 / Ranger 3, then legal level-5 split with an Extra Attack class at 5 only | multiclass aggregate incorrectly unlocks Extra Attack; two class sources incorrectly make three attacks |
| Action Surge composition | Fighter 5 | two attacks on normal Attack and two on surged Attack, never unlimited actions |
| Monk action economy | Monk 5 | Attack x2 plus Martial Arts/Flurry bonus strikes; Stunning Strike once per turn; Focus spent once; d8 damage |
| Nick/Light composition | Fighter 5 and Ranger 5 dual wielders | Nick attack neither consumes the second Extra Attack nor duplicates the bonus-action attack |
| Reactive defense | Monk 5 and Rogue 5 versus multiattack enemy | Deflect Attacks/Uncanny Dodge prompts only for eligible hits, once per reaction, with clear reduction in log and sheets |
| Level-up ASI/feat | each class 3→4→5, both ASI modes | illegal score above cap, lost prior choices, wrong recalculation, General feat unavailable or duplicated |
| Full-caster slot transition | Bard/Cleric/Druid/Sorcerer/Wizard 4→5 | two level-3 slots, correct preparation count, added spells always prepared where applicable |
| Pact Magic transition | Warlock 4→5 | exactly two level-3 Pact slots, all Pact casts upcast to 3, five invocations, long/short rest recovery |
| Half-caster transition | Paladin/Ranger 4→5 | level-2 slots appear but no level-3 slots; prepared-spell count correct |
| Subclass grants | one retained level-5 character for every one of 48 subclasses | level-3 abilities present once; level-5 grant spells appear without consuming normal prepared quota; wrong casting resource |
| Species scaling | Dragonborn/Goliath and every Elf/Tiefling lineage at level 4→5 | unlock too early, missing free cast, wrong spellcasting ability, wrong recovery, Darkness duplicate/conflict |
| Concentration collision | Haste/Fly/Spirit Guardians/area spells plus a second concentration cast | prior effect/area not removed, target icon stale, mini-sheet unclear |
| Counterspell and reactions | two opposing level-5 casters | missing pre-resolution choice, reaction not spent, spell slot wrong, log leaks hidden information |
| Areas and movement | Sleet Storm, Hunger of Hadar, Spirit Guardians, Stinking Cloud, Call Lightning | geometry mismatch, created/enter/move/start/end trigger wrong, save repeated or omitted, concentration orphan |
| Summons | Animate Dead, Conjure Animals, Summon Fey, Summon Undead, Faithful Steed | summon absent from board, initiative/ownership unclear, duplicate on recast, no cleanup |
| Condition lifecycle | Blindness/Deafness, Fear, Hypnotic Pattern, Slow, Bestow Curse, Hold Person | generic text effect, both mutually exclusive conditions applied, saves/timing wrong, icon/hover missing |
| Rest/resource conversion | Bard Font, Druid Wild Resurgence, Sorcerous Restoration | resource exceeds cap, consumes wrong slot/use, wrong Short/Long Rest reset, no user-visible explanation |

## Exit criteria

The level-5 mini-MVP is complete only when all 266 manifest rows resolve uniquely; every transitive feature/spell/feat reference resolves; level-up and multiclass calculations match level-by-level rules; automated focused tests pass; every relevant row has retained browser evidence in sheet/combat/clarity dimensions; discovered regressions are fixed and retested; and only then are individually evidenced entities marked certified and made freely selectable in Forge.
