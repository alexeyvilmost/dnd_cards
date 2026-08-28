# Mini-MVP repair and certification timing log — 2026-08-28

## Snapshot and accounting boundary

- Status at this snapshot: the first exact-SHA release was certified and reached
  72/72 Forge readiness. Its first three production canaries then exposed two
  integration-contract defects and one invalid canary assumption. The fixes are
  frozen and locally verified against the production backend; the new exact-SHA
  commit/deploy/evidence/certification cycle and final in-app checks remain.
- Display timezone: Europe/Moscow (UTC+03:00).
- User-observed task duration: approximately **8 h 30 min**.
- First exact tracked milestone: commit `76b3c70` at
  `2026-08-28T01:00:08+03:00`.
- Last exact milestone in this snapshot: certification plan creation at
  `2026-08-28T08:44:38.434+03:00`.
- Exactly reconstructable span between those milestones: **7 h 44 min
  30.434 s**.
- If the user's 8 h 30 min measurement ended at the certification-plan
  milestone, the uninstrumented work before the first commit was approximately
  **45 min 29.566 s**. This is an inference, not an exact timestamp.

Historical active work and machine wait were not logged separately. Commit
intervals below are therefore `mixed/unseparated`; they include any reasoning,
editing, test execution, deployment, and pauses between commits. Exact machine
timings are reported separately from the release-evidence JSON.

## Reconstructed major-step log

| Step | Boundary (Europe/Moscow) | Elapsed | Time type | Evidence and result | Bottleneck | Next-task speedup |
| --- | --- | ---: | --- | --- | --- | --- |
| Browser audit, root-cause analysis, and first systemic repair | start unknown → `01:00:08` | unknown; approximately `45:29.566` only under the stated user-duration assumption | mixed/unseparated | `76b3c70`; 118 files, 12,317 insertions and 951 deletions | One batch combined browser investigation, engine/runtime repair, infrastructure, migrations, and test expansion | Establish the timing log and reproduction matrix first; split independent adapter, content, and infrastructure work into parallel lanes, then integrate behind one contract review |
| Align certification with production readiness | `01:00:08` → `01:56:42` | `56:34` | mixed/unseparated | `1480bcd`; atomic certification projection/readiness work | Production content authority was a separate boundary from the runtime fix | Exercise dry-run production readiness before the first deployment candidate and keep the projection shared between runtime and fixture code |
| Make installs deterministic | `01:56:42` → `02:39:02` | `42:20` | mixed/unseparated | `191a1d8` (committer timestamp); DiceBox integrity and lifecycle-script controls | Install-time asset mutation appeared only in a clean exact-SHA environment | Run a clean install plus asset-integrity check once near the start of release work, while implementation continues in parallel |
| Preserve Git-object bytes in Windows release archive | `02:39:02` → `02:45:52` | `06:50` | mixed/unseparated | `f30cbba`; archive documentation and command corrected | Operator checkout line-ending policy changed pinned bytes | Make the archive-byte check a preflight command independent of the deployment host |
| Separate Node and Vitest suites | `02:45:52` → `03:24:29` | `38:37` | mixed/unseparated | `a7d5bcc`; foreign empty suite excluded from Vitest and retained in its owning gate | Two runners claimed the same filename pattern | Add a manifest test that assigns every test file to exactly one runner before the full suite starts |
| Assert migrated Goliath authority | `03:24:29` → `03:45:03` | `20:34` | mixed/unseparated | `06a6c6b`; stale duplicate-authority expectation repaired | Test expectation described the pre-migration state | Generate post-migration assertions from the migration postcondition instead of maintaining a second manual inventory |
| Close reaction migration coverage | `03:45:03` → `04:28:16` | `43:13` | mixed/unseparated | `cd6398a`; corruption-path and round-trip coverage added | Ordinary tests had not enabled the critical 100% coverage barrier | Run critical-module coverage as a focused pre-commit gate whenever those modules change |
| Isolate Vite release generators | `04:28:16` → `05:28:01` | `59:45` | mixed/unseparated | `3de31a4`; automatic dependency discovery disabled for generators | Cold optimizer state crawled unrelated app modules | Give generators a tested shared factory with dependency discovery disabled by construction |
| Preserve failed release diagnostics | `05:28:01` → `06:08:20` | `40:19` | mixed/unseparated | `b4a5b4c`; nonzero and strict-validation failures now retain private reports | A transient full-suite failure deleted the only diagnostic, forcing inference and reruns | Preserve the first failure artifact before cleanup; forbid hypothesis-free reruns |
| Repair exact-SHA browser fixture and font contracts | `06:08:20` → `08:14:23` | **`2:06:03`** | mixed/unseparated | `cfc579c`; deterministic condition release, self-hosted fonts, browser network assertions | This is the longest reconstructable change interval; the isolated browser fixture had drifted from the real loader and external font availability affected a rules path | Run the exact fixture certification and cross-origin request assertion in a focused cold-browser gate before deployment; continue sharing production materialization code with test fixtures |
| Deploy/bootstrap final evidence runner | `08:14:23` → `08:22:27.047` | `08:04.047` | mixed/unseparated | Deployed exact SHA, prepared clean evidence checkout and began evidence | Deployment/bootstrap has no structured per-action timing record | Emit deploy, health, checkout, install/cache, and runner-start timestamps into one deployment artifact |
| Exact-SHA full release evidence | `08:22:27.047` → `08:43:27.468` | **`21:00.421`** | machine wait | 6,276/6,276 tests; 16/16 gates; zero failed, skipped, or TODO | The suite is sequential; four gates consume 74.3% of its wall time | Keep one final exact-SHA run; profile safe sharding/parallelism and reuse immutable build/catalog artifacts across gates |
| Evidence-to-plan handoff | `08:43:27.468` → approximately `08:44:31.904` | approximately `01:04.436` | mixed/unseparated | Operator/orchestration interval inferred by subtracting the measured plan command from its artifact creation time | This interval is not broken down | Emit action start/end records alongside the certification artifact |
| Generate read-only 252-record certification plan | approximately `08:44:31.904` → `08:44:38.434` | **`00:06.530`** | machine wait | Planned bundle, 252/252 records | Not a material bottleneck | No optimization priority; retain the exact timing field |
| Reconstruct this timing log and author the durable policy (measured portion) | `09:01:45.301` → `09:08:38.874` | `06:53.573` | active work; parallel with authorization diagnostics | Added this log and `docs/feature-task-timing-policy.md`; earlier discovery minutes were not clocked | Historical archaeology required Git, evidence JSON, and diagnostic metadata correlation | Start the template at task acceptance and have commands emit timing records, eliminating reconstruction work |

