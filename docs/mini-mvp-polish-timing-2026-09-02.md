# Mini-MVP polish timing log — 2026-09-02

Timezone: Europe/Moscow (UTC+03:00). Start: 03:25:44.

This log records wall-clock time for major steps and notable actions. Durations include tool startup and output collection, not only CPU time.

| Time | Duration | Major step / action | Result and speed note |
|---|---:|---|---|
| 03:25:44–03:34:21 | 8m 37s | Repository and runtime audit | Mapped condition materialization, grant-effect paths, sheets/mini-sheets, combat continuations, targeting declarations, Forge additions, deployment docs, and pre-existing dirty files. This was the broadest search phase; CodeGraph was not usable as a trusted clean index, so focused repository searches were used. |
| 03:34:21–03:48:20 | 13m 59s | First implementation slice | Added exact effect entity references, data-card rendering, Bardic Inspiration boon mechanics/UI, canonical combat activation, Acid Splash data migration, and manual-spell provenance. |
| 03:48:20–03:57:40 | 9m 20s | First compile and focused diagnosis | Type-check passed after integration. Focused tests exposed an existing immutable release-pin drift unrelated to this feature and one expected-value mistake in the new boon scenario. |
| 03:57:40–04:05:50 | 8m 10s | Runtime gap closure | Extended after-failure boons from ordinary target saves to concentration, hazard, weapon-mastery, and unarmed saves. Completed canonical always-prepared grants for Forge-added spells. |
| 04:05:50–04:10:42 | 4m 52s | Remaining UI surfaces | Replaced generated condition/effect chips in condition sheet, action sheet, and legacy encounter board with exact library-backed effect cards; legacy manual conditions now carry library identity. |
| 04:10:42–04:13:05 | 2m 23s | Static verification | Three incremental TypeScript checks; final run clean. Each full check took about 46–54 seconds. Incremental targeted checks would reduce this loop substantially. |
| 04:13:05–04:13:26 | 21s | Focused frontend behavior suite | 8 files / 40 tests passed. Test runner reported 7.15s; remaining time was process/tool startup. |
| 04:13:26–04:14:35 | 1m 09s | Backend migration verification | First run found a stale “migration 139 must be latest” assertion (27.2s including Go compilation). Updated the ordering contract; second run passed in 7.9s (test execution 1.577s). |

## Avoidable or optimization-relevant time observed

- Full TypeScript compilation dominated the edit/verify loop: roughly 2m 30s across three successful/failing runs. Add a fast project reference or a narrow `tsc`/Vitest type boundary for changed runtime packages, keeping one full compile at the gate.
- The first backend migration run spent about 27s compiling before reaching a stale ordering assertion. A small migration-registration test target, or a helper that asserts “latest” through one shared constant, would avoid repeated per-migration edits.
- An earlier test invocation used repository-root paths and scanned temporary immutable-build folders before it was stopped (about 30s). Always run frontend tests from `frontend/` with explicit `src/...` paths and exclude repository `tmp/` from discovery.
- The existing release identity pin is already stale relative to the current compiler. It creates noisy failures in broad immutable suites and obscures feature regressions. Repair it in a dedicated recertification release, not opportunistically during unrelated features.

## Current checkpoint

At 04:14:45, implementation plus focused static/backend/frontend verification consumed 49m 01s. Broad suite/build, deployment, browser QA, checklist/report update, and QA-character cleanup are not included yet and will be appended as they happen.

## Continuation through production closure

