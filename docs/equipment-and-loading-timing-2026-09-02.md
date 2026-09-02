# Character loading and base-equipment task timing — 2026-09-02

Timezone: Europe/Moscow (UTC+03:00).

| Started | Finished | Duration | Major step / action | Result |
|---|---|---:|---|---|
| 07:26:33 | 07:31:24 | 4m 51s | Task setup, required browser/spreadsheet workflow review, repository and dependency inspection | Worktree ownership preserved; measurement and implementation plan established. |
| 07:31:24 | 07:41:02 | 9m 38s | Production API baseline measurements | Found hidden `/api/characters-v3` sheet request: 3,084,083 decoded bytes, 889,203 compressed bytes, 1.13–3.26s; preview is 3,878 bytes. Forge catalogs total about 1.35 MB decoded, with spells alone 900,425 bytes. |
| 07:41:02 | 07:44:20 | 3m 18s | Sheet/Forge request-path diagnosis from production access evidence and source tracing | Sheet eagerly downloads all characters, nine card-catalog pages, all basic actions and all mastery effects; Forge eagerly downloads every spell irrespective of character level. |
| 07:44:20 | 07:48:54 | 4m 34s | Implement, test, build, upload, and release the first loading optimization | Full backend suite, 36 focused frontend tests, TypeScript, and production build passed; release `65fd6c0b` became healthy on Timecloud with five releases retained. |
| 07:48:54 | 07:55:14 | 6m 20s | Production remeasurement and second-pass Forge diagnosis | Sheet full-character download fell from 889,203 to 991 compressed bytes; action/mastery payloads fell from about 409 KB to about 9 KB. Found a remaining 355,773-byte Forge resource catalog caused by embedded resource icons. |
| 07:55:14 | 08:06:59 | 11m 45s | Resource projection implementation, tests, build, upload retry, Timecloud release, and production measurement | Forge resource response fell from 355,773 to 2,847 compressed bytes (99.2%). The first upload connection dropped; compression plus SSH keepalive completed the retry. |
| 08:06:59 | 08:23:59 | 17m 00s | Official 2024 equipment scope definition and initial workbook authoring/render review | Defined 107 mechanical rows across five QA tabs; generated and visually checked every tab. Exact-name comparison initially matched 93/107 production records. |
| 08:23:59 | 08:30:58 | 6m 59s | Production catalog reconciliation | Resolved 12 of 14 apparent gaps as naming aliases or wrong duplicate selection. Confirmed two real gaps: Morningstar and Bullseye Lantern; identified 22 canonical weapons without executable profiles. |
| 08:30:58 | 08:43:31 | 12m 33s | Canonical weapon/armor/utility implementation plus automated verification | Added 38 weapon profiles, 13 armor profiles, and mechanics for 55 utility rows; existing Healing Potion remains the 56th. Backend suite, 47 focused frontend tests, TypeScript, and production build passed. |
| 08:43:31 | 08:55:56 | 12m 25s | First equipment deployment, automatic rollback, and production-schema diagnosis | Timecloud restored the prior healthy release. The failure was two new card numbers exceeding production's 20-character limit; local test fixtures used unconstrained text. Shortened both identifiers and added a real-limit regression check. |
| 08:55:56 | 09:00:15 | 4m 19s | Corrected equipment release and checklist reconciliation against production | Release `bcef7032` became healthy on Timecloud; the rebuilt workbook matched all 107 scoped entities with zero missing catalog records. |
| 09:00:15 | 09:05:27 | 5m 12s | Reusable manual-QA character setup | Created and retained six purpose-specific characters covering weapons, trained armor, untrained armor, consumables, combat gear, and sheet gear. |
| 09:05:27 | 09:27:46 | 22m 19s | First manual browser pass: weapon, combat, trained armor, and untrained armor | Verified weapon equip/attack calculations, combat construction, trained armor AC, heavy-armor Strength speed penalty, and the untrained warning. Found two clarity gaps and one real rule gap: generic combat weapon action, missing item mechanic details, and spellcasting not blocked by untrained armor. |
| 09:27:46 | 09:36:24 | 8m 38s | Weapon/item clarity and untrained-armor rule implementation | Added structured mechanic details to item cards and weapon action previews, weapon-specific combat labels, spell prohibition, Strength/Dexterity d20 disadvantage, corrected armor descriptions, and 47 focused regression checks. |

## Running bottleneck ranking

1. Hidden full-character target catalog on every sheet mount.
2. Eager all-card canonical index and untrimmed runtime action/effect catalogs.
3. Forge loading all 394 spells for a level-1 character.
4. Resource catalog embedding about 504 KB of base64 image text (about 356 KB compressed).
5. Equipment catalog duplication and display-only rules: resolving the canonical item took longer than writing most mechanics.
6. Test-schema drift: a fixture that omitted the production varchar limit allowed a deployment-only migration failure.
7. Manual UI discovery and scene setup: the first four representative sheet/combat cases took 22 minutes because each new UI state and dialog path had to be mapped once.

## Planned speedups

- Use character previews for the sheet target selector and hydrate one selected target by ID.
- Hydrate only card references required by the current inventory/container graph during sheet mount.
- Add runtime catalog projections that retain mechanics while excluding editor-only payloads and embedded images.
- Bound Forge’s spell catalog to levels the current character can use.
- Project resource icons to individually cached media URLs instead of embedding them in the Forge response.
- Keep a committed stable equipment manifest (card number, aliases, expected mechanic) so later audits do not repeat duplicate/name reconciliation.
- Run the focused equipment contract suite before the full build; this pass found logic failures in about 3 seconds, while the production bundle took about 90 seconds end-to-end.
- Use compressed uploads with SSH keepalive by default to avoid repeating the 3–5 minute failed-transfer path seen in the second loading release.
- Generate migration test schemas from the production schema (or at minimum assert production field limits) so release-only constraint failures are caught before image builds.
- Keep the six retained equipment QA characters and a small browser smoke script so later equipment passes start at the exact sheet/combat state instead of rebuilding inventory and scenes.
