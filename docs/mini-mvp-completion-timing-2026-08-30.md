# Mini-MVP completion timing log — 2026-08-30

- Status: in progress (steps 1–3; step 4 intentionally waits for user approval)
- Display timezone: Europe/Moscow (UTC+03:00)
- Accepted at: 2026-08-30T10:20:28.000+03:00
- Completed at: pending
- Critical-path wall time: pending
- Active work: pending
- Machine wait on critical path: pending
- Machine wait overlapped by active work: pending
- External wait: pending

## Action log

| ID | Step/action | Start | End | Elapsed | Category | Parallel group | Outcome/evidence |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| A01 | Intake, repository safety boundary, skill/working-tree review, and baseline inventory | 10:20:28 | 10:22:32 | 2m04s | active work | baseline-1 | Preserved three pre-existing tracked edits and unrelated untracked assets; found the prior ally-combat implementation and the sequential long CI workflow. |
| A02 | Production bard reproduction by read-only database inspection | 10:22:32 | 10:26:50 | 4m18s | active work | baseline-1 | Character `100eb271-ad36-4045-9aea-ef0d01a9e395` has six spells and two level-1 slots, but `rule_state.spellcasting` is JSON null and its bard spell grants have no spellcasting ability. The live `EFF-bard-spellcasting` effect declares no primary ability. |
| A03 | Signed-in browser-session check | 10:23:58 | 10:25:08 | 1m10s | active work | baseline-1 | One app tab was public-only; the protected character route redirected to login. No credentials or browser storage were inspected. Reproduction continued through read-only production data. |
| A04 | Spell denominator/support inventory and existing gate profiling | 10:26:50 | 10:29:30 | 2m40s | mixed/unseparated | baseline-1 | Pinned mini-MVP denominator is 34 cantrips + 64 first-level spells. Current production support is incomplete. Planner-only `test:mini:catalog` passed 56 tests in 14.517s but did not execute the real Forge character contract; live audit hit one transient connection reset. |
| A05 | Retry the production strict catalog audit | 10:29:30 | 10:31:21 | 1m51s | external wait | — | A second request also ended in a remote `ECONNRESET`; the longest individual request waited 75.612s. Switched subsequent production inspection to the direct read-only database path instead of repeating the slow failure. |
| A06 | Root-cause fix: audited Bard spellcasting contract repair | 10:31:21 | 10:43:48 | 12m27s | active work | — | Added migration 118 with exact identity/preimage checks, certification revocation, compare-and-swap update, idempotency, and invariant tests. Focused migration test passed; command wall time 20.626s, Go test execution 0.994s. |
| A07 | Build the 98-spell real-sheet activation catalog gate | 10:43:48 | 10:49:47 | 5m59s | active work | — | Added the exact 34/64 denominator gate through schema validation, the real legacy-target materialization boundary, immutable sheet projection, resource rules, activation/trigger rules, and supported primitives. Added it to the live matrix. |
| A08 | Add and run the Bard Forge-character regression | 10:49:47 | 10:50:01 | 14s | machine wait | — | 50 resolver tests passed in 1.28s; full command wall time was 13.778s. The regression uses the reported Bard's six exact spell choices and proves all inherit Charisma. |
| A09 | TypeScript diagnostic pass | 10:50:01 | 10:51:06 | 1m05s | mixed/unseparated | — | 35.764s typecheck exposed four local narrowing errors in the new catalog gate; corrected without entering the wider suite. |
| A10 | Production 98-spell failure-set audit (three focused iterations) | 10:51:17 | 10:52:56 | 1m39s | mixed/unseparated | — | First pass exposed legacy targeting at the wrong boundary (5.285s); second enumerated all 40 rows (4.009s); after routing through the sheet's real compatibility boundary, only `SPELL-0311` remained invalid (3.960s). |
| A11 | Root-cause fix: audited Sleep class-list repair | 10:52:56 | 10:55:34 | 2m38s | active work | — | Added migration 119 with exact mechanics pre/postimage, three stable class ids, false-certificate revocation, idempotency, and guard restoration. Focused migration gate passed in 3.450s. |
| A12 | Combat scene constructor implementation | 10:55:34 | 10:59:27 | 3m53s | active work | — | Expanded setup to three additional characters; added in-combat initiative editing and exact per-actor resource refresh while preserving the active turn and world-scene order. |
| A13 | Scene constructor focused verification | 10:59:27 | 11:00:02 | 35s | machine wait | final-gates-1 | Engine integration gate passed 14/14 in 4.658s; TypeScript verification passed in 34.320s on the same parallel critical path. |
| A14 | Replace automatic long CI with focused gates and add catalog certification support | 11:00:02 | 11:03:57 | 3m55s | active work | — | Push/PR CI now runs targeted TypeScript, Vitest, and migration gates with a 10-minute timeout. Historic full/offline/live-browser suites remain available only by explicit manual dispatch. Added an exact 98-row, atomic support-certification planner and tests. |
| A15 | Final local release gates | 11:03:57 | 11:08:02 | 4m05s | mixed/unseparated | final-gates-2 | 70 focused frontend tests, 2 certification-planner tests, migration tests, and targeted lint passed. Production bundle compiled in 24.59s, then the post-build hygiene gate correctly rejected unrelated untracked local DiceBox `assets/ammo`; exact-archive build will exclude those files. |

