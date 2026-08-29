# Feature task timing — combat hotbar, monster token, character previews

Date: 2026-08-29 (Europe/Moscow)

## Outcome

- Added a BG3-inspired clickable resource strip above the combat hotbar.
- Added resource-specific action filtering with second-click reset, including exact free-use spell grants.
- Reused the character-sheet action preview in combat and moved its popover to the document layer so the hotbar cannot clip it.
- Fixed the monster constructor save sequence so a local image is uploaded after the monster update without erasing its existing durable token URL.
- Added a bounded `fields=preview` character-list projection so the library no longer downloads runtime JSON that its cards do not render.
- Added focused unit, backend integration, and desktop/mobile browser coverage for the changed contracts.

## Wall-clock record

- Start: `09:29:17.968 +03:00`
- Local implementation and verification complete: `09:56:11.535 +03:00`
- Total local elapsed time: **26m 53.6s**
- Live production upload: **not included in this wall clock**; it was completed and timed separately after the user authorized the browser session.

The command durations below overlap because independent checks were deliberately run in parallel. They must not be summed to calculate wall-clock time.

## Major phases

| Phase | Duration | Result |
| --- | ---: | --- |
| Reference review, CodeGraph/source tracing, and cross-layer contract mapping | ~15m | Located hotbar/resource/action-preview paths, monster save/upload boundary, and oversized character-list serialization. This was the longest active reasoning phase. |
| Implementation across combat UI, monster constructor, preview DTO/API, and test fixtures | Included in the 26m 53.6s wall clock | 3 vertical fixes plus tests; edits were made while focused checks were running. |
| Final focused unit suite | 6.39s | 4 files, 34 tests passed. |
| Final changed browser suite | 30.0s | 6/6 passed: three flows on desktop and mobile. |
| Final backend suite | 14.72s | `go test ./...` passed. |
| Final frontend TypeScript compile | ~42.5s | Passed. |
| Production bundle | 79.59s | Passed with direct Vite build. This was the longest single machine action. |

## Detailed action log

| Action | Duration | Status / finding |
| --- | ---: | --- |
| First focused frontend run | 19.59s | Failed early because the newly added test had a syntax error. |
| Second focused frontend run | 52.75s | 33 passed, 1 failed; the remaining failure was incomplete test mocking. |
| First cold frontend typecheck | 80.53s | Passed; it ran concurrently with other cold checks. |
| First cold focused backend run | 55.29s process wall time | Passed; package test time was much shorter, with cold/concurrent startup dominating. |
| Corrected focused frontend run | 10.24s | Passed. |
| Corrected focused backend run | 13.91s | Passed. |
| Corrected frontend typecheck | 47.36s | Passed. |
| Direct Vite production build | 79.59s | Passed. The repository's wrapper asset guard was intentionally not used because unrelated pre-existing untracked asset folders trigger it. |
| First combat + monster desktop/mobile browser pass | 34.10s | 4/4 passed. |
| Character-preview desktop/mobile browser pass | 13.21s | 2/2 passed. |
| Final formatting | 0.37s | Completed. |
| Live-browser harness typecheck | 5.04s | Passed. |
| Final complete backend suite | 14.72s | Passed. |
| Final frontend typecheck | ~42.5s | Passed. |
| Final focused frontend unit suite | 6.39s | 34/34 passed. |
| Final Go static analysis | 5.56s | Passed. |
| Browser command with stale project names | 2.33s | Failed before tests started; corrected names were `desktop-chromium` and `mobile-chromium`. |
| Final changed browser suite | 30.0s | 6/6 passed. |

## Production follow-up after authorization

Authorization was completed in a later turn, so these actions are recorded separately from the original 26m 53.6s local wall clock.

