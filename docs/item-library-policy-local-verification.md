# Item library: local verification and saved-runtime compatibility

Updated 2026-09-24. Saved-item compatibility is implemented using the bounded migration-265 design below. Main has registered and applied 265 locally, restarted the API and verified live endpoints. This is an implementation choice to preserve existing item access, not a separate user-specified grant design. Production remains unchanged.

Final integration: targeted backend tests and explicit migration-265 integration test passed. Live private catalog: 401 for guests and 126 items for the local QA account. Public library without templates still returns 687 items. The snapshot contains 2041 saved grants. The snippets below are reference, not additional registrations to duplicate.

## Migration 265 handoff — implemented

- `owned_item_grants` is a separate server-written authorization table, keyed by character + original owner + canonical card. Migration 265 snapshots existing `free`/`campaign` equipment and positive integral inventory rows joined to nondeleted cards. It excludes the shared legacy-public user and dungeon sheets. Unknown equipment keys, container pointers, turn-state/bond references and arbitrary nested JSON do not create grants.
- A transactional receipt makes the snapshot strictly one-time even if migration code is rerun. No cards, character JSON, mechanics, combat artifacts or history are rewritten. Deleting a character cascades its grants; changing its owner does not transfer them. No client DTO or endpoint accepts grant writes. Automated Down deliberately refuses to discard this authorization baseline.
- `/api/cards` list/search/lightweight index, export and tag-member discovery remain **library-only**. Detail, battle detail and battle batch additionally use the one `itemAccessQuery` scope for the authenticated owner's saved grants or their server-owned run inventory/offers/staples/rewards. Arbitrary free inventory and client-supplied owner/run IDs are not evidence.
- Run inventory requires a real owned run and owned `dungeon_crawl` member, with valid stored party membership (or legacy single-member shape). Status allowlist: `active`, `victory`, `defeat`; unknown/abandoned/empty statuses deny. Terminal runs remain readable, but their existing write guard makes them immutable. Offers/rewards are taken from server-owned run records, never request JSON. Core frozen combat resolution is unchanged.
- Ordinary create, runtime PATCH and template-copy boundaries validate/grant inside their existing transaction. Players may add public-library cards or reuse that same character's grants. Actual authenticated content administrators may add hidden cards to their own sheets (`reason=admin`); ownership and admin role are separate checks. The helper never infers admin authority from the character owner or payload. Runtime-command writes already enforce inventory consumption only and cannot insert new identities. Legacy run PATCHes now additionally cannot increase item ownership.
- Strict-JWT `GET /api/my-item-catalog` returns **only** owned/trusted-run additions with the same canonical serializer/lightweight projection as `/cards`, paginated and `private, no-store`. `cardsApi.getMyItemCatalog` is uncached. `getCardsIndex` merges these pages only for authenticated runtime reference resolution, deduplicates IDs and discards stale-session responses; CardLibrary never calls it. Existing public index session handling remains intact. `ownedItemCache.ts` partitions direct/list card caches by session while preserving URL-prefix invalidation.
- Tagged Bag Of Holding visibility is now limited to `very_rare`, `epic`, `legendary`, `artifact`, `relic`. Tagged custom/unknown rarities are tested as denied. Main's `defaultItemSource` normalization remains unchanged.

### Main-owned registration snippets

Registered in the migration list after 264:

```go
{Version: "265_owned_item_grants", Description: "Snapshot saved normal-character item grants", Up: AddOwnedItemGrants265, Down: RefuseOwnedItemGrants265Down},
```

Inside the existing `/api` router group, alongside card routes:

```go
registerOwnedItemRoutes(api, authService, db)
```

Apply 265 before serving the changed item handlers: they intentionally fail closed if the grants schema/function is absent. Register the private route before validating the merged runtime index. Main handles application migration/restart and live endpoint QA. No changes to `main.go`, `migrations.go`, App/Layout, engine or unrelated UI were made by this task.

### Latest verification