| Time | Duration | Major step / action | Result and speed note |
|---|---:|---|---|
| 04:14:45–04:32:58 | 18m 13s | Broad verification, production bundle, first integrated commit | Completed the effect-card, boon, targeting and always-prepared slice. The local Vite build and full static gate dominated this interval. |
| 04:32:58–04:52:30 | 19m 32s | First deployment and browser integration audit | Verified core paths, then found remaining condition identities generated outside the library. Browser evidence was more valuable than another broad synthetic pipeline because it exposed the actual presentation gap. |
| 04:52:30–05:08:58 | 16m 28s | Remaining condition identity, area targeting and icons | Closed standard-condition identities, aligned remaining area declarations and supplied missing library icons. |
| 05:08:58–05:25:15 | 16m 17s | Combat identity propagation and Timecloud retention/cache work | Preserved effect identity through combat compilation and changed retention to keep five releases without deleting Docker build cache. |
| 05:25:15–05:42:52 | 17m 37s | Bardic production retest and persistence fix | Browser retest showed the effect mechanically applied but its entity identity was lost after persistence. Backend schema/persistence repair fixed the exact boundary. |
| 05:42:52–06:04:53 | 22m 01s | Exhaustive target-side runtime-effect audit and migration | Longest single reasoning/implementation block after the initial audit. Converted every non-condition lasting target payload in the mini-MVP spell/action scope into a real effect entity while preserving mechanics. |
| 06:04:53–06:12:44 | 7m 51s | Deployment attempt 1 and rollback | Cold backend build reached migration and found a legacy SQL `NULL` mechanics row. Transaction and release rolled back safely. A restored-DB preflight would have found this before building frontend/releasing. |
| 06:12:44–06:18:24 | 5m 40s | Deployment attempt 2 and rollback | The corrected migration reached the effect-type constraint and failed because `active_effect` was not a valid catalog type. Rollback was automatic. Direct schema inspection found the accepted values quickly. |
| 06:18:24–06:26:39 | 8m 15s | Production-backup migration preflight and icon completeness | Restored the latest production dump into ephemeral PostgreSQL, ran migrations, verified 63 effects, found one missing image, added the fallback and repeated the preflight successfully at 63/63. |
| 06:26:39–06:42:57 | 16m 18s | Final data migration deploy, browser Ray test, nested-reference diagnosis | Cached release deployment completed in about 19 seconds. Fresh Ray of Frost then revealed that nested `grant_effect` references were not preloaded; focused diagnosis and two regression tests closed it. |
| 06:42:57–06:51:30 | 8m 33s | Frontend build, archive upload and final Timecloud deploy | Focused tests passed in 4.69s; local production build took 44.54s. Uploading the 114 MB immutable archive and rebuilding the unchanged backend were the main avoidable costs. |
| 06:51:30–06:58:30 | 7m 00s | Final browser QA | Ray of Frost hit a Wolf, inspector showed 30/base 40 speed, real icon/source and clickable effect card. Forge showed all 10 species, 12 classes and repaired spells in default verified-only mode. |
| 06:58:30–07:03:20 | 4m 50s | Exact certification and audits | Atomic operation certified 155 records (17 actions, 116 effects, 22 spells). The live manifest changed from 158/180 to 180/180; 63/63 runtime effects were verified with images. |
| 07:03:20–07:10:10 | 6m 50s | Workbook synchronization, re-import and six-sheet render | Updated 111 support cells and seven evidence threads. Formula scan returned zero. Full rendering was substantially slower than editing; range-only iteration would be faster. |
| 07:10:10–07:12:15 | 2m 05s | Exact QA cleanup and final report | Preview validated 75 QA and 10 preserved characters; deletion took 5.65s and the post-check confirmed 10 total / 0 QA. |

## Final duration and largest contributors

Total wall time from 03:25:44 to approximately 07:12:15: **3h 46m 31s**.

The largest contributors were:

1. **Data/runtime integration and exhaustive effect materialization:** roughly 60–70 minutes across the initial implementation, remaining identity audit and the 22-minute full runtime-effect conversion.
2. **Deployment/rebuild/upload cycles:** roughly 45–55 minutes. Two failed migration releases were safe but avoidable; the frontend-only final release still rebuilt an unchanged backend, and each release uploaded a 114 MB archive.
3. **Broad compile/build verification:** roughly 20–30 minutes distributed across repeated TypeScript, Vite and Go builds. Focused tests themselves were usually seconds.
4. **Browser QA and evidence capture:** roughly 20–25 minutes. This found three issues the broad suites missed: lost persisted entity identity, shallow nested-effect preloading and the actual target-inspector clarity gap.
5. **Spreadsheet artifact QA:** roughly 7 minutes for synchronization, re-import, formula scan and six full renders; edits themselves were negligible.

## Concrete speed improvements for the next feature task

- Make restored-production-DB migration preflight mandatory before building or switching a release. It would have avoided both rollback cycles.
- Compute changed paths and reuse the current backend/frontend image independently. A frontend-only change should not compile Go, and a migration/backend-only change should not run Vite.
- Enable BuildKit/buildx and preserve dependency layers; the server currently warns that it uses the deprecated legacy builder.
- Replace the 114 MB full archive transfer with server-side fetch of an exact signed Git SHA or a content-addressed delta artifact.
- During development run focused Vitest suites and one package-level type boundary; keep one full TypeScript/Vite build as the release gate.
- Keep browser smoke scenarios small and deterministic: one living high-HP target for effect inspection, one area cluster for geometry and a reset helper that creates a fresh scene from production data.
- Render only changed workbook ranges during iteration; re-import and render all tabs once at the final gate.