| Action | Duration | Status / finding |
| --- | ---: | --- |
| Load authenticated Goblin constructor | 3.5s after initial navigation | Record and content-admin controls loaded correctly. |
| Select supplied 512×512 token | 1.8s | Local preview was created successfully. |
| Attempt ordinary constructor save | 3.90s | Reproduced production failure: `Не удалось обновить монстра`. The rejection occurs in the monster database update before image upload. |
| Direct production cloud upload | 5.38s | Succeeded through the existing `В облако` action. |
| Full reload and persistence verification | 4.3s | The Goblin retained the new Yandex Storage token URL after reloading from the API. |
| Backend regression suite after explicit-update fix | 10.39s | Passed. The PostgreSQL-specific integration case is present but skipped locally because `CANONICAL_RUNTIME_TEST_DSN` is not configured. |
| Backend static analysis after fix | 2.74s | Passed in parallel with the regression suite. |

Production token URL: `https://dnd-cards-images.storage.yandexcloud.net/monster_tokens/1787986913_i6hGgIzg.png`

## Release attempt after production authorization

The feature release was pushed to `main` as three allowlisted commits. The first release attempt incorrectly targeted the retired hosting integration, whose account was inactive. Production therefore remained on `d945965e0943f6beed68d31d03ee29f63c988b0f`; the intended feature SHA was `a6770435c43d94f1bda0b5979a5b8054008e0d0f` before the Timecloud migration commit.

| Action | Duration | Status / finding |
| --- | ---: | --- |
| CI run 260 for `6090329` | 5m 52s | Failed in the full frontend suite: one character-access test still mocked `list` instead of the new `listPreviews` method. |
| Local full frontend reproduction | 6m 23.1s | 2,693/2,694 tests passed; isolated the single stale mock. |
| Targeted character-access regression | 8.60s process / 4.24s test | 2/2 passed after the mock correction. |
| Frontend TypeScript check after correction | ~53.6s | Passed. |
| CI run 261 for `a95ef6c` | 14m 38s | Frontend gates passed; PostgreSQL integration exposed `action_ids = NULL` for an unchanged monster with an explicit empty list. |
| Local PostgreSQL failure reproduction | 8.57s | Reproduced the website-constructor save failure exactly. |
| Targeted PostgreSQL regression after fix | 12.38s process / 3.57s test | Passed; explicit empty `Properties` now persists as `[]`, while a missing value remains SQL `NULL`. |
| Content-migration bootstrap | 8.73s | Passed against the isolated PostgreSQL database. |
| Complete backend suite against PostgreSQL | 26.52s process | Passed; backend package 12.661s and migrations package 5.911s. |
| Backend static analysis | 2.30s | Passed. |
| CI offline gate 262 for final `a677043` | 14m 50s | Passed: build, lint, 2,695 frontend tests, MVP/coverage/semantic gates, browser acceptance, content migration, backend tests, and vet. |
| CI browser acceptance inside run 262 | 4m 09s | Passed; this was the longest individual final-CI step. |
| CI production-canary job | 10s | Workflow remained red because the repository's production canary account secret is not configured; the tested offline gate itself passed. |
| Wait for retired-host rollout | ~3m | No Aug 29 deployment appeared; both public services continued reporting the previous SHA. |
| Retired-provider diagnosis | ~2m | Deployment history confirmed that GitHub pushes did not start new deployments. |
| Retired-provider redeploy attempt | 15.9s | Rejected because that inactive account could no longer deploy. This was not the current Timecloud release path. |

### Release speed findings

1. Run the affected test before the complete 6m23s frontend suite. The stale mock was proven in 4.24s once isolated.
2. Run the monster update integration test against PostgreSQL before the full CI push. SQLite/unit coverage could not expose the `NOT NULL JSONB` conversion failure.
3. Check Timecloud SSH connectivity, runner availability, disk space, and current SHA before spending time on a release.
4. Use the explicit Timecloud archive/runner procedure after the offline gate; a green code gate intentionally does not mutate production.
5. Configure or intentionally disable the production-canary job when its credentials are absent so a passed offline gate is not reported as an undifferentiated workflow failure.

## Timecloud migration timing

