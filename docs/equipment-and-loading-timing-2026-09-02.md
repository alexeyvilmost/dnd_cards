# Character loading and base-equipment task timing — 2026-09-02

Timezone: Europe/Moscow (UTC+03:00).

| Started | Finished | Duration | Major step / action | Result |
|---|---|---:|---|---|
| 07:26:33 | 07:31:24 | 4m 51s | Task setup, required browser/spreadsheet workflow review, repository and dependency inspection | Worktree ownership preserved; measurement and implementation plan established. |
| 07:31:24 | 07:41:02 | 9m 38s | Production API baseline measurements | Found hidden `/api/characters-v3` sheet request: 3,084,083 decoded bytes, 889,203 compressed bytes, 1.13–3.26s; preview is 3,878 bytes. Forge catalogs total about 1.35 MB decoded, with spells alone 900,425 bytes. |
| 07:41:02 | 07:44:20 | 3m 18s | Sheet/Forge request-path diagnosis from production access evidence and source tracing | Sheet eagerly downloads all characters, nine card-catalog pages, all basic actions and all mastery effects; Forge eagerly downloads every spell irrespective of character level. |
| 07:44:20 | 07:48:54 | 4m 34s | Implement, test, build, upload, and release the first loading optimization | Full backend suite, 36 focused frontend tests, TypeScript, and production build passed; release `65fd6c0b` became healthy on Timecloud with five releases retained. |
| 07:48:54 | 07:55:14 | 6m 20s | Production remeasurement and second-pass Forge diagnosis | Sheet full-character download fell from 889,203 to 991 compressed bytes; action/mastery payloads fell from about 409 KB to about 9 KB. Found a remaining 355,773-byte Forge resource catalog caused by embedded resource icons. |

## Running bottleneck ranking

1. Hidden full-character target catalog on every sheet mount.
2. Eager all-card canonical index and untrimmed runtime action/effect catalogs.
3. Forge loading all 394 spells for a level-1 character.
4. Resource catalog embedding about 504 KB of base64 image text (about 356 KB compressed).

## Planned speedups

- Use character previews for the sheet target selector and hydrate one selected target by ID.
- Hydrate only card references required by the current inventory/container graph during sheet mount.
- Add runtime catalog projections that retain mechanics while excluding editor-only payloads and embedded images.
- Bound Forge’s spell catalog to levels the current character can use.
- Project resource icons to individually cached media URLs instead of embedding them in the Forge response.
