# Roguelike: reconciliation with the original plan, 2026-09-07

The original plan is `docs/roguelike-implementation-plan-2026-09-07.md` in the user's original checkout. The release worktree was created from production and did not include that uncommitted document. This report distinguishes delivered behavior from the larger original acceptance criteria. The requested reuse of the character sheet, desktop Forge and ShopDetail supersedes the plan's separate camp interface.

## Remaining work

| Original steps | Current evidence | Status / remaining acceptance |
| --- | --- | --- |
| 1: baseline and manifests | Isolated production branch; 18 monster candidates, 11 enabled; 27 random shop entries | Partial: fighter dependency closure and a versioned release content manifest remain |
| 2: vertical slice | Production combat/reward/camp/reload, existing sheet/Forge/shop | Delivered and browser checked |
| 3: trusted execution | Server owns XP, gold, shop/rest commands, revisions and receipts | Partial: combat resolution still originates in the browser. No trusted TS worker; server replay of battle commands remains |
| 4: durable decisions and checkpoints | Run revision, retry and checkpoint implementation; existing solo-combat saves and reaction tests | Partial: old rules artifacts, full command replay and every interrupted decision need acceptance coverage |
| 5–6: fighter and all choices | Existing Forge and rules engine reused; Champion L3→4→5 checked in production | Partial: do not infer full support for all four subclasses, ten styles, twenty maneuvers, eligible feats and spell choices from this test. Dependency manifest and full roundtrip matrix remain |
| 7: monsters | 18 materialized records, 11 with positive generation weight | Partial: goblin escape; zombie fortitude; spider/hobgoblin poison clauses; bugbear grab/drag; captain/veteran Parry remain gated |
| 8: AI | Deterministic target choice, melee/ranged attack choice, pack/frenzy advantages; this change adds legal movement budget, terrain, sight repositioning, preferred range and interrupt stop | Partial: reactions, utility actions, complete path/area traversal and tactical profiles remain |
| 9: generator/rewards | Separate RNG streams, stage budgets, body caps, one-time rewards | Partial: current encounters contain one monster type. Mixed composition allowlist, history constraints and versioned frozen encounter inputs remain |
| 10: camp/shop | Sheet rests/items/inventory; purchase, refresh, pin; gold/supplies/time persistence checked in browser | Delivered core flow. Full resource/attunement/mastery-change and item matrix still requires validation |
| 11: completion | Production level 5 + 14000 XP victory and persisted result checked using QA setup | Delivered vertical flow; not a substitute for an unmodified complete playthrough with all subclasses |
| 12: simulation/rollout | Production SHA checks, tests, browser checks; 1000 XP pacing simulations added here | Partial: full combat simulations across build × level × encounter and economy policy remain |

## This increment

- AI destinations use the same reachable-cell and line-of-sight projections as player actions. It respects the remaining movement ledger, grappled speed and difficult terrain for movement and Dash.
- A ranged enemy can leave an obscured cell to regain sight and can approach its profile's preferred range. It does not consume Dash when no useful movement exists.
- Pending movement reactions stop the AI controller before it starts another action.
- Added focused tests for partial movement, grapple, terrain, fog, deterministic decisions and preferred range, plus an actual engine turn on difficult terrain.
- 1000 deterministic successful-encounter progression simulations reach 14000 XP in 42–55 victories (mean 48.15). This is not a combat survival simulation and does not certify combat balance.

Do not enable the remaining monsters or advertise complete original-plan coverage until their executable clauses and integration scenarios pass. In the 2024 wolf block the prone rider is size-gated and automatic on a hit; it must not be implemented as a 2014 Strength save. Rule reference: https://www.dndbeyond.com/sources/dnd/br-2024/creature-stat-blocks


## Wolf increment

- The shared condition executor accepts a validated `max_target_size` gate (0–5). Missing/invalid target size is rejected before payment or RNG. A hit applies Prone automatically to a permitted size; a miss or oversized target does not. Existing condition immunity processing remains authoritative.
- Migration 200 updates the two wolf Bite actions without rewriting historical migration 199. Wolf: Medium or smaller; Dire Wolf: Large or smaller. Their Perception expertise, Stealth proficiency and Darkvision 60 ft. are materialized through the monster compiler.
- Pack Tactics excludes Incapacitated allies, including conditions that incorporate it; Prone and Poisoned alone do not exclude a living ally.
- Both wolves enter the generator at their existing level/body limits. Successful-encounter pacing across 1000 seeds is 41–56 encounters, mean 48.91. This is not combat survival evidence.
- Focused coverage includes invalid-size preflight with no spending/RNG, hit/miss size boundaries, composed ally conditions, compiler traits, and actual AI Bite → save → reload.
- The larger remaining-work table above still applies, including trusted execution and full fighter/content acceptance.


## Frozen encounters

- The next encounter now includes an immutable copy of its monster, actions and effects plus a generator version. Retry retains that record rather than rerunning selection against the latest library.
- Combat setup uses the run-owned roster and catalog. URL parameters no longer override the encounter or add external allies to a run.
- Legacy encounters without a frozen catalog continue using their previously drawn ids. This preserves compatibility but cannot retroactively recover historical records.
- This freezes monster content, not old executable rules artifacts or every player dependency; those remain in the acceptance backlog.
