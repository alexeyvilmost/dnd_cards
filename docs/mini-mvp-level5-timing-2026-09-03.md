# Mini-MVP level-5 timing log — 2026-09-03

Timezone: Europe/Moscow (MSK, UTC+3). Deadline: 15:00 MSK.

This log records wall-clock duration for major work and the slowest individual actions. It is updated during the run; the final section must be reconciled before handoff.

## Major steps

| Time (MSK) | Step | Wall time | Result / bottleneck |
|---|---|---:|---|
| 08:47–09:05 | Level-2/3 spell inventory, migration 166 and Go verification (agent) | 16m 55s | 115 PHB spells normalized. Implementation/iteration was about 9m; PDF extraction was the slowest single read at about 72s. |
| 08:48–09:06, interrupted 08:49–09:00 | Exact level-5 scope manifest and report (agent) | about 6m active | 223-row denominator produced. Authoring was longest; source/PDF checks were about 50s aggregate. |
| 08:48–09:13 | Progression and subclass depth audit (agent) | about 5m active for audit | Found missing level-4/5 producers and the secondary-subclass persistence/gating defect. A CodeGraph call took 27.8s. |
| 08:49–09:00 | Isolated production-clone local stack (agent) | about 11m | Docker Desktop startup took 77s and was the largest avoidable wait. Snapshot download took about 40s, checksum 4.2s, restore 17.7s, backend start 10s, frontend start 0.54s. |
| 09:00–09:07 | Persistent-area runtime follow-up | about 7m | Added event-specific hazards and in-area damage immunities. Two failed focused iterations exposed missing hazard catalog registration and an existing saved-hazard damage mutation bug. Final focused run passed 25/25 in 3.85s. |
| 09:07–09:09 | Progression/multiclass automated regression set | 10.39s | 8 files / 48 tests passed. |
| 09:08 | Full TypeScript typecheck | 41.05s | Passed. This is currently the slowest recurring local verification command. |
| 09:09–09:10 | Exact level-3/5 manifest tests | 0.19s | 9/9 passed. |
| 09:10 | Apply migration 166 to production-shaped local clone | 7.7s | Correctly blocked: postcondition failed for 60 rows. No production deployment occurred. |
| 09:11–09:23 | Repair and revalidate migration 166 (agent) | 12m 07s | Production-clone application passed after normalizing the real catalog shape. |
| 09:23–09:35 | Level-2/3 spell targeting and area follow-up (agent) | 11m 31s | Closed targeting geometry and Web obscurity gaps; 115 rows remain explicitly untested. |
| 08:48–09:22 | Level-4/5 progression producer migration 167 (agent) | 34m 17s | Longest completed implementation step so far: 12 classes, 48 subclasses and 15 species unlocks share one producer. |
| 09:00–09:10 | Multiclass persistence migration 168 and repair (agent) | about 10m | Added per-class levels/subclasses and fixed edit/Forge persistence. |
| 09:11–09:41 | Level-4 General-feat gate migration 170 (agent) | about 30m | 21m inventory/audit plus 9m implementation; exact 43-feat eligibility and ability-cap gate. |
| 09:13–09:50 | General-feat data/signature migration 172 (agent) | about 37m | 33 non-spell feats materialized. Cross-cutting runtime consumers, not row authoring, are the bottleneck. |
| 09:30–09:44 | Local browser: Fighter, Wizard and multiclass progression | about 14m | Retained three characters; found the Extra Attack ledger defect and the Wizard repeated-mechanics-source combat blocker; proved Fighter→Rogue subclass persistence. |
| 09:40 | Expand executable manifest from 223 to 266 rows | 2m 06s | Added exact 43 General feats; level-5 manifest 7/7 passed in 0.12s. |
| 09:41–10:10 | Attack-ledger/runtime hardening migration 169 (agent) | 29m 17s | Repaired canonical Unarmed Strike ledger, exact-instance Wizard spell choices, level-gated historical choices and Uncanny Dodge. Attack-ledger work was the longest substep at about 14m 30s. |
| 09:32–10:08 | General spell-feat migration 171 and runtime (agent) | 35m 35s | Nine feats, seven actions and spell-choice/runtime bridges. Production-clone failures and final idempotency/signature audit consumed about 15m 14s. |
| 09:50–10:14 | General-feat damage runtime (agent) | about 24m | Heavy Armor Master complete; GWM, Crusher, Piercer and Slasher partial. Missing generic continuation/dialog primitives remain the main cost. |
| 10:01–10:02 | Level-5 workbook rebuild | 35.4s | Preserved all accepted rows; added 91 General-feat and 115 level-2/3 spell checklist rows. |
| 10:02–10:04 | Workbook compare and six-sheet visual QA | about 2m | No accepted rows missing; all six sheets rendered without formula/layout corruption. |
| 10:04–10:14 | Local browser retest: multiclass, Wizard and Fighter | about 10m | Multiclass General-feat gate passed end to end. Browser exposed Drow spell-access and Extra Attack hotbar gaps. Safe stale-combat reset passed. |
| 10:04–10:14 | Stale combat rules-snapshot recovery (agent) | about 10m | Added explicit one-click reset that preserves character and unrelated turn-state owners; 6 tests and typecheck passed. |
| 10:02–10:14 | General-feat Forge acquisition audit (agent) | about 12m | 43/43 ability gates audited; fixed production wording for medium-armor prerequisite. Spell Sniper, Weapon Master, Observant and Keen Mind secondary-choice gaps remain in progress. |
| 10:14–10:24 | Four General-feat acquisition/action repairs | about 13m | Closed the immediate Forge/action payload gaps for Spell Sniper, Weapon Master, Observant and Keen Mind; lifecycle behavior still requires browser proof. |
| 10:14–10:24 | Extra Attack browser/runtime follow-up | about 10m (34m cumulative attack work) | Fixed solo-adapter ledger reuse. Browser proved two normal attacks plus two fresh Action Surge attacks and blocked a fifth. |
| 10:14–10:24 | Wizard prepared-choice repair | 2m 31s | Later-level Wizard choices were incorrectly filtered out of the prepared pool; 41 focused tests and typecheck passed. |
| 10:14–10:24 | Exact 43-General-feat runtime audit | 9m 15s | 12 executable in principle, 19 partial, 12 descriptive-only. This audit prevents catalog presence from being misreported as support. |
| 10:22–10:38 | Local browser and targeted repair pass | about 16m | Verified Fighter Extra Attack/Action Surge, repaired scene character addition, normalized Wizard cantrip access/growth, exercised Fireball and Web, and fixed duplicate half-damage preview. Web exposed a strict generic-condition violation. |
| 10:26–10:57 | Level-3–5 class/species/subclass runtime audit (agent) | about 31m | Exact audit covered 12 classes, 48 subclasses, 15 species unlocks and all 43 General feats. Subclass action/trigger inspection was longest at about 10m and found hidden limited actions, unsupported result-level resource spending and missing event emitters. |
| 10:38–10:53 | General-feat choice/discovery and duplicate-grant repairs | about 15m | Fixed nested Telekinetic action discovery, repeat-instance option exclusion, atomic Resilient choice, Durable death-save filtering and valid duplicate spell grants across independent sources. Focused run: 7 files / 111 tests. |
| 10:48–10:53 | Local browser: Resilient acquisition/sheet clarity | about 5m | Retained Fighter 4 `8ccd5364-0ded-4fc9-b2d5-79d53f63be34`; Forge correctly disabled existing save proficiencies, DEX 14→15 and DEX save +4 were visible and the rule card was clear. Combat-specific save remains open. |
| 10:42–10:57 | Level-5 base progression repair migration 179 (agent) | about 15m | Repaired prepared-spell totals, Warlock invocation progression, Favored Enemy uses, Sneak Attack scaling and Second Wind count/formula. Production-clone/schema audit was longest at about 7m. |
| 10:47–10:57 | Missing level-1–5 Warlock invocation catalog migration 180 (agent) | about 10m | Added the 13 absent invocations and rebuilt the exact 22-option denominator. Canonical SRD/spell-ID audit was longest at about 4m; four board/companion-dependent invocations remain explicitly consumer-limited. |
| 10:58–10:59 | Authorized local login confirmation | about 1m | Existing authenticated browser session remained valid and the retained General-feat QA sheet loaded. Production login was authorized but intentionally deferred until a locally coherent release is ready. |
| 10:48–11:12 | Strict data-driven condition repair migration 177 (agent) | 24m 30s | Repaired 161 exact action/effect rows and eliminated generic condition payloads in the level-5 slice. Source-row normalization was the longest substep at about 9m. |
| 10:59–11:15 | Shared limited granted-action resource plumbing (agent) | about 16m | Granted actions now participate in sheet/combat resource initialization, reconciliation, rest and per-turn recovery. Focused verification was the longest substep at about 8m; two typechecks took about 78s together. |
| 11:03–11:15 | Browser Web, persisted-scene and War Caster repair | about 12m | Two save/reload cycles exposed separate stale-world and derived spell-access defects. Web then retained its exact `COND-restrained` library effect, hover details and speed/roll modifiers across a clean reload. |
| 11:06–11:15 | Subclass action repair migration 181 (agent) | 8m 46s | Repaired 15 actions: activation costs, Focus key, bounded uses and Nature's Wrath strict condition. The 5m 34s catalog/action audit was longest. |
| 11:15–11:18 | Migration 181 integration and coherent frontend verification | about 3m | Registry edit and Go migration suite passed in 5.0s; local restart applied migration 181. Eight focused frontend files passed 88/88 in 6.37s. Typecheck initially exposed seven compile errors from concurrent work, fixed in one edit pass; clean rerun took about 32s. |
| 11:16–11:43 | Complete 43-General-feat runtime audit and bounded repair (agent) | about 27m | Runtime tracing/implementation was longest at about 20m. Repaired nine additional feat paths and source-turn Slasher expiry. Focused runtime 67/67, catalog/projection 35/35 and manifest 7/7 passed; browser certification remains open. |
| 11:16–11:33 | Level-3/5 species integrity repair (agent) | about 17m | Materialized the three Aasimar revelation branches, Goliath Large Form and a generic once-per-turn damage-rider ledger. Production-clone replay and 23 frontend tests passed; mobile-emanation/flight limitations remain explicit. |
| 11:21–11:26 | Local browser: Monk 2→3→4→5 | about 5m | Retained Monk `7ca8a067-3fb5-47c0-a8bd-d070199f447f`; selected Open Hand and Telekinetic (WIS), and verified Focus 5/5, d8 Martial Arts, Extra Attack and Stunning Strike on the sheet. |
| 11:26–11:44 | Monk combat-certificate and system-unarmed debug/fix | about 18m | Longest root-agent debugging block in this phase. Three separate boundaries misclassified triggered unarmed riders, revalidated an actor-bound strike as the base catalog action, or dropped Monk variables/ability modifiers in the system strike. Four focused certificate files passed 34/34; RulesSession regression passed 11/11. |
| 11:36–11:52 | Persisted d20 interrupts: Cutting Words and Warding Flare (agent) | 16m 04s | Architecture/resource audit plus implementation was longest at 7m. Added pre-roll Disadvantage, after-success die subtraction, persisted RNG, monster pause/resume and UI; focused runtime 7/7 plus migration/resource/lint gates passed. |
| 11:44–11:53 | Local browser: Monk level-5 combat proof | about 9m | Proved DEX attack, d8 damage, two-entry Extra Attack ledger, focus spending, Stunning Strike save/exact condition card and Flurry cost. Target death ended Flurry after its first resolved strike, so a two-live-target proof remains open. |
| 11:53–11:54 | Register/apply migrations 182–184 locally | about 1m | Migration suite passed in 1.13s; backend restart applied General-feat, species and d20-interrupt migrations in one attempt. |
| 11:54–11:55 | Full TypeScript integration check | about 41s | Found only two fixture-cast errors in the new unarmed projection test; both were corrected with the intended `unknown` boundary. |
| 11:50–12:29 | Deep General-feat runtime pass (agent) | about 39m | Raised the exact census to 24 executable / 17 partial / 2 unsupported. Migration replay debugging was longest at about 10m; full typechecks took about 42s each. |
| 11:48–12:26 | Level-2/3 spell integrity audit and migration 186 (agent) | about 38m | Audited all 115 spells as 16 supported / 41 partial / 58 unsupported and repaired all targeting contracts. Semantic effect design was the longest substep at about 9m. |
| 12:03–12:30 | Class/subclass integrity audit and migration 185 (agent) | about 27m measured implementation/final window | Audited 33 base gates and 99 subclass progression effects; manual recursive tracing was the dominant uninstrumented phase. Full TypeScript validation was the longest measured command at 43.6s. |
| 12:04–12:15 | Actor-bound weapon certification diagnosis and first Nick pass | about 11m | Browser exposed an equipped 5-foot offhand attack being compared with an unbound 600-foot template. The actor-bound projection fix and focused regression closed it. |
| 12:17–12:26 | Correct Light/Nick browser sequence and UI hardening | about 9m | Two Shortsword attacks plus one Nick Scimitar attack passed without Bonus Action spend; Vex advantage was consumed. Fixed the stale enabled button/Bonus Action hover after once-per-turn Nick use. |
| 12:26–12:29 | Apply migrations 185–186 and Bard Lore browser check | about 3m | Local migration/restart succeeded. Lore exposed the required 3-of-18 skill choice after the full QA catalog was enabled. |
| 12:30–12:32 | Refresh amended migration 182 in the persistent local clone | about 2m | Browser initially saw stale ASI data because migration 182 had been amended after its first local application. Removed only the local version marker and replayed the idempotent migration; backend returned immediately. |
| 12:16–12:33 | Level-up/multiclass deep integrity pass (agent) | 16m 04s | Owning-class gates, invocation levels, stale attack profiles, secondary Hit Dice and multiclass slots repaired. Implementation plus focused tests was longest at 6m 15s; 132/132 passed. |
| 12:36–12:40 | Required-subclass backend boundary | about 4m | Added fail-closed create/update validation once a class reaches its subclass threshold. One missing import caused a 4.2s failed test iteration; the corrected full backend rerun passed in 9.28s. |
| 12:27–12:45 | Forge level-4 ASI/General-feat controls and browser proof | about 18m | Stale local migration data cost about 6m; tracing cost about 4m, implementation about 3m, and browser verification about 5m. Both +2 and +1/+1 ASI layouts saved correctly; Shield Master was restored with its Strength choice. |
| 12:40–12:48 | Release-readiness audit and exact changed-test surface | about 8m root integration, audit ran in parallel | Explicit 51-file/480-test selection found one stale label assertion; the focused correction passed 11/11. No retired corpus result was used. |
| 12:43–12:50 | Fresh production-snapshot migration-order replay | about 7m elapsed, 17.8s measured restore/apply | Restored the migration-164 snapshot in 14.8s and applied 165→186 in exact registry order in about 3s. Investigation/setup, not database execution, dominated elapsed time. |
| 12:43–12:51 | Release identity, condition authority and certificate regeneration (agent) | about 7m 30s | Investigation/contract decision was longest at about 3m. Overlay/effects took 21.18s, certificate suite 19.58s, generation 15.6s and drift check 14.9s. |
| 12:51–12:57 | Protection weapon-bridge and post-hit continuation repair | about 6m | Browser exposed an `InvalidFacts` rejection, then a deterministic test exposed the second-stage dropped trigger. Final focused result: 45/45 in 3.44s. |
| 12:57 | Final backend release gate | 8.02s measured | `go test ./...` passed in 6.59s; `go vet ./...` passed in 1.43s. |
| 12:50–12:52 | Timecloud preflight (agent) | about 2m elapsed | Production identity/health and five-release retention were coherent. One transient SSH connection consumed 10.07s; retry with three bounded attempts succeeded. |
| 12:58–13:04 | Checkpoint commit, push and Timecloud release | 5m 53.5s measured deployment, about 6m 30s total | Archive 1.11s, hash 0.45s, upload 36.16s, identity verification 0.71s; remote backup/build/restart runner dominated at 315.11s. Production backend, frontend, symlink and five-release retention all resolved to `273f73da4a093065eb351f7f7ecd27fa814c6dae`. |
| 13:12–13:25 | Aasimar/Goliath level-5 runtime repair (agent) | 13m 01s | Implementation was the main path; focused runtime tests passed 102/102 in 7.05s, migration replay passed in 4.88s, and TypeScript typecheck took 50.25s, the longest measured command. |
| 13:06–13:31 | Remaining General-feat runtime work (agent) | about 25m | Architecture/data discovery about 8m; runtime implementation about 10m (longest); support-invalidation migration diagnosis about 3m; focused verification about 4m. Mounted Combatant and Polearm Master primary paths now execute but remain untested. |
| 13:12–13:24 | Wizard Memorize Spell materialization (agent) | about 12m | TypeScript typecheck was the longest command at 58s. Focused suite passed 40/40; migration replay, lint and typecheck passed. |
| 13:14–13:20 | Production Sorcerer level-up/manual QA | about 6m | Advanced retained Sorcerer 2→5 and inspected level-5 progression/resources. This exposed the catalog-wide Fly ownership failure and the unrestricted Sorcerous Restoration action. |
| 13:20–13:24 | Sorcerer strict-projection/rest repair | about 4m | Added stable Fly/Slow class ownership and a once-per-Long-Rest short-rest trigger; focused rest regression passed 13/13 in 4.22s. |
| 13:24–13:29 | Local migration/authentication recovery | about 5m | Migration 187's support invalidation ordering and a too-short local JWT signing secret caused two short failed iterations. Replaying 187 after the ordering correction and restarting with a valid local-only secret restored the stack. No production credential was changed. |
| 13:29–13:32 | Wizard Memorize Spell browser proof | about 3m | Short-rest swap, journal clarity, reload persistence and combat prepared/unprepared projection all passed on the retained Wizard. |
| 13:25–13:35 | Exact level-2/3 spell contract audit (agent) | 9m 34s | DB/runtime correlation took about 6m and was the longest part. After migration 190, strict projection and targeting passed 115/115; eight concrete runtime/cost/geometry defects were routed to focused repairs. |
| 13:31–13:37 | Heat Metal/cylinder repair (agent) | 6m 03s | Implementation and DB replay passed; TypeScript at 42.6s was longest and caught one concurrent feat typing issue that was fixed during integration. |
| 13:35–13:40 | Unsafe no-picker and long-cast repair (agent) | about 5m 35s | Six false immediate interactions became explicit narratives and nine non-atomic casting times became enforceable. Migration replay and 18/18 focused tests passed; authoring exact postconditions was the longest substep. |
| 13:35–13:37 | Final Timecloud/readiness preflight (agent) | 1m 39.3s | Backend/frontend/symlink identity matched, runner checksum matched, release count was exactly five and about 27.9 GiB remained. One harmless local quoting retry made no remote change. |
| 13:40–13:45 | Final integration gate before commit | about 5m | Backend test+vet passed in 14.48s; TypeScript passed in 43.40s; lint 22.69s; build 74.81s; certificate drift 19.50s; manifest/security 1.87s; 159/159 changed-surface tests passed in 8.98s; idempotent migration-tail replay passed in 3.46s. One new assertion used the wrong projected targeting field and cost one 12.45s failed focused run before correction. |
| 13:45–13:50 | Timecloud release `242cebde` | about 4m 21s measured | Archive 0.63s, hash 0.43s, upload 35.25s and runner 222.35s. This was about 93s faster than the checkpoint runner; backend/frontend/symlink identity and exactly five retained releases passed independently. |
| 13:50–13:53 | Production Sorcerer retest and casting-ability repair | about 3m | Browser immediately narrowed the remaining failure from class-list ownership to an explicit subclass-grant casting ability. Migration 193 adds Charisma to all six Draconic Sorcery grants; its declaration test passed in 4.51s and local application succeeded. |

