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


## Production replay acceptance: b13d253

- TimeWeb/public SHA `b13d2537bda9ffa93da6730aa88a624bf68de6c8`; backup `pre-b13d2537bda9ffa93da6730aa88a624bf68de6c8-20260907T162726Z.dump`. Full offline gate passed384 files /3201 tests; Go, TypeScript, lint and real-worker replay checks passed.
- In the already-open Tough×2 battle, browser Dodge and End Turn committed revisions40/41. The first journal event captured the existing17f22d98 envelope; the second recorded four actual random values. Reload preserved round2,10/22HP, NPC positions and spent/recovered resources.
- A private export was replayed with the actual archived17f22d98 executable:2 commands verified, final envelope hash `sha256:e27e275ac219425ea1aad4ba6688ee2e5f716b3a64a5ad07de3fa6d90e4b3144`. Repeating the last accepted HTTP request returned revision41 and left exactly2 events.

## Parry and individual Multiattack continuations (pending deployment)

- Added data-owned +2 AC for one triggering melee attack, with held-weapon eligibility checked both before offering and before accepting. No lasting AC modifier is stored. NPC weapons use ordinary frozen card/equipment state. Captain saves/skills and veteran skills are materialized from SRD5.2.1 pp262/337.
- AI uses an offered Parry only when it changes the known hit into a miss; it preserves the reaction on critical/unpreventable hits. Integration cases cover weapon, unarmed and spell melee attacks, ranged attacks, missing weapon, repeat attacks and reload.
- Monster compiler splits repeated stat-block attacks into single common-engine strikes with one initial action cost and a persisted tail. A reaction no longer advances initiative while movement/attack continuations remain. A scenario proves first hit→saved reaction→Parry→independently rolled second hit, with exactly one action payment.
- Migration204 was exercised against temporary copies of the two monster/card rows in production PostgreSQL and rolled back; both updates affected one row. No global content changed during that check.
- Both candidates remain gated until production reaction acceptance and remaining weapon/mixed-Multiattack coverage. Other outstanding work still includes the complete four-subclass matrix, all18 monsters, movement/AI coverage, future-content pinning and a natural full run.


## Production Parry acceptance: ef27679

- TimeWeb/public SHA `ef2767926a86035c309c0a7bf98f09a36104c602`; all four containers healthy. Backup `pre-ef2767926a86035c309c0a7bf98f09a36104c602-20260907T165231Z.dump`. Offline regression:384 files /3209 tests, Go/TypeScript/lint/headless/Node replay passed.
- Dedicated browser fixture used a1000HP fighter to sustain repeated veteran attacks; this is mechanics acceptance, not a natural run or balance sample. Veteran made two independently rolled attacks each turn and switched from crossbow to greatsword at melee range. A13+5=18 player attack triggered Parry: reaction spent, AC17 became19 for that attack, miss. A later16+5=21 attack used normalAC17 and dealt7 damage. Reload preserved round15, veteran37/65HP, fighter767/1000HP and the Parry log.
- All30 accepted commands replayed against the actual archived4b202b05 executable with identical random values and envelope hashes. Final hash `sha256:8c307ba19d10fa4f6bd90b9dd578fb4d736ef5f6dabc5846dbd4b746d3a9f1f9`.
- The preceding Tough encounter ended in defeat through browser controls. All6 journaled commands replayed against17f22d98; final hash `sha256:199b0b92824d260251868d7101969b36062669658a70859081f0c8764ee11b54`. Retry restored camp. Existing inventory equipped chainmail (AC12→16), existing shop bought supplies for20gp, existing long-rest flow restored6→22HP and consumed one supply. No duplicate camp interface was introduced.


## Undead Fortitude and movement corrections (pending deployment)

- Added a common data-owned `zero_hp_save` primitive. The monster compiler projects existing frozen Undead Fortitude metadata into a Constitution save, DC5+actual damage, remaining1HP, excluding radiant/critical damage. No healing event or reaction resource is involved. Unit and full combat tests cover success, failure, repeated use after reload, tempHP, resistance/proficiency and already-resolved spell saves.
- The combat integration caught missing critical provenance on primary damage. It now reaches the damage recipient (as riders already did). Critical hits do not independently impose concentration disadvantage; explicit rules still can.
- AI preserves saved extra movement allotments; forced movement preserves voluntary movement. Opportunity eligibility uses the actual action reach and visible target, including a10ft boundary test. Full movement continuation/route work is still outstanding.
- Zombie remains generator-gated until production acceptance. This does not certify all18 monsters or the four fighter subclasses.