- Start: `11:33:04.370 +03:00`
- Repository migration, focused validation, and production-build check complete: `11:49:11.291 +03:00`
- Pre-deployment wall clock: **16m 06.9s**

Independent checks overlapped and therefore must not be summed as wall-clock time.

| Action | Duration | Status / finding |
| --- | ---: | --- |
| CodeGraph deployment trace | 3.8s | Completed before text search as required by the indexed repository contract. |
| Repository mention/source scan | 5.2s | Located runtime fallbacks, old hosts, release evidence, backup guards, docs, and obsolete config files. |
| Timecloud guide and infrastructure review | 4.4s | Confirmed the exact-SHA archive, backup, atomic cutover, and rollback procedure. |
| Timecloud SSH/server preflight | 3.9s | Current release, three containers, deploy runner, and disk capacity verified. |
| Mechanical cleanup across 67 tracked files | 0.86s | Replaced obsolete provider text and retired production URLs before semantic corrections. |
| Focused Go deployment/security tests | 14.69s | Passed. |
| Release and backup-contract suite | 46.54s | 77/77 passed; the longest test inside it was the 29.52s migration integration case. |
| Stale release-fixture correction | 0.96s rerun | The fixture still expected the deleted secondary nginx listener; corrected to assert the canonical template. |
| Complete backend tests and vet | 14.78s | Passed. |
| Timecloud Compose validation | 0.71s | Passed with an existing local env-file path. |
| Shell runner syntax + diff whitespace gate | 1.18s | Passed. |
| Frontend TypeScript | 53.07s | Passed; longest single pre-deployment machine action. |
| Vite auto-config attempt | 3.93s | Failed because a local ignored generated config shadowed the tracked config. |
| Canonical production Vite build | 46.91s | Passed when pinned to tracked `vite.config.ts`. |

Speed improvements confirmed here:

1. Pin `vite.config.ts` in local release commands; this avoids stale ignored generated config discovery.
2. Keep the 1-second focused release assertion before the 46-second contract suite.
3. Run independent Go, TypeScript, and deployment-syntax checks concurrently.
4. Perform Timecloud SSH/runner/disk preflight before lengthy CI or production builds.

## What took longest

1. **Cross-layer discovery and contract mapping (~15m)** was the largest active block. Three requests crossed UI, engine metadata, API serialization, storage upload, permissions, and browser behavior.
2. **The production build (79.59s)** was the longest individual machine action.
3. **Cold TypeScript compilation (80.53s initially; ~42.5s warm)** was the next largest repeatable machine cost.
4. **Avoidable reruns cost about 74.7s**: 72.3s for the two early unit-test mistakes and 2.3s for stale Playwright project names.

## How to make the next feature task faster

1. Add pure contract tests before component wiring. The final resource filter and monster payload tests run in milliseconds and would have caught both early mistakes before the broader suite.
2. Keep a single canonical changed-feature verification command containing the repository's real Playwright project names. This removes command-memory errors and makes timing automatic.
3. Reuse one warm TypeScript/build worker when possible. Cold compiler startup roughly doubled the typecheck duration in this run.
4. Run one production build after focused tests, not after every edit. Browser fixtures already validate behavior more cheaply.
5. Keep bounded list DTOs as an API rule: list/card endpoints should select only rendered columns; detail/runtime endpoints own large JSON.
6. Expose content-admin capability in the UI before enabling constructor saves. That turns a production-only 401/403 investigation into an immediate actionable message.
7. Preserve the monster's durable image URL until storage confirms the replacement. This prevents failed uploads from creating a second recovery/debugging task.

## Verification summary

- Frontend focused unit tests: **34/34 passed**.
- Changed desktop/mobile browser tests: **6/6 passed**.
- Backend tests: **passed**.
- Go static analysis: **passed**.
- Frontend application typecheck: **passed**.
- Live-browser harness typecheck: **passed**.
- Targeted lint: **passed**.
- Production Vite build: **passed**.
