# Current-state audit — the design languages of Bag of Holding

> Evidence-based snapshot of the app *as it is today* (React + Vite + Tailwind 3.3.5,
> lucide-react, Inter + Pangolin). Produced by reading the codebase and inspecting the
> **live** rendered DOM on the dev server. This is the "before" that the redesign fixes.
> The proposed "after" lives in [`tokens.css`](tokens.css) and the [`preview/`](preview) gallery.

## TL;DR

The app looks like several different products stitched together. There are **eight distinct
color languages**, **four+ competing "primary action" colors**, **four disagreeing sources of
truth for card rarity**, and no shared scale for radius, spacing, elevation, or z-index. The
richest, most distinctive UI — the dark **gold-on-parchment "forge/sheet"** — is already
half-tokenized as CSS variables and is the obvious brand direction; almost everything else is
stock Tailwind that carries none of that identity.

Three findings are the crux:

1. **The chrome and the fantasy UI are two different apps.** The library/creators/nav are a
   light, cool, gray/blue SaaS shell (Inter, `#f9fafb`, `blue-600`). Open a character and you
   drop into a dark, warm, gold world (`#141210`, `#d8b978`) that even **removes the top nav**.
   They share zero tokens.
2. **Typography carries no identity.** Everything renders in **Inter** — including the
   "Bag of Holding" wordmark and the dark forge headings. The `Pangolin` fantasy font is
   loaded (`@fontsource/pangolin`) but effectively **unused**. The fantasy feel is 100% color +
   paper texture, 0% type.
3. **The good system exists but is trapped.** `CharacterForge.css` already defines
   `--forge-bg / --forge-panel / --forge-gold / --forge-line / --forge-text …` — a real token
   set — but scoped to `.forge` only, duplicated as raw hex in sibling files, and never promoted
   to `:root`. Promote and rename it and you have your design system.

---

## The eight color worlds

| # | World | Where it lives | Sample |
|---|-------|----------------|--------|
| 1 | **Stock Tailwind chrome** (gray/blue) | `index.css` `.btn-*`/`.input-field`, `Layout.tsx` header+nav, Inventory, Groups, Initiative, Shop, most DetailModals | `#f9fafb` `#ffffff` `#111827` `#2563eb` |
| 2 | **Parchment/Gold — dark** (the signature) | `CharacterForge.css`, `CharacterSheetV2.css`, sheet dialogs/toasts | `#141210` `#1c1813` `#d8b978` `#e8e0d0` |
| 3 | **Parchment/Gold — paper (light)** | `.forge.sheet-paper` overrides + hardcoded copies in `SheetJournalFab.css` | `#e9e3d5` `#ffffff` `#2a251d` |
| 4 | **BG3 tooltip cards** (dark brown/gold, Georgia serif) | `Bg3Card.tsx`, `spellCardStyle.ts`, all `*Preview.tsx` | `#2b2520` `#8a7320` `#f3ead4` `#c9a227` |
| 5 | **Item rarity gradients** | `index.css .card-border-*`, `tailwind.config`, `cardStyles.ts`, `rarityVisuals.ts`, `CardPreview.tsx` | `#22c55e` `#3b82f6` `#a855f7` `#f59e0b` |
| 6 | **Auth glassmorphism** (purple/blue/indigo) | `Login.tsx`, `Register.tsx` only | `#581c87` `#1e3a8a` `#9333ea` |
| 7 | **Ad-hoc accent sprawl** | indigo creators, purple AI, green confirm, amber "start combat" | `#4f46e5` `#9333ea` `#16a34a` `#d97706` |
| 8 | **Off-palette cool leaks** | slate hover cards, blue art-glows, undefined-var fallbacks inside the warm sheet | `#1e293b` `#94a3b8` `rgba(59,130,246,.6)` |

Live-inspected anchor values (rendered, not guessed): body `rgb(249,250,251)` Inter; header `#fff`
64px sticky; sheet root `.forge` `rgb(20,18,16)`; `.sheet-panel` `rgb(28,24,19)` text `rgb(232,224,208)`;
`h1` gold `rgb(216,185,120)`; fonts in use across the sheet: **Inter only**.

---

## Ranked inconsistencies

### Critical

1. **Two entire design systems with no bridge.** Chrome (`.btn-primary #2563eb`, `input` gray-300,
   `blue-100` active) vs forge/sheet (`--forge-gold #d8b978`, `--forge-line #6b5836`, `#141210`
   canvas). Zero shared tokens, radii, or hover language.
   → *Adopt the parchment/gold palette as the single language via `:root` variables; rebuild
   `.btn-*`/`.input-field`/`Layout` on them. The chrome becomes a dark parchment shell.*
