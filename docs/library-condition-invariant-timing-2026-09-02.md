# Library-owned condition invariant timing — 2026-09-02

Times are Europe/Moscow wall-clock measurements, rounded to the nearest minute for intermediate boundaries. The turn began at `16:45:00+03:00`.

| Interval | Duration | Major step / action | Result |
|---|---:|---|---|
| 16:45–16:51 | 6 min | CodeGraph call-chain mapping and browser-control setup | Located the mastery compiler/runtime/persistence chain before editing. |
| 16:51–16:58 | 7 min | Sap identity implementation and focused fixtures | Removed legacy executable fallback and carried library identity into runtime effects. |
| 16:58–17:04 | 6 min | Cross-system generic-condition audit | Found and fixed Grapple, Shove/Prone, and condition-leave bypasses. |
| 17:04–17:09 | 5 min | Backend guard, catalog validation, and focused regression tests | Added server anti-bypass validation; confirmed 8/8 masteries and 16/16 conditions have identity. |
| 17:09–17:24 | 15 min | Release-fixture hash investigation | Proved the overlay mismatch exists on the clean pre-change commit and avoided an unrelated release-id change. |
| 17:24–17:30 | 6 min | Final focused tests, type check, diff isolation, commit | 82 frontend tests, TypeScript, and backend tests passed; only 19 intended files committed. |
| 17:30–17:31 | 1 min | Mainline release commit and push | Published release source commit `6dc3fb9…`. |
| 17:31–17:36 | 5 min | Timecloud immutable build, health checks, activation, retention | Release healthy; exact commit active; 5 releases and 5 archives retained. |
| 17:36–17:42 | 6 min | Authenticated production browser reproduction | Fresh Sap hit persisted across reload and was clear in target inspection. |

## Longest part

The longest investigation was **15 minutes diagnosing the pinned overlay hash mismatch**. It was unrelated to the requested behavior: the same mismatch reproduced from the clean pre-change commit. Timecloud deployment was the longest necessary mechanical action at about **5 minutes**, dominated by backend/frontend image builds and the frontend production bundle.

## How to make the next pass faster

1. Add a release-fixture dry-run command that prints every computed content hash and its source inputs in one invocation. Compare it against a clean baseline before regenerating artifacts. This should reduce the 15-minute detour to roughly 2–3 minutes.
2. Keep a small `conditions-invariant` test target containing the mastery, condition-transition, reducer, persistence, and server-validation tests used here. The useful focused suite itself took about 6 seconds; invoking the existing binaries directly avoided the package manager's unrelated install-policy check.
3. Cache the Timecloud frontend build with BuildKit/buildx. The current legacy Docker builder retransforms 4,622 modules on every release and accounts for most of the ~5-minute deployment.
4. Keep a dedicated living QA fighter with one nonlethal Sap target and resettable scene resources. The scene constructor already cut manual setup substantially; avoiding a lethal damage roll would make the UI check repeatable in 2–3 minutes.

## Total

Implementation through production evidence took **57 minutes 24 seconds** (`16:45:00`–`17:42:24`). Report authoring and repository cleanup are tracked after that evidence boundary so they do not inflate the engineering/debugging time.
