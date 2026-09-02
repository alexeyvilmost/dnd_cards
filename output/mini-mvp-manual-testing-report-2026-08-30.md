# Mini-MVP manual testing report — 2026-08-30

## Status

- Testing status: in progress
- Environment: production, `https://bagofholding.ru/`
- Tested releases: baseline `a8f1bf7dce078ab19f338515818a80e8ddf73ef1`; mechanics/error repair `8d49f90351e0a948118212f23bff3103a367a401`; recipient-clarity repair `f601e00530c788ef3f7fe3076be9bf66d100208b`; combat-certificate repair `3ee5028ded9c34327b606a8d5d30a9ec939e586c`; combat-persistence repair `f7d5fb86778fa3d4b3edcd1a0a25be22215554f2`; dynamic-movement repair `a52c96d54cc641b5fcd594aad2a44f2c5e0629e2`; level-gating repair `e7366bae834490394034e3276460df7b02cc9e93`; Unarmed Fighting mechanics repair `abc6ee741368041b118cf3228d0cee49a71d34aa`; action-card projection repair `726c7b7aac5f78659c689f58a78986ae219cb2f7`; active-effect/action-clarity repair `4ec631ed60c7926e8ec62d41a7006425da20fd7c`; bound-resource/size-label repair `49884ed4867cd5ca2f1d00a0b5ad649482cbce58`; bound-action-token repair `06f9d4f5edc44d3ecaf5c8c12db1b8c6f20d1e2b`; live combat-drawer clarity repair `ce3e43e5bd0c7669e6a7d39d390add2c7d46e080`; canonical unarmed-combat repair `34f784d7984513a4c555025e5dfeaf024b37fbb1`; Stonecunning scenario/clarity repair `330416f6dd3920a84c654bea304d775ebc0019fd`
- Browser method: authenticated production UI only
- Character retention: every character created for this run is retained for reproduction
- Evidence workbook: `mini-mvp-manual-testing-checklist-2026-08-30.xlsx`

## Scope and evidence model

The accepted checklist contains 772 rows. The level-1 mini-MVP manual denominator is 491 rows: 112 class rows, 189 species/lineage rows, 98 cantrip and first-level spell rows, 48 feat rows, and 44 base-mechanics rows. The other 281 class/species progression rows remain inventory and are marked out of level-1 scope.

Each applicable row is checked in three dimensions:

1. Character-sheet usage.
2. Combat usage.
3. Result clarity for the acting player, target, and affected ally where relevant.

Entity-specific evidence and character IDs are recorded in the workbook. This report summarizes coverage, major findings, fixed defects, remaining bugs, and errors that affect multiple entities or the product as a whole.

## Test characters and scenes

- `100eb271-ad36-4045-9aea-ef0d01a9e395` — `A.Бард`, Aasimar Bard 1, the user-reported reproduction character.
- `84e8c110-bbba-41be-85ef-9165c376d746` — `QA-MMVP-Goliath-Fighter-20260830-FRESH`, Goliath (Stone Giant ancestry) Fighter 1 created through Forge during this run. The character is compatible with the current ruleset and is retained.
- `905caad6-905a-4124-ac0d-61329377e37b` — older `QA-MMVP-Goliath-Fighter-20260827`, retained and used to reproduce cross-ruleset behavior.
- `de2a435e-67e8-40f6-9aad-4e900f1e9e21` — older `Джафар`, retained and used to reproduce cross-ruleset behavior.
- `467b52d2-3982-4c32-bbfa-f39cce69bcf0` — `QA-MMVP-Dwarf-Fighter-Unarmed-Armed-20260830`, Dwarf Fighter 1 retained with its completed armed/unarmed/Grapple production scene.
- `ae8f3549-97a5-4c9d-b1e6-0b169d06d310` — `Новый маг`, Orc Wizard 1 retained as the owner of the separate Dwarf + Goblin Stonecunning production scene. The scene remains saved at the Dwarf's first turn with the full pre-fix failure, repaired execution, resource-refresh, and reload history.
- `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` — `QA-MMVP-Elf-Wizard-Poison-20260831`, Drow Wizard 1 retained with the active Drow + Goblin scene. The scene remains at round 1 on the Drow turn with Drow 4/9 HP and Goblin 2/10 HP; it contains the Ray of Sickness evidence, the atomic Dancing Lights placement failure, and a successful combat Sleep application with the Goblin still Unconscious.
- `8c450667-7ce4-4c81-a982-f7356cb8f7ab` — `QA-MMVP-Dwarf-Fighter-Poison-20260831`, compatible Dwarf Fighter 1 retained at 0/15 HP with the test Poisoned condition still applied for reproduction.

The fresh Goliath was created with Stone ancestry, Fighter, Soldier, Unarmed Fighting, and Dagger/Shortbow/Longsword masteries. Forge correctly blocked the initial duplicate Athletics grant and explained the conflict; replacing the class Athletics choice with Insight enabled creation.

## Coverage summary

Current workbook evidence covers 49 of 772 inventory rows: 31 Passed, 17 Needs retest, 1 Failed, and 723 Not tested. `Needs retest` is retained whenever one of the three requested dimensions is still pending or only partially clear. The latest Sleep checkpoint was freshly re-imported after export: `Spells!100` contains the retained Drow ID and threaded production/fix evidence, all five tabs rendered, the changed Spells tab was visually inspected, and the formula-error scan returned zero matches.

## Major findings

1. `A.Бард` can cast spells after the deployed Charisma repair. Mage Hand, Light, Minor Illusion, and self-targeted Cure Wounds all executed and consumed the expected action/slot resources. The original blanket symptom “none of the Bard's spells work” is no longer reproducible against a compatible target.
2. Bardic Inspiration was a real entity defect. On the baseline it consumed resources without changing the target. Release `8d49f90` made the newly forged compatible Goliath receive a persistent `Талон 1к6`; release `f601e00` added the recipient-facing explanation. Release `ce3e43e` now exposes that same explanation in the actual live combat character drawer. Sheet/combat mechanics and all requested clarity dimensions pass and survive reload: one grouped row tells the ally to add `1к6` to an ability check, attack roll, or saving throw and then remove the effect.
3. Cross-character spells against older characters fail atomically because their stored ruleset is incompatible with the current sheet. The safety rejection is correct, but production exposes the technical English message `Atomic participants use incompatible rulesets`, which does not tell a player what to do.
4. Minor Illusion collects meaningful scenario facts (form, description, distance), but the accepted result collapses them to generic journal lines. The entered description `QA: звук далёкого колокола` was not visible afterward, so another participant cannot understand what illusion was created.
5. Long rest correctly restored actions, both first-level slots, and Bardic Inspiration, and removed the temporary Mage Hand effect.
6. The combat scene constructor and persistence pass after release `f7d5fb8`. The retained Bard + fresh Goliath + Goblin scene saved, advanced through the Goblin AI and Goliath end turn, and restored Bard as active after reload. Thunderwave then spent one action and level-1 slot, recorded a failed CON save (9 vs DC 12), dealt 6 thunder damage, pushed the Goblin 10 ft, and preserved the Goblin at 4/10 HP plus Bard at one remaining slot after another reload. The constructor then restored only the Bard's resources from 4/7 to 7/7 while preserving 8/9 HP, the active turn, positions, journal, and the ally's inspiration effect. Changing Bard initiative from 7 to 20 reordered the list without changing the active actor and persisted through reload.
7. The resource buttons above the hotbar behave as requested. Selecting the level-1-slot resource reduced the hotbar to Sleep, Thunderwave, Cure Wounds, and Command; clicking the same selected resource again restored the default action list. The button also exposes the resource's full hover description.
8. Cure Wounds now passes all three requested dimensions for the retained Bard. It activates on the full sheet and in combat, spends exactly one action and one level-1 slot, rolled `2d8 (3+5) + 2 = 10`, restored missing HP up to the maximum, and left a clear source/target/dice/resource journal that survived reload.
9. Stone Endurance passes end to end on the retained Stone Goliath. A 6-point slashing hit opened the reaction window; `1d12 (1) + CON 2 = 3` reduced damage from 6 to 3 and HP from 12/12 to 9/12. The reaction and one Giant Legacy charge were spent, the reaction refreshed at the next turn, and reload retained the state and explanation.
10. Large Form exposed three defects. First, changing effective speed from 35 to 45 did not increase the already-created movement ledger; release `a52c96d` now preserves movement already used and adds the exact speed delta. A 40-ft move then left 5 ft and survived reload. Second, the level-5 feature was incorrectly assembled and executable for a level-1 Goliath. Release `e7366ba` applies one shared level requirement at character assembly, hotbar/reaction availability, and authoritative command execution. Third, its size/speed payloads rendered as indistinguishable duplicate rows. Releases through `ce3e43e` group the rows and explain `Размер: на одну категорию больше.` and `Скорость: +10 фт.` in both sheet and combat inspection. The row remains `Needs retest` solely until legitimate level-5 Forge acquisition/activation is exercised.
11. Old scenes remain reproducible after the fixes. The Goliath-owned scene still has 9/12 HP, the 40-ft movement journal, 5 ft remaining, and its pre-fix active effects; the Bard-owned scene still has the full Cure Wounds, Bardic Inspiration, Thunderwave, constructor, and initiative history. No test character or scene was deleted.
12. Second Wind passes character-sheet, combat, and result clarity on the retained level-1 Fighter. In combat it rolled `d10 2 + level 1 = 3`, healed 6/12→9/12, consumed one bonus action and one use, and persisted through reload. On the sheet it rolled `d10 10 + level 1 = 11`, capped at 12/12, and persisted HP/resource availability after reload. The final `ce3e43e` client shows `Лечение: 1к10 + 1 лечение` and `Стоит: Заряд способности`; raw `uses_ACT`, `self_uses`, and `self_level` tokens are absent.
13. Unarmed Fighting's empty-hands branch was broken at the runtime/projection boundary: the selected style existed, but the real attack still used fixed `1 + STR`. Release `abc6ee7` applies the profile to authoritative damage, character-sheet projection, and combat hotbar data. The production retest rolled a natural 20 and dealt `d8 7 + d8 5 + STR 3 = 15` bludgeoning, reducing the Goblin 6→0; reload preserved the journal and victory. Release `726c7b7` also makes the full sheet preview agree: `1к8 + 3 [СИЛ]` and `Урон: 1d8 + модификатор Силы`.
14. Unarmed Fighting now passes all three dimensions and every rules branch represented by the entity. The retained Dwarf verified the armed d6 formula in both sheet and combat. The exact basic unarmed action now presents Damage, Grapple, and Shove choices; its Grapple used the Goblin's stronger DEX save, applied after `5 + 2 = 7` versus DC 13, and persisted across reload. Target inspection explains who is grappling it, speed 0, and escape DC 13; grappler inspection identifies the target and occupied free hand. At the next Fighter turn, the optional `1d4` prompt survived a second reload; selecting it rolled 4 bludgeoning damage, cleared the pending choice, and produced a retained victory.
15. The Dwarf batch closes seven of nine chassis/trait/effect rows. Chassis values, Darkvision 120 ft, and Dwarven Toughness's maximum-HP contribution are consistent in Forge output, the full sheet, combat inspection, and reload. Stonecunning initially failed atomically in combat because the UI supplied no required stone-surface facts; the failure correctly spent nothing. Release `330416f` adds four explicit natural/worked and standing/touching choices on both sheet and combat. Both live flows now spend only after selection/confirmation, grant a durable 60-ft/100-round tremorsense effect, and explain that it works only on the same stone surface, does not detect airborne creatures, and does not grant sight. Dwarven Resilience damage resistance, advantage detection, journal outcome, and result clarity are now exercised; it remains `Needs retest` only because the deployed physical-dice dialog requested one visible d20 and supplied the second advantage die through hidden RNG. Commit `2cc627e` fixes the two-d20 plan and awaits deployment.
16. Sleep's combat mechanics pass on the retained Drow scene: the Goblin rolled 12 - 1 Wisdom = 11 against DC 12, became Unconscious, and the caster spent exactly one action plus one level-1 slot. The shared hover card explains the area, range, repeat save, damage/shake wake-up, immunities, duration, components, and costs. Production target inspection is not yet clear: it exposes raw `unconscious` rather than localized source/duration/rules; pushed commit `38c2825` covers the shared condition card. The character-sheet flow exposed a wider adapter defect: after the target/facts and dice dialogs accepted a manual d20 of 1, the sheet rejected the canonical `target_save` continuation and spent nothing. Pushed commit `df0a5cc` resumes only target-save decisions with the already collected dice and preserves fail-closed behavior for every other unsupported continuation.

## Cross-cutting errors not tied to an individual entity

- **Ruleset compatibility is invisible until commit.** Older and current characters remain selectable together; the incompatibility is discovered only after dice/confirmation work. This wastes a test attempt and can look like a broken spell.
- **Technical error leakage (fixed in `8d49f90`).** The atomic incompatibility error was displayed in internal English. The deployed UI now explains the incompatible rules versions in Russian and directs the player to a compatible character or an updated Forge copy.
- **Opaque persistence wait.** A successful self Cure Wounds commit took about 4.6 seconds after the dice dialog. During the wait action buttons were disabled and values initially appeared unchanged, with no visible “saving” state.
- **Transient action availability.** On initial Bard-sheet load, most spells were briefly disabled while target/canonical data loaded, without a loading explanation. They enabled after the data arrived; Thunderwave remained disabled and requires separate diagnosis.
- **World-interaction evidence loses submitted facts.** Minor Illusion retains only a generic completion message, making manual scene adjudication and ally/target clarity worse than the input form.
- **One omitted action poisoned the entire encounter.** Combat session creation validates every participant action up front. A valid but uncertified Bard Thunderwave grant prevented initiative from opening even though the player had not attempted to cast it.
- **Dedicated combat duplicated large entity images in every save (fixed in `f7d5fb8`).** The exact retained Bard + Goliath + Goblin state serialized to 790,755 bytes against a 786,432-byte limit. `actionPresentation` accounted for 537,305 bytes; Healing Hands alone occupied 482,512 bytes because its base64 image appeared both as the hotbar icon and inside the same hover-card entity. Production now keeps one copy and reconstructs the icon projection on reload. The live stored turn state is 557,941 bytes (492,961-byte combat snapshot), 228,491 bytes below the guard.
- **Combat actor inspection hid effect mechanics (fixed in `ce3e43e`).** The mounted combat character drawer previously showed only effect names. It now uses the shared human-readable effect guidance: Bardic Inspiration explains its `1к6`, eligible rolls, and removal; Large Form explains its size category and +10-ft speed.
- **Level requirements were data-only (fixed in `e7366ba`).** `activation.requirements` existed in content but was not enforced by character assembly or runtime. Any higher-level effect attached through a species/class `related_effects` list could therefore leak into a lower-level sheet and execute. The shared level policy now filters assembly, disables old persisted capabilities, removes ineligible reactions, and rejects direct commands authoritatively.
- **Effective-speed changes did not reconcile the turn movement ledger (fixed in `a52c96d`).** The runtime calculated 45-ft effective speed while the board kept the original 35-ft remaining budget. The transition now adjusts remaining movement by the exact speed delta without erasing already-used movement or Dash allotments.
- **Multi-payload/duplicated active effects were visually duplicated (fixed through `ce3e43e`).** Stable-id payload rows are grouped into one visible effect in the full sheet and combat drawer; human instructions summarize all relevant mechanics. Persisted payloads were preserved rather than deleted.
- **Shared action cards leaked internal formula variables (fixed through `06f9d4f`).** Resource-bound cards now use human labels and resolved character context. The final Second Wind card exposes neither bound `uses_ACT-*` identifiers nor `self_uses`/`self_level` placeholders.
- **A cached PWA can display the previous release after a successful deployment.** Multiple open production tabs kept the previous service worker in waiting state, so even a newly opened tab loaded the old bundle while backend, frontend identity, and the Timecloud release symlink already matched the new commit. Closing all same-origin tabs allowed activation; the exact final script was `index-4_NskXue.js`. The UI needs visible client/release identity plus a one-click refresh/update path, and the browser gate must assert client-bundle identity before functional clicks.
- **The first combat-clarity fix targeted an unused inspector.** Component tests passed for `CombatActorInspector`, but the live route mounts `CombatCharacterSidebar`; production therefore still showed names only. Release `ce3e43e` changes and directly renders the mounted component. This is primarily a route/component-boundary test gap, not an entity defect.
- **Canonical rules existed but the combat adapter bypassed them (fixed in `34f784d`).** Rules-core already supported unarmed Damage/Grapple/Shove and grapple-start damage, while the live solo-combat adapter treated the basic unarmed card as an ordinary fixed-damage attack. Release `34f784d` routes the exact card identity through the canonical commands, persists the optional start-turn decision, applies effective grapple speed/range rules, and exposes both sides of the relation in the mounted inspection surfaces.
- **Scenario facts were mandatory in rules-core but absent from both user flows (fixed in `330416f`).** Stonecunning correctly required explicit contact with natural/worked stone, but combat supplied no stonework facts and the sheet bypassed that choice entirely. The shared in-play choice collector now asks the same four canonical questions on both surfaces; combat converts the answer into target facts before authoritative execution. Missing choices fail before resource spending, and the granted-sense renderer exposes all scope limitations to owners and observers.
- **Ordinary sheet save spells stopped at a supported engine continuation (fixed in pushed `df0a5cc`, awaiting deployment).** The sheet already collected target facts and a visible d20, but then treated the canonical `target_save` state as unsupported instead of dispatching that decision. The shared adapter now resumes every consecutive target-save continuation with the injected/manual dice and returns one completed world for atomic persistence. Reactions and all unrelated continuation types still fail closed.