## Test and release gates

| Gate | Scope | Elapsed | Result | Tests | Retry | Artifact |
| --- | --- | ---: | --- | ---: | ---: | --- |
| `test:mini:catalog` | planner/unit baseline | 14.517s | passed | 56 | 0 | terminal output |
| `mini-mvp-audit --strict` | live production baseline | 75.612s longest attempt | infrastructure failure (`ECONNRESET`) | — | 1 | terminal output |
| focused Bard migration unit gate | migration registration + canonical JSON invariant | 20.626s wall / 0.994s test | passed | 2 | 0 | terminal output |
| Bard resolver regression | reported Bard + six selected spells | 13.778s wall / 1.28s Vitest | passed | 50 | 0 | terminal output |
| TypeScript diagnostic | new activation catalog | 35.764s | failed, then corrected | — | 0 | terminal output |
| 98-spell production activation gate | exact live rows through real sheet projection | 3.960s final baseline pass | expected failure: Sleep only | 97/98 rows | 0 | terminal output |
| focused Bard + Sleep migration gate | unit plus optional isolated-PostgreSQL cases | 3.450s | passed | 6 registered/available | 0 | terminal output |
| combat scene constructor | state transitions and world-scene synchronization | 4.658s | passed | 14 | 0 | terminal output |
| TypeScript after scene constructor | frontend compile contract | 34.320s | passed | — | 0 | terminal output |
| final focused frontend gate | resolver + scene engine + hotbar | 6.950s | passed | 70 | 0 | terminal output |
| support-certification planner | exact atomic 98-row support update | 0.245s | passed | 2 | 0 | terminal output |
| final focused migration gate | Bard + Sleep repair contracts | 4.394s wall / 1.728s test | passed | 6 registered/available | 0 | terminal output |
| targeted lint | changed frontend modules | 23.557s | passed | — | 0 | terminal output |
| production build | TypeScript + Vite + PWA + asset hygiene | 55s wall / 24.59s Vite | blocked only by unrelated untracked `assets/ammo` | — | 0 | terminal output |
| sheet combat certification drift check | generated certificate baseline | pending | pending | — | 0 | terminal output |

## Early bottleneck findings

1. The existing catalog gate verifies patch planners and hashes, not that a real Forge caster can cast its chosen spells.
2. The generated combat certificate compiles an overlay containing a bard spellcasting declaration that live production data lacks; the two inputs can therefore disagree while CI stays green.
3. The current CI workflow runs build, the full frontend suite, two structural coverage suites, semantic coverage, two-browser Playwright, race-enabled backend tests, and a production browser wait serially. This is the long pipeline to replace with focused required checks and explicit manual checklist evidence.
4. The first material time loss was the repeated public live-audit request: 75.612s on the longest attempt and no diagnostic payload. Direct database inspection returned the decisive Bard mismatch in seconds, so later production gates will avoid blind HTTP retries.
5. Aggregating every spell failure in one live run reduced diagnosis from a potential 40 request/test loops to three sub-six-second passes. Thirty-nine apparent targeting failures were valid legacy rows handled by the real sheet adapter; one genuine catalog defect remained: Sleep lacked stable class-list ids despite a full mechanical certificate.

## Data quality

- Exact timestamps: task start, A01–A04 boundary, individual machine gate durations.
- Reconstructed intervals: A01–A06 boundaries were reconstructed from exact tool-start time plus recorded wall durations; overlap is identified where applicable. Exact machine timings are stated separately in the evidence cells.
- Secrets: none recorded.