2. **Four+ competing "primary action" colors.** `blue-600` (item/effect/action creators),
   `indigo-600` (background/class/feat/race/spell creators), `green-600` (confirm), `purple-600`
   (AI generate), `amber-600` (Initiative), plus purple→blue / purple→pink gradients.
   → *Collapse to one `--accent-gold`. Confirm = `--success`, destructive = `--danger`, AI/generate
   is primary + icon — not its own color. No page-local primary overrides.*
3. **Four disagreeing rarity sources of truth.** `RARITY_OPTIONS`/`tailwind.config` pure hex
   (`#00FF00 #0080FF #8000FF #FF8000`); `cardStyles`/`rarityVisuals` -500 hex; `CardPreview`
   -600 classes; a 4th hex set keyed on **`epic`/`legendary`** (not valid `Rarity` values).
   → *One `--rarity-*` token set (6 tiers + custom); derive border/title/glow from the single per-tier hex.*

### High

4. **Rarity rendering bug.** `getRarityColorValue` (`CardPreview.tsx:10-25`) switches on
   `epic`/`legendary`, which aren't in the `Rarity` union — so `very_rare`/`artifact`/`relic`
   detailed text silently falls back to gray `#6b7280`. `raritySymbols.ts` repeats the orphan keys.
   → *Rekey to `common|uncommon|rare|very_rare|artifact|relic|custom`; delete the epic/legendary branches.*
5. **Overlay chaos.** z-index bases `50 / 60 / 300 / 1000 / 9999` (sheet toasts render over modals);
   five backdrop scrims (`black/50`, `black/75`, `rgba(0,0,0,.45)`, `rgba(10,8,6,.6)`, …).
   → *Define a z-scale (`--z-modal 1000`, `--z-toast 1100`, `--z-popover 1200`) and one `--scrim`.*
6. **Forge palette is duplicated + un-promoted.** `--forge-*` vars are defined only under `.forge`,
   consumed as `var(--forge-*)` in some files, but hardcoded as identical hex in `DiceDialog.css` /
   `SheetToasts.css`. `SheetJournalFab.css:91` fallback `#e8e8e8` ≠ real `#e8e0d0`.
   → *Promote all `--forge-*` to `:root` with semantic names; replace every literal with the var.*
7. **Undefined variables render cold fallbacks.** `--forge-muted` (`#8a8f98` slate), `--success`,
   `--dt-cold` (`#7ec8e3`), `--forge-border` are referenced but never defined, so cold slate/green/cyan
   always win inside the warm sheet.
   → *Define `--success` / `--info-cool` / `--text-dim` at `:root`; drop `--forge-muted`; fix var() fallbacks.*
8. **Cold slate/blue leaks in the warm sheet.** `forge-effect-card` hover popover is `slate-800` /
   black border / blue `rgba(59,130,246,.6)` glow; `EffectPreview` is slate-800; the action-economy
   SVG is a green/orange/purple triad.
   → *Restyle onto `--surface/--border/--text/--accent-gold`; move the art glow to gold; keep only `--info-cool` for cool-semantic data.*

### Medium

9. **Shared `.btn-*` classes cover a minority and contradict themselves.** ~20 of 89 button-bearing
   files use them; buttons re-declare colors (`className="btn-primary bg-blue-600"`); `.btn-secondary`
   is a solid fill overridden into an outline in most usages.
   → *Ship one `<Button>` (primary/secondary/ghost/danger) on unified tokens; forbid inline color overrides.*
10. **Radius / spacing / parchment-tone zoos.** 559 `rounded-*` occurrences across 78 files
    (`rounded/md/lg/xl/full` + raw `6/7/8/10/12/14/16px`); icon tiles at 38/42/52px; four creams
    (`#f3ead4 #f5eed8 #e8e0d0 #f0e6d2`) for one role; inline magic-number spacing.
    → *`--radius 8px` (+ pill/round only), an 8px spacing scale, one `--text` parchment tone.*

---

## Bonus issues worth fixing during the redesign

- **Login/Register** ship hardcoded **test-credential buttons** in the UI and still say brand
  **"D&D Cards"** (should be "Bag of Holding"). They live on a purple glassmorphism island used nowhere else.
- **No `<Switch>` component exists** anywhere; booleans are native checkboxes (blue vs indigo accent, w-4 vs w-5).
- **`TagsInput` is a plain text field** despite the name (no chips).
- **Dead CSS**: `.forge-nav` alongside the live `.forge-rail`; `tailwind.config` `shadow-card`/`card-hover` tokens are never used.
- **Native `confirm()`** is used for delete confirmations in places instead of a dialog.

---

## What's already good (keep it)

- The `--forge-*` variable pattern in `CharacterForge.css` — the seed of the whole system.
- The gold `#d8b978` + warm-ink `#e8e0d0` pairing — the strongest, most repeated brand signal.
- The rarity concept (frame + title + glow per tier) — just needs one source of truth.
- The paper texture (`groovepaper.png` + warm overlay) — apply it at `:root` so every route shares it.
- Physical card sizing in mm (`52.5 × 74.25`) for print/export.
