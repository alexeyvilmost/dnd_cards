# Mini-MVP through level 5 — testing report

Date: 2026-09-03. Status: release checkpoint prepared; the full level-5 denominator remains incomplete. This report separates executable evidence from content that remains unverified.

## Scope denominator

The fixed cumulative denominator is 266 rows:

- 12 base classes;
- 33 non-subclass class-feature gates, including 12 level-4 Ability Score Improvement gates;
- 48 level-3 subclasses;
- 15 species unlocks (7 at level 3 and 8 at level 5);
- 43 General feats unlocked by a class-level-4 feat gate;
- 63 PHB level-2 spells;
- 52 PHB level-3 spells.

Custom `SPELL-0483` and `SPELL-0485` are explicitly outside the PHB scope. No new cantrips, equipment, or unrelated species features are included.

## Automated evidence so far

- Level-3 and level-5 manifest tests pass; the level-5 manifest now pins all 266 rows, including the exact contiguous `FEAT-0011`–`FEAT-0053` General-feat denominator.
- Persistent combat-area and canonical hazard tests: 25/25 passed after fixes.
- Multiclass, Attack-ledger core, sheet projection, Forge support filtering, half-caster and class-scope regressions pass in focused suites. The solo-combat adapter now preserves the open Attack-action ledger after Action is spent; focused integration is 37/37.
- Full TypeScript typecheck passed after the area changes.
- A fresh clone restored from the production migration-164 snapshot replayed the final registry order 165→186 exactly once. All 22 migrations applied successfully in about 3 seconds after the 14.8-second restore, closing the release-order gap created by earlier out-of-order development replays.
- Release identity is internally consistent at overlay 1.14. Conditions remain pinned to their independently certified 1.13 authority instead of receiving fabricated evidence from unrelated overlay changes. The regenerated sheet-combat certificate has 450 roots and 18 actions; its drift check passes.
- Migrations 166 and 169–186 were applied to the isolated production clone. Migration 166 normalizes all 115 in-scope level-2/3 PHB spells; 170–172 materialize all 43 General feats, their mandatory ability choices, linked effects and signature spell-feat/action data. Migrations 173–184 repair lineage spell access, feat-card clarity/action payloads, Wizard growth, strict conditions, feat-choice integrity, base progression, Warlock invocations, subclass action costs/uses, additional General-feat mechanics, species transformations and persisted d20 interrupts. Migration 185 repairs representative level-5 class/subclass runtime contracts; migration 186 repairs strict targeting for all 115 level-2/3 PHB rows and adds bounded semantic effects to a smaller supported subset. Every new entity remains `untested`; schema/application success is not treated as browser certification.
- The post-integration frontend batch passed 88/88 focused tests across granted actions, resource initialization, rest recovery, sheet-world projection, areas, saved-world upgrades and solo combat. A clean full TypeScript typecheck followed.

The retired long `microMvpScenarioCorpus` pipeline was not run. Focused tests with explicit assertions are used instead.

## Fixed runtime findings

### Persistent areas

- Automatic hazards no longer invent a saving throw. Cloud of Daggers-style damage is applied immediately through the canonical event log.
- Spike Growth-style hazards can trigger once per traversed 5-foot cell.
- Areas can trigger on creation, entry, exit, movement, start of turn and end of turn.
- One area can now own different hazards for different events. Hunger of Hadar can deal automatic cold damage at start of turn and request a distinct Dexterity save against acid at end of turn.
- Silence can block verbal spell components and grant thunder-damage immunity only while the actor remains inside its area.
- Area-linked conditions and defenses are removed on exit or area/concentration expiry.
- Line areas use an actual directional length/width footprint.
- Area hover text exposes duration, terrain/obscurement, verbal blocking, in-area immunities, save/no-save resolution and trigger timing.

### Canonical hazard bug

A saved hazard could emit a damage event while leaving HP unchanged because its payload was routed as `self` rather than through the target state. The focused Hunger of Hadar test reproduced this and the handler now uses the canonical target route. Existing condition and automatic-hazard tests remain green.

### Extra Attack and Action Surge

