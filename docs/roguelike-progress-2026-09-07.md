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
| 9: generator/rewards | Separate RNG streams, stage budgets, body caps, one-time rewards | Mixed composition allowlist, bounded history and frozen monster inputs are implemented below. Remaining: full combat/economy balance and complete rules/player content version pinning |
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


## Production acceptance: 298349e

- TimeWeb health and containers verified exact SHA `298349e358858074b021436991352ddcf1a4f829`.
- Full frontend gate: 381 files / 3161 tests; Go, TypeScript and lint passed.
- Built-in browser: QA run `497cc48f-73f8-48a4-a59e-31a909a00cef` was prepared with 300 XP and an explicit wolf seed, then leveled through desktop Forge. This is fixture-based acceptance, not a natural full run.
- Two wolf Bites applied 6 and 7 piercing damage, each applying Prone without a save; the second attack rolled with advantage. Reload retained 3/22 HP and the actual Prone runtime effect.
- The subsequent defeat gave no XP. Browser Retry restored the L2 checkpoint, gold and clock; the encounter hash `b0239f1db8820bb18823cc49d22fd40b` and catalog hash `db2f078bd1669ad2e0d4201ba904d2ae` remained unchanged.

## Prone movement follow-up

Browser acceptance exposed a missing tactical command to stand. The existing combat hotbar now exposes it beside movement while Prone. It costs half effective speed rounded down, spends no action, and is unavailable at zero speed, insufficient remaining movement or a pending decision. The same command is used by monster AI. Crawling costs one extra foot per foot, additive with difficult terrain; reachable-cell projection and actual movement use the same surcharge. Focused engine tests cover standing, persistence, rejection cases, crawling and AI standing before attacking.

Rules reference for Prone and crawling: https://www.dndbeyond.com/sources/dnd/br-2024/rules-glossary


## Production acceptance: 0587551

- TimeWeb verified exact SHA `05875512ec831c1e8939b290c655875ee5e84098`.
- Full suite: 381 files / 3166 tests. An additional odd-speed rounding scenario passed afterward in the 53-case focused combat suite; TypeScript and lint passed.
- Built-in browser loaded the existing Prone combat after deployment. Standing consumed 15 of 30 ft., retained 15/22 HP, spent no action/bonus/reaction and removed its button. Reload retained the 15-ft. ledger and removed condition.
- The screenshot identified a third utility button wrapping beyond the existing hotbar height. The follow-up keeps the three utility controls in one row while Prone.
- In the actual battle, Unarmed Fighting dealt d8+3 damage. Action Surge granted and then consumed its separate action budget, allowing a second attack that defeated one wolf.

## Mixed compositions

- Added reviewed pairings: bandit/guard; kobold/giant rat; guard/tough; bandit/tough; skeleton/animated armor; wolf/dire wolf; ogre/berserker. Pairs have explicit level gates. Three-body variants only appear at L3+; initial two L1 fights remain single enemies.
- Every member still requires positive generation weight, an existing record, its minimum level and its own body cap. Total bodies and XP obey the existing encounter envelope.
- The run stores the full roster and frozen dependencies. Old single-species records still load. The same roster projection is used by navigation and battle setup.
- Checkpoints retain the last five won composition keys. A third identical composition in a row is excluded when another legal candidate exists; reserve selection cannot become empty.
- The existing reward transaction uses total roster XP and body count, preserving one-time rewards.
- 1000 deterministic successful-encounter simulations: 45–57 victories, mean 50.39, all 11 enabled monsters visited. These simulations do not measure combat survival.


## Production acceptance: 6232779

- TimeWeb and public health verified SHA `6232779fddba176e1970099ae3ebc89d238ff818`.
- Built-in browser: the L2 QA fighter defeated both wolves through ordinary Unarmed Fighting attacks, Action Surge and Second Wind. Claiming the result changed XP 300→400 and gold 18→36, retained 19/22 HP, and awarded Alchemist's Fire. Reload retained the result in the existing character sheet.
- During the deployment, an old lazy-loaded chunk failed. The existing “Load new version” recovery button restored the app; the awarded result was not lost. Asset continuity across deployments still needs improvement.
- A separate mixed-composition fixture used seed `qa-mixed-acceptance-1` at XP400 / one victory. The next encounter generated one bandit and one guard. Both performed their turns; reload retained their initiative, positions and the player's 14/22 HP. This fixture is not an unmodified full run.