## Individual measured actions

| Action | Duration |
|---|---:|
| Initial level-5 CodeGraph scope query | 11.9s |
| Local deployment/runtime CodeGraph query | 15.4s |
| Extra Attack CodeGraph query | 13.1s |
| Tricky-combination CodeGraph query | 22.3s |
| Multiclass subclass CodeGraph query | 25.38s |
| Frontend area tests, first iteration | 6.62s |
| Frontend area tests, final passing iteration | 3.85s |
| Backend migrations test after registering 166 | 4.07s; failed only because the latest-version assertion still awaited migrations 167/168 |
| Targeted progression regression set | 10.39s |
| Full TypeScript typecheck | 41.05s |
| Existing workbook import plus six-sheet render | about 34s | Required visual baseline before extending the accepted checklist. |
| Level-5 workbook rebuild | 35.4s |
| Workbook row-preservation comparison | 5.6s |
| Level-5 manifest after adding General feats | 0.12s |
| Solo-combat integration after scene/attack-ledger repairs | 37/37 passed |
| Wizard focused prepared/cantrip regression set | 55 tests passed |
| Mechanics-description regression after Fireball preview repair | 13/13 passed |
| Migration suite after registering subclass repair 181 | 5.0s; passed |
| Granted-action/area/persisted-combat focused batch | 6.37s; 8 files / 88 tests passed |
| Full TypeScript typecheck after concurrent integration | about 32s; passed after one seven-error repair pass |
| Monk certification focused batch | 34/34 passed in 15.86s |
| Monk RulesSession/unarmed focused batch | 11/11 passed in 2.57s |
| Migration suite after registering 182–184 | 1.13s; passed |
| Full TypeScript integration check after d20/species/feat merge | about 41s; two test-fixture casts only |
| Full backend test suite after migrations 185–186 | 11.50s wall; both backend packages passed |
| Final class/choice focused suite | 104 tests passed; 5.16s wall |
| Migration 185 clone replay | 4.91s; two passes, temporary clone removed |
| Weapon/Nick focused regression batch | 16/16 passed in 6.2s |
| Level-up/multiclass focused regression | 132/132 passed across 10 files |
| Backend `go vet ./...` after integration | 2.0s; passed |
| Fresh production-snapshot clone restore | 14.8s |
| Exact ordered migrations 165→186 | about 3s; 22/22 applied |
| Release overlay/patch/effects suite | 49/49 in 21.18s |
| Regenerated sheet-combat certificate suite | 32/32 in 19.58s |
| Protection continuation regression | 45/45 in 3.44s |
| Final backend test/vet gate | 6.59s / 1.43s |