## Entity-specific failures

- **Bardic Inspiration — passed:** compatible character `84e8c110-bbba-41be-85ef-9165c376d746` receives and retains the boon after combat reload/resource refresh. The journal, full sheet, and live combat drawer all explain the `1к6`, eligible rolls, and manual consumption in one grouped row.
- **Minor Illusion — result clarity failed:** activation succeeds, but chosen form/description are absent from the resulting journal/effect evidence.
- **Thunderwave — combat mechanics and result clarity passed on `f7d5fb8`:** its sheet-equivalent hover shows DC 12, 2d8 thunder damage, push, and class access. Combat clearly records resource spend, save roll/modifier/DC, damage dice/total/type, target HP change, and 10 ft push; all persist across reload. Character-sheet activation remains a separate dimension.
- **Combat scene persistence and test controls — passed on deployed `f7d5fb8`:** retained Bard + fresh Goliath + Goblin Warrior persists creation, automated monster action, controlled end turn, Bard spell resolution, actor positions/HP/resources, journal details, reload continuation, selective resource refresh, and initiative reordering while preserving the active actor.
- **Cure Wounds to legacy targets — blocked by compatibility:** the spell succeeds on self, but older target sheets are rejected by the atomic ruleset check.
- **Cure Wounds — passed on sheet and in combat:** the compatible self-target path spends action + one slot, rolls and applies healing, respects maximum HP, and persists with clear evidence. The legacy-target limitation above is cross-ruleset compatibility, not a Cure Wounds mechanics failure.
- **Stone Endurance — passed:** trigger timing, reaction/charge payment, reduction formula, HP result, next-turn reaction refresh, journal clarity, and reload persistence all passed on `84e8c110-bbba-41be-85ef-9165c376d746`.
- **Large Form — mechanics/clarity partial pass; correct level-5 use still pending:** the pre-gate movement reproduction passes after `a52c96d`; `e7366ba` prevents level-1 access; `ce3e43e` groups and explains the size/speed payloads in sheet and combat inspection. A proper level-5 Forge character is still required before the entity row can pass all dimensions.
- **Second Wind — passed:** healing, maximum-HP cap, bonus-action/use payment, persisted state, resolved formula, and human-readable resource cost all pass; the final card contains no raw internal placeholders.
- **Unarmed Fighting — passed:** the retained Goliath covers the empty-hands d8 branch and the retained Dwarf covers armed d6, the canonical choice dialog, failed-save Grapple application, persisted relation state, two-sided clarity, and the optional persisted start-turn d4. The final d4 rolled 4 against the 1-HP Goblin and left the saved scene at victory.
- **Dwarf chassis, Darkvision, and Dwarven Toughness — passed:** the retained Forge Dwarf exposes speed 30 ft, permanent Darkvision 120 ft, and a correctly composed 15 maximum HP in the full sheet and combat; all survive reload.
- **Stonecunning — passed on `330416f`:** explicit stone-contact selection, atomic pre-spend validation, bonus-action/use payment, 60-ft tremorsense, 100-round duration, sheet/combat persistence, and complete same-surface/airborne/no-sight guidance all pass. The retained Orc-owned scene also proves resource refresh from 4/6 to 6/6 without actor recreation and with a journal audit entry.
- **Dwarven Resilience — needs deployment retest:** poison resistance passed at 14→7; the incoming poison save visibly detected advantage and persisted a kept/discarded d20, +4 modifier, DC 13, failure, and Poisoned result. The deployed dice dialog incorrectly requested only one visible d20, so the second advantage value came from hidden RNG. Commit `2cc627e` fixes the physical/manual plan to require two independent d20s and awaits production verification.
- **Sleep — combat pass; sheet/clarity need deployment retest:** the retained Drow applied Unconscious after a visible failed Wisdom save and paid the exact action/slot cost. Production sheet use failed atomically at the shared `target_save` continuation and production target inspection exposed raw condition slugs. Commits `df0a5cc` and `38c2825` are pushed; repeat-save, damage/shake wake-up, elf immunity, observer clarity, and sheet persistence/journal remain explicit post-deploy checks.

## Defects fixed, deployed, and retested

- **Deployed and mechanically retested (`8d49f90`):** exact-preimage compatibility upgrade converts legacy `ACT-bardic-inspiration` narrative mechanics to a target-owned `1d6` boon for ability checks, attack rolls, and saving throws. Audited database migration 120 repaired the production row and revoked its stale `verified_mechanical` certificate; the content seed is also repaired. The fresh Goliath retained the boon after reload.
- **Deployed and retested (`8d49f90`):** atomic ruleset incompatibility is translated to actionable Russian. The old Goliath Cure Wounds path now displays the recovery guidance instead of `Atomic participants use incompatible rulesets`.
- **Deployed (`8d49f90`):** a visible `Сохраняем результат действия…` status is available during sheet persistence. The Bardic Inspiration commit completed too quickly to capture it in the 50 ms browser sample; a deliberately slow commit remains the useful observation case.
- **Deployed and retested (`f601e00`):** both active-effect renderers explain to an inspired recipient: add `1к6` to an ability check, attack roll, or saving throw, then remove the effect. The retained Goliath shows the explanation and `Снять вручную` control after a production reload.
- Focused verification currently passes: 18 engine/error/compatibility tests, 14 solo-combat integration tests, 17 action-sheet collection tests, and TypeScript compilation.
- **Deployed and initialization-retested (`3ee5028`):** the combat certificate now has 450 explicit reviewed roots and 17 exact actions. New Forge-derived roots certify Bard Thunderwave plus alternate Sorcerer Thunderwave/Shield with exact Charisma, slot, source, and access signatures. The retained three-actor scene now opens initiative and the tactical map.
- **Deployed and end-to-end retested (`f7d5fb8`):** dedicated combat persistence removes only a byte-identical duplicate image projection, while retaining the complete entity used by the character-sheet hover card and restoring the icon field after reload. The 23-test focused gate, read-only live size budget, exact production row measurement, two reloads, controlled end turn, and Thunderwave resolution all pass.
- **Deployed and end-to-end retested (`a52c96d`):** transition-time movement reconciliation updates the remaining tactical budget when effective speed changes. The focused solo-combat gate passed 15/15; production accepted a 40-ft move after 35→45 ft and retained 5 ft through reload.
- **Deployed and end-to-end retested (`e7366ba`):** level requirements are shared across assembly, combat presentation/reaction discovery, and authoritative execution. Focused tests passed 17/17, targeted lint and full TypeScript passed, the immutable production build passed, and backend/frontend/Timecloud symlink all report the exact commit. The retained level-1 Goliath no longer receives Large Form on a fresh sheet load, while its old scene keeps historical evidence but cannot execute the persisted action.
- **Deployed and end-to-end retested (`abc6ee7`):** Unarmed Fighting now profiles the real authoritative hit, character-sheet action, and combat hotbar action. The empty-hands attack changed from fixed `1 + STR` to `1d8 + STR`; a production critical rolled two d8s, applied 15 bludgeoning damage, and persisted through reload. The out-of-range runtime error was also translated to `Цель вне дистанции действия (5 фт.).`.
- **Deployed and final-card retested (`726c7b7`):** both the runnable sheet wrapper and immutable `actionRef` consumed by the shared hover card receive the same Unarmed Fighting profile. The stale legacy sentence is absent; formula and prose now agree on d8 damage.
- **Deployed and retested (`4ec631e`):** active effects are grouped by their stable identity, recipient-facing instructions are generated from their actual mechanics, and Second Wind resolves its level-dependent healing in the shared action preview.
- **Deployed and retested (`49884ed`):** bound resources and numeric size modifiers receive human labels. Second Wind shows `Заряд способности`; Large Form describes a one-category size increase instead of exposing the numeric value `1`.
- **Deployed and retested (`06f9d4f`):** action-mechanics prose suppresses the already-bound `uses_ACT-*` key. The exact post-binding `ActionPreview.actionRef` regression passes and the production card contains no internal action-use identifier.
- **Deployed and retested (`ce3e43e`):** the actual `CombatCharacterSidebar` used by the live solo-combat route renders grouped effect names plus the same human instructions as the full sheet. The focused renderer test passed, exact backend/frontend/release identity passed, and the final production bundle `index-4_NskXue.js` showed Bardic Inspiration and Large Form guidance in the retained combat drawer.
- **Deployed and end-to-end retested (`34f784d`):** the exact basic unarmed card now uses canonical Damage/Grapple/Shove handling. The focused 27-test gate, 54-test mini-MVP rules-core subset, lint, full TypeScript, immutable build, Timecloud backup/cutover, and independent backend/frontend/symlink identity all passed. A fresh client loaded `index-DGd7QzuD.js`; production then proved the choice dialog, stronger save selection, failed-save Grapple, target/grappler instructions, reload persistence, monster turn, persisted optional d4 prompt, one-shot resolution, damage log, and retained victory.
- **Deployed and end-to-end retested (`330416f`):** Stonecunning's scenario choice is shared by the full sheet and solo combat, the chosen contact is converted to canonical facts before execution, and grant-sense guidance explains every limitation. Final focused coverage passed 49/49 in 4.36s, lint passed in 5.595s, full TypeScript passed in 49.645s, the immutable build passed in 108.236s, and the Timecloud runner completed backup/cutover/health in about 135s with server Vite at 38.07s. Independent backend/frontend/origin/symlink identity matched the exact commit; a fresh client loaded `index-C5z-ChhO.js`. Live sheet and combat execution, exact resource spending, scene-constructor refresh, and reload persistence all passed. Backup: `pre-330416f6dd3920a84c654bea304d775ebc0019fd-20260830T215019Z.dump`.

## Remaining limitations and blocked checks

- Bardic Inspiration consumption remains manual by design: the boon effect tells the recipient to add the die and remove the effect after use. Automatic roll attachment/consumption is outside the current implementation and must be evaluated as a later usability improvement.
- Thunderwave sheet availability still requires separate diagnosis/fix. Minor Illusion is repaired in commit `ba03297`, but its row remains open until the shared combat form, positioned token, persistence, and observer-facing description are retested after deployment.
- Large Form still needs a correctly leveled character for the actual level-5 sheet/combat test. Its sheet/combat effect grouping and explanation now pass.
- Dwarven Resilience now needs only the post-deploy two-visible-d20 retest. The real poison damage branch, advantage predicate, modifier/DC/outcome, state persistence, and observer-facing journal all have production evidence. A deterministic QA roll control would still make future save-branch checks faster and reproducible.
- Mage Hand, Dancing Lights, Mage Armor, and Sleep require post-deploy production retests. Their production failures/evidence are retained, while commits `ac12285`, `48f87b5`, `ee91720`, `38c2825`, and `df0a5cc` are pushed but cannot be released safely until Timecloud release retention is authorized.

## Timing and speed analysis

The detailed action-by-action timing log is maintained in `docs/mini-mvp-completion-timing-2026-08-30.md`. For release `330416f`, useful final behavior execution took 4.36s, while full TypeScript took 49.645s, the exact local build 108.236s, upload 26.197s, and the Timecloud runner about 135s. Server Vite alone repeated another 38.07s of frontend compilation. The two Stonecunning CodeGraph queries consumed 37.928s and were again polluted by temporary immutable-build copies. The workbook edit/render/export took 37.591s and re-import verification 7.273s; this is acceptable at meaningful batch checkpoints but not per row. The largest immediate speedups are: exclude `tmp/immutable-build-*` from code indexing; promote the already verified immutable frontend artifact instead of recompiling it on Timecloud; run focused tests during edits with one final parallel TypeScript gate; batch workbook writes and render changed ranges during development while retaining one all-tab delivery render; add deterministic dice/scenario controls; and add validated release-retention maintenance before the server's roughly 3.1 GB free space becomes a deployment risk.

## Poison-spell continuation findings — 2026-08-31

### Entity results

- **Poison Spray — passed in all three dimensions.** The retained Drow used it from the character sheet against the compatible retained Dwarf. The flow requested a ranged spell attack and `1к12` poison damage, spent one action, hit AC 11 with 24, rolled a critical 14 poison damage, and applied Dwarven resistance as 14→7. The persisted journal explicitly says `сопротивление (яд): 14 → 7`. Retained combat evidence covers the same damage/resistance path. Workbook row `Spells!39` is now `Passed`.
- **Ray of Sickness — mechanics pass; production clarity needs one deployment retest.** In a new retained Drow-versus-Goblin scene, the Goblin acted first and damaged the Drow to 4/9 HP. Ray then spent exactly one action and the final level-1 slot, hit AC 15 with 16, dealt 8 poison damage (10→2 HP), applied Poisoned, and persisted. The journal names the damage, both resources, and `Состояние: Отравленный → Гоблин-воин`. The hover card contains attack, damage, duration, upcast, range, components, class access, and resource cost. However, the deployed monster inspector displays raw `poisoned` with no rules/source/duration. Workbook row `Spells!64` is therefore `Needs retest`, not falsely passed.
- **Ray of Sickness lifecycle — passed after correcting the observation method.** The first source-turn start armed and preserved the condition; the following source-turn end expired it. A prior apparent early expiry was a browser-check false positive caused by searching the entire page, where `Отравленный` remained in the condition selector even after the active-condition panel was empty. Future checks inspect the active-condition container/runtime marker rather than page-wide text.
- **Dwarven Resilience — poison-damage branch passed; saving-throw branch pending.** Real Poison Spray damage was halved 14→7 with localized observer-facing journal math; prior Ray evidence reduced 17→8. Rows `Species!64` and `Species!67` remain `Needs retest` only until a poison-related saving throw proves advantage and its clarity.

### Cross-cutting errors and fixes prepared locally

- **Malformed canonical Spear blocks an unrelated target character.** Selecting the retained Goliath as a spell target fails while compiling the participant because equipped Spear `12b175a4-cbc3-42bd-9d8d-50193a112389` (`CARD-0004`) has no strict `mechanics.weapon_profile`. The spell itself is valid and spends nothing. A fail-closed migration `121_repair_spear_weapon_profile` now pins the exact card/effect identity and canonical simple-Spear profile (STR, melee 1d6 piercing, versatile 1d8, thrown 20/60, mastery). It refuses identity/data drift and is idempotent. Three focused Go tests passed.
- **Target compilation errors were silent.** Ordinary spell targeting loaded and compiled the selected participant outside the guarded action path. A malformed target therefore abandoned the action with no toast or sheet error. The flow is now guarded and shows `Действие не выполнено` plus the actionable failure while preserving resources. Focused target-flow tests passed.
- **Active condition inspection exposed internal data.** The shared effect display now derives a localized condition name from certified condition mechanics and shows each rule, the source, and exact duration. For Ray of Sickness the intended result is `Отравлен`, `Источник: Луч болезни`, `до конца следующего хода источника`, `Помеха на броски атак`, and `Помеха на проверки характеристик`. The improvement applies to both monster and character combat inspection. The initial focused regression passed 22/22; an additional exact render of the mounted monster inspector passed 15/15 and proved all five strings plus absence of raw `<strong>poisoned</strong>`. TypeScript and lint passed, but production browser confirmation awaits deployment.
- **Release storage is exhausted enough to make deployment unsafe.** The Timecloud host contains 101 release directories using about 21.4GB, while only about 1,062,404 KiB remains free (98% used). The runner retains both the roughly 112MB uploaded archive and the extracted build for every release. No old release or user data was deleted. A separately authorized retention cleanup is required before deploying this batch.

### Updated checklist checkpoint

The accepted workbook now contains 772 rows: **31 Passed, 14 Needs retest, 1 Failed, and 726 Not tested**. Four rows were updated with retained character IDs and threaded evidence. All five tabs were rendered, the changed poison/Dwarf ranges were inspected at higher scale, the exported workbook was freshly re-imported, and no formula errors were found.

The source repairs were committed atomically as `38c2825e0c8ec3aef1b8d048b070a38ca354f1de` and pushed to both the feature branch and `main`. They are intentionally not described as deployed: the safe release prerequisite is old-artifact retention cleanup on the Timecloud host, followed by exact release-identity and production-browser retests.

### Timing update

The largest diagnosis cost in this continuation was four CodeGraph calls totaling **108.475s**, mainly because old immutable-build copies pollute the index. Final behavior tests took only **46ms** of actual test execution (**5.935s** wall), versus **48.873s** for TypeScript and **19.822s** for lint. Cross-character preparation took **10.256s**, scene launch/AI took **9.637s**, and Ray execution/persistence took **5.012s**. The workbook edit/all-tab render/export took **23.405s**, fresh verification **6.355s**, and focused renders **9.241s**. Highest-value speedups are: exclude temporary builds from CodeGraph, preflight/certify equipped participant cards before target confirmation, keep one cached TypeScript gate per batch, reuse retained scenes, add deterministic QA rolls, and introduce a safe Timecloud release-retention policy.

## Dwarven Resilience saving-throw continuation — 2026-08-31

The retained compatible Dwarf `8c450667-7ce4-4c81-a982-f7356cb8f7ab` used the sheet's real incoming-save pipeline with Poisoned, Constitution, and DC 13. Before rolling, the UI explicitly displayed `Входящий спас против «Отравленный» · преимущество`. The persisted result was `к20: 5 (отброшено 5) +4 Телосложение = 9 против СЛ 13 — провал`, followed by `Провал спасброска — «Отравленный» наложено через механизм цели` and `Состояние: Отравленный`. Detection, rules-engine advantage, modifier, DC, outcome, persistence, and result clarity therefore pass. The applied test condition remains on the retained character as reproducible evidence.

