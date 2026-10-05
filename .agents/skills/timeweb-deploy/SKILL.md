---
name: timeweb-deploy
description: Release dnd_cards to its TimeWeb production server from a locally verified commit when the user explicitly requests a deployment.
---

# TimeWeb release

Use this only from the `dnd_cards` repository for an explicitly requested production release. It does not grant permission to deploy, change server secrets, modify Google/Yandex provider settings, or restore production data on its own. Follow any narrower user instruction and the repository's `AGENTS.md`.

## Procedure

1. Read `AGENTS.md` and the current contracts [`docs/release-deployment.md`](../../../docs/release-deployment.md) and [`docs/release-ci.md`](../../../docs/release-ci.md). `docs/standalone-deploy-after-push.md` retains the old single-SHA runner as historical material; do not execute its obsolete runner or retention commands.
2. Inspect the branch and worktree. Identify the exact application changes in scope. Preserve unrelated edits and local artifacts; never stage all files blindly. Keep credentials, database dumps, generated local output, and unrelated personal skills out of the release archive.
3. Run proportionate local checks for affected backend, frontend, workers, and migrations. Prefer the repository release gate when suitable; otherwise run focused tests plus typecheck, lint, and a production build for affected frontend code. A failed check blocks release.
4. Review the staged diff and secret/dump scans. Commit and push only the verified, in-scope changes to the expected release branch. Fetch and confirm the release is an exact commit on `origin/main`; production builds must come from that commit, never from a dirty working tree.
5. Reuse the dedicated persistent deploy identity described in `docs/standalone-deploy-after-push.md`: `%USERPROFILE%\.ssh\bagofholding_timeweb_ed25519`. Its private half stays outside the repository and is restricted to the current Windows user; only its `.pub` half is registered in TimeWeb. Do not generate a replacement key or remove this key during an ordinary release. If it is not registered or SSH verification fails, stop and report the blocker; do not reset passwords or weaken server authentication. Use a one-off key only when the user explicitly requests that alternative.
6. Use the verified CI → immutable images → deployment workflow. The hosted runner transfers the exact clean control archive and candidate over the dedicated environment SSH identity; the host re-verifies provenance, captures a protected backup, rehearses the exact candidate and rollback, and applies only a validated composition. Initial adoption is an explicit manual workflow mode. Never bypass disabled gates, forge workflow metadata, use a production self-hosted Actions runner, or replace a missing historical artifact with the current one.
7. Independently verify edge health, `/api/health`, `/build-info.json`, worker identity, image digests and the saved deployment receipt. A selective release can legitimately retain different component source commits: compare each against its manifest entry and baked identity, rather than requiring all component SHAs to equal the latest commit. Verify recorded migration versions with a read-only query when they change. Do not restore the database as part of an application rollback.
8. Do not remove the persistent deploy key after a release. If an explicitly authorized one-off key was used as a fallback, remove only that exact key, verify it can no longer authenticate, detach/delete it in TimeWeb, and remove only its validated local temporary directory. Never remove the persistent key or any pre-existing key.
9. Report the deployed SHA, health/identity results, relevant migration versions, backup location, and confirmation that any one-off credentials were removed. State separately that the persistent deploy key remains installed; distinguish a healthy deployment from any unrelated provider-console issue (for example, an OAuth `redirect_uri_mismatch`).

## Stop conditions

- Do not deploy if local checks fail, the pushed SHA differs from the reviewed commit, archive checksums differ, or the server runner cannot confirm health and exact release identity.
- Do not retry an uncertain server mutation until its current state has been checked. Persistent SSH access is provisioned once through the TimeWeb server's Access settings; routine releases must not create or rotate credentials.
- A production database restore, secret rotation, OAuth-console change, or other external configuration change requires explicit user direction; an application deploy does not authorize it.
- Never print, place in command output, or commit API tokens, private keys, passwords, `DATABASE_URL`, or application environment files. Avoid process listings that include command arguments when checking long-running deployment work.