- Isolated PostgreSQL migration and backend targeted tests passed, including snapshot immutability/idempotency, two distinct saved cards, foreign/guest/forged references, owner transfer, known/unknown run statuses, malformed parties, strict JWT, canonical full/light projections, atomic denied writes, admin actor authorization, template-copy rollback and existing character/runtime authorization regressions.
- Frontend: **8 files / 40 tests passed** after index/private-cache changes (command below). Main separately reported its broader frontend/browser QA; it is not counted as this task's live endpoint verification.
- `go test ./...` also passed across all packages without database DSNs; database-dependent tests in that broader run skip, so the explicit isolated-DB targeted run above is the integration evidence. `git diff --check` passed.
- No new browser run was performed for migration 265. Earlier mocked admin counts below are explicitly not live counts. No running API was modified by these test commands.

```powershell
Set-Location 'C:/Projects/dnd_cards/backend'
$ownedConfig = Get-Content -LiteralPath 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json' -Raw | ConvertFrom-Json
if (-not ([uri]$ownedConfig.DATABASE_URL).IsLoopback) { throw 'Local database required' }
$env:OWNED_ITEM_265_TEST_DSN = $ownedConfig.DATABASE_URL
$env:CANONICAL_RUNTIME_TEST_DSN = $ownedConfig.DATABASE_URL
& 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe' test ./migrations . -run 'Test(OwnedItem|ItemLibrary|BulkEntityTags|EntityTagFilter|ContentAdminAuth|CharacterV3|CharacterRuntimeCommand|CharacterTemplate|RoguelikeCamp|RoguelikeCharacter)' -count=1

Set-Location 'C:/Projects/dnd_cards/frontend'
node node_modules/vitest/vitest.mjs run src/utils/cardsIndex.test.ts src/api/authPolicy.test.ts src/api/ownedItemCache.test.ts src/components/library src/api/apiCache.test.ts src/api/readRetry.test.ts
```

Deliberate scope limit: no grant is synthesized from a new imported paper document, standalone bond reference or arbitrary related-card traversal. The requested snapshot covers actual saved inventory/equipment, not a new dependency-closure authorization system. Hidden canonical container contents not themselves stored in inventory are not automatically granted. Existing server-side combat dependency resolution/artifacts are untouched. GM/shared-sheet visibility is not expanded.

Completed cache follow-up: `getCardsIndex` subscribes to successful character/template/run/catalog/tag cache invalidations. Same-session acquisitions refresh private additions on the next read, while ordinary public HTTP pages retain their existing cache. A generation guard discards requests predating a mutation. Eight additional cases cover relevant prefixes, a purchase/read race and unrelated spell edits; final targeted frontend run passed 9 files / 44 tests.

## What the tests changed

- No running API process was started, stopped, rebuilt in place, or restarted by this task. No service configuration, real admin allowlist, application migration registration, or production data was changed by the test runs. Source changes require the main task's normal backend restart to become active in that process.
- Go integration tests compiled a temporary test executable and invoked Gin handlers with `httptest` / `router.ServeHTTP`, without opening an HTTP listener or calling `main()`.
- Those Go tests **did write test data** to PostgreSQL. The connection came from `C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json`, verified as loopback: `127.0.0.1:5434/dnd_cards`. `openCharacterV3AccessFixture` creates a unique `character_v3_access_<uuid>` schema, supplies it as the connection search path, creates fixture tables/users/cards/tags there, and drops that schema in `t.Cleanup`. They do not seed or tag rows in the application's normal schema. JWT/admin settings use `t.Setenv` within the test process.
- The browser used the existing Vite server at `http://localhost:3000`. Every `/api/*` request was fulfilled locally by Playwright. Its administrator token/profile and `can_manage` were fixtures. The one bulk POST was intercepted and asserted, **not sent to the API**. This is a mocked UI acceptance test, not evidence that the previously running read-only API had gained mutation support.
- Browser contexts were temporary. Four final screenshots were written under `outputs/item-library-policy/`. An earlier `load-failure.png` is a harness-debug artifact, not a successful acceptance result.
- The pre-existing read-only API setup is documented separately in `docs/paper-catalog-readonly-local.md`; this task did not modify or restart that setup. Its previously documented 882-card count is not a measurement from these tests.

## Exact evidence and counts

