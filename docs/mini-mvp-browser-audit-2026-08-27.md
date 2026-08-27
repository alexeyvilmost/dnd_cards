# Mini-MVP production browser audit — 2026-08-27

## Scope and method

- Production: `https://bagofholding.ru`, authenticated as the supplied test account.
- Browser-first walkthrough: real Forge choices, real character sheets, dedicated solo combat, and `/initiative`.
- Existing user entities were not deleted or renamed.
- Test artifacts created during this audit:
  - `QA-MMVP-Goliath-Fighter-20260827` — `905caad6-905a-4124-ac0d-61329377e37b`
  - `QA-MMVP-Dragon-Wizard-20260827` — `89f8fefe-acf2-45bc-86e1-960d8cb49188`
  - initiative participants `QA-MMVP-Initiative-A-20260827` and `QA-MMVP-Initiative-B-20260827`
- No password, token, or session data is recorded in this document.

## Executive result

The mini-MVP is not release-safe as an end-to-end product despite green isolated tests and the existing certificate claims. The main discrepancy is that certification proves compiled data and isolated engine primitives, while real users traverse an interactive assembler, a sheet projection, a second dedicated-combat projection, persistence, and deployed proxy infrastructure. Those boundaries are either bypassed or asserted only for presence, not for a coherent outcome.

The shared technical root is a split runtime contract, not a list of missing hardcoded exceptions. Tests construct complete canonical actors and rules-ready detail entities; production often passes lightweight list rows, preserves two independent combat snapshots, or falls back to legacy sheet execution. Missing mechanics are sometimes caught and converted into a missing action, so the canonical engine never gets the chance to enforce the rule or produce a visible initialization error.

The highest-impact reproduced failures are:

1. Forge can finish and create characters while required choices and cross-source conflicts remain unresolved.
2. The Stone Goliath lineage exposes two separate entities for one named reaction, while neither reaches the incoming-damage decision flow in dedicated combat.
3. Equipped weapon actions that work on the sheet disappear in dedicated combat.
4. Ordinary sheet spells can bypass canonical target constraints: Mage Armor consumed the Wizard's slot and was applied to an armored Goliath.
5. Production TTG import follows an upstream redirect onto the Bag of Holding origin and parses the app shell instead of TTG content.
6. A resolved and completed combat can leave a duplicated stale pending-decision blocker on the sheet.
7. Forge list responses manufacture image URLs for entities that have no image source, so the UI silently falls back to `?`.

## Browser findings

### P0/P1 — incorrect playable state

#### MMVP-BR-001 — Forge permits an incomplete/invalid finished character

**Severity:** High
**Status:** Reproduced twice

Wizard path:

1. Choose Wizard and select Arcana as a class skill.
2. Choose Sage, which also grants Arcana.
3. Complete Forge and create the character.

Actual result: the sheet is created, but “Ошибки и выборы” contains `«arcana» уже получено из «Волшебник», повтор из «Мудрец» не применяется.`

Fighter path:

1. Choose Fighter and Soldier.
2. Complete Forge and create the character.

Actual result: the sheet is created with two unresolved items: duplicate Athletics and `Искусность: выберите 3 вида оружия · выбрано 0 из 3`.

Expected: Forge either prevents the conflicting choice, offers an immediate replacement, or blocks creation until the draft has no unresolved required choices.

#### MMVP-BR-002 — Stone Goliath exposes the same ability as both an effect and an action

**Severity:** High
**Status:** Reproduced in Forge preview, sheet, and combat

Evidence:

- `Каменная стойкость` appeared twice in Forge preview and twice under sheet traits.
- Production content confirms that the selected lineage links both `RE-sub-stone` (`86817ebd-10e0-4f47-84e7-197cc973938d`) and `ACT-goliath-stone` (`7517b42e-4417-407f-a16c-5fa0c9e81282`). Both are named `Каменная стойкость` and independently encode the `damage_taken` reaction.
- The intended content cleanup script clears `related_actions` and deletes the legacy action, but it hardcodes an obsolete lineage UUID (`scripts/content/fix-goliath-stone-frost.mjs:6–15,63–82`). Production therefore violates the migration's intended postcondition.
- The shared `Наследие великанов: 2/2` pool is correct for proficiency bonus +2; the defect is duplicate semantic representation, not the pool size.
- `Большая форма` emitted the same effect label twice because it applies separate size and speed modifiers. That logging is ambiguous, but it is not by itself proof of duplicate application.