## Production rollout: 83fad6b

- Exact TimeWeb/public SHA `83fad6b7e4f5e56cac45a8e9e1fd70405c5389df`; all four containers healthy. Backup `pre-83fad6b7e4f5e56cac45a8e9e1fd70405c5389df-20260907T173412Z.dump`; archive SHA256 `7d7b06bac6afa4983c7acbe7ddff466c22609bc139e6d697f5ffdbacee7f10cb`.
- Final frozen-source regression passed385 files /3220 tests. TypeScript, lint, headless engine and actual HTTP worker replay gates passed. The earlier concurrent run observed pre-fix modules and failed the two new critical scenarios; the full final rerun passed both and all existing tests.
- Dedicated three-zombie browser fixture uses1000 playerHP; not a natural run or balance sample. First fatal10damage produced CON5+3 vsDC15, failure; second zombie failed CON2+3 vsDC11 after6damage. Browser success/reload/replay acceptance is still in progress.
- Stat-block audit found omitted condition immunities and senses in existing seed data. Migration205 adds verified defenses for zombie, skeleton and animated armor, plus zombie Wisdom save proficiency. Its statements were tested against temporary production table copies and rolled back (one row each); Go tests pass. Blindsight execution and broader visibility semantics still require work; declaring a sense is not its behavioral certification.

- Browser acceptance finished: on round8 the last zombie at1HP took5damage, rolled14+3 vsDC10 and stayed at1HP. Reload preserved the state; another fatal8damage produced17+3 vsDC13 and again retained1HP. A later6damage produced3+3 vsDC11, failure. Ordinary result button returned to the existing sheet:150XP,one victory,53gp,one supply; server reward was150XP/35gp, hero965/1000HP.
- The20 accepted commands replayed with the actual e837ce7c executable: `sha256:c61f06240af040d7bead915e40efdca1bedeb35d4e4e77d5117150074963e5e9`. A transient SSH timeout on the first read did not affect gameplay; the successful read/replay followed without another game mutation.


## Defense data deployed; shared Blindsight pending deployment

- TimeWeb/public SHA `a98a2e6f950ae83dc1d949df2160696e982ac428`, backup `pre-a98a2e6f950ae83dc1d949df2160696e982ac428-20260907T175317Z.dump`, archive SHA256 `c8f01cdf60af3d827d9b7bc939809a82657c025f4cce27c6f0677f2054bd28ff`. All four containers healthy. Production rows now contain the exact three condition-immunity lists,60ft senses and zombie Wisdom proficiency. Existing fights remain on frozen data.
- New common sense resolver reads permanent and unexpired active `grant_sense` declarations, excluding unactivated abilities. Tactical visibility is directed and accounts for concealment, invisibility, blindness and in-range Blindsight. Darkvision and Tremorsense do not grant sight through fog.
- The common attack modifier collectors suppress blindness attack penalties only for an owned in-range nonvisual sense; unrelated Poisoned penalties and purely visual ability checks remain. Required-sight targeting checks the same owned range. Monster compilation now projects declared Blindsight, shared with the existing fighter style.
- Focused regression includes a JSON-restored blinded fighter attacking an invisible target without extra dice, and rejecting required-sight targeting outside its range. The final full regression passed386 files /3225 tests; TypeScript and lint passed. Browser acceptance with the actual FEAT-0060 choice is prepared but has not initialized combat yet.
- Lighting, physical occlusion and complete movement continuations remain separate outstanding work; this increment does not claim the entire original plan is accepted.


## Blindsight production acceptance; senses/skills migration

