# Mini-MVP: level 2, level-up and multiclass acceptance report

Date: 2026-09-03

Environment: local focused gates plus `https://bagofholding.ru` production browser

Scope: all twelve base classes through character level 2, level-up, multiclass. No new spells, cantrips, items or species features.

## Release conclusion

Initial production release: `1c26b29777af891cdcbfee9639813f8c44c927b8`. Backend, frontend and Timecloud `current` matched; retention was 5 releases / 5 archives. A browser follow-up found and corrected the temporary-action filter before final acceptance; the final SHA is recorded below after the follow-up deployment.

The level-up and multiclass paths are working, and every base class is visible in the approved Forge catalog after the certification migration. Eight classes have complete level-2 acceptance for the current mini-MVP contract. Four classes remain explicitly `verified_partial` rather than being falsely labelled fully mechanical:

- Druid: form statistics, attacks, exit, temporary HP and spell denial work; Pack Tactics, Spider Climb and Web Walker are visible data but are not tactical modifiers yet.
- Fighter: Action Surge has a dedicated non-Magic action resource; Tactical Mind rolls and refunds correctly after failure, but its boon is armed before the check instead of being offered in a post-failure dialog.
- Monk: Focus actions and restoration work; Uncanny Metabolism is not yet restricted to the post-initiative decision window.
- Sorcerer: Font of Magic, Quickened Spell and Transmuted Spell work; the other eight Metamagic choices are library cards with clear rules text but do not yet modify spell resolution.

`verified_partial` remains an approved/default-visible state and exposes every limitation on the card. It is used here deliberately so Forge availability does not imply mechanics that do not exist.

## Level-up and multiclass

| Scenario | Sheet | Combat | Clarity | Result / retained evidence |
|---|---|---|---|---|
| Wizard 1 → 2 | PASS | PASS | PASS | Level choice applied; Scholar and level-2 spell choices appeared. Character `2e4d02a6-fcbe-4a67-95f8-4b2b81b75791`. |
| Fighter 1 / Rogue 1 reload | PASS | PASS | PASS | Both owned classes remain present; no class is silently replaced. Character `f4b8e1c5-5aba-42d9-8056-d4b21d3da954`. |
| Fresh level-2 Forge class selection | PASS after release | N/A | PASS | Twelve base classes are approved/default-visible. Custom Pugilist is intentionally outside this scope. |

## Class acceptance matrix

| Class | Sheet usage | Combat usage | Result clarity | Status | Retained character |
|---|---|---|---|---|---|
| Barbarian | PASS | PASS | PASS | `verified_mechanical`; Reckless Attack creates two named, timed effects and changes advantage. | `da252a04-6c4f-4107-a439-89c29212f82c` |
| Bard | PASS | PASS | PASS | `verified_mechanical`; level-2 passive features and Bardic Inspiration remain available. | `17af8579-f2cf-4802-8e57-2b0755e1fd59` |
| Cleric | PASS | PASS after release | PASS | `verified_mechanical`; Divine Spark heal/damage and self-centred Turn Undead emanation use Channel Divinity. | `006a18eb-9eb1-4c02-b0f2-42f1a757868f` |
| Druid | PASS | PASS | PASS with limitations | `verified_partial`; Wild Shape form/attacks/exit and Wild Companion work; listed form-trait limitations above. | `5d51dfca-faca-45de-b280-d5d8a0bcd30d` |
| Fighter | PASS | PASS | PASS with limitation | `verified_partial`; Action Surge extra action is labelled and cannot pay a Magic action; Tactical Mind timing UX limitation above. | `86df67e2-0683-40cf-8453-1ed3a12112c5` |
| Monk | PASS | PASS | PASS with limitation | `verified_partial`; Flurry performed two attacks and spent one Focus/bonus action; Patient Defense effects and refresh are visible. | `7ca8a067-3fb5-47c0-a8bd-d070199f447f` |
| Paladin | PASS | PASS | PASS | `verified_mechanical`; level-2 spellcasting/smite resource contract is present. | `a290b7cd-16b9-4e08-86aa-5544060825a7` |
| Ranger | PASS | PASS | PASS | `verified_mechanical`; Deft Explorer choices and level-2 spellcasting are present. | `0e7b3e1c-f7a1-4701-872c-b254947c520b` |
| Rogue | PASS | PASS | PASS | `verified_mechanical`; Cunning Dash spent bonus action, doubled speed and produced a sourced timed effect/journal entry. | `b1993a02-6987-4cc9-ba5e-1a1ce34f3572` |
| Sorcerer | PASS | PASS for implemented options | PASS with limitations | `verified_partial`; exact Metamagic limits listed above. | `5097609d-27ca-4ca6-8acb-cf094d54be47` |
| Warlock | PASS | PASS | PASS | `verified_mechanical`; Armor of Agathys spent pact slot 2→1 and Magical Cunning restored 1→2 with journal evidence. | `4a12fae4-9da6-40df-b624-f8dd0f4fc286` |
| Wizard | PASS | PASS | PASS | `verified_mechanical`; Scholar choice and level-2 preparation are retained. | `370f1122-67b6-4f3f-ad50-f2ce921711f9` |