Expected: one selected lineage contributes one user-facing reaction and one canonical runtime behavior. If an action references an effect, the assembler must not render both as independent abilities.

#### MMVP-BR-003 — Stone Endurance does not join the combat reaction lifecycle

**Severity:** High
**Status:** Reproduced

A Wolf hit the Goliath for piercing damage while the character had `Реакция: 1/1` and available lineage uses. Combat applied damage and advanced without offering Stone Endurance.

The reaction is lost at the adapter boundary:

- the sheet action projection accepts only `activation.mode === active` actions/effects (`frontend/src/character/actionSheet.ts:68–84`);
- passive collection explicitly rejects reactions (`frontend/src/character/resourceInit.ts:29–37`);
- rules-core currently opens attack reaction windows only for owned action capabilities with a `hit_by_attack` trigger, while Stone declares `damage_taken` (`frontend/src/rules-core/handler.ts:2314–2326,2728–2738,3049–3141`).

Expected: a generic suspended pre-damage continuation retains the incoming damage bundle, offers every legal `damage_taken` reaction, pays its resources, and only then applies final damage. It must work for attacks, saving throws, automatic damage, and hazards—not as a Stone-specific branch.

#### MMVP-BR-004 — equipped weapon actions disappear in dedicated combat

**Severity:** High
**Status:** Reproduced

On the Fighter sheet:

- Equipped Shortsword enabled melee attack; it hit and did not consume ammunition.
- Equipped Longbow enabled ranged attack, applied Archery `+2`, and reduced Arrows from 40 to 39.

In the dedicated `/combat` surface with Longbow still equipped, neither melee nor ranged weapon attack was present in the action panel. Only generic actions and non-weapon abilities were available.

Root cause: `getCardsIndex()` deliberately requests `fields=list`, whose rows omit mechanics (`frontend/src/utils/cardsIndex.ts:15–23`). The sheet hydrates equipped cards individually, but `SoloCombatPage` passes this shallow map directly into participant construction (`frontend/src/pages/CharacterSheetMVP.tsx:325–338`, `frontend/src/pages/SoloCombatPage.tsx:117–130`). Weapon projection requires `mechanics.weapon_profile`; the resulting parser error is caught and the action is silently dropped (`frontend/src/character/sheetCanonicalActionProjection.ts:104–128`, `frontend/src/engine/weapon.ts:411–425`, `frontend/src/rules-core/weaponProfile.ts:137–143`).

Expected: use distinct list-row and rules-ready detail types. Centrally hydrate all rule-relevant cards before participant construction, and fail combat initialization visibly if mechanics are missing rather than removing actions.

#### MMVP-BR-005 — ordinary sheet spell path bypasses canonical target constraints

**Severity:** High
**Status:** Reproduced

The Wizard cast Mage Armor through the sheet with the Goliath selected as target. The sheet spent `Действие`, reduced level-1 slots from 2 to 1, and persisted the effect on that target even though the Goliath wore armor. The Wizard's displayed AC staying 11 was therefore expected; it was not a self-AC projection failure.

Canonical compilation and rules-core correctly preserve and enforce willing/unarmored targeting (`frontend/src/rules-core/actionTargeting.ts:152–162,188–200`, `frontend/src/rules-core/handler.ts:304–400`). The real sheet uses canonical spell data for access/payment, but ordinary non-primitive spells fall through to legacy `executeAction`; target options check only read-only/charm state (`frontend/src/components/SheetActionsPanel.tsx:294–315,1658–1699,2090–2093`, `frontend/src/character/sheetActionOrchestrator.ts:532–545`).

Expected: every spell executes through the same canonical validation boundary, with rejection before resource payment. UI filtering is helpful but cannot be the authority.

#### MMVP-BR-006 — long rest did not restore the spent spell slot

**Severity:** Medium/High
**Status:** Reproduced once; needs a deterministic regression test

After using Shield and completing the full long-rest/prepared-spell flow, the next dedicated combat opened with `Ячейка 1-го круга: 1/2`, not `2/2`.

Expected: a completed long rest restores the level-1 spell-slot pool before the next combat starts.

#### MMVP-BR-007 — completed combat leaves a stale pending-decision blocker

**Severity:** High
**Status:** Reproduced after a victorious dedicated combat