## Stat-block attacks follow-up (pending deployment)

- Normal and maximum ranged distances are distinct. The shared executor folds long-range disadvantage with existing advantage/disadvantage and rejects missing distance before costs or RNG.
- Migration201 declares normal ranges and adds separate melee variants for the guard's spear, kobold's dagger, bugbear's hammer and ogre's javelin. Existing AI chooses a legal melee mode at close range.
- Fixed stat-block attack bonuses also establish melee/ranged mode without requiring an equipped player item. Condition projections therefore receive the actual mode.
- Integration tests execute hobgoblin and spider physical+poison damage, critical dice and poison immunity through the common engine and persistence. Neither stat block calls for a poison save or the Poisoned condition in SRD5.2.1.
- Hobgoblin Warrior's Darkvision is materialized and it is enabled. Spider remains gated pending climbing/sense coverage. Six of the eighteen candidates remain gated; full fighter/trusted-worker acceptance remains outstanding.


## Portable rules boundary

- Moved pure resource presentation out of the React hook/API module; the UI re-exports preserve existing imports and behavior.
- `npm run test:roguelike:headless` bundles the actual tactical engine for Node, rejects React/API dependencies, initializes a canonical fighter plus monster and executes a real monster turn (100→97 HP). No browser globals or HTTP mock are supplied.
- This proves a portable runtime boundary, not trusted production execution. The Go command transport, server-owned initialization, deterministic IDs/RNG and pinned worker dispatch still need implementation.
- Monster opportunity attacks now select a melee mode and one attack effect, including when a ranged action precedes melee or the monster has Multiattack. An integration scenario covers that ordering.
- Full offline gate passed 382 files / 3187 tests before the final boundary/opportunity follow-up; focused boundary, resource presentation and tactical scenarios also passed. Updated XP pacing with 12 enabled creatures: 44–57 victories, mean49.76 over1000 successful-encounter simulations.
- Browser potion acceptance in the mixed encounter: 14→22HP, bonus action1→0, ordinary movement and attack remained available.


## Production acceptance: 15f9915

- TimeWeb/public health verified `15f99156faaefb978c355793024cc0c8c0588346`.
- Built-in browser fixture: Hobgoblin Warrior used its longbow at range, dealt physical and poison packets, and dwarf poison resistance reduced 9 poison to 4. After the player moved adjacent, the same enemy switched to Longsword. No poison save/Poisoned condition appeared.
- This was a dedicated QA encounter, not a natural full-run acceptance.

## Trusted execution integration (not yet deployed)

- Extracted the existing character assembler and sheet combat loader into dependency-injected factories; browser wrappers retain the original APIs. The worker resolves a complete frozen dependency catalog without React or HTTP imports.
- Replaced ambient combat identities with deterministic UUIDv8 identities; the worker owns a seeded hash-stream RNG cursor and returns immutable transitions. Failed transitions cannot advance committed entropy.
- Added server-owned initialization, command execution, runtime projection and private envelope/catalog columns. Go computes before acquiring write locks, then compares both run and character revisions and commits runtime, envelope and idempotency receipt together.
- Browser actions send intents through the existing combat UI. The compatibility runtime endpoint rejects changes to trusted battles. Completion reads the private outcome. Saving throws retain the existing panel with automatic rolls only for trusted battles.
- Node dispatcher persists executable bundles by SHA256 separately from Docker image retention and checks requested hashes. Retry retains the saved catalog/artifact. The service is internal-only and authenticated.
- Local checks: offline initialization/replay and engine integration 69 tests; Go packages pass; Node transport restart/pinning/authentication test passes; headless bundle builds a pinned fighter and executes real engine transitions without browser mocks. Full regression is still running. No claim of production acceptance yet.
- Still outstanding beyond this increment: full fighter/subclass matrix, remaining gated monster mechanics, combat/economy survival simulations, full natural-run acceptance, full-run future-content pinning and old frontend asset continuity.

- Final offline regression passed: 384 files / 3197 tests. TypeScript, focused lint, headless execution and Node dispatcher tests passed.
- First worker image build stopped before any production switch because its Docker context omitted the existing weapon/charge JSON directories. Added both directories to the image inputs. Public service remained on 15f9915.
- Added a trusted-required encounter flag so a client cannot inject a legacy outcome before server initialization; regression rejects forged victory both before and after initialization.