- TimeWeb/public SHA `7ae3d189e9010e8f4c77512b8d6fbe0640b39de8`; four healthy containers. Backup `pre-7ae3d189e9010e8f4c77512b8d6fbe0640b39de8-20260907T181115Z.dump`; archive SHA256 `01ce56248ddac49cba23686b90c4aa5a764fce0cf1428815737708ec9778258c`.
- Actual FEAT-0060 selected on a dedicated blinded QA fighter. Initial distant crossbow attack rolled16/8 with advantage; after moving within5ft, fighter attacks rolled single7,16,8 and dealt4 each. Adjacent bandit also rolled a single8. Reload preserved round1, fighter991HP, bandit7HP and position. Victory round3 returned to the existing sheet:25XP, one win,36gp. Sheet displays permanent10ft Blindsight and the retained Blinded condition. This1000HP mechanics fixture is not a natural run; the ordinary sheet derives13 maxHP from the real level-one build.
- All6 accepted combat commands replayed exactly against archived artifact `sha256:6ee8bd4cac0c30813f1187d07be3aa61f0f1e66d2659d8d73bbfb2a0e9136f21`; final envelope hash `sha256:af20405e88c7e6d7d70977f32aa13d3aceef4a3d86bc7147b3b486d21d8e0b2f`.
- Migration206 fills SRD5.2.1 senses and skill/save proficiency for ten stat blocks, including Perception expertise for wolves, Stealth expertise for goblin/spider/bugbear, rat Dexterity saves and spider10ft Blindsight. Go tests pass; exact SQL ran on temporary production table copies with one affected row each and ROLLBACK. Generator gates and complex traits are unchanged; this is not full18-monster certification.


## Senses/skills deployed; Bloodied Frenzy runtime fix

- TimeWeb/public SHA `2914da1161f7ab3f46f4bf0d5c8bb44b2fd1ccb3`; four healthy containers. Backup `pre-2914da1161f7ab3f46f4bf0d5c8bb44b2fd1ccb3-20260907T182115Z.dump`; archive SHA256 `9df4fd8a107817f67916f0b37650733911d08a9cb1076b2cfab357653eb4f252`. Read-only production verification confirmed all ten migrated rows.
- Audit caught Bloodied Frenzy implemented only around ordinary AI attacks. The monster compiler now emits shared carrier-HP-gated attack and saving-throw modifiers; temporary hit points are excluded. Reactions use the same rules. The former attack-only controller branch is removed.
- Unit tests cover odd/even half-HP boundaries, healing, reload, disadvantage cancellation and invalid data. Real combat integration verifies one/two save dice at34/33HP out of67, and one/two attack dice on an opportunity attack (plus its damage die). Full regression:387 files /3231 tests. TypeScript, lint, headless and actual HTTP-worker replay gates pass.
- A dedicated berserker browser fixture is prepared but not initialized; it must use the next deployed artifact. Full movement continuations, all subclasses and a natural full run remain outstanding.


## Bloodied Frenzy accepted; interrupted movement continuation

- TimeWeb/public SHA `52775279ec6d78c6c95c318810501866cdedbb21`; four healthy containers. Backup `pre-52775279ec6d78c6c95c318810501866cdedbb21-20260907T183113Z.dump`; archive SHA256 `27d16abe490f3a77077d585d1d43533e8d93cd080041698c7f62ff7c4a38aacd`.
- Browser fixture: at67/67HP berserker's shove save rolled one9+3 vsDC13. At24/67HP its attack rolled20/11 (critical); reload retained round13 and player936HP. Repeated shove then rolled17/16+3 vsDC13 (success). A provoked attack rolled5/2+5 vsAC16 (miss) and spent one reaction. Victory round16 returned to the sheet with450XP,30gp and the ordinary Forge level-two link. This1000HP mechanics fixture is not a natural run.
- All33 commands replayed exactly against archived artifact `sha256:daf395987bcd5a29a16c0b9e863d198d60721ca8cab2cfbfd3a5b6d148f2250b`; final envelope hash `sha256:339cc49d6ba887f9fc4177a1d175a54b4bb7c81e69016d5bb47aa1bc715c0953`.
- Movement now retains a pending destination/origin and processed opportunity reactors. A player decision pauses before position/budget mutation. Common resume after decisions prevents duplicate attacks and declined War Caster choices, processes remaining reactors, and cancels stale movement after displacement/death/speed-zero. NPC route continuation skips an already completed step. War Caster choice includes the ordinary melee attack.
- The new Sentinel test caught an older out-of-turn rider failure. A source-owned reaction continuation retains the rider's mechanics/costs and does not enter the proactive hotbar. A saved hit applies speed-zero before the pending movement, even outside the owner's turn.
- Regression:387 files /3236 tests; TypeScript/lint/headless/HTTP worker replay pass. Focused tests cover Parry accept/decline after JSON reload, two sequential reactors, declined War Caster and Sentinel cancellation. Production browser acceptance pending.
- Still outstanding: full traversable player routes and per-step area/entry reactions, player opportunity-action assembly for builds without the legacy weapon-attack effect, all subclass coverage and the natural full-run acceptance. Existing QA unarmed build has no player opportunity action; this is not hidden by the continuation fixture, which explicitly supplies a melee reaction.