The commit-to-plan span is not an active-effort estimate. No reliable source can
separate active work from machine waiting inside the historical commit windows.

## Exact final evidence timing

Source: private `micro-mvp-release-evidence-cfc579c.json`, whose own
`startedAt`/`completedAt` and gate timestamps are UTC. Durations below come from
those timestamps, not file modification times.

| Gate | Elapsed | Share of 21:00.421 | Result/tests | Main speedup candidate |
| --- | ---: | ---: | --- | --- |
| `frontend_test` | **`6:24.277`** | 30.5% | 2,685/2,685 | Profile slow files and worker saturation; use impacted tests during development while retaining one full final run |
| `browser` | **`4:45.895`** | 22.7% | 40/40 | Profile by spec; shard only after fixtures and database state are proven isolated |
| `semantic_coverage` | `2:13.129` | 10.6% | 1,265/1,265 | Reuse compatible instrumentation/results instead of recompiling the same corpus |
| `rules_core_coverage` | `2:12.020` | 10.5% | 1,108/1,108 | Run this focused barrier immediately after rules-core edits; investigate compatible coverage-pass reuse |
| `build` | `1:22.715` | 6.6% | passed | Build once per exact source tree and consume the hashed output in later gates |
| `frontend_mvp` | `0:52.059` | 4.1% | 134/134 | Share immutable catalog snapshots and warm transform caches where determinism is preserved |
| `micro_manifest` | `0:47.169` | 3.7% | 151/151 | Cache the source/content hash inputs for the same exact tree |
| `live_matrix` | `0:41.293` | 3.3% | 29/29 | Run beside independent frontend-only gates if database isolation is retained |
| `backend_go_test` | `0:34.330` | 2.7% | 459/459 | Run concurrently with frontend-only gates in an isolated database lane |
| `lint` | `0:19.358` | 1.5% | passed | Run concurrently with unit tests after dependency installation |
| `sheet_combat_certification` | `0:15.908` | 1.3% | passed | Reuse the exact generated fixture/hash from the build lane |
| `micro_matrix` | `0:12.499` | 1.0% | 21/21 | Parallelize only if it does not share mutable content state |
| `rules_lab_fixture` | `0:08.746` | 0.7% | passed | Reuse the isolated generator process/cache |
| `rules_primitive_coverage` | `0:04.410` | 0.3% | 384/384 | No priority until larger gates are reduced |
| `backend_go_vet` | `0:01.410` | 0.1% | passed | Run beside backend tests if the build cache is read-safe |
| `deployment_health` | `0:00.132` | <0.1% | passed | No optimization needed |
| Evidence orchestration overhead | `0:05.071` | 0.4% | passed | No optimization needed |

