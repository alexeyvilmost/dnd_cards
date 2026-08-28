# Feature-task timing policy and template

## Purpose

Every feature, bug-fix, migration, and production-certification task must keep a
timing log from task acceptance through the final live check. The log exists to
reduce feedback-loop time, not to evaluate people. It must make the critical
path, repeated work, and avoidable waiting visible.

## What to record

Start a task log before investigation. Add an entry at the beginning and end of
every major step and every action that takes at least one minute. At minimum,
record:

1. scope and safety checks;
2. browser reproduction or baseline measurement;
3. root-cause investigation;
4. design/contract decision;
5. implementation;
6. focused tests;
7. adjacent/integration tests;
8. full release evidence;
9. review and rework;
10. commit, push, deploy, certification, and live browser verification.

Use ISO-8601 timestamps with an offset. Record the task's display timezone at
the top of the log. Machine-produced evidence may remain in UTC, but the summary
must identify that timezone explicitly.

Do not record passwords, access tokens, cookies, environment values, or other
secrets. Link to a private artifact by path or hash instead of copying sensitive
output into the log.

## Time categories

Each action has one primary category:

- **active work** — browser exploration, reading, reasoning, editing, review, or
  responding to a failure;
- **machine wait** — tests, builds, installs, image creation, deployment, or
  evidence generation where completion is on the critical path;
- **external wait** — approval, unavailable service, rate limit, or another
  dependency outside the repository;
- **mixed/unseparated** — permitted only for reconstructed historical entries
  where active and wait time cannot be recovered.

Track two different totals:

- **critical-path wall time** is the union of intervals from acceptance to the
  terminal result; overlapping actions count once;
- **active effort** and **machine wait** are action totals. If active work occurs
  while a machine action runs, tag both rows with the same `parallel group`.
  The overlapped machine time is reported separately and is not presented as
  avoidable critical-path wait.

Never infer active effort by subtracting known test time from an uninstrumented
commit interval. Label historical gaps `mixed/unseparated` and state the source
used to reconstruct them.

## Required live logging behavior

- Write the task-start timestamp as soon as the task is accepted.
- Start each action row before the action, then fill its end, outcome, and
  artifact fields immediately afterward.
- Preserve the first failed test report. Do not rerun a failed full gate until a
  concrete hypothesis or corrective change is recorded.
- Run focused checks after each relevant change. Run the complete exact-SHA
  release suite once the focused and adjacent checks are green.
- When independent checks are safe to parallelize, give them a shared parallel
  group and keep the critical path visible.
- At handoff, name the three longest phases, the slowest machine gates, retry
  count, repeated minutes, and specific changes proposed for the next task.

## Copyable task template

```markdown
# <task> timing log — <date>

- Status: in progress | complete | blocked
- Display timezone: <IANA timezone>
- Accepted at: <ISO-8601>
- Completed at: <ISO-8601 or pending>
- Critical-path wall time: <duration or pending>
- Active work: <duration or pending>
- Machine wait on critical path: <duration or pending>
- Machine wait overlapped by active work: <duration or pending>
- External wait: <duration or pending>

## Action log

| ID | Step/action | Start | End | Elapsed | Category | Parallel group | Outcome/evidence |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| A01 | Task intake and safety boundary | ... | ... | ... | active work | — | ... |

## Test and release gates

| Gate | Scope | Elapsed | Result | Tests | Retry | Artifact |
| --- | --- | ---: | --- | ---: | ---: | --- |
| ... | focused | ... | passed | ... | 0 | ... |

## Bottlenecks and next-task changes

| Rank | Phase/action | Time | Why it was slow | Change for next task | Expected signal |
| ---: | --- | ---: | --- | --- | --- |
| 1 | ... | ... | ... | ... | ... |

## Data quality

- Exact timestamps: ...
- Reconstructed intervals: ...
- Unknown/unlogged intervals: ...
- Overlap assumptions: ...
```

## Review metrics

Compare task-to-task trends using medians, not a single best run:

- time to first deterministic reproduction;
- time from reproduction to root-cause statement;
- time from first edit to focused green;
- focused feedback-loop p50 and p95;
- number and total duration of full-suite attempts;
- repeated machine minutes caused by the same failure class;
- exact-SHA deploy-to-live-green time;
- escaped defects found only by manual testing.

An optimization is successful only when it shortens one of these measures
without weakening the behavior asserted by the release gate.
