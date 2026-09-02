# Base equipment and character-loading report — 2026-09-02

## Outcome

- Production release: `4c1f44ff72b5c608120974eae4dfbd93821b85cb` (`/api/health` reports `ok`).
- Checklist: 107/107 scoped equipment entities matched to production catalog records and approved.
- Results: 107 passed, 0 failed, 0 blocked, 0 remaining.
- Scope: 38 weapons, 13 armor entries, 8 consumables, 17 combat-gear entries, and 31 sheet-gear entries.
- Catalog availability: the equipment migrations leave `support` unset, which is the application's unrestricted state; all approved entries are selectable rather than gated by the old uncertified-entity dialog.
- QA characters were retained for reproduction.

The detailed row-by-row result, character ID, evidence, and cell comment is in `base-equipment-manual-testing-checklist-2026-09-02.xlsx`.

## Character sheet and Forge loading

The largest sheet delay was not the character being viewed. Every sheet mount also fetched the full character collection as a target catalog, then eagerly downloaded nine catalog pages plus complete basic-action and mastery-effect payloads. Forge fetched all spell levels for a level-1 build and embedded large resource icons directly in the resource response.

Measured production changes:

| Request | Before | After | Reduction |
|---|---:|---:|---:|
| Sheet character-list response | 889,203 compressed bytes | 991 compressed bytes | 99.9% |
| Basic actions | 330,250 compressed bytes | 4,479 compressed bytes | 98.6% |
| Mastery effects | 79,185 compressed bytes | 4,521 compressed bytes | 94.3% |
| Forge resources | 355,773 compressed bytes | 2,847 compressed bytes | 99.2% |
| Forge level-1 spells | 156,077 compressed bytes | 42,596 compressed bytes | 72.7% |

The sheet now uses preview records for target selection, hydrates only the selected character, and no longer performs the nine-page eager card cascade. Runtime endpoints return small mechanic-preserving projections. Forge requests only spells relevant to the current level and receives projected resources without embedded image payloads.

## Manual-test method

Every relevant entity was evaluated in the three requested dimensions:

1. Character sheet: card visibility, detail/hover content, equip/use controls, resources, derived values, and restrictions.
2. Combat: action availability, target/range, cost, roll/save/damage/effect, charge or ammunition consumption, journal entry, and persistence after refresh.
3. Clarity: the actor and target can see what happened, why it happened, the duration/source, and what remains usable.

Equipment that has no combat action is marked not applicable for combat rather than simulated. Every weapon card and weapon profile was individually inspected; a live Club attack exercised the shared attack pipeline, while the 38-profile matrix and ammunition contracts were checked by 56 focused automated executions. This avoids pretending that repeating the identical attack UI 38 times tests 38 independent engines.

## Retained QA characters

| Purpose | Character ID |
|---|---|
| Weapons | `7382a1e6-f7a2-45ca-8370-38f119845791` |
| Armor, trained | `65273dd7-771c-40d6-aa1c-61cf6a041a91` |
| Armor, untrained | `2e4d02a6-fcbe-4a67-95f8-4b2b81b75791` |
| Consumables | `ca97af18-701c-456b-89c7-0d0e5c8ac725` |
| Combat gear | `e7255504-0aad-461e-9b3a-df4b6fa58ece` |
| Sheet gear | `7bc85a26-d51c-455f-a8d5-557b9f1c5a41` |

The Healer's Kit target was intentionally left at 0 HP and stable so its final state can be reproduced.

## Equipment results

### Weapons

- All 38 base weapons have executable profiles with damage type/die, ability choice, range/reach, properties, mastery, and ammunition link where applicable.
- The sheet/equip dialogs and combat preview show weapon-specific mechanics instead of a generic attack description.
- Live Club evidence: +5 to hit, 1d4+3 damage, 5-foot reach, and Slow mastery.
- The complete weapon/ammunition regression set passed: 6 files, 56 tests, 6.05 seconds.

### Armor

- All 13 entries equipped correctly and recalculated AC. Observed trained AC values were 14, 14, 15, 15, 16, 17, 17, 18, 15, 17, 18, 19; Shield raised the Plate setup from 19 to 21. The Defense style's +1 is included where applicable.
- Untrained Chain Mail showed AC 16, speed 20, disabled spell actions with a reason, and Strength/Dexterity d20 disadvantage.
- Strength requirements, Stealth disadvantage, proficiency, equip state, and shield bonus are visible in item detail.

### Consumables