The sheet-to-world projection reads the data-owned integer variable `attacks_per_attack_action`, and the solo-combat adapter now reuses an open Attack-action ledger after the Action resource reaches zero. Browser execution proved two attacks in the normal Attack action, then two more in the fresh Action Surge Attack action; the fifth attempt was disabled. This verifies the shared Fighter 5 path, not every class/subclass combination that can obtain Extra Attack.

Persisted attack profiles are now rebuilt after level-up rather than retained blindly, closing the level-4→5 stale one-attack profile. Class and subclass level gates use the owning class level, not total character level; a Druid 3/Fighter 2 can no longer receive Druid-5 Circle features. Warlock invocation minimum class levels are preserved through collection, Forge filtering/validation and fail-closed rule resolution. Direct character create/update also rejects a class that has crossed its subclass threshold without a subclass selection.

### Actor-bound Unarmed Strike and Monk 5

- Triggered Monk attacks are no longer admitted into the pinned level-1 certificate merely because they contain an unarmed attack roll; only the exact basic Unarmed Strike receives the legacy system primitive.
- Persisted combat revalidates contextual actions against each owning actor, so a legal Monk DEX/d8 binding survives scene creation and reload instead of being compared with STR/flat base damage.
- The ruleset-owned `PerformUnarmedStrike` path now receives the actor's data-owned variables, ability modifiers and armor state. Browser proof showed DEX attack rolls and d8 + DEX damage.
- The retained Monk completed two attacks from one Attack action, spent Focus on Stunning Strike, forced and logged the Constitution save, applied exact library `COND-stunned`, and exposed the condition's source, duration and concrete restrictions in the Goblin mini-sheet. Flurry spent one Bonus Action and one Focus and resolved its first d8/Dex strike; the defeated only target prevented a two-target/two-strike proof.

### Protection continuation and post-hit feats

- Equipped weapon attacks now forward one current Protection observation for every source-owned protector through the strict sheet-combat bridge. Before the fix, the browser rejected the attack with `InvalidFacts`.
- Post-hit feat offers are now resumed after a Protection pre-roll decision. Previously the pending Protection window caused Shield Master and similar hit-triggered actions to be discarded even when the eventual attack hit.
- Focused regression coverage passes 45/45 across the weapon bridge and solo-combat continuation. Browser QA confirmed that the attack reaches the Protection dialog without the former rejection. The final on-hit Shield Master browser branch is still not certified because both post-fix manual rolls missed; the deterministic integration test proves the prompt is retained after a hit.

### Persisted d20 interrupts

The shared solo-combat continuation now supports data-driven pre-roll Disadvantage and post-success die subtraction across actors, including exact range/line-of-sight/resource checks, persisted RNG and monster-turn pause/resume. Migration 184 materializes Warding Flare and Cutting Words on that contract. Their focused automated gates pass, but neither row is certified until browser reaction dialogs, owner/observer clarity and reload behavior are exercised.

## Major open findings

1. All 43 level-4 General feats are in the required denominator. After the deep migration-182/runtime pass, the exact code-level audit classifies 24 as executable in their primary mechanics, 17 as partial and 2 as unsupported. The unsupported rows are Mounted Combatant and Polearm Master. None of the 43 will be certified solely from catalog presence or unit tests; each still needs the relevant sheet/combat/clarity browser proof.
2. The earlier Durable, Telekinetic, Resilient and Elemental Adept structural defects are repaired. Defensive Duelist, Grappler, Shield Master, Charger and Sentinel now have bounded executable primary paths. Important secondary clauses remain: Actor has no impersonation declaration UI; Grappler lacks damage-plus-grapple and reduced drag; Shield Master lacks its successful-DEX-save zero-damage reaction; Charger is weapon-only and uses a fixed 10-foot push; Sentinel lacks the adjacent-enemy-attacks-another-target trigger.
3. Most subclass active/triggered effects are still narrative-only or lack a runnable action. Limited-use granted actions can also disappear when projection is called without a uses context, and result-level resource `spend` operations are not currently executed. These paths cannot honestly be certified until materialized and exercised.
4. Web now creates a visible, persistent, concentration-owned area with clear geometry/event labels and applies exact library `COND-restrained`. Browser inspection showed speed 0, attack/save disadvantages, attacks-against advantage, source and duration; a full reload preserved a valid scene. Escape-action and flammability rules remain open, so Web is not yet certified.
5. Draconic Flight and Goliath Large Form have catalog entries but no completed browser proof at level 5.
6. Movable Moonbeam/Flaming Sphere and mobile emanations still need explicit board movement/anchoring actions; a stationary approximation must not be certified as full support.
7. The 33 non-subclass class gates audit as 22 supported, 10 partial and 1 unsupported; the unsupported gate is Wizard Memorize Spell. Across 99 subclass feature/effect instances, 20 are supported, 53 partial and 26 unsupported. Rolled up by subclass, only 3/48 are fully supported, 35 are partial and 10 unsupported, so broad subclass certification would be false.
8. The 115 PHB level-2/3 spells audit as 16 supported, 41 partial and 58 unsupported at code level. Migration 186 guarantees strict targeting contracts for all 115, but summons, counter/dispel interactions, repeated saves, movable effects and mobile emanations are the dominant runtime gaps. No level-2/3 spell is browser-certified by this pass.
9. Thirsting Blade's `pact_weapon` filter is still ignored by the global attack-profile model, invocation effect prerequisites such as Pact of the Blade/Chain are not enforced, and these invocation paths must remain uncertified.