The two slowest gates account for **53.2%** of the final evidence run. The four
slowest account for **74.3%**. They are the first candidates for profiling; the
sub-second gates are not.

## Recoverable retry timing

These are lower bounds, not a complete retry ledger. Earlier evidence attempts
did not yet preserve all gate metadata.

| Attempt/action | Reconstructed elapsed | Time type | Source and confidence | Result/lesson |
| --- | ---: | --- | --- | --- |
| Frontend suite that exposed runner ownership collision | `7:08.207` | machine wait | Vitest `startTime` → private diagnostic file mtime; includes small persistence overhead | 2,679 assertions passed but the run status was false because Vitest collected a foreign empty Node suite |
| MVP suite that exposed stale Goliath authority expectation | `0:44.678` | machine wait | Vitest `startTime` → private diagnostic file mtime; includes small persistence overhead | 132/133 passed; failure led to the post-migration assertion |
| Four MVP confirmation runs after Vite-generator investigation | `3:43.394` total | machine wait | Four Vitest `startTime` → diagnostic mtimes | All four ran 134/134; preserving the first failing report earlier would have reduced the need to establish behavior by repetition |

Known recoverable retry wait is therefore at least **11 min 36.279 s**. Other
failed exact-SHA attempts, install/build time, browser runs, deployment, and
active diagnosis were not fully instrumented, so this value must not be treated
as the total repeated time.

## Certification authorization attempts

All four attempts were fail-closed and made no production write. Attempt 1 has
an exact wall-clock boundary. The later rows have exact component durations but
their inter-attempt diagnosis time was not instrumented, so component sums are
reported instead of invented start/end timestamps.

| Attempt | Boundary / measured actions | Measured machine time | Result | Avoidable cause and speedup |
| ---: | --- | ---: | --- | --- |
| 1 | `09:02:18.524` → `09:02:20.006`; preflight `1.041 s`, SSH-key step `0.432 s` | wall `1.482 s`; components `1.473 s` | SSH-key path failure; no writes | Add a local key-path/readability check before starting the remote workflow |
| 2 | preflight `0.584 s`, key retrieval `1.331 s`, mint guard `0.905 s` | components `2.820 s` | Mint guard failed; no writes | Exercise the complete stdin/data path in a disposable smoke test |
| 3 | preflight `0.635 s`, key retrieval `0.801 s`, selection guard `0.834 s` | components `2.270 s` | Selection guard failed; no writes | Validate selection input and candidate cardinality before key retrieval |
| 4 (diagnostic) | preflight `0.623 s`, key retrieval `0.367 s`, selection cardinality `0.809 s` | components `1.799 s` | Corrected diagnostic found two active allowlisted administrators; no writes | Require an explicit operator-authorized UUID and verify that exact user is active; never select the first row implicitly |

