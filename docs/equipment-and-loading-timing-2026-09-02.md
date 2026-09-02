# Character loading and base-equipment task timing — 2026-09-02

Timezone: Europe/Moscow (UTC+03:00).

| Started | Finished | Duration | Major step / action | Result |
|---|---|---:|---|---|
| 07:26:33 | 07:31:24 | 4m 51s | Task setup, required browser/spreadsheet workflow review, repository and dependency inspection | Worktree ownership preserved; measurement and implementation plan established. |
| 07:31:24 | 07:41:02 | 9m 38s | Production API baseline measurements | Found hidden `/api/characters-v3` sheet request: 3,084,083 decoded bytes, 889,203 compressed bytes, 1.13–3.26s; preview is 3,878 bytes. Forge catalogs total about 1.35 MB decoded, with spells alone 900,425 bytes. |
| 07:41:02 | 07:51:20 | 10m 18s | Sheet/Forge request-path diagnosis from production access evidence and source tracing | Sheet eagerly downloads all characters, nine card-catalog pages, all basic actions and all mastery effects; Forge eagerly downloads every spell irrespective of character level. |

## Running bottleneck ranking

1. Hidden full-character target catalog on every sheet mount.
2. Eager all-card canonical index and untrimmed runtime action/effect catalogs.
3. Forge loading all 394 spells for a level-1 character.

## Planned speedups

- Use character previews for the sheet target selector and hydrate one selected target by ID.
- Hydrate only card references required by the current inventory/container graph during sheet mount.
- Add runtime catalog projections that retain mechanics while excluding editor-only payloads and embedded images.
- Bound Forge’s spell catalog to levels the current character can use.