The exact class/species/subclass audit (10:26–10:57 MSK) additionally found:

- the shared limited-use `grant_action` resource path is now implemented and covered through sheet/combat initialization, reconciliation, rest and turn recovery; representative browser proof is still required;
- migration 181 moved nine subclass action spends to activation costs, normalized Monk `focus_points` to `focus`, and bounded Healing Light, Warrior of the Gods, Steps of the Fey, Tides of Chaos and Stunning Strike uses;
- Cutting Words and Warding Flare reference event kinds that the encounter dispatcher does not yet emit, while Cunning Strike references a nonexistent `sneak_attack_hit` event;
- the current Aasimar revelation action is incorrectly certified despite narrative-only branches and must be revoked until executable variants pass browser proof;
- all 48 subclasses and 42/43 General feats are still `untested` in the local catalog, and Ability Score Improvement has no support status; the verified-only Forge can therefore dead-end at required level-3/4 choices. Certification will not be fabricated to hide this defect.

Migrations 178–181 are registered and applied in the running local backend. Migration 180 contains all 22 invocations available through Warlock 5; Gaze of Two Minds, Investment of the Chain Master, One with Shadows and Misty Visions remain explicitly marked as needing board/companion consumers rather than being certified prematurely.

## Manual browser matrix

Manual execution is in progress against the isolated local production clone. No result below changes catalog certification by itself.