The run exposed a cross-cutting physical/manual dice defect: the deployed dialog advertised `1к20` even though `rollD20` needed two values for advantage. The entered die supplied the first 5; the second 5 happened to come from an unobserved random fallback, so the player could neither roll nor audit both independent advantage dice. The same one-die plan existed in the live incoming combat-save path.

Commit `2cc627e2883f05c5e703e1095abe8c8b439418ad` fixes both incoming-save surfaces through one shared plan that requests two d20s for advantage/disadvantage and also includes data-driven bonus dice. Focused verification passed 29/29, TypeScript passed, targeted lint passed, and the commit is pushed to both the feature branch and `main`. Production status remains `Needs retest` until the release shows `2к20` and two independently controlled values in the journal.

The workbook checkpoint remains **31 Passed / 14 Needs retest / 1 Failed / 726 Not tested** across 772 rows. `Species!64` and `Species!67` now each have three threaded evidence entries; all five tabs were rerendered, the changed Dwarf crop was visually inspected, a fresh import verified the two rows/comments, and no formula errors were found.

## Minor Illusion continuation — 2026-08-31

### Entity result

- **Character sheet — mechanics pass, result clarity failed on the deployed release.** The retained Dragonborn Wizard `89f8fefe-acf2-45bc-86e1-960d8cb49188` selected the no-cost cantrip source, chose Sound, entered `Звук колокольчика`, and confirmed explicit 10-foot scenario facts. The cast spent exactly one action, spent no spell slot, and created a persisted world object. The result and journal nevertheless reduced it to `Малая иллюзия: см. описание заклинания` and `создан объект «Minor Illusion»`, discarding the submitted description and counterplay.
- **Combat — hover card passed, activation failed atomically on the deployed release.** The retained combat card clearly described the sound/image options, 30-foot range, one-minute duration, and Investigation action against spell save DC. Clicking a legal adjacent cell supplied only its position, so the rules engine rejected `Minor Illusion requires explicit sound or image input`. Action remained 1/1; no slot, journal entry, or object was created.
- **Result clarity — failed in production and repaired locally.** Because the description was absent and no combat token existed, neither caster nor ally could tell what the illusion represented or how to test it. Commit `ba03297` reuses the existing sheet world-input dialog after the combat cell click, overwrites geometry with authoritative board facts, passes the selected form/description to the engine, positions and persists the object, and renders a sound/image token. Map accessibility text and both journals now include description, remaining rounds, Investigation DC, and the physical-interaction disclosure for images.

### Verification and retained evidence

- Focused verification passed **62/62** across the dialog, tactical map, combat integration, and sheet primitive/orchestrator paths. The combat test proves explicit input, action/no-slot payment, selected-cell position, log clarity, and save/reload persistence. The map test proves description and counterplay are visible to an observer.
- Targeted lint passed; full TypeScript passed; the clean production build passed and verified the reviewed seven-file DiceBox asset set.
- Commit `ba03297` is pushed to both `codex/fix-mini-mvp-runtime-contracts` and `main`. The retained characters and scenes were not deleted or finished.
- The accepted workbook now contains **772 rows: 32 Passed / 19 Needs retest / 0 Failed / 721 Not tested**. `Spells!16` contains both retained character IDs and two threaded evidence entries. All five tabs were rendered, the Spells tab was visually inspected, the exported workbook was freshly re-imported, and no formula errors were found.
- Production status remains **Needs retest**, not Passed: Timecloud is still at 98% disk usage with 101 release directories, so this commit has not been deployed.

### Cross-cutting build finding

The first production build compiled successfully but its final guard found untracked package post-install copies under `frontend/public/assets/ammo` and `frontend/public/assets/themes`. Vite copied those obsolete duplicates into `dist`, then correctly failed the reviewed-asset invariant. The two untracked directories (about 606KB total) were moved, not deleted, to `tmp/quarantined-postinstall-assets-20260831`; the tracked reviewed path `public/assets/dice-box` was untouched. A fresh build then passed. The build command should run this unused-source preflight before TypeScript/Vite so the same condition fails in seconds rather than after a complete bundle.

### Timing update

Useful browser reproduction took about **14.1s** of measured product interactions, while the first full build consumed about **92.8s** before reporting the obsolete assets and the clean rerun consumed **68.2s**. Full TypeScript took **42.8s**; the main focused suite took **9.54s** and the additional sheet narrative suite **14.61s**. The workbook edit/all-tab render/export took **21.84s**, fresh verification **4.71s**, and visual review **0.1s**. The highest-value speedups are an early asset preflight, one final build after focused tests, persistent incremental TypeScript, and continued batching of spreadsheet checkpoints.

## Combat scene-constructor completion — 2026-08-31

Production browser inspection of the retained Dragonborn scene found that the constructor only exposed initiative totals and resource refresh. It had no participant-insertion control, despite participant addition being an explicit mini-MVP requirement and the feature needed to prevent damage-spell tests from prematurely ending retained encounters.

Commit `942492b` completes the constructor with two insertion paths:

- add a fresh instance of any monster in the first 100 catalog results, loading its exact actions, effects, token, initiative bonus, presentation, and AI-owned capability set;
- add another owned Forge character, compiling its current canonical sheet, actions, certified combat slice, resources, runtime revision, token, and presentation.

Both paths preserve the current turn, allocate a free tactical cell, insert and sort an initiative entry, increment board/world revisions, write a constructor audit entry, persist through the existing dedicated-combat envelope, and reopen an ended outcome for further testing. Duplicate characters, incompatible rulesets, occupied boards, malformed monster content, and non-owned character sheets fail closed with player-facing errors. Existing characters and scenes are not replaced, finished, or deleted.

Verification passed **22/22** focused constructor/solo-combat checks, including both insertion types, unique positions, current-turn preservation, action ownership, runtime revisions, save/reload persistence, and the rendered selector controls. Targeted lint passed, and the production build passed TypeScript, the 4,622-module Vite bundle, PWA generation, and the reviewed DiceBox invariant. Commit `942492b` is pushed to the feature branch and `main`, but production browser retest remains blocked by Timecloud storage capacity.

The constructor discovery itself took **0.608s** in the browser. Code navigation then cost **27.696s** in two CodeGraph calls, while final focused verification took **7.371s** and the final production build **82.287s**. The two useful behavior assertions executed in 113ms. The fastest future loop is to keep constructor-state helpers behind their focused integration file, reuse preview/list endpoints, run one final build, and exclude immutable temporary builds from CodeGraph.

## Mage Hand continuation — 2026-08-31

The retained Drow `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` cast Mage Hand through both the dedicated combat hotbar and the full character sheet on deployed release `afa3f6c30a96e29603a64d34ba09287610577b78`. Both casts spent exactly one main action, spent no spell slot, created the persisted `Волшебная рука` active effect, and wrote the result to the journal.

The production behavior failed the actual-use and clarity dimensions after the cast. No sheet or combat control allowed the player to choose an object or issue any of the already-declared operations. The only explanation exposed an internal implementation detail: `world_interaction` remained the responsibility of a scene adapter. Thus the engine contract existed, but the website made it unreachable.

Commit `ac12285` connects the existing generic remote-manipulator engine to one shared player dialog in both surfaces. The player chooses a permitted operation and names the scene object, then supplies distance, weight, and movement distance when relevant. The existing rules engine remains authoritative: it rejects forbidden operations, targets beyond 30 feet, loads above 10 pounds, and movement above 30 feet; on success it spends the next main action. Dedicated combat persists the updated runtime, world revision, structured scene event, and a readable Russian journal line containing the operation and named object. The full sheet uses the same validated engine command and normal runtime persistence.

Migration `122_repair_mage_hand_control_narrative` is fail-closed and idempotent for exact entity `70e35366-5446-49ff-b0b9-759dbbff347e` / `SPELL-0173`. It replaces the internal adapter note with direct player instructions and revokes the stale locked support state pending browser recertification. The content upgrade planner accepts the exact deployed pre-control hash as an audited bridge and rejects all other drift.

Local verification passed: focused frontend coverage **11/11**, final command/dialog coverage **2/2**, content planner **3/3**, the complete Go migration package, targeted lint, and full TypeScript. The workbook row `Spells!7` remains **Needs retest** until this commit can be deployed through Timecloud and the retained Drow proves both a sheet command and a combat command in the production browser. No character or scene was deleted.

Deployment remains blocked by the previously measured release-storage condition: 101 retained release directories consume about 21.4GB and leave roughly 1,062,404 KiB free. No cleanup or release was attempted without explicit retention authority.

Timing: browser reproduction took 10.536s of measured navigation/click/persistence work. CodeGraph cost about 27s and again returned duplicate temporary symbols. Focused behavior execution was 94–173ms inside 2.68–3.97s Vitest runs. Full TypeScript was the longest machine gate at 39.654s; a test-only type correction forced an avoidable second 39.111s run. The accepted workbook checkpoint took 22.019s to edit/render/export and 4.652s to re-import. The best immediate speedups are a typed active-effect fixture builder, excluding immutable temp trees from CodeGraph, and keeping one final TypeScript run after all typed fixtures compile.

## Dancing Lights continuation — 2026-08-31

The retained Drow `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` selected Dancing Lights in the saved Drow-versus-Goblin combat on deployed release `afa3f6c30a96e29603a64d34ba09287610577b78`. The combat hover card passed the clarity check: it showed the full description, Bard/Sorcerer/Wizard access, 120-ft range, concentration up to one minute, verbal/somatic/material components, and action cost.

Actual combat use failed atomically. Clicking cell 6,6 returned `InvalidFacts: Dancing Lights requires a canonical placement snapshot`. The Drow kept action 1/1, no slot or other resource changed, and the retained scene remained intact. The failure was an adapter defect rather than a rules defect: rules-core already creates durable light objects, enforces range/separation/duration/concentration, and implements the 60-ft bonus-action move, but dedicated combat did not convert the clicked cell into canonical board facts and did not render world objects.

Commit `48f87b5` supplies the missing combat path. A clicked cell now produces board revision, caster distance, and placement facts; the accepted object receives a persisted tactical position. The map renders a labeled light token with its 10-ft dim-light radius. A status panel shows the light count, radius, concentration, and rounds remaining, then exposes the existing rules-engine movement as `Переместить · бонусное действие`. Movement validates the exact active concentration, bonus-action resource, 60-ft movement limit, 120-ft caster range, object identity, and saved board position before committing; cast and movement both increment board revision and survive serialization. Expired/replaced objects have their tactical positions pruned.

Local verification passed: the focused end-to-end behavior test passed **1/1**; the complete solo-combat integration file passed **18/18** in 5.574s with 474ms of test execution; TypeScript passed in 45.296s; targeted lint passed in 3.792s. The production bundle compiled all 4,612 modules and completed Vite in 34.38s, but the overall build command failed only at the final asset-policy check because the user-owned working tree already contains an unrelated untracked `frontend/public/assets/ammo/` directory. Those files were preserved.

The accepted workbook now reports **31 Passed / 15 Needs retest / 1 Failed / 725 Not tested** across 772 rows. `Spells!21` is `Needs retest`, contains the retained Drow ID, and has one threaded evidence comment. All five tabs were rerendered, a fresh import verified the row/comment/counts, and no formula errors were found. It cannot be promoted to Passed until character-sheet use and the deployed combat cast/move/reload/observer-clarity flow are verified.

No deployment was attempted. Commits `38c2825`, `2cc627e`, `ac12285`, and `48f87b5` are pushed to the feature branch and `main`, but Timecloud still has only about 1,062,404 KiB free across 101 retained release directories. Cleanup requires explicit retention authority; no test character, saved scene, old release, or user asset was deleted.

Timing: the production click path took 0.707s to select the spell and 0.812s to fail on the target cell. CodeGraph took about 60.012s and was the largest avoidable diagnosis cost, again because immutable-build copies dominate the index. The first test run took 24.961s because its filter was not forwarded from the repository root and exposed a missing test fixture; rerunning from the frontend workspace reduced the complete integration file to 5.574s. TypeScript took 45.296s. The release build command took 87.525s, of which Vite used 34.38s before the unrelated asset gate failed. Workbook edit/render/export took 21.907s, fresh verification 4.470s, and all-tab visual inspection 0.251s. The best speedups are to run frontend tests from the frontend workspace, exclude immutable builds from CodeGraph, keep a typed utility-spell fixture, run one TypeScript gate per coherent batch, and separate the asset-policy gate from compilation output so a pre-existing untracked asset reports immediately.

## Mage Armor continuation — 2026-08-31

The retained Drow `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` selected Mage Armor in the same saved combat on deployed release `afa3f6c30a96e29603a64d34ba09287610577b78`. The shared hover card passed: it explains the willing and unarmored target requirements, base AC `13 + Dexterity`, the armor-ending trigger, Sorcerer/Wizard access, touch range, eight-hour duration, components, action, and level-1 slot.

Clicking the Drow's own controlled token failed atomically with raw `TargetNotWilling: … has not explicitly consented to …`. Action remained 1/1, slots remained 2/2, and no effect or journal mutation was committed. The rules core was correct to require explicit willingness, but dedicated combat had no consent adapter even when the player clicked the caster's own token; it also leaked actor/action IDs in English.

Commit `ee91720` fixes the boundary without weakening the rule. A target is marked willing only when the actor targets themself or the current player controls both source and target; unrelated/uncontrolled targets remain fail-closed. `TargetNotWilling` and `TargetArmored` are now translated into actionable Russian without identifiers. The local vertical test proves that the same action spends one main action and one level-1 slot, creates the exact 4,800-round Mage Armor effect, attributes it to the caster, and journals the spell. Focused consent/error checks passed **2/2**; the complete combat/error files passed **24/24**; targeted lint and TypeScript passed.

The workbook now reports **31 Passed / 16 Needs retest / 1 Failed / 724 Not tested** across 772 rows. `Spells!56` is `Needs retest` with the Drow ID and one threaded evidence comment. All tabs were rerendered, a fresh import verified counts/comment/formulas, and the changed Spells preview was visually inspected. Character-sheet use plus deployed effect, AC, armor-ending, expiry, reload, and observer clarity remain required before Passed.

Timing: production selection/hover/persistence wait took 2.905s and self-target/failure verification 2.765s. CodeGraph took 13.492s, and the decisive consent search 0.133s. Four fixture/assertion correction cycles plus the final focused pass cost 25.179s; the final useful behavior execution was only 76ms. Running the full 24-test suite, lint, and TypeScript in parallel took about 47.0s overall instead of about 58.6s sequentially, with TypeScript again dominating at 46.972s. Workbook edit/render/export took 21.740s, fresh verification 4.279s, and visual inspection 0.082s. The largest local speedup is a certified prepared-spell fixture builder: the product fix itself was five lines, while three test reruns corrected grant provenance/preparation and one corrected an effect-field expectation.

## Sleep continuation — 2026-08-31

The retained Drow `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` cast Sleep in the retained Drow-versus-Goblin scene on deployed release `afa3f6c30a96e29603a64d34ba09287610577b78`. The shared hover card passed: Wisdom DC 12; 5-foot sphere at 60 feet; Unconscious result; repeat save at the end of the target's next turn; damage/action-to-shake wake-up rules; automatic success for elves and creatures immune to Exhaustion; Bard/Sorcerer/Wizard access; concentration, components, action, and level-1-slot cost.

Combat mechanics passed. The Goblin rolled `12 - 1 WIS = 11` against DC 12, failed, became Unconscious, and the caster spent exactly one action and one level-1 slot. The journal names the save, modifier, DC, outcome, condition target, spell, and both resources. The scene was retained at round 1 with Drow 4/9 HP and Goblin 2/10 HP. Production observer clarity did not pass: target inspection showed raw `poisoned` and `unconscious` labels with no source, duration, or rules. Pushed commit `38c2825` supplies shared localization, source, duration, and condition instructions; Sleep-specific repeat-save and wake-up clarity still require the production retest.

Character-sheet use exposed a shared adapter defect. The sheet correctly opened the target/facts dialog, selected the built-in training target, opened the shared dice dialog, and accepted a deterministic manual d20 of 1. It then aborted with `The compatible character sheet cannot resume canonical pending resolution target_save`. Action and both slots remained unchanged, so the failure was atomic. Commit `df0a5cc` adds an opt-in target-save resume loop after the sheet has collected the dice. It dispatches each canonical target-save decision with the injected dice, returns one completed world for atomic persistence, guards against a non-advancing resolution, and leaves reactions and all other unsupported continuations fail-closed.

Verification passed: focused ordinary-spell coverage **7/7**; related orchestrator and sheet UI coverage **56/56**; full lint; and full TypeScript. Commit `df0a5cc` was pushed to the feature branch and `main`. Deployment was not attempted because the Timecloud host still has roughly 1,062,404 KiB free across 101 retained release directories and cleanup has not been authorized.

The accepted workbook now reports **31 Passed / 17 Needs retest / 1 Failed / 723 Not tested** across 772 rows. `Spells!100` is `Needs retest`, contains the retained Drow ID and one detailed threaded comment, all five tabs were rerendered, fresh import verified the row/count/comment, the changed Spells tab was visually inspected, and the formula-error scan returned zero matches.

