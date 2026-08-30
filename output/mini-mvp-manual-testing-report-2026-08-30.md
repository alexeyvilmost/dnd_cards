# Mini-MVP manual testing report — 2026-08-30

## Status

- Testing status: in progress
- Environment: production, `https://bagofholding.ru/`
- Tested releases: baseline `a8f1bf7dce078ab19f338515818a80e8ddf73ef1`; mechanics/error repair `8d49f90351e0a948118212f23bff3103a367a401`; recipient-clarity repair `f601e00530c788ef3f7fe3076be9bf66d100208b`
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

The fresh Goliath was created with Stone ancestry, Fighter, Soldier, Unarmed Fighting, and Dagger/Shortbow/Longsword masteries. Forge correctly blocked the initial duplicate Athletics grant and explained the conflict; replacing the class Athletics choice with Insight enabled creation.

## Coverage summary

_Populated after workbook evidence is complete._

## Major findings

1. `A.Бард` can cast spells after the deployed Charisma repair. Mage Hand, Light, Minor Illusion, and self-targeted Cure Wounds all executed and consumed the expected action/slot resources. The original blanket symptom “none of the Bard's spells work” is no longer reproducible against a compatible target.
2. Bardic Inspiration was a real entity defect. On the baseline it consumed resources without changing the target. Release `8d49f90` made the newly forged compatible Goliath receive a persistent `Талон 1к6`; release `f601e00` adds the recipient-facing explanation that the die applies to an ability check, attack roll, or saving throw and is removed after use. Sheet mechanics and recipient clarity now pass on the retained target; combat usage remains to be tested separately.
3. Cross-character spells against older characters fail atomically because their stored ruleset is incompatible with the current sheet. The safety rejection is correct, but production exposes the technical English message `Atomic participants use incompatible rulesets`, which does not tell a player what to do.
4. Minor Illusion collects meaningful scenario facts (form, description, distance), but the accepted result collapses them to generic journal lines. The entered description `QA: звук далёкого колокола` was not visible afterward, so another participant cannot understand what illusion was created.
5. Long rest correctly restored actions, both first-level slots, and Bardic Inspiration, and removed the temporary Mage Hand effect.
6. The combat scene constructor successfully accepted the fresh Goliath and a Goblin Warrior, but the encounter could not initialize because the reviewed combat certificate omitted the Bard-scoped Thunderwave action. The certificate had the same spell for Druid/Wizard and already supported its `area_object_push` primitive; this was an access/coverage gap rather than an unsupported spell mechanic.

## Cross-cutting errors not tied to an individual entity

- **Ruleset compatibility is invisible until commit.** Older and current characters remain selectable together; the incompatibility is discovered only after dice/confirmation work. This wastes a test attempt and can look like a broken spell.
- **Technical error leakage (fixed in `8d49f90`).** The atomic incompatibility error was displayed in internal English. The deployed UI now explains the incompatible rules versions in Russian and directs the player to a compatible character or an updated Forge copy.
- **Opaque persistence wait.** A successful self Cure Wounds commit took about 4.6 seconds after the dice dialog. During the wait action buttons were disabled and values initially appeared unchanged, with no visible “saving” state.
- **Transient action availability.** On initial Bard-sheet load, most spells were briefly disabled while target/canonical data loaded, without a loading explanation. They enabled after the data arrived; Thunderwave remained disabled and requires separate diagnosis.
- **World-interaction evidence loses submitted facts.** Minor Illusion retains only a generic completion message, making manual scene adjudication and ally/target clarity worse than the input form.
- **One omitted action poisoned the entire encounter.** Combat session creation validates every participant action up front. A valid but uncertified Bard Thunderwave grant prevented initiative from opening even though the player had not attempted to cast it.

## Entity-specific failures

- **Bardic Inspiration — sheet mechanics and recipient clarity passed after repair; combat pending:** fresh compatible character `84e8c110-bbba-41be-85ef-9165c376d746` receives and retains the boon, sees its eligible rolls and consumption instruction, and can remove it manually after use.
- **Minor Illusion — result clarity failed:** activation succeeds, but chosen form/description are absent from the resulting journal/effect evidence.
- **Thunderwave — blocked pending diagnosis:** action remains disabled on the reported Bard while other spells enable.
- **Combat scene initialization — failed on deployed `f601e00`:** retained Bard + fresh Goliath + Goblin Warrior is rejected before initiative because `Thunderwave@CLASS-bard` is absent from the deployed reviewed catalog.
- **Cure Wounds to legacy targets — blocked by compatibility:** the spell succeeds on self, but older target sheets are rejected by the atomic ruleset check.

## Defects fixed, deployed, and retested

- **Deployed and mechanically retested (`8d49f90`):** exact-preimage compatibility upgrade converts legacy `ACT-bardic-inspiration` narrative mechanics to a target-owned `1d6` boon for ability checks, attack rolls, and saving throws. Audited database migration 120 repaired the production row and revoked its stale `verified_mechanical` certificate; the content seed is also repaired. The fresh Goliath retained the boon after reload.
- **Deployed and retested (`8d49f90`):** atomic ruleset incompatibility is translated to actionable Russian. The old Goliath Cure Wounds path now displays the recovery guidance instead of `Atomic participants use incompatible rulesets`.
- **Deployed (`8d49f90`):** a visible `Сохраняем результат действия…` status is available during sheet persistence. The Bardic Inspiration commit completed too quickly to capture it in the 50 ms browser sample; a deliberately slow commit remains the useful observation case.
- **Deployed and retested (`f601e00`):** both active-effect renderers explain to an inspired recipient: add `1к6` to an ability check, attack roll, or saving throw, then remove the effect. The retained Goliath shows the explanation and `Снять вручную` control after a production reload.
- Focused verification currently passes: 18 engine/error/compatibility tests, 14 solo-combat integration tests, 17 action-sheet collection tests, and TypeScript compilation.
- **Locally fixed, deployment/retest pending:** the combat certificate now has 450 explicit reviewed roots and 17 exact actions. New Forge-derived roots certify Bard Thunderwave plus alternate Sorcerer Thunderwave/Shield with exact Charisma, slot, source, and access signatures. The 12-test certificate suite, artifact drift check, targeted lint, and TypeScript/Vite compilation pass.

## Remaining limitations and blocked checks

- Bardic Inspiration consumption remains manual by design: the boon effect tells the recipient to add the die and remove the effect after use. Automatic roll attachment/consumption is outside the current implementation and must be evaluated as a later usability improvement.
- The expanded combat certificate still needs immutable Timecloud deployment and an exact production rerun of the retained Bard + Goliath + Goblin scene.
- Thunderwave sheet availability and Minor Illusion result serialization still require separate diagnosis/fix before their rows can be closed.

## Timing and speed analysis

The detailed action-by-action timing log is maintained in `docs/mini-mvp-completion-timing-2026-08-30.md`. The final report will identify the longest manual-testing, debugging, bug-fixing, deployment, and retest phases and concrete ways to shorten the next run.