| Check | Administrator | Player / guest |
| --- | --- | --- |
| Go visibility fixture: 20 cards total (no saved grants) | `total=20` | `total=10` for both authenticated player and guest |
| Go list with `limit=1` | 1 returned row, total 20 | 1 returned row, total 10 |
| Go detail / battle detail / tag detail | All 20 accessible | 10 accessible; 10 hidden return 404 |
| Go export / battle batch / tag-member index | 20 items/IDs | 10 items/IDs |
| Go `common OR rare` filter | Not used for this assertion | 3 results; CSV, repeated and alias forms checked |
| Browser fixture | 2 displayed cards | The same 2 displayed cards; no live filtering count inferred |
| Browser bulk interaction | 2 selected IDs, 1 tag ID, exactly 1 intercepted POST | No selection control, 0 bulk requests |
| Browser desktop at 1366 × 900 | Rail width 184; client/scroll width 183/183 | Same |
| Browser mobile at 390 × 844 | Document client/scroll width 390/390 | Same |
| Browser unhandled errors in final run | 0 | 0 |

Earlier library-only frontend command: **5 test files, 24 tests passed** (latest expanded checks are above). The Go targeted suite passed against the local database, without integration skips. A broader targeted Go command also included existing tag filtering and content-admin middleware tests and passed. The earlier full `tsc -b --pretty false` exited 1 with 56 diagnostics outside the changed library/authPolicy/entityTags files, chiefly existing test metadata typing in `rules-core`; a fully green repository typecheck is not claimed.

Test sources:

- `backend/item_library_policy_test.go`
- `backend/entity_tags_bulk_test.go`
- `backend/character_v3_access_integration_test.go` (isolated-schema fixture and in-process HTTP helper)
- `frontend/src/components/library/CardLibrary.test.tsx`
- `frontend/src/components/library/libraryNavigation.test.ts`
- `frontend/src/components/library/itemLibraryApi.test.ts`
- `frontend/src/api/authPolicy.test.ts`
- `frontend/src/components/library/library-layout.local.mjs`

Final screenshots:

- `outputs/item-library-policy/desktop-admin.png`
- `outputs/item-library-policy/desktop-guest.png`
- `outputs/item-library-policy/mobile-admin.png`
- `outputs/item-library-policy/mobile-guest.png`

## Reproduce the completed tests

PowerShell; no application restart is required. Do not omit the DSN setup: the database integration fixtures skip when it is missing.

```powershell
Set-Location 'C:/Projects/dnd_cards/backend'
$libraryTestConfig = Get-Content -LiteralPath 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json' -Raw | ConvertFrom-Json
if (-not ([uri]$libraryTestConfig.DATABASE_URL).IsLoopback) { throw 'Local database required' }
$env:CANONICAL_RUNTIME_TEST_DSN = $libraryTestConfig.DATABASE_URL
& 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/go/bin/go.exe' test . -run 'Test(ItemLibrary|BulkEntityTags|EntityTagFilter|ContentAdminAuth)' -count=1
```

The initial narrower integration run used `-run 'Test(ItemLibrary|BulkEntityTags)' -count=1 -v`.

```powershell
Set-Location 'C:/Projects/dnd_cards/frontend'
node node_modules/vitest/vitest.mjs run src/components/library src/api/authPolicy.test.ts src/utils/libraryUrlParams.test.ts
node src/components/library/library-layout.local.mjs
node node_modules/typescript/bin/tsc -b --pretty false
```

The browser command requires the existing local Vite server and installed Chrome. It defaults to `http://localhost:3000`; `LIBRARY_TEST_ORIGIN` may select another loopback Vite origin. It never starts or restarts the API. A known failing full typecheck is listed for reproducibility, not counted as a passing check.

## Which saved contexts load restricted cards

This is a call-site audit, not a claim that every existing character currently owns a hidden card. No live production inventories were inspected.