The measured component time across the four attempts was **8.362 s**. The
meaningful cost was the uninstrumented diagnosis between attempts, not command
runtime. The operational defect was a missing interactive-stdin flag on the
containerized PostgreSQL client: SQL received EOF, returned no rows, and caused
a misleading selection failure. Add a preflight unit/smoke test that asserts the
SQL reaches `psql`, verifies nonempty typed output, and covers zero/one/multiple
administrator cardinalities before this script is used again.

## Certification, first production canary, and corrective loop

The rows below were measured after the original snapshot. They are deliberately
split into actions instead of being presented as one opaque “release” duration.
Where only stopwatch output survived, elapsed time is exact but the wall-clock
start/end is not reconstructed.

| Step/action | Elapsed | Category | Result | Bottleneck / speedup |
| --- | ---: | --- | --- | --- |
| Core exact-support atomic apply | `13.017 s` | machine wait | 252/252 postimages verified | Already fast; keep the reviewed bundle and exact receipt checks |
| Forge public dry run | `5.254 s` | machine wait | Exact 49-root post-core plan | No optimization priority |
| Forge public apply with stale pooled TLS connection | `36.910 s` | machine wait / failed attempt | Client socket closed before any HTTP response; Caddy/backend logs proved the request never arrived | Correlate edge and backend request IDs before changing proxy limits; retry the byte-identical operation ID/body on ambiguous transport failure |
| Post-failure readiness diagnosis | `14.676 s` | machine wait | Confirmed all 49 Forge rows remained unapplied | Preserve postimage/readiness diagnostics beside the failed request |
| Internal-tunnel Forge preflight/key/token/dry run | `0.596 + 0.458 + 0.995 + 5.028 s` | mixed action/machine | Exact identity and 49-row plan revalidated | Replace the emergency tunnel with the shared idempotent client path |
| Internal-tunnel Forge atomic apply | `5.943 s` | machine wait | 49/49 applied once | New shared client now makes this detour unnecessary |
| Composed production readiness | `13.261 s` | machine wait | Current condition authority and 72/72 Forge roots | Keep as one composed predicate rather than duplicate catalog scans |
| Live Playwright typecheck | `2.603 s` | machine wait | Passed | No optimization priority |
| First required Stone Ranger canary | `11.6 s` | machine wait | Failed because the test read explicit `character.action_ids` as the complete derived grant graph | Reuse one resolved-grants helper in fixtures/canaries and include relation IDs in failure diagnostics |
| First Fighter canary | `9.6 s` | machine wait | Reached Mage Hand, then backend returned 422 | Persist the backend's allowlisted error body in the first failure artifact |
| First Wizard canary | `6.7 s` | machine wait | `SPELL-0161` failed at the same 422 boundary | One schema-contract reproduction was sufficient for both paths |
| Stone save→assembly→runtime trace and canary correction | `20:50` total (`18:23` diagnosis, `0:34` edit, `1:53` verification) | active work + machine | Production content was correct; canary now follows lineage `related_actions` and dependency hashing proves drift invalidates only Stone | The cross-layer trace, not commands, dominated; centralize a resolved-granted-actions diagnostic |
| Exact-batch client correction | `19:47` | active work + machine | Shared byte-stable idempotent writer; mandatory manifest green | Initial proxy hypothesis cost about 7 minutes; inspect Caddy/backend receipt evidence first |
| Exact-batch ambiguity hardening | `4:41` | active work + machine | Added bounded retry for fetch/body-read loss, 408/429/5xx and strict URL rejection | Two full manifest runs cost about 99 seconds; put delimiter-normalization cases in the focused matrix first |
| Runtime ruleset identity focused gates | `8.640 s` | machine wait | 7 files / 42 tests | Keep this focused set as the schema feedback loop |
| Runtime TypeScript + live TypeScript | `58.975 + 7.914 s` | machine wait | Both passed | TypeScript was the longest local compiler gate; run it once after focused tests stabilize |
| Runtime targeted lint | `7.491 s` | machine wait | Passed | No optimization priority |
| Runtime production build | `43.260 s` | machine wait | Passed in clean environment | Avoid dirty-worktree builds because unused postinstall assets intentionally fail the asset guard |
| Modified-frontend → production-backend Fighter canary | `47.4 s` | machine wait | Mage Hand and Elementalism passed; exact self-cleanup passed | This pre-deploy wire gate prevented another evidence/deploy cycle |
| Modified-frontend → production-backend Wizard canary | `18.2 s` | machine wait | Utility world primitives passed; exact self-cleanup passed | Run beside the Fighter path only when separate accounts/state make parallelism safe; here one worker was correct |
| Combined production-backed corrective verification | `69.361 s` (`09:51:28.065–09:52:37.427+03:00`) | machine wait | 2/2 passed | This is the preferred early adapter-contract check for future changes |
| Independent frozen-delta review | `17:33.162` wall (`~14:50` active, `0:34` tools, `~2:09` coordination wait) | active work / mixed | Found and closed legacy FNV-world data-loss risk; final code review had no blocker | Review the migration compatibility contract before the first live rerun |
| Final full frontend unit suite | `7:27.950` (`10:02:38–10:10:05.950+03:00`) | machine wait, overlapped with review/logging | 318/318 files and 2,688/2,688 tests passed | Do not repeat this corpus after every focused change; run it once on the frozen pre-commit tree |
| Final full frontend lint | approximately `22.26 s` (started `10:02:35.558+03:00`) | machine wait, parallel with unit suite | Passed | Correct parallel lane; it added no critical-path time |
| Final frozen-delta audit | `7:16.229` (`10:02:15.161–10:09:31.391+03:00`) | active work / machine, parallel with unit suite | Code blocker-free; 17/17 batch, 21/21 SHA/FNV/atomic/Toast, credential scan and diff check green | Reviewing in parallel with the broad suite saved about seven minutes of critical-path time |

