# Bag of Holding — Design Foundation

The base to lean on for the **Bag of Holding** redesign, built to feed **Claude Design**
(claude.ai/design). It captures the app's current design reality, distills one unified design
language, and ships that language as a live, `@dsCard`-marked component gallery ready to sync.

> **The idea in one line:** one warm, dark *"adventurer's table"* — near-black parchment canvas,
> **gold as the single accent**, warm ink text — replacing the eight disconnected color worlds
> the app runs today.

## Open this first

**[`index.html`](index.html)** — open in any browser to see the entire language on one page
(hero + every gallery card rendered live from `tokens.css`). This is the visual reference.

## What's in here

| File | Purpose |
|------|---------|
| [`tokens.css`](tokens.css) | **The single source of truth.** All colors, type, spacing, radii, shadows, z-index as CSS variables. Dark "table" theme at `:root` + light "paper" theme (`.theme-paper`). |
| [`index.html`](index.html) | Working UI kit — the whole system on one page, embeds every gallery card. |
| [`preview/`](preview) | The `@dsCard`-marked gallery: one HTML file per card (Color, Type, Foundations, Buttons, Forms, Cards, Modals, Navigation, Sheet). |
| [`current-state-audit.md`](current-state-audit.md) | The **"before"**: the 8 color worlds, ranked inconsistencies, and the real bugs found. |
| [`claude-design-workflow.md`](claude-design-workflow.md) | How to drive Claude Design / `DesignSync` — the incremental sync workflow, dos & don'ts, gotchas. |

## The language, in rules

1. **One accent.** `--accent-gold #d8b978` is the *only* primary/action/active/link/focus color.
   No blue, indigo, purple, amber, or green "primary" anywhere. Confirm = `--success`,
   destructive = `--danger`, AI/generate = primary + icon (not a new color).
2. **Warm neutrals only.** Surfaces are the near-black parchment ramp (`--bg-canvas` → `--surface`
   → `--surface-2` → `--surface-well`); text is warm ink (`--text` / `--text-dim`). The *only*
   sanctioned cool color is `--info-cool`, reserved for cold/temp/shield **data** (temp HP, cold damage).
3. **One of everything structural.** `--radius 8px` (+ pill/round exceptions only), an 8px spacing
   scale, a 4-step shadow scale, and a single z-index + scrim scale. No magic numbers.
4. **Type = Inter for UI, Georgia for headings, Pangolin for the brand.** Put the fantasy font to
   work on the wordmark and hero card titles — today it's loaded but unused.
5. **Rarity has one source of truth.** One hex per tier in `--rarity-*`; frame, title tint, and
   glow are *derived* from it — not hand-encoded in four places.
6. **Tokens, never hex.** Components read variables. Change `tokens.css` and the whole app moves.

## How to use this with Claude Design

1. Skim [`current-state-audit.md`](current-state-audit.md) for the problem, and open
   [`index.html`](index.html) for the target look.
2. When ready, follow [`claude-design-workflow.md`](claude-design-workflow.md): create/verify a
   design-system project, then **sync one card at a time** with `/design-sync` — never wholesale.
   Suggested order: Color → Type → Foundations → Button → Forms → Cards → Modals → Navigation → Sheet.
3. Then use Claude Design's handoff back into Claude Code to migrate the real components
   (`.btn-*`, `.input-field`, `Layout`, `CardPreview`, the sheet panels) onto the tokens,
   deleting the competing palettes as you go.

## Notes & honest caveats

- **Screenshots of the running app aren't included.** The preview environment's screenshot
  subsystem times out on every page and there's no headless browser to persist PNGs. Instead the
  audit is grounded in **live computed-style inspection** of the running app (exact rendered
  hex/font/spacing — more precise than a screenshot for a token audit), and the [gallery](index.html)
  renders the *target* language live. If you want real "before" PNGs, say so and I can wire up a
  headless capture (Playwright) as a follow-up.
- This is a **foundation, not the finished system**. It intentionally ships one strong card per
  area to seed Claude Design; Claude Design + Claude Code will extend it to the full component set
  (the audit's component inventory lists the rest: icon buttons, token/multi-select, tabs, wizard
  rail, toasts, empty/error states, spinners, …).
- The proposed direction is **dark-first**. If you'd rather keep the app light and lead with the
  **paper** theme, everything still holds — flip which theme is the `:root` default in `tokens.css`.
  That's the one big open call worth making before the migration starts.