- Acid: save/action/quantity/journal flow passed.
- Antitoxin: bonus-action cost, charge consumption, duration, and visible effect passed.
- Healing Potion: healed 7→12, consumed one item, and wrote the result to the journal.
- Basic Poison: visible ten-turn, one-hit weapon rider passed.
- Oil: visible zone/effect and quantity consumption passed.
- Holy Water: an ineligible ordinary target resolves without false damage or dice and explains the fiend/undead restriction.
- Alchemist's Fire: failed save, initial damage, and visible turn-start burning effect passed.
- Healer's Kit: adjacent 0-HP ally targeting, charge 8→7, action consumption, and stable-state persistence passed.

### Combat gear

- Ball Bearings produced a visible zone/effect and an immediate journal result.
- Net forced the target save and left a visible Restrained effect with Net as its source.
- Caltrops, Chain, Climber's Kit, Grappling Hook, Hunting Trap, Manacles, Rope, and Torch executed without runtime errors and expose their result as an effect/zone or journal state as appropriate.
- Crowbar and Portable Ram no longer spend a fake free action; they establish the next-check benefit described by the item.
- Arrows, Bolts, Firearm Bullets, Sling Bullets, and Needles are linked by exact inventory card and consumed through the shared ranged-attack executor.

### Sheet gear

- All 31 cards were opened and inspected in production. Description, official rule, weight/price, container/pack rule, and any active light/check action are visible.
- Narrative-only gear does not invent a combat action. Light sources, checks, focuses, containers, and pack contents expose the mechanic that is relevant to the sheet.

## Major bugs fixed

1. Full-character overfetch on every sheet view.
2. Eager full-card catalog loading and oversized action/mastery/resource responses.
3. Forge requesting irrelevant spell levels.
4. Missing Morningstar and Bullseye Lantern records and missing executable profiles for 22 weapons.
5. Item and equipment dialogs omitted structured mechanical details or showed untranslated property IDs.
6. Untrained armor did not block spellcasting or impose the required Strength/Dexterity d20 disadvantage.
7. Holy Water rolled or damaged an ineligible target instead of clearly resolving the restriction.
8. Alchemist's Fire's nested start-of-turn damage was not executable.
9. Next-check tools spent a fake free-action resource.
10. Inventory item-use pools initialized before the asynchronous inventory response and remained missing.
11. `self_uses` placeholders were not rebound to the owned inventory card's charge pool.
12. The legacy item adapter ignored explicit actor targeting and selected the user.
13. Healer's Kit validation belonged to the nested target effect but was applied to its enclosing self action.
14. Solo-combat persistence omitted death-save state, so a correct stable result was overwritten during the compatibility merge.
15. Local migration fixtures did not reproduce production's 20-character card-number limit; the first equipment release failed safely and rolled back.

## Non-entity and operational findings

- A previously opened PWA tab can keep the prior service-worker bundle alive after a healthy cutover. Acceptance testing should begin in a fresh tab after closing old clients.
- The immutable deployment archive is about 81 MB and is compiled again on Timecloud. Small fixes therefore spend much more time in transfer/build/cutover than in tests.
- The release runner requires a `.tar` input contract; an early `.tar.gz` attempt caused an avoidable repeat upload.
- SSH interruption does not imply a failed release. Detached server-side logs and bounded identity checks should be the source of truth.
- Retention is enforced by the release runner, which removes the sixth-oldest release after a healthy cutover and keeps five.

## Timing and speed recommendations

The complete chronological log is in `docs/equipment-and-loading-timing-2026-09-02.md`.

Total wall time from first inspection through final evidence was 6h 27m 35s. The longest useful implementation block was executable carried-item support (1h 07m). The longest avoidable debugging block was the Healer's Kit boundary chase (about 59m across correction releases). Focused tests were fast—the final weapon/ammunition suite took 6.05s—while a production release/retest cycle took roughly two to four minutes.

Highest-value speed improvements:

1. Add a production-shaped route integration fixture covering async inventory hydration → owned pool binding → explicit ally targeting → effect application → refresh persistence.
2. Batch a release only after that fixture passes instead of using production deployments to discover each adapter boundary.
3. Publish the already verified frontend artifact and skip unchanged frontend builds for backend-only fixes.
4. Shrink the deployment context to runtime files and use a resumable, keepalive-enabled upload.
5. Generate migration tests from production field constraints.
6. Keep the six QA characters and deterministic scenes as reusable fixtures.
7. Close stale PWA tabs before acceptance testing.

## Verification summary

- Backend full suite: passed.
- Frontend TypeScript check: passed.
- Focused item/runtime suites: passed.
- Focused weapon/ammunition suite: 56/56 passed.
- Production health: `ok`, exact source commit `4c1f44ff72b5c608120974eae4dfbd93821b85cb`.
- Workbook render audit: all six sheets (Summary plus five categories) visually passed.