## Interrupted movement accepted; zombie generator gate removed

- TimeWeb/public SHA `e5b2beee0e3a08bc9e21b22e213d9402a7942654`; all four containers healthy. Backup `pre-e5b2beee0e3a08bc9e21b22e213d9402a7942654-20260907T185331Z.dump`; archive SHA256 `cdba84d1bc3c160ab0461aacb94a171519ca243ed9f92ea10067f6cf5a2968f8`.
- Browser mechanics fixture directly grants Defensive Duelist and1000HP, carries/equips the ordinary CARD-0297 dagger, faces three berserkers. It does not test legal feat acquisition. On round2, movement fromUI8,10 to9,10 paused at the original cell with995HP and30ft while a melee hit awaited the defender's reaction. Reload preserved that exact state and the reaction buttons. Choosing Defensive Duelist resolved the saved16+5 attack, then the remaining reactor rolled20+5; only after both did the hero move to9,10 with978HP and25ft. A second reload retained the completed step and reaction0/1.
- All5 accepted commands replayed identically against archived `sha256:e49008b782a23ebd2b5835778775c94f70f057c0822b288f8fc5d5dd4a67b3fc`; final hash `sha256:8b7456560c38807a5997ac1bac391e434989e8e9550ee624bed64bde316bbb27`. The fixture battle remains active for further reaction work.
- Zombie is now enabled in the encounter pool after Undead Fortitude/defense browser and replay acceptance. Positive generator entries increase12→13. Existing pacing simulation now asserts every enabled entry is actually encountered;1000 successful-encounter sequences yield44–57 encounters, mean49.48, zombie2396 visits. This measures XP pacing, not combat survival/economy. Offline Go suite passes; database-gated tests are not claimed as executed in this domain-only change.

## Zombie pool deployed; shared Pack Tactics

- TimeWeb/public SHA `3d0d435029ab47f79ee53a9f0af551eca5ce9b90`; all four containers healthy. Backup `pre-3d0d435029ab47f79ee53a9f0af551eca5ce9b90-20260907T190543Z.dump`; archive SHA256 `125df1d642ebc23cf2ea976dcd605d8896e2c6451f2c2ebddab91e7ccef98039`.
- Pack Tactics is now a common passive attack modifier using the existing spatial fact for an eligible ally within5ft of the target. This replaces the ordinary-AI-attack wrapper and also applies to opportunity attacks. Far, dead and incapacitated allies do not qualify; prone allies do. A spent ally reaction does not disable the trait.
- Full regression passes387 files /3241 tests, plus TypeScript, lint, headless rules and actual HTTP worker replay. Five integration scenarios verify reaction dice, resource use and movement after JSON reload. Production acceptance is pending; remaining subclass, movement and natural-run work is not claimed complete.

## Pack Tactics production acceptance; local development switch

