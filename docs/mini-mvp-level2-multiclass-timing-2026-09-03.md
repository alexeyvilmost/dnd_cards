# Mini-MVP level-2 / multiclass timing log

Task start: 2026-09-03 03:02:50 +03:00

Policy: log major implementation, test, browser, deployment and correction phases; do not run the retired long corpus.

## Major steps

| Step | Wall time | Kind | Outcome |
|---|---:|---|---|
| Production catalog/API diagnosis | ~2 min | active diagnosis | Found all 12 base classes had null support, which made the verified level-2 Forge class list empty. Compact class request: 53 ms, 46,034 bytes for 62 rows. |
| Rogue sheet acceptance | ~3 min | manual browser | Cunning Dash resource, effect and journal passed. |
| Monk sheet + scene + combat acceptance | ~8 min | manual browser | Patient Defense, resource refresh and two-hit Flurry passed. Most time was scene/dice interaction. |
| Cleric sheet + undead scene diagnosis | ~7 min | manual browser/diagnosis | Divine Spark passed; Turn Undead reproduced a zero-range area-target dead end. Retained a real undead QA monster. |
| Turn Undead and hotbar implementation | ~4 min | code | Added immediate self-centred emanation targeting and readable temporary-action resources. |
| Focused frontend edit loops | 14.700 s total | machine wait | Two useful failed iterations (5.270 s, 4.562 s) and final 26/26 pass (4.868 s). Failure was a boundary fixture exactly at/outside 30 feet. |
| TypeScript gate | 34.474 s | machine wait | Passed before the final fixture-hardening patch. |
| Backend migration edit loops | 6.726 s total | machine wait | First full package run found only a stale latest-version assertion (2.956 s); final package passed (3.770 s). |
| Broader combat/level-2 edit loops | 18.325 s total | machine wait | Two runs exposed optional-fixture crashes (5.991 s, 5.617 s); final 158/158 pass took 6.717 s. |
| Certification integrity review | ~4 min | active review | Replaced blanket full-mechanical certification with explicit partial limits for Druid, Fighter, Monk and Sorcerer. |
| Release-candidate parallel gate | 37.737 s critical path | machine wait | TypeScript passed; Go migrations passed in 4.662 s. |
| Stale persistence assertion diagnosis and correction | ~5 min active + 11.395 s test wait | diagnosis/test | The size-optimized runtime correctly strips inline card art, but one older test still expected one embedded copy. Updated only the assertion; final relevant suite passed in 7.284 s. |
| Exact archive creation | 0.635 s | local machine | 114,268,160-byte immutable tar for `1c26b297`; SHA-256 `4f3b9ec48969695ea41c4a0cc15fe7350dc602e4db6ddc5c86e24aa2dc7197ff`. |
| Verified Timecloud upload | 32.645 s | network wait | Remote SHA-256 matched before runner start. |
| Timecloud release runner | 209.408 s | remote machine wait | Backup, backend/frontend images, migration, atomic cutover and health checks passed. This was the longest single machine action. |
| Independent identity + retention | 1.231 s | network/read-only | Backend, frontend and `current` matched `1c26b297`; exactly 5 releases and 5 archives. |
| Fresh Forge + Turn Undead production acceptance | ~8 min | manual browser | All 12 classes visible; fresh 30-foot emanation selected undead immediately and logged a successful save plus both resource spends. |
| Action Surge production acceptance and filter defect | ~6 min | manual browser/diagnosis | Dedicated resource and hover card were clear, but the literal-cost filter returned zero actions. |
| Follow-up filter implementation and gates | ~3 min + 36.222 s critical path | code/machine wait | Substitute Action Surge resource maps to non-spell `action` cards; Quickened maps to spell `action` cards. Focused tests 5.363 s, TypeScript 36.222 s. |
| Follow-up archive creation | 0.583 s | local machine | 114,278,400-byte archive; SHA-256 `02a48e2266ece732a5b8418180c7d66fbf3517d1a4aaef57c5f8033345673fac`. |
| Follow-up verified upload | 30.306 s | network wait | Remote checksum matched. |
| Follow-up Timecloud runner | 149.386 s | remote machine wait | Cached release was 60.022 s faster than the first runner. |
| Final identity + retention | 1.353 s | network/read-only | Backend, frontend and `current` matched `55ca2842`; 5 releases and 5 archives. |
| Fresh-client filter and toggle acceptance | ~2 min | manual browser | Non-spell actions appeared for Action Surge; Magic actions were excluded; second click restored default hotbar. |

Task close: 2026-09-03 03:43:59 +03:00. Total wall clock for this continuation: 41m 08s.

## What took longest

The longest useful phase was manual browser acceptance, especially Monk/Cleric setup and the production follow-up: over 30 minutes combined. The slow part was not test execution; it was repeated page state preparation, target selection, dice dialogs, initiative turns and rebuilding a fresh encounter after discovering that old snapshots embed old action mechanics.

The longest single automated action was the Timecloud runner at 209.408 seconds. Local TypeScript took 34–38 seconds; focused behavior tests were under eight seconds per pass.

## How to speed up the next run

1. Add deterministic scene presets for each class boundary: injured ally, adjacent enemy, undead pack and depleted resources. Reusing a retained scene already saved character creation time; one-click presets would remove most of the remaining browser setup.
2. Add a test-mode deterministic dice control directly to the scene constructor. Current manual acceptance spends more time opening and resolving dice dialogs than evaluating results.
3. Add a catalog-to-fresh-combat reset button. Reloading is insufficient because saved combat snapshots embed action mechanics; testers need an explicit recompile/restart control.
4. Keep focused Vitest files as the edit loop and run TypeScript once on the final candidate. Here 158 focused tests took 6.717 s versus 34.474 s for type checking.
5. Make the migration registry test derive the latest entry rather than hard-coding the previous migration name. The current assertion caused one avoidable backend rerun.
6. Make minimal combat fixtures use the same constructor defaults as production. Missing optional `grapples` and duplicated actor assumptions caused two avoidable reruns despite production state being valid.
7. Promote one locally verified frontend artifact to Timecloud or enable a content-addressed BuildKit cache. Prior releases show server-side Vite recompilation and upload/cutover dominate the machine critical path.