Earlier, a free-use Thunderwave on the sheet had opened a target decision under `canonical_pending_combat_v1`. The app then allowed a separate dedicated fight to start and persist `solo_combat_v1` in the same `turn_state`. The dedicated-combat writer preserves unrelated keys while every combat patch increments `runtime_revision` (`frontend/src/pages/SoloCombatPage.tsx:73–98,214–231`, `frontend/src/solo-combat/persistence.ts:84–91`). This leaves the sheet continuation present but invalid against its saved participant revisions.

The Wizard then hit a Wolf with Ray of Frost, skipped the offered Shield reaction, and killed it with Magic Missile. Combat reached `Победа`. After `Завершить и вернуться в лист`, the sheet displayed `Сохранённое решение устарело` and `Ожидающее боевое решение устарело после изменения листа; перезагрузите участников боя`.

The reset control was rendered twice because both the Actions and Spells sections mount their own full `SheetActionsPanel` (`frontend/src/pages/CharacterSheetMVP.tsx:1110–1122,1504–1521`). Both independently project the same global continuation/error UI. Sheet actions/spells were disabled while the stale decision existed.

Expected: one authoritative lifecycle owns combat continuation. Starting dedicated combat must resolve, explicitly discard, or reject an existing sheet continuation; finishing it must clear all state it owns. Global decision UI should render once outside action-category panels.

### P1/P2 — infrastructure, UX, and consistency

#### MMVP-BR-008 — TTG import parses the Bag of Holding app shell

**Severity:** High
**Status:** Reproduced