- TimeWeb/public SHA `2b0f83e486ba39e52f23fddf73dd5884661b7c81`, four healthy containers. Backup `pre-2b0f83e486ba39e52f23fddf73dd5884661b7c81-20260907T191338Z.dump`; archive SHA256 `38bd913e10cdac87cdf8c0eeb488f406c3756fc4cc76f2dbf611107bb9f21d46`.
- Three-wolf browser fixture: hero stood up, then left their reach. The first opportunity attack against the standing hero rolled11/3+4 (miss), the second18/2+4 hit for3 and knocked prone, the third6/6+4 missed. Each spent one reaction. Reload retained974HP and the completed movement. Two commands replayed exactly against artifact `sha256:02891bdfdb6ef24014e4ae9d6a9f5439860cc1ff559975a74111cb6dd095054d`; final hash `sha256:87a45f566b6d202187a675db5721aa7d122184f73a0b563d854da30436803eae`.
- That browser test exposed a separate movement-cost bug: becoming prone during the reaction still charged the earlier standing cost. The next local increment recomputes the cost after reactions, retains resolved damage and cancels an unaffordable step. Tests cover5ft and15ft remaining budgets.
- User requested local deployment and DB testing instead of intermediate TimeWeb releases. Created isolated local PostgreSQL database `boh_roguelike_20260907` from the latest backup, with22 undeleted monsters and migration206. Existing local databases remain intact. Local API8080, rules worker8090 and Vite3000 are running; credentials stay outside Git. Vite relative API proxy now defaults to the local API, with explicit `DEV_API_PROXY_TARGET` override.
- The shared sheet pending-decision panel now supports both Shove outcomes. Player choices pause system auto-resolution and use an owned server intent; NPC choices remain automatic. Browser local fixture at `1edc7030-ba48-4a65-95e8-8ce39c433762`: bandit failed1+1 vsDC13, choice survived reload, Prone applied without displacement; NPC spent15ft standing next turn. A second successful shove explicitly pushed the bandit fromUI3,2 to2,1. No additional interface or visual language was introduced.
- Full regression387 files /3244 tests; TypeScript, lint, headless rules and rebuilt HTTP-worker/replay gates pass. Local artifact `sha256:fc966aac5458c89f8fa117b6c08c4c00ace58e4391b3382a3460cf129b782b4a`. First three local commands replayed exactly, final hash `sha256:504396ccb782aa79c3201d6a539363959016c3cb2fbf9ee65c372d17c932ad85` (later second-shove commands will be exported separately).
- These are mechanics fixtures with1000HP, not natural progression or survival/balance acceptance. No TimeWeb deployment was started after the user's local-testing instruction.

- Local wolf acceptance: hero stood (30→15ft), then provoked three bites; the hits knocked the hero prone. The5ft step correctly cost10ft, leaving5ft and961HP atUI7,10. Reload retained the result. Three commands replay exactly; final hash `sha256:ed26f8355a317788bc034f59c4aada9fbee4db73e066eadf1796596469afa1b7`. The completed six-command Shove sequence also replays exactly; final hash `sha256:eafd2216bab644f515d7cda703e04e52370e45cf35e847c2e689b1584e80c787`.
- Added `scripts/start-roguelike-local.ps1` and local development instructions. PowerShell parsing and Vite config typecheck pass. Existing API/worker/frontend processes and dedicated PostgreSQL remain available for the next iterations.
## Long-combat event cursor accepted locally

- Reactions, post-hit features, Interception and D20 previews used the bounded UI-log array length as an event offset. Once80 rows were retained, new attacks could become invisible to these mechanics. New log entries carry a monotonic sequence; all recent-event consumers use that cursor. Legacy saves without sequence migrate on their next entry and retain pending cursors. The visible history remains bounded to80 rows.
- Regression covers Sentinel with short history, full legacy history and a160-event cursor, including a saved defender decision; Crusher remains available after qualifying damage and once per turn at cursor160. Full387 files /3247 tests pass; TypeScript, lint, headless and rebuilt HTTP-worker replay pass.
- Local browser fixture directly grants FEAT-0026, equips the ordinary CARD-0298 mace, has1000HP and faces a67HP berserker. It is not a legal-build-acquisition or balance test. Sixteen ordinary end-turn clicks yielded83 log events. Round17 mace hit18+5 vsAC13 for4damage, opening Crusher; reload retained the choice. Applying it pushed the target fromUI6,8 to5,7, leaving63HP and hero906HP.
- All18 commands replay exactly against local artifact `sha256:3bfe2bf54848e9d832758d4e7f583effa7a92ea74b4e1723852a7aab855c6ba7`, final hash `sha256:0a9f5c547f86b90bf5113ca5ea42d0c53cbff1b690b9df16140844f92ca4f2da`.
- Further audit found the current Crusher content unnecessarily restricts its push to the basic weapon card; unarmed bludgeoning coverage and its critical-hit rider need a separate content/runtime repair. Canonical player opportunity-action assembly and the larger original-plan gaps remain outstanding.
## Character opportunity attack assembly accepted locally

