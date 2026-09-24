# Shared library shell — local handoff, 2026-09-24

## Dark control follow-up

Desktop filter panels and mobile drawers now explicitly use dark panel/input tokens, including the drawer header/footer, close/reset/apply buttons, native select menus, rarity checkboxes and filter-count badge. Bulk-tag controls use `library-chrome-panel` / `library-chrome-button`, with readable disabled/error/status states and dark selection-checkbox chrome.

`LibraryTagControl` wraps the existing canonical stable-ID picker for CardLibrary, MonsterLibrary and bulk tags. Its CSS targets only the direct in-page label/select/button children; it does not theme entity dialogs or preview descendants. White entity-card surfaces remain unchanged. Added desktop/mobile DOM regressions require two real list wrappers to remain outside the dark control surfaces, plus CSS-scoping assertions.

Latest run of the command below: **10 files / 60 tests passed**; scoped `git diff --check` passed. Browser/sidebar geometry QA remains with main; no browser automation, image generation or asset changes were performed for this follow-up.

## Completed scope

- `CardLibrary` and `/monsters` share `LibrarySidebar`, `LibrarySearch` and `LibrarySectionHero`. App, Layout, global theme, CharacterForge/sheets, PaperSheet and backend/migration 265 were not edited for this follow-up.
- `libraryCatalog.tsx` extracts the existing NavRail data; the underlying NavRail component is unchanged. Exactly 13 IDs, in order: `cards`, `monsters`, `effects`, `passives`, `actions`, `spells`, `feats`, `backgrounds`, `races`, `classes`, `resources`, `variables`, `concepts`.
- Sidebar width animates between 208 and 68 px on desktop. Mobile retains a bounded, horizontally scrollable top rail without a visible bottom scrollbar. The toggle is above the rail, visibly says **Свернуть**, and has an accessible expand/collapse name, `aria-expanded` and `aria-controls`. Every icon retains NavRail's accessible label and current-page marker.
- Collapse state uses `localStorage['library.sidebar.collapsed']`, survives route changes/reloads, responds to storage events, and degrades safely if storage is unavailable. Reduced-motion rules disable transitions.
- Browser-reported collapsed-height regression fixed: `.navrail-txt` is **display:none**, not merely zero-width/transparent. Collapsed items have height/min-height 50 px and cannot shrink. Narrower horizontal padding leaves space for icons even with the desktop vertical scrollbar. A CSS regression assertion guards these declarations; actual browser geometry remains main's CUA check.
- Shared search debounces for 250 ms, supports Enter and immediate clear, handles IME composition, cancels pending drafts on Back/Forward/unmount, and preserves drafts when a tag/filter changes during the debounce. Committed searches create URL-history entries (`q`); existing CardLibrary filter replace behavior and all specialized filters remain. Monster search hydrates `q` and preserves canonical `tag` and unrelated parameters. Stale monster responses are ignored and recovered requests clear old errors.
- `LibrarySectionHero` props: `type` (section ID), optional `heading`, `subtitle`, `action`. Stable wrapper `.library-section-hero[data-library-section]`; minimum height 165 px desktop / 120 px mobile. `libraryHeroArt.ts` maps every section to `/images/library/<type>.jpg`. All 13 files supplied by main are present. Background is centered; the mild left overlay becomes transparent before the right-hand art. Missing images retain a panel background and semantic title/action.
- Hero headings explicitly use Georgia with sufficient specificity to override global heading font rules. All 11 CardLibrary “Показано…” counters use `library-chrome-status` and `--site-muted`; entity text is not selected by those rules.
- MonsterPreview and card/entity markup/styles remain canonical. The only monster entity CSS addition explicitly pins its pre-existing text color to `#2d241a` under the dark page wrapper. Monster grid can shrink below 320 px without forcing document overflow. Chrome consumes the supplied `--site-*` tokens; no global recoloring selectors were added.

## Verification

From `C:/Projects/dnd_cards/frontend`:

```powershell
node node_modules/vitest/vitest.mjs run src/components/library src/utils/libraryUrlParams.test.ts src/api/authPolicy.test.ts src/utils/cardsIndex.test.ts src/api/ownedItemCache.test.ts
```

Result: **9 files / 56 tests passed**. Coverage includes route persistence, accessible collapsed buttons, unavailable storage, all 13 banner mappings, reduced motion/CSS scoping, the collapsed-label height regression, query/history/tag behavior, in-flight response races, unchanged real MonsterPreview markup, and existing rarity/selection/admin/cache tests.

```powershell
node node_modules/typescript/bin/tsc -b --pretty false
git diff --check -- src/pages/CardLibrary.tsx src/pages/CardLibrary.css src/pages/MonsterLibrary.tsx src/pages/MonsterLibrary.css src/components/library
```

Scoped diff check passed. Full typecheck exits 1 with **56 diagnostics, all under `src/rules-core`** (existing Vitest metadata typing); none reference this follow-up's library/monster files. Repository-wide diff check also reported unrelated trailing whitespace in another agent's `WeaponTemplates.tsx`; that file was not changed here.

No browser automation or external API calls were made for this follow-up. DOM/API tests use mocks. Main owns live CUA QA, including final desktop/mobile collapse geometry, tab-to-tab persistence and banner crops. No commit, deployment, production access, server restart or application migration occurred in this follow-up.
