# Mini-MVP manual testing report — 2026-08-30

## Status

- Testing status: in progress
- Environment: production, `https://bagofholding.ru/`
- Tested release: `a8f1bf7dce078ab19f338515818a80e8ddf73ef1`
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
2. Bardic Inspiration is a real entity defect. It consumes the Bard's bonus action and inspiration charge and reports success, but neither older targets nor the newly forged compatible Goliath receive an effect, control, or explanation. Source inspection confirmed that the production action is authored as narrative-only even though the engine already supports a typed target-owned boon.
3. Cross-character spells against older characters fail atomically because their stored ruleset is incompatible with the current sheet. The safety rejection is correct, but production exposes the technical English message `Atomic participants use incompatible rulesets`, which does not tell a player what to do.
4. Minor Illusion collects meaningful scenario facts (form, description, distance), but the accepted result collapses them to generic journal lines. The entered description `QA: звук далёкого колокола` was not visible afterward, so another participant cannot understand what illusion was created.
5. Long rest correctly restored actions, both first-level slots, and Bardic Inspiration, and removed the temporary Mage Hand effect.

## Cross-cutting errors not tied to an individual entity

- **Ruleset compatibility is invisible until commit.** Older and current characters remain selectable together; the incompatibility is discovered only after dice/confirmation work. This wastes a test attempt and can look like a broken spell.
- **Technical error leakage.** The atomic incompatibility error is displayed in internal English instead of player-facing Russian with a recovery path.
- **Opaque persistence wait.** A successful self Cure Wounds commit took about 4.6 seconds after the dice dialog. During the wait action buttons were disabled and values initially appeared unchanged, with no visible “saving” state.
- **Transient action availability.** On initial Bard-sheet load, most spells were briefly disabled while target/canonical data loaded, without a loading explanation. They enabled after the data arrived; Thunderwave remained disabled and requires separate diagnosis.
- **World-interaction evidence loses submitted facts.** Minor Illusion retains only a generic completion message, making manual scene adjudication and ally/target clarity worse than the input form.

## Entity-specific failures

- **Bardic Inspiration — failed:** resources and Bard-side log change, but no target-side boon or instructions appear, including on fresh compatible character `84e8c110-bbba-41be-85ef-9165c376d746`.
- **Minor Illusion — result clarity failed:** activation succeeds, but chosen form/description are absent from the resulting journal/effect evidence.
- **Thunderwave — blocked pending diagnosis:** action remains disabled on the reported Bard while other spells enable.
- **Cure Wounds to legacy targets — blocked by compatibility:** the spell succeeds on self, but older target sheets are rejected by the atomic ruleset check.

## Defects fixed, deployed, and retested

- **Local fix awaiting deployment:** exact-preimage compatibility upgrade converts legacy `ACT-bardic-inspiration` narrative mechanics to a target-owned `1d6` boon for ability checks, attack rolls, and saving throws. Audited database migration 120 repairs the production row and revokes its stale `verified_mechanical` certificate; the content seed is also repaired as the long-term source of truth. Engine and solo-combat regressions assert that the ally—not the Bard—owns the effect.
- **Local fix awaiting deployment:** atomic ruleset incompatibility is translated to actionable Russian.
- **Local fix awaiting deployment:** a visible `Сохраняем результат действия…` status is shown during sheet persistence.
- Focused verification currently passes: 18 engine/error/compatibility tests, 14 solo-combat integration tests, 17 action-sheet collection tests, and TypeScript compilation.

## Remaining limitations and blocked checks

- The three local fixes above still require an exact Timecloud deployment and production browser retest.
- Bardic Inspiration consumption remains manual by design: the boon effect tells the recipient to add the die and remove the effect after use. Automatic roll attachment/consumption is outside the current implementation and must be evaluated as a later usability improvement.
- Thunderwave and Minor Illusion result serialization still require diagnosis/fix before their rows can be closed.

## Timing and speed analysis

The detailed action-by-action timing log is maintained in `docs/mini-mvp-completion-timing-2026-08-30.md`. The final report will identify the longest manual-testing, debugging, bug-fixing, deployment, and retest phases and concrete ways to shorten the next run.