- `2f8cc05b-e9b0-4cde-8629-41ee99b5cb3d` — retained Human Fighter 5 (Champion). Forge and sheet show the subclass, level-4 feat gate and Extra Attack. Browser combat passed exactly two normal Attack-action strikes plus two fresh Action Surge strikes; a fifth strike was blocked.
- `ded98719-b42d-489f-9917-7516c1c425df` — retained Drow Wizard 5 (Evoker). Forge exposes level-2/3 choices and the sheet has exact 4/3/2 slots plus Drow spell grants. The repeated mechanics-source, lineage access and later-level prepared-choice defects are fixed. Fireball browser execution consumed one level-3 slot, rolled one 8d6 instance, applied friendly fire inside its displayed sphere and killed the Goblin. Web created a visible concentration area, consumed its level-2 slot and applied the exact library restrained condition on a failed save; its hover card made the resulting speed and roll modifiers clear. The fight also reloaded cleanly after the War Caster derived-spell access fix.
- `14d2104c-f907-4c6e-adb7-0cd8e07a886e` — retained Orc Fighter 1 / Rogue 4 (Thief), now character level 5. Browser level-up advanced Rogue independently, kept Thief, required one General feat and one additional weapon mastery, required Athlete's STR/DEX increase, persisted DEX 14→15, and shows the feat/effect on the sheet.
- `8ccd5364-0ded-4fc9-b2d5-79d53f63be34` — retained Human Fighter 4 (Champion), restored to Shield Master with Strength 18 after exercising both Ability Score Improvement layouts and the General-feat ability selector. During the same Forge pass, a temporary Resilient (Dexterity) state proved prerequisite filtering, DEX 14→15 and a +4 Dexterity save. Current combat browser QA proves the strict Protection reaction dialog no longer rejects equipped weapon attacks; the deterministic post-hit continuation test proves Shield Master choices survive that dialog. A successful post-fix browser hit/choice/save remains required before certification.
- `7ca8a067-3fb5-47c0-a8bd-d070199f447f` — retained Dwarf Monk 5 (Open Hand) with Telekinetic (Wisdom). Forge persisted levels 2→3→4→5, subclass and feat ability choice; the sheet shows Focus 5/5, d8 Martial Arts, Extra Attack and Stunning Strike. Combat proved DEX/d8 Unarmed Strike, two attacks after one Action spend, Focus 5→4 on Stunning Strike, a visible failed CON save, exact `COND-stunned` details, and Flurry's Bonus Action/Focus spend. A fresh two-surviving-target scene is still needed to prove both Flurry strikes and Open Hand rider choice.
- `17af8579-f2cf-4802-8e57-2b0755e1fd59` — retained Dwarf Bard 2 used for the canonical 2→3 Lore test. With the QA catalog enabled, all four subclasses and level-2 spells appear. Selecting College of Lore now renders its description plus an explicit 3-of-18 skill selector, disables already-owned proficiencies and keeps confirmation blocked until all choices are complete. A separate transient state glitch remains: toggling the full-catalog checkbox can clear the active class and briefly show a stale class preview until Bard is reselected.
- Fighter/Bard combat clarity check — Bardic Inspiration applied a real library-backed effect to the Fighter mini-sheet. The target sees source, duration and use explanation; the dialog correctly separates before-roll and failure-only uses and enables the boon on the target's turn.
- `2f8cc05b-e9b0-4cde-8629-41ee99b5cb3d` — the retained Fighter 5 also passed the correct Light/Nick sequence after swapping to Shortsword main hand and Scimitar off hand. Two Shortsword attacks completed the Attack action; the Nick Scimitar attack then used neither Action nor Bonus Action, consumed Vex advantage correctly, and became disabled after its once-per-turn use. This also exposed and fixed an actor-bound certification bug that compared the 5-foot equipped attack against the unbound 600-foot template.

Priority order after local migration succeeds:

1. Complete remaining Extra Attack combinations: the Light/Nick sequence and the core two-attacks-plus-Action-Surge scenario now pass. Duplicate Extra Attack from multiclassing still needs browser proof that it does not stack.
2. Monk 4→5: Focus 4→5, Martial Arts die d6→d8, two attacks plus Martial Arts/Flurry, Stunning Strike once per turn, save and condition clarity.
3. Bard 4→5: Inspiration becomes d8, short-rest recovery works, spell-slot conversion works, ally dialog/icon/hover make the boon usable.
4. Sorcerer 2→3→4→5: point maxima scale 2/3/4/5 and Sorcerous Restoration does not overfill.
5. Primary and secondary subclass selection: Fighter 2/Wizard 3 and Wizard 3/Fighter 2; no early subclass level-5 grants from total level.
6. Every subclass: sheet availability, combat cost/target/timing, and clarity of target/ally effects. Active and triggered features are prioritized before passives.
7. Dragonborn/Goliath and every Elf/Tiefling level-5 lineage spell: unlock timing, chosen casting ability, free cast, slot cast and long-rest reset.
8. ASI/feat gates: all classes at 3→4; +2, +1/+1, General feat prerequisites/caps/persistence; independent choices for two class-level-4 gates; then all 43 General feats through sheet/combat/clarity scenarios appropriate to their rules.
9. Areas and concentration: voluntary/forced entry, exit, repeated movement, start/end turn, save success/failure, concentration replacement/loss, visibility and hover clarity.
10. Upcasting and slot systems: full casters, half casters, Pact Magic, multiclass slot table, exact level-2/3 cost, short/long rest recovery.

All QA characters created by the browser pass must be retained with their IDs recorded here.

## Certification policy

Only entities that pass all relevant dimensions—character sheet, combat, and user-visible clarity—will be marked certified/free to choose in Forge. Untested, partially supported, stationary-only, or narrative-only entities remain `untested`; the report will list them rather than changing their certification optimistically.
