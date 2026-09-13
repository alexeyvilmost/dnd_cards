# Combat presentation acceptance, 2026-09-13

The dedicated combat screen now presents initiative, attacks and encounter
rewards using the existing sheet palette, settings and item previews. Combat
remains authoritative: the presentation consumes committed log events and
never draws another random outcome. Hover probability probes an isolated
world until the shared d20 resolver declares the full attack profile, then
enumerates its distribution without spending resources or changing the world.

## Local browser acceptance

Checked with the real local API and PostgreSQL through the in-app browser:

- Action and Ray of Frost images extend beyond the hover card without clipping.
- Initiative shows every participant, committed d20 faces, modifiers and order.
- Standard, fast and skip attack modes share the persisted sheet/site setting.
- Weapon/unarmed hit chances agree with the committed modifier and target AC;
  ranged 55%, unarmed 60%, greatsword 70%, Ray of Frost 80% in their fixtures.
- Player and monster attacks show hit/miss results; arrows, weapon impact and
  floating damage with the shared damage icons are visible on the board.
- Ray of Frost displays cold damage and its speed reduction together, including
  at the upper/left edge of the board. Dash displays its own effect cue.
- Shield changes AC against the already rolled attack. Reaction resolution
  preserves that die, and the final result precedes impact/damage presentation.
- Reload restores the existing battle without replaying historical dice.
- Two actual roguelike victories grant 25 XP/8 gold and 25 XP/9 gold respectively.
  The second reward includes Holy Water, rendered with SheetItemRow/ItemPreview.
  Only the isolated local QA run's loot seed was selected for a guaranteed loot
  fixture; combat outcomes were obtained through ordinary UI commands.

Desktop and mobile Playwright acceptance covers opening initiative, existing
Forge-to-sheet-to-combat flow, owned ally setup, hover bounds, tactical movement,
spell use and restoration. Added regressions cover exact hit distribution,
read-only attack preview, multiple damage packets/attacks, defensive reactions,
mode persistence, and a monster timer interrupted by a presentation dialog.

The ordinary combat setup consumes its encounter query after successful save;
navigation or hot reload cannot reuse that query to initialize another fight.
The monster lifecycle records a handled turn only when its timer executes, so
temporarily blocking the board for presentation cannot lose the queued turn.

Production release checks and evidence are generated against the exact pushed
commit using the standard TimeWeb immutable archive workflow. Secrets and
authenticated acceptance artifacts are stored outside the repository.