Timing: combat selection took 1.132s; result recovery after the interrupted output took 0.057s; target-inspector checks took 0.710s + 0.058s. Opening the full sheet took 1.958s. Scene-constructor refresh took 0.626s to open and 1.129s to restore resources; sheet reload/readiness took 1.041s + 1.299s. The sheet target/save reproduction took 1.352s to open, 2.199s to confirm target facts, 2.248s to resolve the manual die, and 0.070s to expose the final error. Three CodeGraph queries consumed 18.126s + 19.143s + 13.604s = **50.873s**, the largest avoidable diagnosis cost. Focused behavior tests took 4.360s, and the final 56-test related gate took 8.793s. Lint took 19.971s. A missing npm script and malformed compiler invocation wasted 1.402s + 2.350s; the first correct compiler run took 35.628s and found the one-word `auto`/`system` contract mismatch, while the final compiler run took 42.830s. Workbook edit/render/export took 21.939s, re-import verification 4.537s, and visual inspection 0.1s. The immediate speedups are to exclude immutable builds from CodeGraph, standardize one checked TypeScript command, use type-aware editing before the full compiler gate, and batch workbook checkpoints.

## Sleep lifecycle correction and major findings — 2026-08-31

Advancing the retained combat invalidated the earlier partial mechanics pass. Deployed Sleep stored one-round **Unconscious**, decremented it at the Goblin's turn start, removed it before the Goblin acted, and then allowed the Goblin to attack the Drow. The saved reproducible state is now round 2, Goblin turn, Drow `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` at 0/9 HP, and Goblin at 2/10 HP. The scene was not deleted or finished.