## Production trusted-worker acceptance: 1029fe0 (in progress)

- Exact public/TimeWeb release: `1029fe0600d758cf472465189197b51bef6c0619`; backup `pre-1029fe0600d758cf472465189197b51bef6c0619-20260907T140949Z.dump`.
- Internal worker artifact: `sha256:17f22d98bbc064bdd2d1821bd81ba04415aed890b27b21647077b05f36f230a2`.
- Built-in browser retry restored XP400, one victory, gold36 and 19/22 HP in the existing sheet. The old PWA client attempted a compatibility combat PATCH and was correctly rejected before mutation. A second reload activated the new client and initialized the server fight.
- Server initialization persisted run revision20/runtime70. The public run contains combat_state but no private envelope/entropy. Movement to UI cell4,3 spent30ft. Unarmed Fighting rolled14+5 againstAC18 and dealt10 (d8=7+3), leaving Hobgoblin1HP.
- Reload preserved positions, initiative22/14, HP19/22, enemy1/11 and action0. A duplicate resume command returned revision23/runtime73 and byte-equivalent state both times. The stale browser received a revision conflict, reconciled, and its next end-turn executed once.
- Enemy turns and subsequent player attacks execute through the worker and persist. Reward acceptance is not yet complete; this is a dedicated QA encounter, not a full natural run.

- Browser completed the trusted encounter: player survived at6/22HP, defeated Hobgoblin, and claimed exactly100XP/15gp. Camp displayed500XP,51gp,two victories. The potion healed8→18HP, spent its one item and bonus action; ordinary attack remained available.
- Next follow-up: retain immutable frontend chunks across deployments and register service-worker update checks even for already-controlled tabs. The previous controller guard prevented those checks on precisely the long-lived tabs that needed them.


## Route and deployment continuity follow-up (not yet deployed)

- AI now uses bounded Dijkstra routes through unoccupied adjacent cells and executes each route step through the common movement engine. Persisted remaining steps resume even after Dash has spent the action. Movement logs are aggregated per completed segment.
- Added obstacle/barrier and saved-Dash-route scenarios; tactical/engine/interrupt suites passed99 cases. TypeScript, lint and headless worker gate passed.
- Proactive worker intents now explicitly reject off-turn actions and unresolved decisions, including movement; direct API calls cannot bypass the hotbar's disabled state.
- Retain old immutable assets for90days independently of Docker image retention. nginx fallback was tested in an isolated container: retained asset200, missing asset404. Service worker registration no longer skips already-controlled tabs.
- Remaining movement work still includes full player route/crossing semantics and broader NPC utility/reaction coverage; this increment does not certify all six gated monsters.


## Production acceptance: b4aa95a

- Exact TimeWeb/public SHA `b4aa95a1fde053dd424ea3767ea5f91d20fed232`; all four containers healthy. Full offline regression:384 files /3200 tests.
- The already-open Tough×2 fight survived deployment and reload. Second Wind healed5→10HP and committed revision39 using the original17f22d98 artifact, proving archived worker dispatch after the executable changed.
- The previous release's `/assets/index-CELMA1pU.js` returned200 as JavaScript (527966bytes). New release asset retention is active. This proves chunk continuity; preservation of unsaved Forge forms still needs separate acceptance.
- Before that fight, the existing sheet short-rest flow spent one Hit Die, healed6→16HP, restored short-rest resources and advanced the clock10→11h.

## Movement ledger and replay journal (pending deployment)

- Common movement preserves the full Dash allotment when the catalog row does not express a speed modifier. Zero-speed constraints still stop voluntary movement; explicit maximum distance cannot override the ledger; fractional/nonfinite board coordinates are rejected. Regression exercises40ft followed by20ft after JSON reload.
- Internal append-only combat events record accepted intents, actual RNG values, executable hash and before/after snapshot hashes. One baseline per combat avoids repeating catalogs. Existing fights receive a baseline at the first accepted command after rollout. Events and receipts commit in the same run/character transaction.
- The private Node replay tool dispatches the pinned artifact and includes the shared runtime projection. A real HTTP worker scenario replays three complete turns after JSON export and detects removed commands or changed hashes. Camp command receipts also retain input payloads.
- This is snapshot-plus-command replay; initialization starts from its accepted baseline, not an event-only rebuild of character/catalog assembly. No public endpoint exposes entropy.