- Canonical weapon/unarmed attack definitions moved into a shared rules-core module; ordinary Attack entries and reaction projections reuse them. Every sheet character now gets actor-scoped melee weapon options and a style-aware unarmed damage option, including builds with no legacy weapon-attack effect. Only actual melee attack modes are offered, with separate5ft/10ft reach boundaries; ranged-only weapons do not become ranged opportunity shots. Reactions remain outside the proactive hotbar.
- Controlled characters explicitly choose or decline through the existing reaction panel. The movement continuation records the pending reactor before the choice, so Sentinel also works after an accepted player reaction. Tests cover armed/unarmed damage, d6/d8 fighting-style qualification, no action spending, declined reactions, ranged-only equipment and both reach boundaries.
- Full387 files /3251 tests, TypeScript/lint/headless and rebuilt HTTP-worker/replay pass. Local artifact `sha256:f87f12a579acfd7e6da4b726e44ef8b9205cecc8e301f3485288695a152a6d3c`.
- Browser mechanics fixture `180338e8-0c2b-4dad-ac3e-b212e3265699` uses1000HP and an explicitly arranged NPC route. After API initialization, only its token positions and saved NPC route were arranged in the isolated local DB. The untouched initialization journal was archived separately, and its sole local baseline removed before any browser play; the first UI command recorded the arranged state as its pre-command baseline. No entropy or dice were edited. This tests reaction continuation, not natural AI movement or balance.
- End Turn paused the bandit before leaving5ft. Reload retained the unarmed-reaction choice. Choosing it rolled8+5 vsAC12, hit for1d8(1)+3=4 and spent one reaction. Bandit completed the5ft step, fired a crossbow (miss), and returned initiative. Both UI commands replay exactly from the arranged baseline; final hash `sha256:74ca88b10c77673d3d129d9c2301e865f80c01128db84e32d9c830cf49c95e1f`.
- Remaining work includes unarmed grapple/shove alternatives during opportunity windows, optional mastery/post-hit continuations on reactions, complete equipment handling, subclasses, all planned monsters and natural full-run acceptance. This increment does not certify those unfinished systems.

## Ranged positioning and reaction-aware routes accepted locally

- A declared preferred range now guides both approach and retreat. Among positions permitting an attack, the controller prefers fewer available enemy opportunity reactions before optimizing distance and movement cost. Monsters without an explicit range preference retain their previous positioning policy.
- Route assessment and actual movement share the same opportunity eligibility: melee reach boundaries, relation, HP, available/non-denied reaction, sight, Disengage and Sentinel. Assessment counts each reactor once and neither rolls nor changes the saved world. It evaluates the existing reachable routes; alternative longer safe routes, Polearm Master entry risk and area-damage forecasting remain separate work.
- Full regression: 387 files / 3253 tests; TypeScript, lint, headless and rebuilt HTTP-worker/replay gates pass. Local worker artifact `sha256:ba6cfcc87ec9472c04c89e770209b7e792d37434e47b3c02341a232cafa73de8`.
- Built-in browser run `649a564f-ffdb-4d4f-b1f6-57efc0fbb947`, character `0fafe004-d816-4306-901c-97769dd10bbb`: ordinary catalog bandit, isolated 1000HP mechanics fixture. The roster was selected in local SQL before initialization; token positions, resources, rolls and subsequent commands were not edited. Hero moved from UI7,9 to4,3. Adjacent bandit stayed at3,2 and hit with its scimitar for3. Hero then stepped to4,4, taking a3-damage opportunity hit. On its next turn the bandit followed a30ft route to9,1 and fired its light crossbow for2; hero992HP, round3. Reload retained the result.
- All four browser commands replay exactly against the archived artifact; final hash `sha256:c1a3b4e9deb836d7f209a978d60a853f2c98aaa60dcea6f23d1826ae43a232c5`. This verifies controller behavior and persistence, not full-run survival balance. No intermediate TimeWeb deployment was performed.

## Player routes accepted locally, 2026-09-08