The corrective loop found that replacing the invalid FNV wire identity without a
compatibility path would have discarded familiar, Pact, scene, concentration,
clock, and replay state. The final exact-alias migration upgrades only a world
whose legacy FNV value is recomputed from the same canonical payload; unrelated
or stale FNV worlds still fail closed.

## Longest parts and how to shorten them

| Rank | Observed bottleneck | Measured time | Why it dominated | Concrete process change |
| ---: | --- | ---: | --- | --- |
| 1 | Browser fixture/font correction interval | `2:06:03` mixed | It was discovered only after an exact-SHA evidence run reached real browser behavior; the fixture modeled stale certification data and depended on an external font request | Add a cold, focused browser preflight that uses production materialization and rejects cross-origin runtime assets before deploy |
| 2 | Vite generator isolation interval | `0:59:45` mixed | Environment-dependent dependency discovery was invisible with a warm optimizer cache | Construct every evidence generator through one fail-closed, entry-discovery-disabled factory and run it once with an empty cache early |
| 3 | Certification-readiness interval | `0:56:34` mixed | Runtime fixes and production content authority were verified at different boundaries | Dry-run the full certification projection against a disposable production-shaped snapshot before packaging |
| Machine 1 | Full frontend unit suite | `6:24.277` exact | Largest single final gate | Identify slow files, tune worker utilization, and avoid running the full corpus after every small correction |
| Machine 2 | Isolated browser suite | `4:45.895` exact | Forty serial/fixture-constrained paths | Record per-spec times and safely shard state-independent specs |

The final full evidence run was only about **4.1%** of the user-reported
8.5-hour wall clock. The larger cost came from discovering release-boundary
problems one after another and cycling through correction plus verification.
The primary optimization is therefore earlier boundary-specific preflights and
first-failure diagnostics, followed by safe parallelism in the final suite.

## Required follow-up entries

Append exact rows when the remaining new-release work completes:

- new exact-SHA commit, push, deploy, and evidence;
- new core/Forge certification and readiness;
- the corrected three production canaries;
- in-app browser Forge/Stone Goliath and `/initiative` checks;
- cleanup and final handoff.

For this task and future feature work, use
`docs/feature-task-timing-policy.md` from task acceptance so active work and
machine wait no longer need to be reconstructed from commit history.
