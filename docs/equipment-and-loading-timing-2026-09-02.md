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
| 09:36:24 | 09:53:25 | 17m 01s | Full verification, production build, review, commit, and main-branch publication | Backend suite and production frontend build passed; isolated only task-owned changes in the dirty worktree. |
| 09:53:25 | 10:12:29 | 19m 04s | Timecloud package transfer, release build, migration, health checks, and retention | Release `ed352593` became healthy with exactly five releases. One 81 MB upload was repeated because the first artifact used an unsupported `.tar.gz` filename rather than the runner's `.tar` contract. |
| 10:12:29 | 10:21:45 | 9m 16s | Production browser retest of untrained armor and weapon combat clarity | Spell buttons now expose the prohibition reason; Strength save requests 2d20; combat hotbar and action card expose the equipped Club, +5 attack, 1d4+3 damage, reach, and Slow mastery. Found the sheet equipment dialog uses a different preview component, and property IDs remained untranslated there. |
| 10:21:45 | 10:43:06 | 21m 21s | Close the remaining equipment-dialog and localization boundary, including focused checks | Added structured mechanics to the actual equip dialog, centralized displayed property translation, and added a dialog regression test; 26 focused checks and TypeScript passed after updating the localization expectation. |
| 10:43:06 | 11:50:29 | 1h 07m 23s | Implement executable carried-item mechanics and active effects | Connected consumables and deployable gear to sheet/combat actions, data-driven effects, charges, target checks, journal results, and visible effect cards. This was the longest implementation block because catalog data, the sheet action adapter, combat targeting, and persistence all meet at this boundary. |
| 11:50:29 | 12:32:00 | 41m 31s | First production item pass and corrective analysis | Exercised consumables and combat gear in the live UI. Acid, Antitoxin, Healing Potion, Basic Poison, Oil, Holy Water, Alchemist's Fire, Ball Bearings, Net, and the non-roll utility actions exposed several shared adapter defects rather than entity-specific failures. |
| 12:32:00 | 12:40:42 | 8m 42s | Finish shared utility behavior and local release gate | Removed fake free-action costs from next-check tools, fixed Alchemist's Fire turn-start damage and Holy Water's ineligible-target result, localized mastery text, and passed focused/backend/TypeScript checks. |
| 12:40:42 | 12:50:30 | 9m 48s | Timecloud release `2bcbd8c` | Immutable release deployed after one SSH connection interruption. Production remained healthy throughout. |
| 12:50:30 | 12:53:33 | 3m 03s | Diagnose and fix empty item-use pools | The sheet synchronized resources before the asynchronous inventory request completed, so item cards could display while their charge pools were absent. Added post-inventory initialization. |
| 12:53:33 | 12:57:20 | 3m 47s | Timecloud release `88591b6` and browser retest | Release became healthy; retest advanced to the next shared boundary. |
| 12:57:20 | 13:04:11 | 6m 51s | Diagnose and fix unbound carried-item use references | Runtime actions still contained the canonical `self_uses` placeholder instead of the inventory-card pool. Bound each carried action to `uses_<card-number>`. |
| 13:04:11 | 13:07:50 | 3m 39s | Timecloud release `247696d` and browser retest | Release became healthy; Healer's Kit then exposed incorrect automatic self-selection. |
| 13:07:50 | 13:11:37 | 3m 47s | Correct Healer's Kit data-driven targeting | Changed the action/effect contract to an adjacent ally and made the owning effect explicitly target that actor. |
| 13:11:37 | 13:15:40 | 4m 03s | Timecloud release `6926fbd` and browser retest | Release became healthy; the legacy adapter still ignored explicit actor targeting. |
| 13:15:40 | 13:21:27 | 5m 47s | Correct explicit target selection in the item action adapter | Explicit `actor` targeting now takes precedence over the old auto-target heuristic. |
| 13:21:27 | 13:24:55 | 3m 28s | Timecloud release `3f895a6` and browser retest | Release became healthy; target validation then revealed ownership remained on the enclosing self action. |
| 13:24:55 | 13:28:09 | 3m 14s | Move Healer's Kit target validation to the applied effect | Removed the false self-target validation and kept the adjacent-incapacitated-ally rule on the actual target effect. |
| 13:28:09 | 13:32:20 | 4m 11s | Timecloud release `b66e80c` and browser retest | The UI applied the effect, but a refresh showed the target's stable state had not persisted. |
| 13:32:20 | 13:43:13 | 10m 53s | Diagnose and fix solo-combat death-save persistence | A focused engine reproduction proved the generic state was correct before persistence. The solo compatibility envelope omitted `death_saves`, allowing the older dedicated runtime value to overwrite it. Added the field copy and regression coverage. |
| 13:43:13 | 13:49:30 | 6m 17s | Final Timecloud release `4c1f44f` and end-to-end Healer's Kit retest | Production health matched the exact SHA. The kit charge changed 8→7, the action was spent, and the adjacent 0-HP ally persisted `stable=true` after refresh. Automatic retention kept the latest five releases during the deployment. |
| 13:49:30 | 13:54:08 | 4m 38s | Final workbook build/render audit and focused weapon/ammunition suite | Workbook reports 107/107 matched and passed across five tabs. All remaining previews rendered cleanly; 56 focused weapon/ammunition checks passed in 6.05 seconds. |

## Running bottleneck ranking

1. Hidden full-character target catalog on every sheet mount.
2. Eager all-card canonical index and untrimmed runtime action/effect catalogs.
3. Forge loading all 394 spells for a level-1 character.
4. Resource catalog embedding about 504 KB of base64 image text (about 356 KB compressed).
5. Equipment catalog duplication and display-only rules: resolving the canonical item took longer than writing most mechanics.
6. Test-schema drift: a fixture that omitted the production varchar limit allowed a deployment-only migration failure.
7. Manual UI discovery and scene setup: the first four representative sheet/combat cases took 22 minutes because each new UI state and dialog path had to be mapped once.
8. Deployment transport: an 81 MB immutable repository archive plus duplicate upload consumed most of the 19-minute release step.
9. The Healer's Kit end-to-end boundary chase: six small correction releases were needed to cross async inventory hydration, pool binding, target selection, nested-effect ownership, and solo-combat persistence. Useful focused tests took seconds; release/retest cycles dominated roughly 59 minutes.

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
- Make the release runner accept `.tar.gz` (or publish its required extension in a checked-in deploy command) and exclude non-runtime tracked assets from the deployment context; this would remove the duplicate upload and shrink the slowest release step.
- Add one production-shaped carried-item integration fixture that mounts the real sheet route, waits for inventory hydration, executes the bound action against an explicit ally, refreshes, and asserts both charge and target persistence. This single test would have caught all six Healer's Kit boundary failures before the first release.
- Keep focused tests as the edit loop and deploy a batch only after the production-shaped fixture passes; the last equipment suite ran 56 checks in 6.05 seconds, compared with roughly two to four minutes per release/retest cycle.
- Promote the already verified frontend artifact, and skip rebuilding the unchanged frontend for backend-only fixes. The current runner repeatedly recompiles and transfers the same large context.
- Close old PWA tabs before a live acceptance pass so an already-running service worker cannot retain the previous bundle and mimic a failed deployment.