| Context | Actual loading path | Consequence when a referenced item is hidden |
| --- | --- | --- |
| Desktop V3 sheet | `CharacterSheetMVP.tsx:351–374`: inventory and equipment IDs → `cardsApi.getCard` → `collectItemMechanics` | Rejected cards are currently caught as null, so item mechanics and derived values can disappear. |
| Equipment panel and weapon bonds | `SheetEquipmentPanel.tsx:115–134,227`: inventory/equipment; replacement dialog loads `readWeaponBondObjects(...).itemCardId` | Missing item rows, container targets, attunement candidates or bond previews. |
| Mobile sheet | `mobile/useMobileCharacter.ts:122` | Same direct-ID hydration and null-on-error behavior as desktop. |
| Owned containers and nested contents | `SheetActionsPanel.tsx:944–979`: canonical `contents[].card_id` dependencies of owned containers; `RelatedItems.tsx` also uses the global index | Container actions may fail to load; names, totals and nested previews can be incomplete. |
| Ordinary/legacy solo combat: start, restore, add ally | `SoloCombatPage.tsx:409,442,974` → `loadSheetCombatParticipant`; `sheetCombatRuntimeFactory.ts:74–96` rehydrates every carried/equipped/bonded card via direct detail | Hydration explicitly throws on a denied detail; even restoration rehydrates participants, so an existing ordinary solo fight can fail to open. |
| Cross-character next-turn resolution | `SheetRestButtons.tsx:443–453` → the same participant factory for the source and linked characters | The same strict item hydration can block the pending turn workflow. |
| Run camp item transfer | `RunPartyCamp.tsx:38` directly loads all top-level item IDs for the selected party member | One denied item rejects the whole transfer-picker load. |
| Run shop | `ShopDetail.tsx:74–86` directly hydrates `run.shop.staples` and `run.shop.offers` | An epic or other hidden server-offered item can prevent shop hydration despite being a valid offer. |
| Run rewards | `CombatRewardDialog.tsx:17` resolves awarded `card_id` through `getCardsIndex` | A missing filtered item with a successful index response can remain labelled “Загружаем предмет…”. |
| Paper-sheet reload and equipment moves | `PaperCharacterSheet.tsx:99–123`, `paper-sheet/SecondaryPages.tsx:271–274` | Reload reports omitted equipment bonuses; move/equip resolution can reject. Imported/local documents supply their own reference IDs. |
| Canonical reference previews | `EntityRefRegistry.tsx:20`; `BackgroundEquipment.tsx:102`; `RelatedItems.tsx:14,26` | Global library resolution cannot display a hidden item solely because the surrounding sheet can access it. It needs the same authorized context bundle. |

Library search, export, constructors and manual-add pickers should retain the new library policy. Selecting new unrestricted content is a different operation from hydrating already authorized runtime dependencies. Background/container dependencies may be admitted through a trusted canonical root; arbitrary links in descriptions are not proof of entitlement.

### Server-owned run combat is different

`roguelike_worker_catalog.go:57–120` resolves dependencies directly from the database; initialization stores the canonical dependency closure in `CombatCatalog`. `roguelike_worker_controller.go:107` uses the saved catalog for combat. These paths do not call `itemLibraryQuery`, so the library patch does not filter their mechanics or rewrite their artifacts.

The frontend trusted-run branch in `SoloCombatPage.tsx` accepts `run.combat_state` before entering the ordinary `getCardsIndex`/participant-hydration branch. Its core combat continuation is therefore not the same failure as ordinary solo combat. The surrounding run sheet, camp, shop and reward UI still have the direct/index reads listed above.

`CombatCatalog` is stored with `json:"-"` in `models_roguelike.go`; it is **not already a public field in the run response**. A context reader can project required cards from it without exposing the whole internal envelope or recomputing historical mechanics.

## Historical broader proposal — superseded by the authorized migration-265 design above

Keep the public `/api/cards*` policy unchanged. Add a narrowly scoped saved-context reader returning canonical Card responses or pinned Card snapshots; do not add `fields=runtime`, `include_hidden`, or a client-supplied character ID as an unchecked bypass.

### 1. Restore the server-owned run contexts first

One strict-auth read endpoint, for example `GET /api/roguelike/runs/:runID/runtime-cards`, can cover the camp, sheet, shop, reward and combat-preview consumers. Reuse `ownedRoguelikeRun` to authenticate ownership and load the real party. Derive the permitted roots server-side from:

- the run members' actual equipment, inventory and persisted weapon bonds;
- that run's actual current shop offers/staples and stored reward records;
- its already pinned combat dependency catalog where the request concerns saved combat.

Use the existing canonical dependency resolver for the bounded, cycle-safe closure (including container contents). A requested-ID subset may narrow this set but never enlarge it. For a battle-bound dependency, return the stored snapshot; do not substitute a live library row if the snapshot is missing or incompatible. For current camp/shop dependencies that were not frozen, keep their existing canonical current-row semantics.

This is smaller than creating a second engine or publishing every hidden item. The existing run camp PATCH guard checks unchanged item ownership and restricts `turn_state`; it provides a stronger trust boundary than an ordinary free-character inventory. Still admit only members of the stored owned run, not an arbitrary `character_type=dungeon_crawl` flag or client list.

### 2. Ordinary persisted V3 characters need one additional authorization fact

Reuse the existing owner / authenticated legacy-public-readonly access check for a `GET /api/characters-v3/:id/runtime-cards` reader. That check alone is insufficient: `runtimeUpdatesForLockedCharacter` accepts equipment, inventory and turn-state references for ordinary characters, so “PATCH a guessed hidden ID, then read it as saved” would bypass the catalog restriction.

The smallest isolated fix, without redesigning every character mutation, is a server-only per-context item grant/baseline:

- Before enabling the restriction for existing sheets, record the existing saved card roots and their necessary canonical dependency closure in an auditable, idempotent backfill. Preserve the sheets, combat artifacts, receipts and history unchanged. Store grants separately from user-editable `rule_state`, `turn_state` and paper fields.
- Allow runtime reads for visible catalog cards plus these explicit context grants. Arbitrary subsequent PATCH/import references do not create grants.
- Legitimate server acquisitions/transfers or an administrator-approved grant add the target character's permission in their authoritative transaction. A clone must not blindly copy grants from a foreign or client-supplied context.
- Use a genuine frozen artifact when one exists. For ordinary sheets, storing authorization IDs does not itself freeze or rewrite mechanics; their prior canonical current-entity behavior can remain intact.

An alternative is to close **every** insertion path for new hidden references before trusting current inventory. That can avoid a grant table but requires a broader mutation audit (creation, editing, runtime commands, imports, cloning and nested bonds), so it is not the smaller isolated change here. Do not backfill permissions lazily from whatever inventory a client presents after rollout.

### 3. Reuse the existing client builders

Load the authorized context bundle once, keep it scoped by authenticated identity + context ID + revision/artifact identity, and pass it to the sheet panels and reference previews. `loadSheetCombatParticipant` already supports `loadCard`; supply a resolver from that bundle instead of changing its mechanic assembly. A missing required dependency stays an explicit error rather than silently becoming no bonus/no action. Do not merge privileged runtime cards into the public library index. Main will handle public-index cache invalidation separately.

### Paper/import compatibility limit

An arbitrary browser-local or imported paper document cannot prove that its hidden UUID reference existed before rollout. There is no safe endpoint that can both trust that assertion and prevent direct-query bypass. Preserve any already embedded offline snapshot as local document content; for server hydration require an authorized persisted context/baseline or explicit administrator grant. User-authored document timestamps and copied signed content certificates are not access grants. Existing server-saved paper documents can be included in the same pre-rollout baseline if their owner/read policy is applied.

### Acceptance criteria for a later implementation

- A previously saved hidden item still contributes the same sheet mechanics and loads in ordinary solo restoration; no old combat artifact hash or stored roll changes.
- Another user, guest, guessed UUID, forged `character_id`, newly injected inventory/bond reference or imported timestamp cannot obtain a hidden item.
- A legitimate owned-run offer/reward and transfer work; a fabricated offer/member/card does not.
- Canonical container closure works for two unrelated items, rejects unrelated description-link traversal, and terminates on cycles.
- Public list/search/detail/export/tag indexes remain restricted; authorized runtime bundles never contaminate their caches.

The broader context-specific endpoints and dependency-closure proposal in this historical section was not implemented. The narrower owner-grant compatibility implementation is documented at the top; no API restart was performed by this task.