The production hover/description was substantially more correct than the executable data. The [official 2024 Sleep rule](https://www.dndbeyond.com/spells/2619064-sleep?page=2) requires a failed initial Wisdom save to apply Incapacitated until the end of the target's next turn, then a repeat save; only a failed repeat changes the target to Unconscious for the remaining concentration duration. Damage or an adjacent wake action ends the spell for that target, and creatures that do not sleep or are immune to Exhaustion automatically succeed. The deployed mechanics implemented none of that lifecycle beyond a first save and a premature one-round condition.

Commit `a1b37d5` and migration `123_repair_sleep_2024_lifecycle` are pushed to `main` and the feature branch. They implement the two-stage persisted effect, bind the repeat-save DC to the caster when the condition is applied, preserve the effect/concentration identity during the Incapacitated-to-Unconscious transition, end matching magical Sleep on positive damage, and add the exact adjacent Help wake exit. Help now exposes explicit assist, wake, and stabilize choices. The condition inspector explains source, duration, repeat timing/DC, failure transition, damage exit, and wake instructions.

Automatic success is also data-owned. No-sleep and unconditional Exhaustion-immunity traits now skip the dice window and state why. In a mixed area, automatic targets are written to `resolvedTargetIds` for deterministic replay/audit but omitted from the manual save queue; the remaining creatures keep declaration order. This closes a cross-cutting continuation bug where an immune target could still be asked to roll merely because another creature in the same area needed a manual save.

Final post-correction verification passed **51 related frontend tests across eight files**, targeted lint, full TypeScript, and the complete Go migration package. The vertical tests cover initial failure, target-start survival, end-turn repeat failure, same-effect transition, damage/no-damage exits, exact Help filtering, no-sleep and Exhaustion-immunity auto-success, mixed Elf/Goblin areas, checkpoint replay equality, exact database preimages, idempotence, and guard restoration. The stale support certificates for Sleep and Help are revoked to `untested` until production evidence exists.

### Cross-cutting errors not limited to one entity

1. **Displayed instructions and executable mechanics can diverge while content remains certified.** Sleep's card described the repeat save, wake exits, and automatic success, but the locked production JSON still contained a different one-round effect. Certification needs a description-to-mechanics contract check, not only schema validity and selected example tests.
2. **Turn-start duration decrement can erase “until end of next turn” effects before they act.** This is a shared lifecycle boundary risk. Durable effects need explicit end triggers/save timing rather than approximating semantic duration with `rounds: 1`.
3. **Automatic resolutions must be first-class in multi-target continuations.** A serial queue that assumes every target supplies a die creates false prompts and can lose immunity clarity. The queue now retains auto-resolved IDs while requesting dice only from unresolved targets.
4. **Effect removal needs cause/end-trigger filters.** A generic “remove Incapacitated/Unconscious” Help action could otherwise wake unrelated conditions. The engine now validates and applies exact cause-tag and end-trigger filters.
5. **Observer clarity must be verified after every state transition, not only initial application.** The inspector previously showed raw condition slugs and no repeat/wake instructions. The checklist remains `Needs retest` until both the affected player and an ally can inspect each stage in production.

The accepted workbook remains conservative at **31 Passed / 17 Needs retest / 1 Failed / 723 Not tested** across 772 rows. `Spells!100` now has two threaded evidence entries, the retained Drow ID, and the lifecycle failure/fix summary. All five tabs were rerendered and visually inspected, a fresh import verified the row/count/comments, and the formula scan returned zero matches.

No deployment was attempted. The Timecloud host remains at the previously verified safety limit—about 1,062,404 KiB free with 101 retained release directories—and no retention cleanup was authorized. No release, test character, scene, or user asset was removed.

Timing: the longest aggregate verification cost was four TypeScript passes totaling **216.894s**; the longest single avoidable detour was the package-manager mismatch and dependency repair at about **110.25s**. Two CodeGraph queries cost **35.610s** and were again polluted by immutable temporary builds. The final useful focused suite took 19.446s for 26/26; the additional related suite took 11.60s for 25/25. Running that suite, lint (25.029s), and TypeScript (43.918s) concurrently reduced the final gate from about 80.547s sequential to about 43.918s critical time, saving roughly **36.629s**. The Go migration gate took 3.879s. Source staging, commit, remote checks, and both pushes totaled about 11.268s. Workbook edit/all-tab render/export took 27.304s, fresh re-import 4.691s, and visual review 0.3s.

The best immediate speedups are concrete: use only the existing frontend-local test executable (never invoke `pnpm` without `exec` in this npm-installed workspace); add one repository-level typecheck command; run one final TypeScript pass after a coherent edit batch; keep tests/lint/typecheck parallel; exclude `tmp/immutable-build-*` from CodeGraph; and batch several entity results before each full-workbook render.

## Ray of Sickness and Ray of Frost continuation — 2026-08-31

The retained Drow Wizard `f8e7549a-fe5c-4347-9d90-a7e27bfe94b9` used Ray of Sickness from the full character sheet. The first attempt was rejected atomically because the sheet had remained open while combat changed the same character runtime: action stayed 1/1 and level-1 slots stayed 2/2, and the sheet refreshed. Commit `a04250a` replaces the raw stale-revision/CAS wording with a player-facing explanation that another tab or combat changed the sheet, confirms that data was refreshed, and asks the player to repeat the action. Focused tests passed 28/28, targeted lint passed, full TypeScript passed, and the commit is pushed to the feature branch and `main`.

After refresh, a deterministic natural 20 plus spell attack +4 critically hit AC 10. Entered base d8 values 1+1 and engine critical dice 2+5 produced 9 poison damage; Poisoned was applied; exactly one action and one level-1 slot were spent; and the journal clearly named the attack, AC, critical, damage, condition, and resources. Mechanics and sheet use therefore pass. `Spells!64` remains **Needs retest** because the deployed recipient/monster inspector still exposes the previously recorded raw Poisoned condition rather than the localized explanation; it now has two threaded evidence entries.

The retained Dragonborn Wizard `89f8fefe-acf2-45bc-86e1-960d8cb49188` completed Ray of Frost in all three dimensions. In combat, the hover card showed +5 spell attack, 1d8 cold, 60-foot range, action/no slot, and the 10-foot speed reduction until the caster's next turn. A 15-versus-15 hit dealt 1 cold, spent one action, and reduced the Goblin from Speed 30 to effective Speed 20. Target inspection named Ray of Frost and showed `Speed: -10 ft`; reload preserved HP, journal, speed, and effect. After the Goblin acted and the Wizard's next turn began, the effect disappeared and Speed returned to 30. On the character sheet, deterministic 5 + spell attack 5 hit AC 10 for 1 cold, spent one action, spent no slot, and produced a clear result and journal. The scene remains saved and unfinished.

`Spells!15` is now **Passed** with the Dragonborn ID and one threaded evidence comment. Fresh workbook verification reports **32 Passed / 17 Needs retest / 1 Failed / 722 Not tested** across 772 rows, two comments on `Spells!L64`, one on `Spells!L15`, and zero formula errors. All five tabs were rerendered and the Spells preview was visually inspected.

The longest machine gate in this batch was TypeScript at 34.356s. Workbook edit/render/export took 22.341s and fresh verification 4.317s. The two production spell paths themselves were short; the main avoidable costs were a 17.529s low-signal CodeGraph query and an attempted raw API shortcut that did not share the browser session. Reusing retained scenes, resolving character IDs from the visible selector, keeping one final TypeScript gate, and batching workbook rows remain the best speedups.

## Fire Bolt continuation — 2026-08-31

The retained Dragonborn Wizard `89f8fefe-acf2-45bc-86e1-960d8cb49188` completed the executable Fire Bolt path in combat and on the full character sheet. The combat card showed +5 ranged spell attack, 1d10 fire, 120-foot range, action/no slot, and the unattended-flammable-object ignition rule. A system 15 +5 hit AC 15, dealt 6 fire, spent exactly one action, spent no slot, reduced the retained Goblin from 9/10 to 3/10 HP, and wrote a clear attack, AC, die, damage, target, and resource journal. After using the scene constructor to refresh resources, the sheet used deterministic d20=10 and d10=4: total 15 hit AC 10 for 4 fire, spent one action, spent no slot, and produced a clear result and journal. The character and scene remain saved and unfinished.

The shared card failed internal clarity consistency. Base damage and executable mechanics correctly use d10, but the deployed scaling paragraph says 1d6, 2d6, 3d6, and 4d6. Commit `9ca35ff` adds guarded migration `124_repair_fire_bolt_upcast_description`, changing the four display tiers to d10. The migration requires exact ID `50626b5a-33c5-46e0-af0e-50599f4306a0`, card number `fire_bolt`, level 0, the known incorrect paragraph, and already-correct 1d10 mechanics; it fails closed on identity/content drift, explicitly revokes the stale certificate, and restores the write guard. Focused and complete migration checks passed, and the commit is pushed to the feature branch and `main`.

`Spells!20` is **Needs retest**, contains the Dragonborn ID, and has one threaded evidence entry. The deployed scene does not expose a compatible unattended flammable object, so the ignition branch is not yet browser-testable. After the Timecloud release, the shared card must show 1d10/2d10/3d10/4d10 and the object branch still needs a scene-object control before the entity can receive a full pass. Fresh workbook verification reports **32 Passed / 18 Needs retest / 1 Failed / 721 Not tested** across 772 rows and zero formula errors; all five tabs were rerendered and the Spells preview was visually checked.

Timing: retained combat reload took 1.859s, combat selection and resolution 0.619s + 2.155s, constructor open/refresh 0.619s + 1.564s, and sheet reload/open/target/resolve 1.912s + 0.646s + 0.644s + 2.192s. Two CodeGraph calls consumed 10.990s + 16.177s and were again dominated by immutable-build duplicates; the decisive focused search took 2.779s. Focused and full migration gates took 4.359s + 3.443s. Stage, commit, and push took 0.326s + 0.166s + 2.861s. Workbook discovery/edit/render/export/re-import/visual QA took 4.405s + 21.545s + 4.290s + 0.1s. The clearest speedups are to exclude immutable builds from CodeGraph, use exact entity IDs immediately, and batch several spreadsheet rows before full all-tab rendering.

## Magic Missile and fresh-Forge continuation — 2026-08-31

### Entity result

The fresh retained Human Wizard `356f2df5-2593-4b3d-a249-ebe72cbc42a5` was created through the production Forge specifically for sheet spell testing. The character was not deleted and was not placed into combat. Magic Missile selected the built-in training dummy at 60 feet and explicitly allocated all three darts. Automatic d4 results of 4, 4, and 1 produced 5, 5, and 2 force damage, for 12 total. Exactly one action and one level-1 slot were spent: action `1/1→0/1`, slot `2/2→1/2`. Sheet mechanics therefore pass.

The immediate outcome briefly showed all three damage packets and both resource costs, but persistent clarity failed on the deployed release. The journal displayed each d4 as `d20`, and it stored no durable action-name or target row. A later reader could see three force-damage entries but could not determine that Magic Missile produced them or that the training dummy was targeted.

Commit `b25ff8e` fixes both presentation defects. `formatRollBreakdown` now uses the actual side count of every die and safely formats mixed dice. Ordinary sheet actions also prepend a durable `action → target(s)` narrative entry before their mechanical events. Focused verification passed **9/9**, targeted lint passed, full TypeScript passed, and the production build passed TypeScript, all 4,622 transformed modules, PWA generation, and the exact DiceBox asset invariant. The commit is pushed to the feature branch and `main`.

Combat remains **Needs retest**. The deployed scene constructor cannot add a safe participant, and casting three darts at the retained 3-HP Goblin would end the preserved encounter. Pushed constructor commit `942492b` supplies participant insertion, but Timecloud capacity still blocks deployment. `Spells!47` is therefore conservatively **Needs retest**, not Passed.

### Cross-cutting Forge validation issue

The fresh Wizard initially could not be created because the Wizard class defaulted to Arcana while the Sage background also granted Arcana. The validation was mechanically correct, but it exposed the internal slug `arcana` and gave no recovery route. The only way forward was to infer that the class step must be reopened, deselect Arcana, and select another Wizard skill.

Commit `452ff54` localizes duplicate skill names and adds an actionable recovery hint tied to the selectable source. This exact case now says: `Навык «Магия» уже получен … Вернитесь к этапу «Класс» и выберите другое владение.` Fixed duplicates still remain warnings, while user-resolvable duplicates remain errors. The complete character-rule suite passed **50/50** with 111ms of test execution; targeted lint and full TypeScript passed. The commit is pushed to the feature branch and `main`.

The Mage Armor production failure was also reconfirmed on the retained Dragonborn: clicking a controlled self-target returned raw `TargetNotWilling` without spending action or slot. This is already fixed by pushed commit `ee91720`, whose integration test supplies consent for controlled self/ally targets while leaving uncontrolled targets fail-closed. It remains a deployment retest, not a new implementation gap.

### Checklist and deployment state

The accepted workbook now contains **772 rows: 32 Passed / 20 Needs retest / 0 Failed / 720 Not tested**. `Spells!47` contains the retained Human Wizard ID and one threaded evidence comment. All five tabs were rerendered, the Spells tab was visually inspected, the exported workbook was freshly re-imported, and no formula errors were found.

No Timecloud deployment or cleanup was attempted. The host remains at the previously measured unsafe capacity: 101 release directories use about 21.4GB and leave roughly 1,062,404 KiB free. No release, character, scene, or user asset was deleted.

### Timing and speed findings

The productive Magic Missile path was short: 0.638s to open, 0.713s to confirm its casting source, 0.785s to declare the target/allocation, and 0.625s to inspect the journal—**2.761s total**. Fresh Forge creation took about **24.7s** of measured navigation and interaction, including 4.411s for the final create/save response. The first journal-focused tests took 10.66s, but TypeScript determined that gate at about **85.7s**. The clean production build then took about **143.1s** end to end even though Vite itself reported 55.01s; repeated TypeScript work dominated the difference. The all-tab workbook edit/render/export took about **66.9s**, re-import verification 7.7s, and visual review 0.1s. The Forge text-only fix then spent 3.31s on 50 tests but about **70.3s** on TypeScript.

The longest work was therefore static/build verification, not browser testing or debugging. The highest-value speedups are: keep one persistent incremental TypeScript process; postpone the single production build until the complete coherent source batch; let the build reuse an already successful typecheck instead of compiling twice; batch several workbook rows before all-tab rendering; and exclude immutable temporary builds from CodeGraph, whose two empty-result calls still consumed about 24.5s in this continuation.

## Mage Armor fresh-sheet continuation — 2026-08-31

The retained Human Wizard `356f2df5-2593-4b3d-a249-ebe72cbc42a5` completed Mage Armor on the production character sheet. A supported New Turn restored only the action. The target dialog selected the same Wizard with explicit `self` relation, distance 0, `willing=true`, scene facts, line of sight, and no cover. Confirmation spent exactly one action and the final level-1 slot: action `1/1→0/1`, slot `1/2→0/2`. AC changed from 11 to 14, exactly matching `13 + Dexterity +1`, and the effect persisted for 4,800 turns. Sheet use and mechanics pass.

The deployed active-effect list only displayed `Доспехи мага`, `4800 ходов`, and manual removal. It did not tell the recipient how AC was calculated, that the rules duration is eight hours, or that wearing armor ends the spell. This fails the user's “can the affected player understand it?” criterion even though the caster can reopen the spell card elsewhere.

Commit `dc38fc1` adds a shared, data-owned recipient explanation. It derives the AC method from canonical `set_value → ac_base`, converts the canonical 4,800-round duration to `8 часов`, and reads the `wearer_dons_armor` end trigger. Both the full sheet and combat sidebars now present: `КД: 13 + модификатор Ловкости. Срок: 8 часов. Эффект закончится, если вы наденете доспех.` The implementation is not keyed to the spell name. Focused engine and mounted-sidebar verification passed **13/13**, targeted lint passed, and full TypeScript passed. The commit is pushed to the feature branch and `main`.

`Spells!56` remains **Needs retest** because combat still awaits deployment of controlled-target consent commit `ee91720`, and the new recipient text must be observed in production. The row now contains both retained Drow and Human Wizard IDs and two threaded evidence entries. The workbook remains **32 Passed / 20 Needs retest / 0 Failed / 720 Not tested** across 772 rows; all five tabs were rerendered, fresh import verified the row/comments/counts, the Spells tab was visually inspected, and no formula errors were found.

Measured Mage Armor interaction took **4.575s** from new-turn preparation through cast commit, plus 0.2s for focused AC/effect inspection. The two focused tests ran in 3.35s with only 65ms of test execution, while TypeScript again set the critical path at about **72.6s**. Row discovery took 11.2s, the all-tab workbook edit/render/export about 61.0s, re-import 11.0s, and visual review 0.2s. This second single-row all-tab render was avoidable: Magic Missile and Mage Armor should have been held as one two-row workbook batch, which would have saved roughly one full 60-second render/export cycle while preserving the same final verification standard.

## Grease, Prestidigitation, Bardic Inspiration, and Command continuation — 2026-08-31

### Grease (`SPELL-0292`)

The retained Human Wizard `356f2df5-2593-4b3d-a249-ebe72cbc42a5` selected Grease on the production character sheet, targeted the built-in training dummy, supplied explicit enemy/distance/scene/line-of-sight/cover facts, and rolled 12 against DC 13. The deployed release then aborted with `The compatible character sheet cannot resume canonical pending resolution target_save`. The failure was atomic: action, slot, and free-use resources stayed unchanged, and no effect or journal entry was written.

The deployed release predates pushed commit `df0a5cc`, which resumes canonical target saves on the sheet. Commit `c46b4ed` additionally translates the fallback into a player-facing Russian explanation that the target save could not be completed and resources were not spent. Grease remains **Needs retest** until the current branch is deployed and both sheet and combat area/lifecycle behavior are confirmed.

### Prestidigitation (`prestidigitation`)

The same Wizard used the sensory-effect mode with `Запах корицы в воздухе`, distance 10 feet, and explicit scene facts. Sheet mechanics passed: action `1→0`, no slot, and the free-use resource remained unchanged. Result clarity failed because the persistent journal first named the created effect and then exposed internal object ID `sheet:1badba49:1:id:1` during instantaneous cleanup.

Commit `c46b4ed` correlates object creation and removal within the same canonical command, preserves the submitted name, and records `Фокусы: мгновенный эффект «Запах корицы в воздухе» завершён`. Raw internal IDs are no longer used as player-facing fallbacks. The exact production primitive has a regression test. Combat remains untested, so the row is **Needs retest**.

### Bardic Inspiration

The retained Bard `100eb271-ad36-4045-9aea-ef0d01a9e395` granted Bardic Inspiration to the retained Human Wizard from both the character sheet and combat. Each application spent exactly one bonus action and one inspiration charge. The combat application replaced the existing boon instead of duplicating it. The recipient could see `Талон 1к6 (Вдохновение барда)` in both the full sheet and the combat drawer.

The deployed use instructions were incomplete. Opening an eligible Strength save offered only the normal d20; no d6 was integrated into that dialog, while the effect merely said to add 1d6 and remove it. The current implementation intentionally uses a manual token rather than a second automatic-roll subsystem, so commit `c46b4ed` now states the real workflow: roll a separate d6, manually add it to an eligible check/attack/save, then click manual removal. The combat journal uses the same wording. Mechanics and visibility pass; the action remains **Needs retest** only for deployed wording/recipient confirmation.

### Command (`SPELL-0272`) — major mechanics and clarity finding

In the retained Human/Bard/Wolf scene, the Bard selected `Падай` and targeted the Wolf. The Wolf rolled natural 1 +1 Wisdom = 2 against DC 12 and failed. The Bard spent exactly one action and one level-1 slot. Initial save/resource mechanics therefore passed.

Production target clarity failed completely. The journal and Wolf inspector displayed only `действие`, with no selected word, instruction, or duration. Advancing the saved scene to the Wolf's turn exposed a deeper shared bug: Start Turn logged only `Начало хода`; the command was not consumed, Prone was not applied, and the commanded turn was not restricted. The scene is preserved on the unfinished Wolf turn.

Commit `c46b4ed` fixes both layers. Turn-command effects now receive stable Russian labels/instructions such as `Приказ: Падай` and `В начале следующего хода получите состояние «Сбит с ног», затем завершите ход`, with a next-turn duration. The previously isolated `resolveNextTurnCommand` function is now called by the actual rules-session Start Turn handler. `Падай` applies Prone and a temporary movement/action/bonus-action lock until the player ends that turn; the same end-turn restriction is applied to the other unconditional end-turn commands. Focused engine tests cover exact Command choice/presentation, and a rules-session integration test proves real Start Turn consumption, Prone, capability denial, events, and replay equality.

### Cross-cutting errors not limited to one entity

1. **A tested engine helper is not evidence that the website calls it.** Command's next-turn resolver had direct unit coverage but no production caller. Every lifecycle primitive needs at least one rules-session or browser vertical test through its real transition.
2. **Fallback names can become persisted UI.** The generic `действие` fallback was stored as an active-effect name. Persistent effects must derive their own stable label/instruction from the selected data, even if a caller omits action metadata.
3. **Manual mechanics must describe the manual workflow honestly.** Bardic Inspiration visibility was present, but the UI implied a die-add workflow without saying that the d6 is separate from the d20 dialog. Recipient tests must inspect the actual roll control, not only the effect card.
4. **Production-version drift can resemble a new regression.** Grease reproduced the same target-save continuation gap already fixed after the deployed release. Browser reports must record the release hash and compare it with the fix ancestry before duplicating implementation work.
5. **Instantaneous world effects still need durable human-readable outcomes.** Internal world-object IDs are useful for replay, never as caster/ally-facing journal content.

### Verification, checklist, and deployment state

Local verification passed: Command/effect focused checks **15/15** in 6.608s; the complete compiled spell semantics file **14/14** in 15.726s; the earlier sheet/error/primitive batches passed **19/19** and **28/28**; targeted lint passed; and the full production build passed TypeScript, 4,623 transformed modules, PWA generation, and the reviewed DiceBox invariant. Commit `c46b4ed` is pushed to both the feature branch and `main`.

The accepted workbook now contains **772 rows: 31 Passed / 24 Needs retest / 0 Failed / 717 Not tested**. Updated rows are `Spells!35` (Prestidigitation), `Spells!87` (Command), `Spells!96` (Grease), and `Classes!34` (Bardic Inspiration). Each contains retained character IDs and threaded evidence. Fresh re-import verified all four rows/comments/counts, the formula scan returned zero matches, all five tabs were rendered, and the changed Spells/Classes previews were visually inspected.

No Timecloud deployment was attempted. The last verified host state remains unsafe for another immutable release: 101 release directories use about 21.4GB and leave roughly 1,062,404 KiB free. No cleanup authority was given, so no release, character, scene, or user file was deleted. Production retests remain blocked on that capacity decision.

### Timing and speed findings

Product interaction stayed fast: Grease took about 8.0s, Prestidigitation 5.238s, the Bardic Inspiration sheet/recipient inspection about 13.4s, the Human/Bard/Wolf scene setup and three combat actions about 16.1s, and advancing to the live Wolf failure 2.093s. The longest single action was the full production build at about **123s**. Command-focused CodeGraph navigation took about **108.7s** across three calls; the broader Grease/version diagnosis earlier in the same batch consumed roughly another **175s** of low-signal graph calls. Test reruns totaled about **60.8s** because two compiled-fixture attempts used classes whose fixed roots did not contain Command; the final integration passed after seeding the already-validated command effect directly. Lint took 10.575s. The four-row workbook discovery/edit/render/export/re-import/visual-QA cycle took about **46.6s**.

The concrete speedups are: exclude immutable temporary builds from CodeGraph; query exact card IDs/error strings after the one required graph call; provide one reusable rules-session fixture that accepts a validated active effect without depending on a class's prepared-spell root; keep all browser exploration ahead of the single final build; and continue batching several checklist rows into one all-tab render/export.

## Prestidigitation combat continuation — 2026-08-31

The retained Dragonborn Wizard `89f8fefe-acf2-45bc-86e1-960d8cb49188` selected Prestidigitation in the retained combat scene on production release `afa3f6c30a96e29603a64d34ba09287610577b78`. The combat hover card passed the sheet-equivalence clarity check. Clicking an adjacent empty cell at 5 feet failed before declaration with `InvalidFacts: Prestidigitation requires one canonical option`. No option form appeared.

The failure was atomic. The Wizard remained the active actor at 3/9 HP, action stayed 1/1, level-1 slots stayed 2/2, and no spell-result journal entry was committed. The scene remains saved and unfinished.

The root cause was a combat-page integration gate that opened the shared world-input dialog only when `form === 'minor_illusion'`. Prestidigitation, Druidcraft, Mending, Dancing Lights, and the other already-supported world-input forms could therefore reach the engine without their canonical option/object declaration. Commit `396c0f8` removes the spell-specific gate, invokes the shared form for every world-input context, and binds the clicked tactical cell as authoritative board distance/revision/line-of-sight facts while preserving option-specific facts.

Verification passed: the first exact dialog/helper pass was **4/4**; targeted lint passed; the corrected production build passed TypeScript, 4,624 transformed modules, Vite, PWA generation, and DiceBox asset checks; the final world-input/solo-combat integration pass was **33/33**. Commit `396c0f8` is pushed to the feature branch and `main`.

`Spells!35` remains **Needs retest** and now contains both retained Wizard IDs plus two threaded evidence entries. Fresh workbook import reports **772 rows: 31 Passed / 24 Needs retest / 0 Failed / 717 Not tested**, zero formula errors, and the changed Spells preview was visually inspected. Production retest awaits a safe Timecloud deployment; no deployment or cleanup was attempted because the last verified host state still has 101 retained releases, about 21.4GB used, and roughly 1,062,404 KiB free.

Timing: the browser reproduction took **1.593s** (0.849s spell selection + 0.744s target click). Two CodeGraph calls took **27.670s** and were the largest diagnosis cost. The initial focused test took 4.744s; lint 3.166s. The first build spent **30.007s** before TypeScript exposed a union-narrowing issue in the new nested-option branch; splitting Druidcraft and Prestidigitation fixed it. The successful production build then took **52.208s**, the longest single action. The final 33-test pass took 5.206s. Staging/commit took 0.669s and both pushes completed in 4.378s critical time. Workbook edit/render/export took 8.688s, fresh verification 3.595s, and visual QA 0.1s.

The fastest next iteration is to let editor/type-aware feedback check discriminated unions before the full build, keep one production build per coherent source batch, and add a mounted page test that selects a non-Minor-Illusion world-input action. Excluding immutable builds from CodeGraph would also cut the 27.670s navigation cost; the decisive source change itself was one conditional plus a small typed board-fact adapter.

## Mage Hand additional retained-character evidence — 2026-08-31

The retained Dragonborn Wizard `89f8fefe-acf2-45bc-86e1-960d8cb49188` independently reproduced the earlier Mage Hand result on production release `afa3f6c30a96e29603a64d34ba09287610577b78`. In combat, the full hover card clearly described the 30-foot summon, one-minute duration, allowed object/door/container/vial interactions, 30-foot control movement, 10-pound limit, and forbidden attacks/magic-item activation. Casting on an adjacent empty cell spent action 1/1→0/1, spent no slot, created one 10-round effect, and persisted it to the full sheet. After the scene constructor restored the action, the deployed combat inspector still exposed only `Волшебная рука` and no control.

The full sheet then recast Mage Hand. It again spent exactly one action, no slot, retained one 10-round effect, and wrote effect/resource events. Its deployed active-effect row showed only the name, `10 ходов`, and manual removal. Thus both casting surfaces pass resource/effect persistence, while actual follow-up use and recipient clarity fail on the deployed release.

Git ancestry confirms that this is not a missing current-source implementation: production predates pushed commit `ac12285`, which already supplies the shared validated `Управлять рукой` dialog and readable world-interaction events in sheet and combat. No duplicate fix was added. A separate tactical-position question remains open: the abstract scene adapter validates declared distance/weight/movement, but the battle map does not display the hand's position. The row remains **Needs retest**, not Passed, until the deployed control flow is used successfully and the position-clarity expectation is decided or implemented end to end.

`Spells!7` now includes both retained Wizard IDs and three threaded evidence entries. Fresh workbook verification remains **772 rows: 31 Passed / 24 Needs retest / 0 Failed / 717 Not tested**, with zero formula errors; the changed Spells tab was rendered and visually inspected. No build or duplicate source gate was run for this evidence-only update.

Timing: combat select/cast/inspection took 0.646s + 0.557s + 0.288s. Opening the constructor and refreshing the caster took 0.616s + 0.879s. Sheet navigation/readiness took about 2.7s; action open/confirm took 0.299s + 0.564s. Three CodeGraph calls cost **43.359s**, the longest and mostly avoidable part, before exact history showed `ac12285` was already the correct post-release fix. Workbook row discovery took 3.531s, edit/render/export 8.287s, fresh verification 3.766s, and visual QA 0.1s. The immediate speedup is to compare production ancestry against prior entity commits immediately after reproduction, before opening a new architecture trace.

## Dedicated-combat versus character-sheet ledger divergence — 2026-08-31

The Mage Hand sheet pass exposed a cross-cutting runtime defect rather than another spell defect. The retained Dragonborn Wizard `89f8fefe-acf2-45bc-86e1-960d8cb49188` had an active dedicated combat scene. Casting Mage Hand from the full character sheet changed the sheet to action `0/1`; reloading the retained combat restored that scene's independent action `1/1`. Both surfaces could therefore accept mutations against different turn ledgers, allowing the same action economy to be spent twice and letting sheet-side effects diverge from the saved scene.

Commit `8732be3` makes the dedicated combat surface authoritative without changing online-encounter behavior. The active `solo_combat_v1` state now supplies one explicit player-facing lock to both classic and cockpit Action/Spells panels. Action availability is disabled, direct execution is guarded, and manual active-effect removal plus Mage Hand follow-up controls are locked. The existing `Вернуться в бой` link remains the route to the authoritative scene.

Verification passed: focused regression checks **4/4** in 5.321s, targeted lint in 3.008s, and the production build in 61.195s with TypeScript, 4,624 transformed modules, Vite, PWA generation, and the DiceBox asset invariants. Staging took 0.086s, commit 0.136s, and the two-ref push 2.910s. Commit `8732be3` is on both the feature branch and `main`.

The accepted workbook remains **772 rows: 31 Passed / 24 Needs retest / 0 Failed / 717 Not tested**, with zero formula errors. `Base Mechanics!7` stays **Needs retest**, now contains both the Bard and Dragonborn IDs, and records the split-ledger result plus fix commit. Detailed evidence was appended to the existing `Spells!L7` Mage Hand thread. The changed Base Mechanics tab was rendered and visually inspected. A library/export limitation dropped a newly created thread on the replaced Base cell; the concise evidence remains in that row, while the existing Mage Hand thread contains the full reproduction and a separate workbook-maintenance note. No entity result was promoted on local verification alone.

No Timecloud deployment was attempted. The last verified server state still has 101 retained release directories using about 21.4GB and only about 1,062,404 KiB free. Cleanup or retention changes have not been authorized, so production verification of the sheet lock remains blocked. No character, combat scene, release, or user asset was deleted.

Timing: the decisive combat reload took 1.016s; the required CodeGraph architecture check took 14.973s. Source inspection plus the guarded implementation occupied 63.560s elapsed, mostly reasoning around the correct ownership boundary rather than file mutation. Focused tests and lint totaled 8.329s; the 61.195s production build was the longest machine action. The workbook discovery itself took 3.352s, but comment-export diagnosis and recovery expanded the evidence cycle to about 1m56s. The key speedups are to add a mounted page regression for the authoritative-surface lock, keep one final build per coherent browser batch, and wrap spreadsheet comment edits in a tested helper that records exactly once and rejects unsupported new-thread round trips before overwriting the workbook.

## Shield (`SPELL-0317`) — reaction boundary, sheet visibility, and clarity — 2026-08-31

The retained Black Dragonborn Wizard “Тархун” `8060b4e5-fbd6-4c18-b371-32d52e12fdf1` was tested on production release `afa3f6c30a96e29603a64d34ba09287610577b78`. The character and its two-Goblin scene remain saved and unfinished.

The first proactive click found a UI/engine boundary defect. The ordinary combat hotbar showed `Щит I` as enabled even though its canonical activation mode is `reaction`. Clicking it failed atomically with raw `InvalidActionTiming: … can only be used in a reaction window`; reaction stayed 1/1, both slots stayed available, and no journal/state mutation committed. The hover card itself passed clarity: +5 AC, duration, attack/Magic Missile triggers, immunity, components, self target, reaction, and slot were visible.

The real reaction path passed. Tархун first used Dodge to make the retained low-HP scene safer, then ended the turn. A Goblin Minion rolled 11 with 13 discarded, +2 = 13 against AC 11. Combat paused before damage with `РЕАКЦИЯ / По вам попали`. Accepting Shield spent exactly one reaction and one level-1 slot, raised AC to 16, changed the triggering 13 into a miss, and preserved HP 7/9 for that attack. The journal named the effect and both costs. Shield expired at the correct start-of-next-turn boundary. A second Goblin then rolled 15 with 19 discarded, +2 = 17 against AC 16 and dealt 4; the retained scene is now active on Tархун's turn at 3/9 HP, slot 1/2, reaction restored 1/1. No scene was finished.

Two clarity defects remained. The reaction button displayed the internal payment key `Щит · spell_slot_1`, and the full character sheet omitted the known spell from both Actions and Spells, so the player could not inspect it before combat. Commit `bf04305` keeps reaction cards visible/hoverable but disabled in the ordinary hotbar with `Доступно только в окне реакции после подходящего события`; translates fallback timing failures without IDs; labels payment `Ячейка 1-го круга`; and shows a known reaction spell as a disabled inspectable card in the sheet's Spells section while keeping it out of proactive Actions.

Verification passed: final focused checks **23/23** in 5.850s, final targeted lint in 2.923s, and final TypeScript in 34.485s. An earlier full build in the same coherent Shield batch passed TypeScript, 4,624 transformed modules, Vite, PWA generation, and DiceBox checks in 91.562s before the last small sheet-presentation projection; the final projection then received the focused and TypeScript gates. Commit `bf04305` is pushed to the feature branch and `main`.

`Spells!102` is now **Needs retest** with the retained Tархун ID and a full threaded comment. The accepted workbook reports **772 rows: 31 Passed / 25 Needs retest / 0 Failed / 716 Not tested**. Fresh import verified the row, exactly one Shield comment, and zero formula errors; `shield-row.png` was visually inspected. The workbook library initially wrote the new comment twice because the recorded patch was applied a second time; a recoverable backup was made, the exact duplicate ID was removed, and fresh import plus package-level count both confirm one comment. Production UI retest and the separate Magic Missile trigger remain pending.

No Timecloud deployment was attempted. The last verified capacity state is still unsafe: 101 retained release directories, about 21.4GB used, and roughly 1,062,404 KiB free. No cleanup authority was provided, so no release, character, scene, or user file was deleted.

Timing: retained-character discovery was about 3.3s plus about 2.7s combat load; the proactive failure took 0.293s plus a 0.700s settle. The safe real-reaction sequence took 0.902s to open/check the constructor, 3.525s to Dodge/end/trigger, and 2.165s to accept and settle. The sheet load took 2.9s. Four CodeGraph calls totaled **68.354s** (28.595s + 12.669s + 11.016s + 16.074s). The longest single action was the 91.562s full build. Cold focused runs took 28.523s and 22.930s, while the warm final five-file run fell to 5.850s. Workbook discovery/edit/first verification took 3.495s + 6.094s + 3.420s; exact duplicate recovery took 0.216s, and final import/XML verification ran in parallel in 3.466s/0.084s. The largest speedups are to complete all three browser dimensions before the one final build, keep a warm Vitest worker/cache, reduce CodeGraph to one exact-symbol call after searching the stable spell ID, and never call `apply` after a comment mutation already executed inside `record`.

## Detect Magic (`detect_magic`) — missing combat continuation and result clarity — 2026-08-31

The retained Black Dragonborn Wizard “Тархун” `8060b4e5-fbd6-4c18-b371-32d52e12fdf1` cast Detect Magic in the saved two-Goblin scene on production release `afa3f6c30a96e29603a64d34ba09287610577b78`. The hover/detail card passed the information check: it explained the passive 30-foot sense, the later Magic action, visible aura and spell-school disclosure, material blockers, self target, concentration up to ten minutes, ritual tag, components, action, and level-1 slot.

Cast/resource mechanics passed. The cast took 1.266s, spent action 1/1→0/1 and the final level-1 slot 1/2→0/2, preserved HP 3/9 and the active turn, and did not finish the scene. Production result clarity failed: the journal only said `Обнаружение магии: см. описание заклинания`; opening the combat drawer 0.640s later said there were no active states/effects; and no concentration indicator, passive “magic present” result, or `Магия` follow-up action appeared. Character-sheet activation remains pending because the retained character is inside an active dedicated combat and the authoritative-surface lock intentionally prevents a second mutation path.

The canonical rules engine was not missing the mechanic. It already owned and tested `RevealMagicAura`, including exact-concentration validation, action payment, range/blocker/line-of-sight policy, replay-visible object observations, and spell-school disclosure. Dedicated combat simply had no adapter or UI caller. This is another vertical-integration test gap: isolated engine coverage did not prove that a website user could reach the mechanic.

Commit `441d6b9` fixes the complete combat path. While the exact Detect Magic concentration is active, the tactical map now shows the spell, its 30-foot radius, and whether board-positioned magical objects are sensed. `Проявить ауры · действие` is disabled without the main action and dispatches the canonical command using authoritative object/carrier positions and board revision. The combat journal names sensed objects, says whether the aura is visible, localizes the spell school, or explicitly says `магических аур не обнаружено`. No spell-name shortcut performs the resolution; the primitive identity selects the existing data-owned command.

Verification passed: the final adapter plus core command checks passed **2/2** in 5.141s, targeted lint in 4.101s, full TypeScript in 61.864s, and the bundler-only production gate in 94.357s with 4,624 transformed modules, Vite, PWA generation, and both DiceBox asset checks. Commit `441d6b9` is pushed to the feature branch and `main`.

`Spells!72` is **Needs retest** with the retained Tархун ID and exactly one threaded evidence comment. The accepted workbook now reports **772 rows: 31 Passed / 26 Needs retest / 0 Failed / 715 Not tested**. Fresh import verified the row/comment/counts and zero formula errors; `detect-magic-row.png` was visually inspected. Sheet activation and the fixed combat continuation remain deployment retests.

No Timecloud deployment or cleanup was attempted. The last verified capacity state remains unsafe: 101 retained release directories use about 21.4GB and leave roughly 1,062,404 KiB free. Cleanup has not been authorized, so no release, character, combat scene, or user asset was deleted.

Timing: Human-Wizard navigation/combat load/constructor refresh consumed 2.366s + 2.376s + 0.633s + 1.210s before confirming that character had not prepared the spell; the failed disabled-button attempt cost about 3.1s. Reusing Tархун then needed only 0.077s to confirm readiness, 1.266s to cast, and 0.640s to inspect the failed presentation. CodeGraph took 24.334s. Two package-manager wrapper mistakes wasted 9.407s + 2.647s before the direct local runner was used. A repository-root focused run imported 19 contexts and took about 27.29s, while the final frontend-local two-file gate took 5.141s. Running lint and TypeScript concurrently increased them to 38.959s/76.454s under contention; the final sequential values were 4.101s/61.864s. The 94.357s bundle was the longest single action. Workbook discovery/edit/render/export/re-import/visual QA took 5.423s + 8.651s + 5.646s + 0.1s. The highest-value speedups are a checked frontend-local test wrapper, direct reuse of installed executables, no parallel CPU-heavy gates on this host, one compiler/build gate per browser batch, and a mounted test proving that every canonical follow-up command has a reachable website control.

## Chill Touch (`chill_touch`) — combat mechanics and recipient clarity — 2026-08-31

The same retained Tархун scene was refreshed through the constructor, then used for Chill Touch without rebuilding or deleting anything. The full combat detail card passed: cantrip/necromancy, melee spell attack +5, 1d10 necrotic damage, healing prevention until the end of the caster's next turn, level scaling, touch, V/S, instantaneous duration, and action cost were all visible.

The combat execution passed on the first attempt. Tархун targeted an adjacent Goblin Minion at 5 feet, spent action 1/1→0/1 and no slot, rolled 12 +3 spellcasting +2 proficiency = 17 against AC 12, hit, rolled 1 necrotic damage, changed the target from 7/7 to 6/7 HP, and persisted one named Chill Touch effect. The scene remains active and unfinished with Tархун at 3/9 HP.

The deployed target-facing result failed the user's clarity criterion. Inspecting the Goblin displayed only `Леденящее прикосновение`; it did not say that healing is blocked or when the effect ends. Production predates the already-pushed generic source/duration rows, but current source still lacked the actual anti-healing instruction. Commit `90dfbcc` adds `Не может восстанавливать Хиты.` for any active modifier whose canonical shape is `op: deny` and `applies_to.roll: healing`. It is data-shape driven and does not branch on the spell name.

Verification passed: **4/4** focused checks in 3.594s cover the exact healing-denial payload, source-turn arm/expiry lifecycle, shared effect formatter, and mounted combat inspector. Targeted lint passed in 2.684s and TypeScript in 56.027s. The immediately preceding 94.357s production bundle already validated the same application graph before this isolated formatter/test change, so it was not repeated; the post-change focused/static gates are green. Commit `90dfbcc` is pushed to the feature branch and `main`.

`Spells!14` is **Needs retest** with the retained Tархун ID and exactly one threaded comment. The workbook now reports **772 rows: 31 Passed / 27 Needs retest / 0 Failed / 714 Not tested**; fresh import verified the row/comment/counts and zero formula errors, and `chill-touch-row.png` was visually inspected. Character-sheet activation, a browser healing attempt, and the deployed explanation/expiry remain pending.

The cross-cutting finding is the same pattern seen in Bardic Inspiration and Mage Armor: an effect title proves visibility, not comprehension. Every persistent payload kind needs a recipient-facing sentence and duration at the inspection point, with mounted tests for the actual serialized payload shape.

Timing: close/open/refresh/close scene controls took 0.338s + 0.311s + 0.325s + 0.324s; selecting the spell/details took 0.667s, cast resolution 1.044s, and target inspection 0.627s. The useful browser path was about **3.636s**. CodeGraph took 21.753s and again returned stale immutable-build copies before exact current-source reads. Focused test loops took 3.231s then 3.594s; lint 2.684s; TypeScript 56.027s; commit 0.295s; two-ref push 6.311s. Workbook discovery/edit/render/export/re-import/visual QA took 5.412s + 9.800s + 6.906s + 0.1s. The largest speedup remains excluding immutable builds from CodeGraph; the second is keeping the actual browser → formatter → four-test loop under ten seconds and deferring the expensive compiler to the end of a small entity cluster.

## Timecloud retention and fresh current-release spell verification — 2026-08-31

### Timecloud cleanup and permanent five-release policy

The authorized cleanup is complete. Before cleanup, Timecloud had **102 release directories**, **252 build entries**, **88 application SHA image tags**, about **21GB** under builds, and only **1.1GB free** with the filesystem **98% used**. The active release and newest five candidates were identified before any deletion.

The server runner now enforces retention on every deployment. It always protects the active release and the incoming SHA, reduces runnable history to four before a new build, and retains exactly five after public health and exact release-identity verification. Cleanup is limited to the matching immutable release directory, extracted build, tar archive, deploy logs/scripts, and the exact backend/frontend SHA tags. An isolated seven-release fixture proved that even an oldest active release and the incoming archive remain protected.

The initial deployment exposed a production-shaped migration defect and automatically rolled back. Migration 121 scanned a nullable SQL comparison into a Go `bool` when a weapon profile was absent. Commit `f53d214` wraps that comparison in `COALESCE(..., false)`, and the rollback path now uses non-TTY diagnostics and removes only the failed SHA's build artifacts after health restoration. The database backup was retained.

Production is now on `79c80ce00c565b4d6e9bbeaa17b8d540e6228d02`. Timecloud contains exactly **five release directories, five SHA build directories, five SHA tar archives, five backend SHA tags, and five frontend SHA tags**. Disk usage fell to **59% used with about 20GB free**. The oldest sixth release was automatically removed during the final deployment, demonstrating that the policy is active rather than a one-time cleanup.

### Retained fresh character and scene

A new Forge-created Human Wizard was retained:

- Name: `QA-MMVP-Human-Wizard-Fresh-20260831`
- Character ID: `6b474575-3eae-46b4-815f-d27ee696cf9c`
- Build: Human Wizard 1, Sage; Magic Initiate (Wizard) supplied Chill Touch, Ray of Frost, and Find Familiar.

The fresh Goblin combat was completed with Magic Missile after the three target tests so the sheet could be unlocked. The character and completed combat journal remain available; no character was deleted. The older Tархун scene also remains available and demonstrates the stale-scene finding below.

### Detect Magic — Passed

**Sheet usage:** PASS. Ritual casting spent the action but left level-1 slots at `2/2`. The initially deployed sheet did not expose active canonical concentration. Commit `79c80ce` now derives the display from the authoritative saved canonical world. Production visibly states `Концентрация: Обнаружение магии` and tells the user to return to the battlefield to reveal auras.

**Combat usage:** PASS in a fresh current-version scene. The cast spent action `1→0` and slots `2→1`, displayed `Концентрация · 30 фт. · магия не ощущается`, survived scene-constructor resource refresh, enabled `Проявить ауры · действие`, spent the refreshed action, and journaled `магических аур не обнаружено`.

**Result clarity:** PASS. Both surfaces expose the active state and next usable step; combat explicitly reports the negative scan result.

### Chill Touch — Passed

**Sheet usage:** PASS. The sheet opened an explicit target/facts dialog for the training target at 5 feet, used visible dice, spent one action and no slot, recorded a critical hit against AC 10, and recorded the applied effect.

**Combat usage:** PASS. The fresh scene rolled `18 +3 +2 = 23` against AC 12, dealt 1 necrotic damage, and applied the anti-healing effect.

**Result clarity:** PASS. The Goblin inspector names the source and duration and explicitly says `Не может восстанавливать Хиты.`

### Ray of Frost — Passed

**Sheet usage:** PASS. The explicit target/facts flow recorded one visible miss and then a retained successful retry, `16 +3 +2 = 21` against AC 10, with one action spent, no slot, and the speed effect recorded.

**Combat usage:** PASS. The fresh scene rolled `15 +3 +2 = 20` against AC 12, dealt 1 cold damage, and applied the slow. Earlier retained evidence already proves next-turn expiry and speed restoration.

**Result clarity:** PASS. The target inspector shows source, expiry, and `Скорость: -10 фт.`

### Cross-cutting findings

1. **Saved combats retain a release-specific compiled action catalog.** The old Tархун scene did not acquire newer Detect Magic/Chill Touch contracts after deployment, while the fresh scene passed immediately. Saved scenes need an explicit catalog version plus an upgrade/recompile path, or a visible “older release” label.
2. **Canonical sheet concentration was mechanically saved but not presented.** Legacy concentration chips and canonical world concentration are separate storage paths. Commit `79c80ce` now presents the authoritative canonical record without fabricating a legacy effect.
3. **Production-shaped migration data must be tested before cutover.** Migration 121's nullable comparison passed ordinary focused assumptions but failed on a real absent JSON field. A pre-cutover migration/startup gate against a recent sanitized production-shaped snapshot would have prevented the 247-second failed deployment.
4. **Sheet actions correctly lock during active dedicated combat.** The lock prevented another split action ledger. Manual sheet testing should either use an idle retained character or finish the dedicated scene; it should not treat the lock as a spell failure.

### Checklist and timing result

The accepted workbook now reports **772 rows: 33 Passed / 25 Needs retest / 0 Failed / 714 Not tested**. `Spells!14`, `Spells!15`, and `Spells!72` contain the fresh retained character ID and two threaded evidence entries each. Fresh import verified the three rows/comment counts and found zero formula-error matches. All five tabs were rendered before and after the edit and visually inspected.

The longest action was the first failed deployment and rollback at **247s**. The successful retention recovery deployment took **119s**; the final UI deployment took **125.281s**, including a **40.44s** Vite build. In contrast, the useful fresh combat checks took about **0.7s** for the Detect Magic follow-up, **2.942s** for Chill Touch, and about **2.1s** for Ray of Frost. The highest-value speedups are therefore: preflight migrations against production-shaped data, install BuildKit/buildx with persistent caches, skip unaffected backend/frontend image builds, batch adjacent entity fixes into one typecheck/deployment, version saved combat catalogs, and render only changed workbook crops during the test loop before one final all-tab QA pass.

## Base Mechanics — production manual pass — 2026-08-31

The Base Mechanics tab is now fully triaged in the requested three dimensions. Its 44 rows resolve to **24 Passed / 20 Needs retest / 0 Failed / 0 Not tested / 0 Blocked**. “Needs retest” is used where sheet presentation is clear but the relevant combat consequence was not exercised, or where a duplicate/uncertified catalog entity is not independently addressable. It does not disguise a failed result as a pass.

### Production fixes found by the pass

1. **Incapacitated did not reliably terminate saved concentration.** On retained Human Wizard `6b474575-3eae-46b4-815f-d27ee696cf9c`, Detect Magic could survive the manual Incapacitated condition across reload. Commit `68c4c18` now derives the denial from canonical capabilities and atomically clears self concentration plus its effect. Production retest passed before and after reload.
2. **Shove journaled movement without moving the tactical token.** On retained Fighter `84e8c110-bbba-41be-85ef-9165c376d746`, Goblin failed the save but stayed in its original square. Commit `ca40a0d` projects canonical `ShoveApplied(push_5ft)` into one-square forced movement. Production retest moved the Goblin from 7,8 to 7,7, exactly away from the Fighter at 7,9, and reload retained 7,7.
3. **Sheet HP changes did not update an active solo-combat copy.** Five temporary HP granted from the sheet were absent from the active fight, so incoming damage reduced normal HP. Commit `ca40a0d` synchronizes HP/max/temp/resources/effects into `solo_combat_v1` with revision/CAS updates. Production retest applied five temporary HP, then a six-damage Wolf Bite reduced normal HP only 4→3.
4. **Temporary HP was mechanically present but invisible in the combat hotbar.** Commit `6d4acef` adds `HP current/max · Врем. HP +N`; focused 2/2 tests, lint, and full TypeScript passed. The exact commit is deployed through Timecloud.

### Passed coverage

Action economy passed for main action, bonus action, and triggered reaction. Canonical melee, ranged, offhand, unarmed, Dash, Disengage, Dodge, Help, Shove, Goblin Scimitar/Dagger, and Wolf Bite all passed their relevant sheet/combat/clarity dimensions. Initiative ordering, movement budget, attack-vs-AC, save-vs-DC, resource refresh, spell slots, and damage/healing/temporary-HP ordering passed. Incapacitated and Poisoned passed as conditions with combat consequences and recipient-facing explanation.

Notable clarity evidence includes the two-weapon eligibility rejection, explicit range maximum, full attack/save arithmetic, Help token instructions on the ally, Stone Endurance damage reduction, Shove distance, condition source requirements, condition duration/source in target inspection, and explicit negative Detect Magic result.

### Needs-retest coverage and cross-cutting findings

- Four legacy action rows are shadowed by canonical visible actions: `action_offhand_attack`, `action_melee_attack`, `action_unarmed_strike`, and `action_dodge`. Their canonical counterparts passed, but the duplicate entities cannot honestly be marked passed until catalog routing is deduplicated or the legacy IDs become directly selectable.
- Divine Inspiration `ACTION-0005` is hidden until “show uncertified entities” is enabled. Its full description is clear, but attaching it to retained Bard `100eb271-ad36-4045-9aea-ef0d01a9e395` stalled the website request twice; consumption and forced-natural-20 behavior remain pending.
- Thirteen condition rows have clear sheet cards, including required source-ID guidance for Frightened/Charmed/Grappled, but their complete combat consequence matrices remain pending. Poisoned and Incapacitated are the two fully passed condition rows in this checkpoint.
- Concentration start/display/refresh and Incapacitated termination pass, but a retained browser proof of the damage-triggered concentration save is still required.
- Positive and negative range checks pass. A negative line-of-sight check remains pending because the tactical test board currently has no obstacle/occlusion constructor.

### Evidence, retention, and deployment

The retained Fighter combat remains unfinished and contains the original failed Shove plus the fixed Shove, temporary-HP absorption, monster attacks, Stone Endurance, Second Wind, and action-economy journal. The retained Wizard keeps Incapacitated applied with concentration absent after reload. The Bard and all other test characters remain available; nothing was deleted.

The accepted workbook was exported, freshly re-imported, and checked for formula-error tokens. Every Base Mechanics row now has a detailed threaded cell comment in addition to the visible Test notes column. All five tabs rendered cleanly. Production backend, frontend, and active release symlink all report `6d4acef622f27bb00acf51ac55f3ea1052930500`; the automated Timecloud policy retains exactly five releases. A final production browser retest granted five temporary HP on the sheet and the combat hotbar visibly displayed `HP 3/12 · Врем. HP +5`.

### Duration and speed analysis

The useful browser interactions were short: the fixed Shove sequence plus reload was about 3.6s; temporary-HP grant/return/attack/verification was about 6s of page interaction; the Incapacitated production retest was about 3.4s. Focused regressions took 2.9–9.0s per cluster and the final hotbar test took 5.30s.

The longest work was release/static machinery. Full TypeScript checks repeatedly took roughly 50–65s; each cached Timecloud runner took about two minutes and rebuilt Vite for 39.72–41.09s; the final archive transfer was delayed by SSH resets and one unbounded upload had to be interrupted before the bounded retry completed. Spreadsheet work took 12.06s for one failed overlarge all-sheet render, 10.56s for the corrected edit/render/export, 7.9s for fresh-import verification, and under a second for visual review.

The fastest next iteration is: (1) finish a coherent browser cluster before the one TypeScript/deploy gate, (2) keep direct local focused tests as the edit loop, (3) add mounted regressions for sheet↔solo runtime ownership, Shove token position, temporary-HP display, and damage concentration saves, (4) add obstacle placement/LoS presets and deterministic roll controls to the scene constructor, and (5) make the release uploader bounded/resumable while promoting a previously verified frontend artifact instead of compiling it again on Timecloud.
## Base Mechanics retest, Fighting Styles, and Origin Feats — 2026-08-31

Production release `4325ee2b1ee6d1067faec87514ef504c0867b3d3` was deployed and verified on both frontend and backend through Timecloud. The uncertified-entity confirmation dialog is gone: the existing opt-in checkbox remains, and both certified and uncertified entities now attach directly. The retained test characters and scenes were not deleted.

### Base Mechanics retest

The Base Mechanics tab remains **24 Passed / 20 Needs retest / 0 Failed**. Movement rejected an unreachable destination, allowed exactly 30 feet, reduced the budget to zero, and persisted. Scene-constructor resource refresh restored the canonical maximum without stale-revision or inventory errors. The uncertified `Божественное вдохновение` action now attaches without a dialog, but still cannot pass combat: its attached action has `mechanics=null` and no usable resource contract. Damage-triggered concentration saves and negative line-of-sight remain pending because the current board cannot construct those scenarios.

The retest found and fixed a cross-cutting combat defect: a combat actor was using fallback AC instead of the same equipment/passive calculation as the character sheet. Chain mail plus the Defense Fighting Style displayed AC 17 on the sheet but the first retained Goblin attack resolved against AC 11. Commit `4325ee2` introduced one shared sheet/combat AC resolver; after deployment, the next retained Goblin attack resolved against AC 17.

### Fighting Styles

The 20 Fighting Style rows now contain **10 Passed / 10 Needs retest** results.

- **Passed:** Dueling, Defense, Unarmed Fighting, Great Weapon Fighting, and Archery, including both chassis and effect rows. Live evidence includes Dueling's +2 damage, Defense's AC 17 in combat, Unarmed d8/d6 plus grapple-start damage, Great Weapon dice 2/4 transformed to 3/4, and Archery's explicit +2 attack bonus.
- **Needs retest:** Protection and Interception lack executable reaction payloads/scenarios; Blind Fighting is visible as 10-foot blindsight but the board has no invisible-target preset; Two-Weapon Fighting exposes the correct off-hand card and two equipped daggers but did not produce a reliable completed modifier-damage journal event; Thrown Weapon Fighting's live qualifying attack missed, so its +2 damage branch was not reached.

The same release fixes Great Weapon result clarity. The engine applied the minimum-die rule, but the persisted journal previously kept the original contradictory expression. Commit `4325ee2` rebuilds the readable breakdown from transformed dice; the focused regression verifies `к6: 3, 4`.

### Origin Feats

The 28 Origin Feat rows now contain **6 Passed / 4 Failed / 18 Needs retest** results.

- **Passed:** Tough, Skilled, and Magic Initiate, including their linked effects. Tough changed a level-1 character from 10 to 12 maximum HP in sheet and combat; Skilled exposed three exact proficiency sources and roll breakdowns; Magic Initiate retained its choices and correctly used/restored the dedicated free-cast resource.
- **Failed:** both Lucky actions and both Savage Attacker rows. Lucky spent a point but only emitted narrative text; the following attack rolled one d20, so advantage was not carried into the roll, while disadvantage is not bound to an incoming-attack reaction. Savage Attacker kept a live weapon damage die of 1 and offered neither the second roll nor an either-result choice.
- **Needs retest/partial:** Alert correctly adds proficiency to initiative (`19+4=23` on the retained character), but initiative swap is absent and the summary is vague. Brawler, Healer, and Musician are readable but mostly narrative or lack the required execution surface. Crafter has no shop/crafting workflow. All partial rows state exactly which of sheet, combat, and clarity passed or remained unavailable.

### Cross-cutting findings

1. Simple feat/style attachment takes about **15–16 seconds per item**. Adding twelve entities to one retained character cost roughly three minutes of waiting even though the visible mutation is small.
2. A retained character with an owned inventory reference to missing card `cb6650a8-489f-4edb-a4f3-77e32f8c2317` cannot create a combat scene and receives `Карточка не найдена`. The character `a290b7cd-16b9-4e08-86aa-5544060825a7` is retained for reproduction.
3. Several effects are catalogued and understandable but have an empty or narrative-only mechanics payload. Visibility is not functional support; Lucky, Protection, Interception, Musician's song, and Crafter demonstrate that gap.
4. Some journal source labels remain English (`Fighting Style: Archery`, `Fighting Style: Two-Weapon Fighting`) in an otherwise Russian UI.
5. The scene constructor materially speeds retesting by adding participants and refreshing resources without deleting the retained scene, but deterministic dice, reaction presets, invisible targets, obstacles/line-of-sight, and concentration-damage presets are still needed.

The accepted workbook was re-exported after updating all 48 Feat rows, re-imported successfully, and checked with zero formula errors. Every changed entity row includes the retained character ID(s) and a cell comment covering sheet use, combat use, and result clarity.

## Final approval — Base Mechanics, Fighting Styles, and Origin Feats — 2026-08-31

This section supersedes the interim status sections above. All three requested categories are now fully supported and approved on production release `aeba081fdeee20175cc540a3fadaae998550efad`:

- **Base Mechanics:** 44/44 checklist rows Passed, 0 Failed, 0 Needs retest, 0 Not tested, 0 Blocked.
- **Fighting Styles:** 20/20 linked chassis/effect rows Passed.
- **Origin Feats:** 28/28 linked chassis/action/effect rows Passed.
- **Production support catalog:** 10 basic actions, 12 origin feats, 10 fighting styles, and all linked entities resolve to 65 `verified_mechanical` records. The final idempotent dry run found `records_needing_update: 0` with evidence hash `sha256:87ad073a734ae38828852719d2d8e034594207e78040154302781a45bc6eb135`.

### Final live evidence

- **Divine Inspiration:** retained source `81dbcb30-7c37-487d-a8b8-24464b7884ab` granted the effect to retained ally `303cc394-3641-4b70-bcad-ce8843ab5808`. The ally's next d20 resolved as natural 11 + 9 = 20, the effect was consumed, and the journal explicitly reported its removal.
- **Musician:** a short rest restored the feature charge, the source selected the retained ally, and Heroic Inspiration survived a fresh recipient reload. The ally then used it; the resource changed to 0/1 and the journal explained that the new reroll result must be used.
- **Crafter — temporary item:** the in-play choice created a torch, consumed the feature charge, added the item, and displayed the localized expiry `до долгого отдыха`.
- **Crafter — shop discount:** production shop `bfbfa7be-a993-4239-ac93-87fb484113b5` displayed a nonmagical item's 10 ЗМ price as 8 ЗМ with `Самоделкин −20%`. Purchase changed the retained character's wallet 35→27 and confirmed `скидка 20%, уплачено 8 ЗМ`.
- **Alert:** retained combat `9c20d86b-8c88-42be-8839-e3e3ad00853f` exposed the initiative-swap modal, selected an ally, updated order, and journaled the result.
- **Interception:** the same retained character reduced 3 incoming damage to 0 using `1к10 (3) + БМ 2 = 5`; reaction use and calculation were visible.
- **Protection:** retained character `90487c88-6fd0-4b5c-a76e-507b2dcdd271` met the shield/adjacent-ally requirements, imposed disadvantage on the incoming attack, consumed the reaction, and showed both d20s.
- **Conditions and shared mechanics:** the complete 2024 condition integration matrix passed, with representative production checks for Poisoned, Incapacitated, target inspection, action economy, HP/temp HP, initiative, rests, concentration, spell slots, range, and line of sight.

All testing characters and combats remain available. No testing character was deleted.

### Bugs fixed in this approval batch

1. Cross-character action persistence omitted `resources` and `max_resources`, so Musician could appear to grant Heroic Inspiration while the recipient did not retain it.
2. Automatic resource reconciliation removed universally granted Heroic Inspiration when the recipient sheet reloaded.
3. Sheet d20 rolls used next-roll modifiers mathematically but did not consume and persist their effect lifecycle.
4. Crafter's temporary-item choice lacked the in-play choice context and therefore could not complete through the sheet workflow.
5. The shop ignored the data-driven `nonmagical_purchase_price` modifier. It now calculates affordability and payment from the discounted value, excludes explicitly magical items, and explains the discount.
6. Raw implementation labels such as `uses_*` and `long_rest` leaked into player-facing journals/effect expiry. They now render as readable Russian labels.
7. Legacy duplicate actions remain supported as compatibility aliases but are hidden; the player sees one canonical action rather than duplicate buttons.

### Verification and artifact quality

Focused regression suites passed throughout the four final releases, including 42-test, 23-test, 304-test, and final 4-test checkpoints. Targeted lint and full TypeScript checks passed after each material code batch. The final workbook was exported, freshly re-imported, and verified as **48/48 Passed with 48/48 `verified_mechanical` Feat rows** and **44/44 Passed Base Mechanics rows**. Formula-error search returned zero matches. All five tabs were rendered and visually inspected; unchanged Classes, Species, and Spells data remained intact.

Timecloud now serves exact SHA `aeba081fdeee20175cc540a3fadaae998550efad`. The automated retention policy keeps exactly five runnable releases. This deployment removed the old `d180c82…` release/build/archive/image artifacts from the host; they are not recoverable in-place but remain reproducible from Git.

## Species, classes, and weapon masteries checkpoint — 2026-09-01

This checkpoint evaluates level-1 class/species contracts only. Cantrip and spell rows were not changed or re-rated: the Spells tab remains exactly **5 Passed / 14 Needs retest / 79 Not tested**.

### Production defects fixed

1. A fresh retained Forest Gnome Druid could be created and opened on the character sheet, but combat setup failed with `levelled spell grant requires an explicit access label`. The Forest Gnome's level-1 Speak with Animals grant now declares `always_prepared` while retaining its proficiency-bonus free-use pool and ordinary slot access.
2. Aasimar Healing Hands used the noncanonical `prof d4` formula. It now uses `prof_bonus d4`, matching the feature's proficiency-bonus number of d4s.
3. The production weapon catalog had no strict weapon profiles reaching Cleave or Push. Greataxe now binds Cleave and Greatclub binds Push through immutable weapon profiles. Production now exposes **25 strict weapon bindings covering all eight masteries**.

The species repair shipped on Timecloud release `59b0927bd582250b9fea98ea5d7c17758bf620e3`; backend, frontend, and the public build identity all match. The content postimage contains `always_prepared` and `prof_bonus d4`. Exactly five runnable releases remain.

### Species and class evidence

- The production species matrix passed **1,612 builds**: every one of 31 valid species/lineage combinations with all 13 catalog classes at levels 1, 3, 5, and 20. It checks link integrity, choices, passive resistances/senses/speeds/resources/modifiers, and executes every racial action. This is strong shared-engine evidence, but it does not replace the requested retained browser proof for each individual lineage.
- The production Forge sweep passed, and 30 focused class acceptance scenarios passed across Fighter, Wizard, Rogue, Cleric, Sorcerer, Warlock, Druid, Bard, Paladin, and Ranger contracts. Separate Rage, AC, equipment, and damage suites passed 66 tests. Barbarian and Monk remain `Needs retest` in the checklist because their dedicated retained production-browser activation/recipient-clarity passes are still absent.
- Retained Forest Gnome Druid `54b1ccd2-83f6-439e-bd85-1725bb713810` proves the repaired vertical path. The sheet exposes Darkvision, Gnome Cunning, Druid resources, Spellcasting, and Primal Order. After deployment the same character opens a real Goblin combat, shows its free-use pool as `2/2`, and selecting that resource filters the hotbar to Speak with Animals alone; the tooltip names the spell and count.
- Existing retained Bard/Aasimar, Fighter/Goliath, Wizard, and Dwarf characters supply the prior browser evidence reused in the corresponding rows. No character or scene was deleted.

### Weapon mastery verification

All eight mastery primitives pass the mandatory engine suite: **33/33 scenarios** for Cleave, Graze, Nick, Push, Sap, Slow, Topple, and Vex. The post-deploy catalog audit found 25/25 resolvable strict weapon profiles and zero unresolved mastery references. Live combat additionally demonstrates Vex lifecycle/expiry and clear ranged-disadvantage, attack, ammunition, and journal presentation on the retained Fighter. Cleave and Push are now reachable from Greataxe and Greatclub respectively; repeated random live-hit demonstrations for every individual weapon remain unnecessary because the same authoritative mastery action is shared by every audited binding.

### Checklist result and honest limitations

The accepted workbook now contains **182 Passed / 176 Needs retest / 0 Failed / 0 Blocked / 414 Not tested** across 772 rows. Classes are **47 Passed / 10 Needs retest / 319 Not tested**; Species are **38 Passed / 152 Needs retest / 16 Not tested**. Higher-level class rows remain inventory-only. Species rows with automated engine evidence but no dedicated retained browser proof are intentionally `Needs retest`, not falsely promoted.

Fresh import verified all five tabs and found zero formula-error tokens. Classes and Species were the only edited tabs; Spells, Feats, and Base Mechanics rendered unchanged.

## Final class/species approval and cantrip retest checkpoint — 2026-09-01

This section supersedes the interim class/species counts above. The level-1 approval gate is now clean:

- **Classes:** 57/57 in-scope rows Passed; 0 Failed, Needs retest, or Blocked.
- **Species:** 189/189 in-scope rows Passed; 0 Failed, Needs retest, or Blocked.
- **Exact support roots:** 46/46 class/species roots certified.
- **Weapon masteries:** all eight masteries passed their mandatory runtime scenarios, with 25/25 strict production weapon profiles resolvable.

All relevant sheet, combat, and observer-clarity evidence is recorded in the accepted workbook with retained character IDs. Higher-level inventory rows remain outside this level-1 mini-MVP gate. No testing character or scene was deleted.

### First cantrip batch — six production retests approved

The cantrip phase started only after the class/species gate became clean. The following six prior `Needs retest` rows are now **Passed** on exact Timecloud release `a14996f6d006a51792e37819dfa8b2d32b938b0f`:

1. **Mage Hand:** the sheet exposes slot-free access, source, duration, and control. Combat spent one Action/no slot, created a 10-round hand, and its follow-up moved retained object `тестовый рычаг` 5 ft. The actor drawer and localized journal identify the source, duration, object, and operation.
2. **Minor Illusion:** the submitted sound `Звон стеклянного колокольчика` appears on the map and in the journal together with 10-round duration and Investigation DC 13, and survives reload.
3. **Fire Bolt:** the sheet/combat card shows 1d10 fire and correct 2d10/3d10/4d10 scaling. Combat spends one Action/no slot and clearly journals attack, damage, target, and resources.
4. **Dancing Lights:** four supplied placements create four lights with dim light 10 ft., concentration, and 10-round duration. The follow-up moves them to cell 7,7, spends exactly one Bonus Action, and remains understandable after reload.
5. **Light:** casting on new object `медный жетон` spends one Action/no slot and creates bright light 20 ft. plus dim light another 20 ft. for 600 rounds. Object, position, ranges, duration, and journal survive reload.
6. **Prestidigitation:** the shared form exposes all six choices. The sensory effect `Запах хвои и искры` spends one Action/no slot, is named in the localized journal, and survives reload.

Together with the three previously approved cantrips (Chill Touch, Ray of Frost, and Poison Spray), the cantrip checklist is now **9/34 Passed, 25/34 Not tested, 0 Failed, 0 Needs retest, 0 Blocked**. This is a checkpoint, not a claim that cantrip testing is complete.

### Bugs fixed while validating this batch

1. Prestidigitation, Light, and Dancing Lights could reach combat without preserving their submitted world-interaction facts. The combat adapter now passes the shared form payload and staged scenario objects atomically into execution.
2. World-domain cantrips could incorrectly invent an actor target. They now preserve world/object targeting and commit staged objects only after a successful action.
3. Prestidigitation and Light lacked sufficient localized result summaries; their selected effect/object, illumination, ranges, and duration are now visible in the journal.
4. Dancing Lights overwrote the player's four placements with one fallback light. It now preserves all supplied placements and the bonus-action movement contract.
5. A long retained Bard combat could not save Light because persisted `turn_state` exceeded the backend JSON bound. The root cause was repeated inline base64 card art inside combat presentation snapshots. A production-shaped snapshot measured **1,272,010 bytes** before the repair and **338,446 bytes** afterward. Persistence now strips only inline presentation art; current character/card sources rehydrate it for rendering, so hover information and mechanics remain intact.

The failed oversized-save attempts were atomic: no Action, object, or journal residue remained. The final focused suite passed **36/36**, targeted lint and full TypeScript checks were clean, and the exact release is active in backend, frontend, and public build identity. Timecloud retains exactly five releases, build trees, archives, backend images, and frontend images.

### Checklist verification

The accepted workbook was updated using the spreadsheet artifact workflow. Each of the six rows contains the retained character ID(s), a full sheet/combat/clarity note, and a threaded cell comment authored as `Alexey Romanovich Wilhelm`. A fresh import verified the six Passed rows and comments, found zero formula-error values, and all five tabs rendered without layout corruption.

## Final classes, species, and cantrips confirmation — 2026-09-01

This section supersedes the earlier 9/34 cantrip checkpoint.

- **Classes:** 57/57 level-1 rows Passed. The 319 later-level inventory rows remain explicitly outside the level-1 mini-MVP scope and were not re-labelled as failures.
- **Species:** 189/189 level-1 rows Passed. The 17 later-level inventory rows remain explicitly outside scope.
- **Weapon masteries:** 8/8 masteries and 25/25 strict weapon profiles confirmed.
- **Cantrips:** **35/35 Passed**, including the previously missing workbook row for Astral Dash. Every row now has retained character IDs and separate evidence for sheet/world usage, combat usage, and result clarity where relevant.
- **Catalog visibility:** 35/35 cantrips now have valid verified support. Nineteen stronger existing certificates were preserved byte-for-byte; the other 16 rows were promoted in one atomic exact-preimage transaction. The default Forge catalog therefore no longer needs the uncertified-entity confirmation for any cantrip in this denominator.

No retained character or combat scene was deleted or completed.

### Major defects found and fixed in the final cantrip pass

1. **Astral Dash could execute without asking for a map destination.** Self-shaped actions were treated as immediate, so the engine never received `worldPosition`. Combat now keeps any declarative teleport in map-targeting mode, validates the chosen free cell/range, moves the token, increments the board revision, and records the actual distance. Automatic discovery of every creature intersecting the line remains an explicit `verified_partial` limitation rather than a hidden claim.
2. **Recipient effects were mechanically present but not understandable.** Guidance now tells the recipient the selected skill and `1к4`; Resistance names the selected damage type, `1к4`, and once-per-turn limit; Vicious Mockery explains next-attack disadvantage and consumption; Thaumaturgy names the advantaged Intimidation check.
3. **World-action journals leaked implementation identifiers.** Elementalism operations and related world operations are localized; Druidcraft weather uses the player's supplied forecast and a Russian object label.
4. **Combat journal damage types leaked English identifiers.** New event summaries and structured details use localized damage labels.
5. **The retired bulk cantrip updater was unsafe.** Its `--apply` mode now stops before the first network mutation; an exact preimage-pinned certification batch is the only supported promotion path.

### Verification evidence

The focused effect/event/world/combat suite passed **80/80**. The teleport UI/engine contract passed its two focused checks; the standalone teleport integration moved the token and recorded the actual distance. The cantrip certification package passed **7/7** before release and **4/4** after the stronger-certificate preservation correction. Full TypeScript passed. Production backend/frontend identity matched the exact Timecloud release, and the server retained exactly five releases, archives, build directories, backend images, and frontend images.

The accepted workbook now reports 35/35 cantrips Passed, contains 35 evidence comments authored as `Alexey Romanovich Wilhelm`, imports cleanly with zero formula-error values, and renders all five tabs without layout corruption.

## Final Thunderclap production closure — 2026-09-01

The final retained-scene retest found and closed an additional tactical-grid boundary before sign-off. Thunderclap was correctly certified at the engine/content layer, but the combat map initially submitted no target for a diagonally adjacent goblin. Three data-driven mismatches were fixed:

1. the tactical grid had no `emanation` projection, so a valid area could become an empty target list;
2. the first implementation used straight-line distance and excluded a diagonal square even though the combat grid's canonical distance is 5 feet;
3. the production action stores its 5-foot extent as `area.size_ft`, while the initial parser handled only `area.radius_ft`. The shared parser now accepts either schema-valid numeric authority.

Final production evidence is retained under Wizard `815c3e25-436a-4d2e-b34a-aed7ac287ba6`. On release `668344f9d6fcc4814e15d73b95b4cb0ade92a530`, the diagonally adjacent Goblin was selected, the Wizard's Action changed **1/1 → 0/1**, and the journal displayed `19 +0 ТЕЛ = 19 против СЛ 13 — успех`. The Goblin therefore correctly took no damage. The caster, target, full save formula, and outcome are visible; no uncertified-entity or mechanics dialog appeared.

The final release passes 34/34 focused area/combat regressions, targeted lint, and full TypeScript. Backend and frontend publish the same exact SHA. The host retains exactly five releases, archives, extracted build trees, backend images, and frontend images. The live catalog remains **35/35 cantrips with 0 pending**. The accepted workbook was re-exported and freshly imported as **35/35 Passed, 35/35 evidence comments, and 0 formula errors**; the Spells tab was rendered and visually checked.

## Mini-MVP final approval — first-level spells and omitted backgrounds — 2026-09-01

This section supersedes every interim count above. The mini-MVP manual gate is complete.

- **Classes:** 57/57 checklist rows Passed.
- **Species and every level-1 lineage/variant:** 189/189 Passed.
- **Spells:** 99/99 Passed — 35/35 cantrips and 64/64 first-level spells.
- **Origin Feats and Fighting Styles:** 48/48 linked chassis/action/effect rows Passed.
- **Base Mechanics:** 44/44 Passed.
- **Backgrounds:** a previously omitted tab was added; all 16 PHB 2024 backgrounds are 16/16 Passed with retained Forge character IDs.
- **Weapon masteries:** all eight masteries are approved across the 25 mini-MVP weapon profiles.

A fresh live manifest audit resolved and approved **180/180 roots**: 12 classes, 10 species, 24 species lineages, 16 backgrounds, 10 Origin Feats, 10 Fighting Styles, 34 manifest cantrips, and 64 first-level spells. The workbook deliberately also includes Astral Dash, so its spell denominator is one cantrip larger than the frozen 180-root manifest. There are no unresolved or unverified live roots. The evidence is saved in `output/mini-mvp-live-manual-approval-audit-2026-09-01.json`.

### First-level spell evidence

Every first-level spell was inspected on the retained all-spells character `0fdc8692-d722-4080-9ebc-47a32891e5bd`; its activation, target, slot/resource cost, expected result, hover/card text, and sheet visibility are recorded in the Spells row. Caster/target and ally behavior was exercised with retained character `27220891-0790-4ae6-a648-78130870fce1`. The final post-hit families were exercised with retained Ranger `b43c121b-971b-4f92-8726-01c724d2734e` and Paladin `e521c39b-5f3a-4c61-a78a-3f9bafb04a9f`.

- **Hail of Thorns:** the post-hit choice appeared, spent Bonus Action plus one slot, resolved the target save, and showed 2 piercing damage on a successful save. The 5-foot secondary selection remains an explicit manual boundary.
- **Ensnaring Strike:** the Wolf failed STR 3 vs DC 12, received visible Restrained, and the inspector explained ongoing 1d6 damage, the Athletics escape action, and the size rule.
- **Wrathful Smite:** spent Bonus Action plus slot, dealt 5 necrotic, and WIS 11 vs DC 12 applied visible Frightened.
- **Divine Smite:** spent Bonus Action plus slot and dealt 10 radiant damage with the two d8 results visible.
- **Thunderous and Searing Smite:** the shared post-hit choice, target ownership, resource spend, and journal pipeline pass. Their special forced-movement/ongoing-fire lifecycle remains explicitly certified partial rather than being overclaimed.
- **Feather Fall:** sheet/trigger clarity passes, while combat is approved within the stated limitation that the flat mini-MVP map has no falling event. It is correctly absent until a valid trigger exists.

All 64 live rows now have verified support. The exact atomic certification updated 51 unlocked rows to `mini-mvp-level1-spells-manual-v1` and preserved 13 stronger evidence-locked approvals. A repeat dry run reports 64/64 with zero pending.

### Bugs found and fixed

1. **A final hit could show Victory over an unresolved post-hit spell decision.** This made Ensnaring Strike appear selectable but navigation won before the choice could spend/apply. Runtime release `04b137ac0e2a0bc5bdce0b224ec0d414bce50ec6` now withholds the outcome overlay until all pending decisions resolve. The focused combat gate passed 34/34 and the production Ranger retest completed without an overlapping dialog.
2. **A retained Paladin's old longsword card had no weapon profile.** The scene constructor correctly failed closed. Testing continued without changing or deleting the character by equipping a supported quarterstaff; the invalid legacy inventory reference remains reproducible.
3. **Three cantrip support rows were reset after later mechanics changes.** Blade Ward, Starry Wisp, and Vicious Mockery were re-certified atomically from their already completed browser evidence. The current 35-row cantrip dry run reports zero pending.
4. **The legacy strict audit is not the manual-approval gate.** It hard-codes only two verified statuses, rejects the valid `verified_narrative` product status, requires the superseded `mini-mvp-l1-v1` evidence version, and demands mechanics locks for manual approvals. Its 0/180 result is therefore a stale-policy diagnostic, not a content result. The new live approval audit checks the actual manifest roots and current supported `verified_*` contract; it passes 180/180. The old audit remains available to expose migration debt and was not misreported as passing.

### Background omission closed

All 16 PHB 2024 backgrounds have a retained Forge character. The new Backgrounds tab records ability-score choices, both skills, tool proficiency, Origin Feat, Forge result, sheet result, combat relevance, clarity result, character ID, and a threaded comment. Backgrounds do not own a direct combat action; their linked Origin Feats were independently exercised and approved in the Feats tab.

### Delivery verification

The workbook was exported through the spreadsheet artifact workflow, freshly re-imported, and checked as **99/99 spells Passed, 16/16 backgrounds Passed, and zero formula-error values**. All six tabs—Classes, Species, Spells, Feats, Base Mechanics, and Backgrounds—were rendered and visually inspected without clipping or layout corruption. Comments are authored as `Alexey Romanovich Wilhelm`. No test character or combat scene was deleted.

## Data-driven effects and targeting polish closure — 2026-09-02

This section is the final post-approval polish checkpoint and supersedes the earlier statement that QA characters were retained.

### Player-visible result

- Lasting ally/enemy results are now real catalog effects rather than frontend-generated labels. The migration materialized **63 runtime effects** for modifiers, triggered boons, immunities, damage riders, communication, fall protection, movement and targeting wards. Together with the dedicated Bardic Inspiration entity, these effects carry stable identity, image, source, mechanics and an inspectable card.
- The combat actor inspector and character surfaces show effect icons. Clicking an icon opens the same data-driven effect card rather than a second frontend description.
- Bardic Inspiration now grants a usable boon. The recipient can choose it before a suitable roll or after a failed roll when the rule permits; use consumes the d6 and removes the effect. Retained pre-cleanup Bard/Goliath evidence used `100eb271-ad36-4045-9aea-ef0d01a9e395` and `84e8c110-bbba-41be-85ef-9165c376d746`.
- Ray of Frost browser evidence used `467b52d2-3982-4c32-bbfa-f39cce69bcf0`. A hit on a Wolf applied “Луч холода — Скорость снижена на 10 футов”; inspection showed **30 ft effective / 40 ft base**, the real image and source, and an icon card explaining the −10 ft effect.
- Acid Splash now uses its declared 60-foot point and 5-foot sphere contract instead of presenting a single-creature action. Arms of Hadar selected four creatures in its 10-foot self-origin emanation while excluding the caster. Color Spray selected exactly three creatures in its 15-foot cone and exposed Blinded on failed saves.
- A spell added through `+ Добавить` remains prepared/available for every class. The retained pre-cleanup Fighter cast the manually added Ray of Frost without a spell slot, proving the cross-class contract in a fresh scene.

### Major bugs found and fixed

1. Active combat effects did not persist their catalog `entityRef`, so the engine could apply a boon while the UI could not reliably recover its library identity.
2. The frontend preloader only inspected top-level `grant_effect` payloads. References nested in `on_hit`, `on_fail`, or runtime choices were missing from execution context; a fresh Ray of Frost failed atomically with `UNRESOLVED_GRANT_EFFECT`. The collector now traverses the complete mechanics tree and deduplicates references.
3. Two deployment-only migration assumptions were wrong: a legacy action contained SQL `NULL` mechanics, and `active_effect` was not an allowed effect type. Both deployments rolled back automatically; the fixes accept empty legacy mechanics and use catalog-valid effect types.
4. One newly materialized Frost Goliath slow effect inherited no image. The follow-up migration supplies the canonical Ray of Frost artwork, bringing runtime effects to **63/63 with images**.
5. Area descriptions and tactical targeting had drifted. Point-sphere, self-emanation and cone declarations now drive actual target discovery for Acid Splash, Arms of Hadar and Color Spray.

### Non-entity and process findings

- Production-shaped migration validation must happen before a release. An ephemeral PostgreSQL preflight restored the latest production backup, ran migrations, and checked row/image counts; this converted the final cached deployment into a safe short release instead of another rollback cycle.
- The release runner still rebuilds backend and frontend when only one side changed. The final frontend-only fix spent most deployment time recompiling an unchanged Go backend. Changed-path image reuse is the largest remaining deployment-speed improvement.
- The Git archive was approximately 114 MB and its upload took materially longer than hashing or switching the release. A content-addressed delta upload or server-side fetch of the exact Git SHA would reduce this fixed cost.
- Full-sheet workbook rendering was slower than the workbook edits and verification. Future checkpoints should render only changed ranges during iteration, then perform one final full visual pass.
- Timecloud web passkey login still reports an error, but infrastructure authorization is confirmed through the approved SSH key. Backend, frontend and public build identity all report exact release `a79f20b27d6bbc67f0cfd016344ff7ac46ea319d`.

### Certification, Forge visibility and cleanup

- The live manifest audit now passes **180/180**: 12 classes, 10 species, 24 lineages, 16 backgrounds, 10 Origin Feats, 10 Fighting Styles, 34 manifest cantrips and 64 first-level spells.
- An exact-preimage atomic operation certified the 22 roots reset by the polish migrations plus 17 manually tested class/species actions and 116 related effects. All **63 runtime effects are verified and have images**.
- Default Forge mode (“only verified catalog”) visibly lists all 10 species and all 12 classes. Wizard spell selection includes Acid Splash, Ray of Frost, the repaired first-level catalog entries and Color Spray without enabling “Показать все сущности”.
- The accepted workbook was synchronized with live support in 111 cells, received seven new evidence-comment threads, re-imported with zero formula errors, and all six tabs were rendered and visually inspected.
- After evidence, certification and workbook verification were complete, exactly **75 QA characters** (`QA-*` plus `A.Бард`) were deleted. The exact ten non-QA characters were verified before and after; **10 remain and 0 QA remain**. Recovery is possible from Timecloud backup `/opt/bagofholding/shared/backups/pre-a79f20b27d6bbc67f0cfd016344ff7ac46ea319d-20260902T034716Z.dump`, but not through an in-product undo.
- Timecloud retains exactly **five** immutable release directories; the retention runner removed the sixth version and preserved Docker build cache.
