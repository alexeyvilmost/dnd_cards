---
name: quick-timeweb-deploy
description: Use when the user explicitly requests a fast production release of dnd_cards to TimeWeb and wants unrelated full-suite tests omitted. Keeps checks focused on the changed risk while preserving exact-commit, backup, health, and migration verification.
---

# Quick TimeWeb deploy

Use only for an explicit production-deploy request in `dnd_cards`. This skill narrows the local test set; it does not authorize a deploy by itself or waive the repository's release invariants.

## Before touching production

1. Read `AGENTS.md`, `.agents/skills/timeweb-deploy/SKILL.md`, and `docs/standalone-deploy-after-push.md`. The existing TimeWeb skill and runbook remain authoritative for credentials, server paths, release runner, backup, rollback, and verification.
2. Inspect `git status`, the branch, and the full in-scope diff. Separate requested files from unrelated work. Never stage or archive the whole dirty workspace. Preserve unrelated edits; if a clean release checkout is needed, isolate only the reviewed commit and restore any temporarily set-aside work.
3. Deploy only the requested scope. For a migration-only release, include the migration registration, implementation and embedded data, plus directly relevant tests. Do not silently include other app or content changes.

## Fast, risk-focused local gate

For an additive or guarded data migration that does not alter rules execution, schema compatibility, deployment infrastructure, or certification:

- Check formatting and whitespace for the scoped diff; validate embedded JSON shape and migration registration.
- Run the migration package tests (`go test ./migrations -count=1` from `backend`) and build the production backend package if the migration changes compiled backend code.
- Run the repository's dump and changed-file credential scans against the staged release scope.
- Skip unrelated frontend suites, full coverage, browser E2E, and broad cross-checks when no changed code depends on them.

Expand the gate only for impacted components. Replay-critical rule-engine changes, schema/certification changes, release tooling, destructive or non-backward-compatible migrations, and major releases require the full gate described in the runbook. A failing relevant check blocks release; never suppress, relabel, or bypass it to save time. If a focused migration check needs a database and no safe local test database is available, stop before deploy rather than substitute production for a test environment.

## Release and verify

After the focused checks pass, review and stage only the requested files, scan the staged diff, and commit/push the reviewed scope to the expected release branch as authorized by the explicit deploy request. Fetch and require the exact release SHA to match `origin/main`; deploy the immutable archive from that SHA using the canonical runner. Do not build production from dirty files.

The production runner must create its database backup before starting the new backend. Afterward independently verify edge/backend/frontend health and exact source SHA. For migrations, perform a read-only check that each expected migration version was recorded. Remove and verify removal of temporary release credentials using the canonical procedure. Never restore production DB as part of app rollback, and do not perform unrelated certification, provider, or secret changes.

Report the deployed SHA, focused checks, migration versions, health/identity results, backup location, and credential cleanup. State clearly if any separate readiness or certification phase remains incomplete.