## Detailed production findings

- Rogue Cunning Action: the sheet action applied a real timed effect, changed bonus action 1→0, and recorded both spend and speed result.
- Monk Patient Defense (Focus): Focus changed 1→0 and the sheet displayed the sourced effects. Scene-constructor refresh restored Focus 0→2 and all turn resources.
- Monk Flurry of Blows: two independent attacks hit the Goblin Warrior for 7 and 6 damage; exactly one Focus and one bonus action were spent, with both rolls and damage entries visible.
- Cleric Divine Spark heal: healed the selected allied Rogue for `1d8 + Wisdom = 3`, spent action and Channel Divinity 2→1, and persisted the ally HP change.
- Turn Undead defect: catalog data described a self-centred 30-foot effect but encoded a zero-range destination sphere, so every map destination was rejected. It is corrected to an emanation and resolved immediately from the Cleric position.
- Production Turn Undead retest: from exactly 30 feet it selected the Skeleton without requesting a destination; the Skeleton rolled `13 - 1 = 12` against DC 12 and succeeded. The journal clearly showed the save, action spend and Channel Divinity spend. A successful save correctly applied no conditions.
- Production Action Surge retest: activation produced a visible `Дополнительное действие Всплеска: 1/1` button and a readable hover card. The first deployed filter matched only literal resource costs and therefore showed no actions; the follow-up maps this substitute resource to non-spell actions that normally cost `action`.
- Scene constructor: adding characters/monsters, changing initiative and refreshing exact resources worked. The retained undead test target is `24b39706-f71a-4813-9994-efa831b42604` (`QA-L2-Скелет`).
- Action Surge and Quickened Spell temporary action pools now appear above the hotbar with human-readable labels.

## Non-entity findings

- Minimal combat fixtures could crash monster planning or speed calculation when `world.grapples` was omitted. Both consumers now accept the optional map; monster planning uses the supplied compiled actor rather than assuming a duplicated world record.
- A pre-existing unrelated unit assertion expects obsolete Bardic Inspiration wording. The current runtime text describes the data-driven automatic use contract. The dirty user-owned test file was not overwritten.
- Persisted old combat snapshots contain their old compiled action data. Retesting a catalog repair requires a fresh encounter, not only a page reload.

## Test gates

- Focused frontend regression: 26/26 passed.
- Broader level-2/combat suite: final pass in 7.284 s (the preceding 158/158 pass took 6.717 s).
- TypeScript release-candidate rerun: passed in 37.737 s.
- Backend migration package release-candidate rerun: passed in 4.662 s.
- A stale persistence assertion still expected an inline base64 image inside saved combat state even though the size optimization deliberately removes all inline card art. The test now checks the production contract; its isolated failure/recheck added 4.111 s plus diagnosis.
- Retired long `microMvpScenarioCorpus` pipeline was not run.
- Follow-up hotbar regression: focused tests passed in 5.363 s; TypeScript passed in 36.222 s.