## Current longest paths

1. General-feat runtime decomposition: 37m for the safe data layer plus parallel 24–36m runtime passes. The exact follow-up audit found only 12/43 executable in principle; the slow part is missing shared event/decision vocabulary, not inserting the 43 feat rows.
2. Progression producer migration 167: 34m 17s. It combined class, subclass, resource and species work; the next expansion should split these into independently clone-testable migrations.
3. Monk combat-certificate debugging: about 18m. The same actor-specific unarmed profile crossed projection, certification, persisted-session validation and the ruleset-owned system action; each boundary had its own independently reasonable fallback to the STR/flat-damage base. A shared actor-bound action adapter and one end-to-end fixture would have found all three in one run.
4. Browser character construction and level-up: about 38m cumulative for retained Fighter, Wizard, multiclass and Monk paths. Reusing a persistent local production clone avoided repeated Timecloud deployments, but each new rules hash requires an explicit stale-scene reset and each Forge choice panel adds interaction time.
5. Release identity investigation: about 7m 30s overall, although all verification commands together were under 75s. Separating the independently certified condition release from the evolving general overlay prevented unrelated level-5 content from forcing false condition recertification.

## Speed improvements for the next expansion

1. Keep a persistent isolated PostgreSQL 17 test clone and refresh it from a snapshot only when the schema/catalog changes. This avoids the 77s Docker startup and 58s download/restore path on every iteration.
2. Add a production-shaped migration integration test in CI. Migration 166's unit tests passed, but a 7.7s local-clone application found a 60-row postcondition failure before deployment.
3. Cache a normalized SRD text/index and generated catalog manifest. Repeated PDF extraction and CodeGraph calls account for most read-only latency.
4. Use the 3–10s focused Vitest groups during implementation and run the 41s typecheck once per coherent batch.
5. Keep browser testing on the local frontend/backend and deploy only after the browser matrix passes; this removes repeated Timecloud build/release latency.
6. Replace broad narrative-only catalog scans with generated, versioned audit fixtures that list unsupported mechanics and schema paths by card number.
7. Add one actor-bound unarmed end-to-end test that starts from the Forge class progression and reaches the system `PerformUnarmedStrike` command. The separate projection/certificate/runtime tests were individually green while their composition was wrong.
8. Add one deterministic browser-seeded combat mode for hit/save branches. Two consecutive manual misses consumed the available Fighter actions even though the post-hit continuation was already deterministic-test green.
9. Keep SSH `ConnectTimeout=10` and `ConnectionAttempts=3`; the preflight recovered from one 10-second transient connection failure without manual intervention.

## Final reconciliation

To be completed at handoff: total elapsed time, browser/manual-test duration, deployment duration and SHA, longest step, wasted/repeated work, and remaining scope if the 15:00 deadline is reached.