Input: `https://new.ttg.club/bestiary/skeleton-mm` (the product's own placeholder/sample URL).

UI result: `Не найден класс доспеха (КД) на странице`.

Network evidence:

- `GET https://bagofholding.ru/proxy/ttg-club-import/bestiary/skeleton-mm` returns HTTP 200, `text/html`, 1,233 bytes.
- The body is Bag of Holding's `index.html`, not a TTG bestiary page (`__NUXT_DATA__`, `КД:`, and TTG `ac` data are absent).
- TTG currently redirects `/bestiary/skeleton-mm` to the relative location `/bestiary?detail=skeleton-mm`. Production nginx forwards that redirect to the browser; the browser resolves the relative location on `bagofholding.ru`, where SPA fallback returns the app shell.

Following the redirect is not a sufficient repair. Running the current parser on today's final TTG page returns the wrong name (`Бестиарий`) and only action names without their descriptions because TTG's heading order and private Nuxt serialization changed. The canonical query-form URL is also rejected by the current URL validator.

TTG already exposes a structured detail API at `https://new.ttg.club/api/v2/bestiary/skeleton-mm`, including Russian name, AC, HP, initiative, defenses, abilities, and complete actions.

Expected: normalize supported links to a validated slug and import a runtime-validated JSON DTO through one app-owned TTG adapter. Keep the presentation URL only as source metadata; do not scrape private SSR markup.

#### MMVP-BR-009 — Forge interaction latency is much worse than API latency

**Severity:** Medium
**Status:** Reproduced during the Wizard path

Several class/background/spell-choice interactions took roughly 7–18 seconds before the next usable state appeared; the initial Wizard data took about 5 seconds to hydrate. Direct production API samples were much faster: the referenced background handler was about 0.07–0.40 seconds across five requests, and the class list about 0.17–0.43 seconds across three requests.

Code tracing found two compounding mechanisms:

- the frontend bearer-token interceptor authenticates public catalog reads too (`frontend/src/api/client.ts:87–95`); strict optional-auth validation performs an active-identity database query for each authenticated request (`backend/middleware.go:59–84,164–178`, `backend/auth_service.go:208–228`);
- Forge loads a multi-stage entity/effect/grant/action graph, including up to six sequential grant depths (`frontend/src/character/assemble.ts:290–690`), while the short-lived detail cache stores only completed responses and does not coalesce concurrent misses (`frontend/src/api/apiCache.ts:15–20`).

Pure spell toggles are a distinct path: the whole spell catalog is repeatedly filtered and rendered without virtualization, so they need click-to-next-paint and network instrumentation rather than an assumed server diagnosis.

#### MMVP-BR-010 — Forge list images point to knowingly empty sources

**Severity:** Medium
**Status:** Confirmed from production list/detail/image responses

List projection unconditionally generates `/api/content-images/...` when Cloudinary is absent, even when the entity has no stored image (`backend/controller.go:55–69`). The image handler then returns 404 when both sources are blank (`backend/content_image_controller.go:67–120`), and Forge silently replaces the image with `?` (`frontend/src/components/forge/EntitySquareCard.tsx:18–50`).

Production currently emits such an image URL for every sampled list row. A concrete sample, class `sorcerer_aberrant` (`f5e0da3e-208a-47fa-a0e8-651bb8bf4684`), has an empty detail `image_url` while its generated content-image route returns 404.

Expected: a blank source produces a blank list image URL. For a known image, the complete list URL → image route → rendered `naturalWidth > 0` contract must hold.

#### MMVP-BR-011 — support badge cardinality is inconsistent

**Severity:** Low/Medium

Forge/sheet cards showed values such as `282/282` for individual spells while Ray of Frost showed `6/6`. Code tracing confirms the badge renders raw transitive certification counts: shared dependencies contribute every covering root, so this is not a count of 282 browser paths. Engine, Forge UI, sheet UI, combat UI, asset, and performance evidence need separate labels.

#### MMVP-BR-012 — intermittent service-worker bootstrap failure

**Severity:** Medium
**Status:** Seen during login; not consistently reproducible

The browser logged repeated `/sw.js` update failures with HTTP 502/unknown network error during login. Later direct samples returned HTTP 200 in about 0.09–0.25 seconds; a separate five-probe sample had four 200 responses in 58–86 ms and one connection failure after about 21 seconds. Nginx serves `/sw.js` as a static route, so this points to intermittent frontend/edge availability rather than service-worker business logic. Add a production monitor rather than closing it from a single green request.

## Passing/regression checks

- Separate melee/ranged sheet actions behaved correctly for Shortsword and Longbow; only the ranged action consumed ammunition.
- Prepared spells appeared in the sheet action block; Detect Magic and Feather Fall remained in Spells but were disabled/unprepared.
- Ray of Frost hit a Wolf in dedicated combat, reduced displayed speed from base 40 to 30, and appeared under the monster's active conditions. The earlier slow-condition symptom is not present in this build.
- Dragonborn fire breath worked in dedicated combat, spent one breath use, forced a Dexterity save, and damaged the Goblin.
- Shield reaction was offered on a hit. Both using Shield and skipping it advanced combat without `Missing resources: action`; the earlier deadlock was not reproduced. The Shield effect is mislabeled as `действие` in the combat log.
- Magic Missile executed in dedicated combat, killed the damaged Wolf, and reduced the remaining level-1 slot from 1/2 to 0/2.
- The `/initiative` manual path worked: two participants were added, initiative was generated, turns advanced, and the round incremented.
- The referenced background endpoint no longer exhibits the previously reported 1.5-second response in a five-request sample (observed total 0.07–0.40 seconds).

Ray of Frost still has an adapter-specific lifecycle risk outside dedicated combat. `TargetContext` supports actor identity, but the persisted-character and encounter-monster sheet target builders omit `id`; modifier ownership then cannot derive source-relative expiry and falls back to `expiry: manual` (`frontend/src/character/runtime.ts:117–145`, `frontend/src/components/SheetActionsPanel.tsx:1259–1287`, `frontend/src/engine/execute.ts:1437–1489,2783–2790`). Dedicated combat actors do have IDs, which is why the browser fight correctly removed the slow at the next relevant turn.

## Why the current tests missed these failures

### 1. The live Forge certificate bypasses Forge interaction

`createCompiledCharacterInForge` writes a completed canonical draft directly to `localStorage` and resumes it (`frontend/e2e-live/real-backend-canary.spec.ts:487`, especially lines 500–507). This exercises final assembly/POST/navigation but skips every real selection, dependent choice, loading state, image state, validation transition, and latency-sensitive request made by a user.

The covering-set loop then verifies IDs, equipment, inventory, gold, one visible item, and absence of a generic error marker (`real-backend-canary.spec.ts:1283–1363`). It does not assert:

- zero unresolved-choice/conflict entries;
- uniqueness of granted actions/effects/resources;
- expected resource maxima;
- derived values such as AC after effects;
- actual ability execution;
- transition into dedicated combat.

The mandatory release gate named `browser` is not this live canary. It is the local Playwright suite, where every `/api` request is intercepted (`frontend/playwright.config.ts:40–43`, `frontend/e2e/forge-api-fixture.ts:312–332,503–526`). The real-backend canary is opt-in/manual, so a release can be certified while production auth, database, proxy, or assets are broken.

### 2. Coverage is entity presence, not behavior composition

The generated fixture guarantees every class/species/lineage/background/feat appears in at least one cyclic root (`frontend/src/canon/miniMvpForgeSheetFixtureGenerator.ts:65–168`). It does not prove each entity's grants are unique after parent + lineage assembly, that cross-source choices are conflict-free, or that each runnable action survives all projections and event lifecycles.

### 3. Sheet and dedicated combat are tested as different worlds

The live sheet canary drives selected sheet actions against the training dummy, while isolated combat tests use constructed actors/catalogs. The production path `Forge -> persisted character -> equipped inventory -> /combat -> monster turn -> reaction -> inspection` is absent. That is exactly where weapon actions disappeared and Stone Endurance failed to subscribe.

Weapon integration fixtures hand-build complete card mechanics, while the cards-index test only verifies `fields=list` pagination. No test feeds real shallow list responses through `SoloCombatPage` hydration into participant construction, so the type/shape mismatch remains invisible.

### 4. Assertions stop at events instead of observable outcomes

For stateful effects, an `EffectApplied`/journal entry is not sufficient. Mage Armor demonstrated that resource spend and an effect event can both be green after an invalid armored target bypasses canonical validation. Tests need pre-payment legality plus post-command projections: AC, speed, HP, inventory quantity, condition list, resource pools, and expiry on the next relevant turn/rest.

### 5. TTG tests cover a saved parser fixture, not the deployed proxy chain

`frontend/src/utils/ttgClubBestiary.test.ts:17–43` parses a repository HTML fixture. It never calls the production proxy, verifies redirect handling, validates the returned host/content type/body, or clicks Import in `/initiative`. The dev proxy follows redirects server-side, while nginx currently lets a relative redirect escape to the application origin, so local behavior and production behavior differ. Even the current parser would silently corrupt today's final TTG page, which proves a saved HTML fixture is the wrong contract boundary.

### 6. Live browser certification is opt-in and has no UX budgets

The live browser canary is documented as an explicit opt-in command, not part of the ordinary isolated browser run (`frontend/README.md:154–181`). Its mini-MVP case has a 900-second overall timeout (`real-backend-canary.spec.ts:1172–1176`) and common waits allow 30 seconds. There are no per-interaction latency budgets, request-count budgets, image-completeness assertions, or a deployment smoke check for `/proxy/ttg-club-import/...`.

### 7. Image tests stop inside the handler

The existing image tests cover data-URI decoding and ETag behavior, not the list-projection contract. Local Forge fixtures return full snapshot rows and do not implement `/api/content-images`; the live canary stubs external image hosts and never asserts `img.complete` or `naturalWidth`. Therefore a catalog full of 404 thumbnails can remain green.

## Recommended testing process

1. Add a small mandatory **real-interaction spine** to every deploy candidate:
   `login -> click Forge choices -> resolve every required choice -> create -> assert no problems -> equip -> sheet action -> dedicated combat action -> monster reaction -> rest -> reload`.
2. Keep the generated covering set for breadth, but add per-root invariants after assembly: unique grant identity, no duplicate action/effect/resource keys, no unresolved issues, exact expected resource maxima, and at least one executable signature per granted active/reactive ability.
3. Add table-driven **projection contract tests** that feed one persisted character into both sheet and dedicated combat and compare runnable canonical action IDs. Equipment changes must invalidate/rebuild both projections identically.
4. For every stateful action, assert the observable state transition and expiry, not only emitted events. Examples: armored Mage Armor target rejected before payment; unarmored target AC updated and persisted; Ray of Frost speed 40→30 then 40; potion quantity 1→0; Shield reaction/slot behavior; long-rest slot restoration.
5. Add deterministic monster-turn scenarios for optional reactions (use and skip branches) and triggered post-hit riders. These must verify pending-decision creation, resource ownership, final damage, and that the next action/turn is not blocked.
6. Replace TTG page scraping with a URL-to-slug normalizer plus a runtime-validated structured API adapter. Add DTO fixture tests and one real browser `/initiative` check that imports Skeleton and asserts name `Скелет`, AC 14, HP 13, initiative +3, and full actions.
7. Add a list-image integration contract: every nonblank list image URL must return an image response and render with `naturalWidth > 0`; a blank source must remain blank. Assert visible image byte/latency budgets.
8. Introduce UX service-level budgets: detail p95 ≤300 ms/p99 ≤600 ms warm; list p95 ≤500 ms (spells ≤800 ms); Forge first interactive ≤1.5 s; warm entity selection settled ≤800 ms; spell toggle next paint ≤150 ms with zero network; save-to-sheet ≤1.5 s; no duplicate in-flight GET URL; zero failed service-worker probes.
9. Add backend timing/query-count evidence separating auth, database, and serialization. Public catalog reads should not perform an active-identity database query for every request; use an auth-free catalog client or bounded identity validation cache.
10. Run the real browser spine automatically after every production deployment and nightly against at least three deliberately composed archetypes: martial/ranged + lineage reaction, prepared full caster + reaction/control spell, and half/pact caster + granted/free-use spell.

## Focused automated checks run during this audit

- `ttgClubBestiary.test.ts` and `sheetCombatWeaponActions.integration.test.ts`: 7 tests passed across 2 files while the corresponding production paths failed.
- Combat/core-focused suites: 53 tests passed across 7 files despite the production adapter defects above.
- `raceAbilities.mvp.test.ts`: skipped in the attempted standalone MVP run, illustrating that some content checks require opt-in live/content conditions and do not provide an always-on release signal.

## Resolution implemented from this audit

The repairs deliberately target shared contracts rather than entity names or one
character fixture:

- dedicated combat now hydrates the full card mechanics graph before projecting
  actions and fails closed if an equipped weapon action would be dropped;
- ordinary spells use canonical legality/targeting before payment, preserve
  actor identity and effect expiry, support actor-free world spells and 1–N
  actor spells, and persist every affected sheet in one idempotent transactional
  runtime command;
- accepted atomic commands reconcile the journal rows already committed by the
  server instead of posting them again; one character-scoped retry envelope
  blocks both Actions and Spells until the exact command is confirmed;
- incoming damage has a generic persisted pre-damage reaction continuation.
  Stone Endurance is one data-owned reaction authority and Shield chains through
  the same mechanism; no Goliath-specific damage shortcut was introduced;
- class starting equipment is repaired by stable card identity, validated on
  write, and checked for referential closure across every Forge option;
- TTG import uses an app-owned runtime-validated structured JSON adapter at a
  fixed upstream origin, with body/time limits, bounded cache, request
  coalescing, concurrency control and rate limiting;
- list image projection and the media route share one availability/security
  contract: blank and unsafe sources are not advertised, safe legacy fallbacks
  remain available, and Forge asserts rendered image dimensions;
- public catalog reads no longer pay authenticated identity validation, catalog
  requests coalesce concurrent misses, and Forge caches stable catalogs without
  putting mechanics into list payloads.

The release process now separates deterministic breadth from observable UX:

1. unit/contract suites cover canonical legality, reaction continuations,
   expiry, atomic rollback/replay, equipment closure, TTG DTO drift and the
   list-image-to-render contract;
2. isolated Playwright starts from an empty Forge, clicks real controls, creates
   a current-catalog character, equips through the sheet and executes a melee
   attack with zero ammunition on desktop and mobile;
3. the production canary creates its own characters and checks three independent
   archetypes: Stone Goliath Ranger, martial + spell, and full caster +
   world-domain spells. It executes mechanics-derived spells and weapon attacks,
   asserts exact resources/ammunition/effects/journal deltas, and exercises the
   migrated damage reaction rather than checking only button presence;
4. a push to `main` waits for the exact frontend **and** backend SHA to appear in
   production, then automatically runs those three browser paths. The same job
   remains available nightly and by manual exact-SHA dispatch.

This changes the meaning of a green mini-MVP release: engine coverage is still
necessary, but it can no longer substitute for Forge interaction, persisted
sheet state, dedicated combat, assets, upstream integration or response-time
budgets.

The first exact-SHA evidence run also exposed an installation-only drift that
ordinary tests could not see: `@3d-dice/dice-box` copied seven unused duplicate
files into `public/assets/{ammo,themes}` while the application serves the
reviewed copy at `/assets/dice-box/`. Install scripts are now disabled in every
environment. Each build verifies the reviewed files byte-for-byte against the
integrity-pinned installed package, then verifies the final Vite output contains
the same files only at the runtime path. The release fingerprint continues to
cover all of `frontend/public`; no asset directory was ignored to make evidence
pass.