- Player movement in both the ordinary combat page and the trusted worker now plans with the same bounded Dijkstra grid as NPC movement. Destination highlights use this reachability too. Each adjacent step uses the existing movement executor, including occupied cells, terrain/crawling cost, reactions and area transitions. A persisted player route continues after a decision; it stops on death, displacement, zero speed, insufficient movement or a newly blocked cell instead of replacing the route.
- Focused tests cover accepted/declined Parry after JSON reload, exact remaining movement and no repeated attack. A hazardous-column test proves that lethal entry damage stops the mover on the intermediate cell, not at the requested destination. Full 387 files / 3256 tests pass, plus TypeScript/lint/headless and rebuilt HTTP-worker replay.
- Local services had stopped between sessions. Docker startup failed on two stale zero-byte socket reparse points (`Docker/run/dockerInference` and `docker-secrets-engine/engine.sock`). Their runtime-only parent directories were retained under dated backup names after stopping the failed Docker processes. Docker and the existing PostgreSQL container restarted successfully; no DB volume or data directory was reset. API8080, worker8090 and Vite3000 were restarted against the same isolated database.
- Browser mechanics fixture run `5b7bf70d-be04-4ced-bb29-570d35a9845f`, character `3c0c571a-6c26-45d9-a328-196ba27da605`, uses 1000HP, directly granted Defensive Duelist and the ordinary dagger. Three actual catalog berserkers were selected before initialization; no subsequent runtime or dice edits. First25ft route completed after an opportunity miss. On round2, the route from UI12,9 to7,10 paused at10,9 after two paid steps: two reactors missed, the third rolled11+5 vsAC16. Reload retained1000HP,20ft and the choice. Defensive Duelist changed the saved roll to a miss againstAC18; the remaining three steps completed at7,10 with5ft and one spent reaction.
- All four browser commands replay exactly against artifact `sha256:f7934b6e475adb494f907cc76768140507facaab9848690a4d1cc3b9c47973f1`; final hash `sha256:d9c84be16c18e1bfe6e55a506eaa648ba1b4be003ee6a7e59082a106b64a1f19`. This is movement/reaction acceptance, not natural-run or subclass completion. Multiple simultaneous Polearm Master entry reactors and optional extra movement abilities still require work.

## Multiple reach-entry reactions accepted locally

- Polearm Master entry reactions now retain a queue of remaining actors across choices and JSON reload. Before each reaction the executor rechecks the held weapon, reach, incapacitation, reaction availability and the mover's current position. Area triggers wait until the entry-reaction queue finishes. An unavailable second actor is skipped without rolling; declining the first does not spend its reaction.
- Extended integration coverage verifies two controlled guards, first decline/second accept, reload, an unavailable queued actor and area-notice ordering. Full 387 files / 3256 tests pass; TypeScript/lint/headless and rebuilt HTTP-worker replay pass.
- Local run `3033b298-f6b1-4938-af09-c70f03bd7863`, character `e509a617-c427-4dc4-8d4f-aef69d6982dc`: arranged mechanics fixture with1000HP, directly granted Polearm Master and CARD-0305 staff. An extra controlled guard and a one-step NPC route were arranged in the isolated DB after initialization. The sole initialization journal was archived privately, then removed only from this fresh fixture before browser play, so its first accepted command records the arranged baseline. No entropy or rolls were edited; this does not test natural party acquisition or solo-run balance.
- End Turn moved the bandit from UI5,7 to5,6 and opened the first guard's entry reaction. Declining opened the second guard's choice; reload preserved it. The second guard's staff hit15+5 vsAC12 for1d8(7)+3=10, leaving bandit1HP. The bandit then attacked with its scimitar (6+3, miss) and returned initiative. Three browser commands replay exactly against artifact `sha256:e554eaf874d5000d37082e1a3c99b653a901aa3d1bbbf10a18a9acbc6de639c8`; final hash `sha256:f22f5f4859a10da86c3db0b5ed85bd72b4da060e3cc4e5ccaf0eddeaa16e9f0a`.
- Browser inspection exposed presentation debt: the reaction window does not identify the acting character and calls the entry attack an opportunity attack. Its options also use text instead of the sheet's visual action rows. These presentation fixes are next; extra movement abilities and the original subclass/full-run scope remain unfinished.

## Reaction presentation reuses the sheet

- The existing post-hit/reaction dialog now renders `SheetActionLine` rows with the saved action/spell or weapon illustration, description and existing preview behavior. It identifies the deciding actor, removes repeated suffixes from option labels and distinguishes the entry-attack prompt from a leaving-reach opportunity attack. Shared sheet row CSS is preserved instead of inheriting the dialog's plain-button styling.
- TypeScript and lint pass. This changes presentation only; the immediately preceding full rules regression remains387/3256. No additional rules-worker release was needed.
- Built-in browser run `ff7bca65-a3b2-4df1-805c-0e77998bac53`, character `ad12e101-72c7-4c3d-a568-e014a38c136b`, uses a1000HP Polearm Master mechanics fixture and one actual berserker. The NPC approached through its normal AI route. Visual inspection confirmed the deciding actor, correct entry prompt and illustrated staff row. Reload retained the choice. Clicking the row executed the saved reaction (natural1, miss), after which the berserker attacked and returned initiative. No positions, decisions or entropy were edited in this fixture.
