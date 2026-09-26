---
name: timeweb-deploy
description: Release dnd_cards to its TimeWeb production server from a locally verified commit when the user explicitly requests a deployment.
---

# TimeWeb release

Use this only from the `dnd_cards` repository for an explicitly requested production release. It does not grant permission to deploy, change server secrets, modify Google/Yandex provider settings, or restore production data on its own. Follow any narrower user instruction and the repository's `AGENTS.md`.

## Procedure

1. Read `AGENTS.md` and the canonical runbook [`docs/standalone-deploy-after-push.md`](../../../docs/standalone-deploy-after-push.md). The runbook owns current server paths, API endpoints, release-runner behavior, and verification commands; do not duplicate or guess those values here.
2. Inspect the branch and worktree. Identify the exact application changes in scope. Preserve unrelated edits and local artifacts; never stage all files blindly. Keep credentials, database dumps, generated local output, and unrelated personal skills out of the release archive.
3. Run proportionate local checks for affected backend, frontend, workers, and migrations. Prefer the repository release gate when suitable; otherwise run focused tests plus typecheck, lint, and a production build for affected frontend code. A failed check blocks release.
4. Review the staged diff and secret/dump scans. Commit and push only the verified, in-scope changes to the expected release branch. Fetch and confirm the release is an exact commit on `origin/main`; production builds must come from that commit, never from a dirty working tree.
5. Use a short-lived SSH key for the release only. Obtain API credentials from the authorized local/TimeWeb secret source without printing or persisting values. Attach the public key to the production server, wait for propagation, and verify access. If credentials or access are unavailable, stop and report the blocker rather than changing authentication or server policy.
6. Create the archive from the exact commit with `git archive`, upload it, and compare its SHA-256 with the server copy. Run the installed release runner described in the runbook. It creates the production database backup, builds immutable images, switches the release atomically, waits for container health, checks the public release identity, and rolls back the application on failure.
7. Independently verify edge health, `/api/health`, `/build-info.json`, and that both reported source commits equal the deployed SHA. When this release adds migrations, verify their recorded versions with a read-only query. Do not restore the database as part of an application rollback.
8. Remove only the temporary public key added for this release from the server, verify that key can no longer authenticate, detach and delete it in TimeWeb, then remove its validated local temporary directory. Never remove pre-existing keys.
9. Report the deployed SHA, health/identity results, relevant migration versions, backup location, and confirmation that temporary credentials were removed. Distinguish a healthy deployment from any unrelated provider-console issue (for example, an OAuth `redirect_uri_mismatch`).

## Stop conditions

- Do not deploy if local checks fail, the pushed SHA differs from the reviewed commit, archive checksums differ, or the server runner cannot confirm health and exact release identity.
- Do not retry an uncertain server mutation until its current state has been checked.
- A production database restore, secret rotation, OAuth-console change, or other external configuration change requires explicit user direction; an application deploy does not authorize it.
- Never print, place in command output, or commit API tokens, private keys, passwords, `DATABASE_URL`, or application environment files. Avoid process listings that include command arguments when checking long-running deployment work.
