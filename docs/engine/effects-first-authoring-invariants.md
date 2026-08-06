# Effects-first rules authoring invariants

**Status:** accepted architecture constraint
**Applies to:** content, character assembly, rules runtime, UI, tests, migrations

## Canonical model

The rules system must converge on effects and variables as its extensibility
boundary. A versioned ruleset release contains the exact database records and
their `mechanics`; tests and every runtime adapter execute that same immutable
release.

- An Action is an Effect with activation and a cost.
- A Spell is an Effect with activation, components, targeting and a cost.
- A Condition is an Effect.
- A Weapon Mastery property is an Effect selected through the weapon and the
  actor's mastery grant.
- A class, species, feat, item or other entity grants effects, actions,
  variables and choices; it must not require branching on its name, UUID or
  `card_number` inside the engine.

Entity-specific rules belong in versioned database `mechanics`. Repository
snapshots are immutable reviewed releases of those records, not an alternative
source of truth. A temporary content overlay is permitted only as a migration
artifact and must be removable once its output is materialized and certified.

## Engine boundary

Engine code may implement reusable, schema-validated primitives and typed
state machines. A primitive is selected by a generic mechanics discriminator
such as `mechanics.primitive.type` and receives all entity-specific parameters
from data. It must not switch on an entity ID or localized name.

`mechanics.activation.cost` is the sole price declaration. A primitive may
reference a named resource used by that cost, but must not repeat its amount,
currency/item binding or recharge policy in code or in a second mechanics
field. Persistent aliases (for example a material GP resource bound to gold)
are projections of the declared source ledger and cannot become a second
spendable balance.

Relative cost resources are explicit primitives, not permission for an
adapter to invent a charge. `self_uses` binds a declared cost to the owning
entity's `uses_<stable-ref>` pool; `self_item` binds it to the owning inventory
card. `mechanics.uses` declares capacity and recovery only. Legacy fields such
as `action.resource` and `consumes_self` have no runtime price semantics.

Common geometry and actor-targeting facts have one authority:
`mechanics.targeting`. Numeric range/area, target domain, actor-target presence,
line of sight and touch requirements must not be inferred from display text or
from a list of spell primitive types. A primitive-specific `policy` contains
only operation-specific parameters (for example push distance, light radius or
maximum active objects) and must not duplicate common targeting values. The
schema and interpreter reject missing or contradictory declarations before any
cost, RNG, ID allocation or state mutation.

Weapon Cards in the certified slice have one strict authority:
`mechanics.weapon_profile`. It declares the weapon type, Simple/Martial
category, attack ability, damage lines, versatile grip, attack modes and exact
ranges/reach, normalized properties, mastery Effect reference, explicit
ammunition reference or `null`, enchantment and attunement. A Heavy property
also declares its ability-score threshold, ability by melee/ranged mode and
Disadvantage consequence. Engine, canonical rules core, Pact Blade projection,
equipment legality and the sheet consume the same parser and fail closed on a
missing or malformed profile. Legacy `Card.range`, `weapon_type`, damage,
properties, tags, `enchant_bonus`, attunement flags and localized names are
display/import compatibility fields and never override a valid profile.

Before an equipped weapon action reaches target selection, its broad catalog
template is bound to the selected actor and weapon: the executable targeting
ceiling and ammunition price come from that profile. A template range such as
600 feet is not executable authority for a dagger.

At the highest level, an interaction between two actors can produce only:

1. an HP change (damage, healing or temporary HP where applicable);
2. applying, changing, consuming or removing an Effect;
3. movement, once spatial execution is supported.

Item transfer and item/world-object lifecycle form a separate explicit
primitive family. Rolls, checks, saving throws, targeting, costs, choices,
reactions, durations and continuations determine whether and how these outcomes
are committed; they are not additional hidden outcome channels.

Current thrown-weapon boundary: melee/ranged profile modes, range and damage
are enforced, but at a distance within reach the runtime deterministically
chooses melee because the sheet has no explicit attack-mode selector yet. It
therefore cannot express “throw at 5 feet” and its associated close-ranged
Disadvantage. Throwing also does not move or consume the weapon item; that is a
future explicit item-lifecycle/transfer primitive. Tests must preserve these
limitations, and release claims must not describe thrown weapons as complete.

## Required properties

- Mechanics are explicit JSON data and pass a versioned schema before release.
- Harmful actions and spells declare `mechanics.interaction.intent = harmful`;
  the runtime must not infer intent from a localized name or from the presence
  of a damage payload.
- Every stateful continuation is serializable, deterministic and replayable.
- Runtime commands fail closed when required facts, source effects, variables,
  targets, ownership or release hashes are absent.
- UI availability and previews are projections of the same mechanics used for
  execution; UI code does not recreate rules.
- A transport that stores a client-computed transition must label it explicitly
  as semantically unverified. Membership, ownership, hashes and CAS make the
  write safe and ordered, but do not turn that transport into rules authority.
- A compiled actor and every active effect retain source entity provenance.
- Spell class lists use explicit stable IDs in `mechanics.spell_class_list_ids`;
  localized `Spell.classes` labels are display/search metadata only.
- Prepared spells are a separate persisted `prepared_spell_choice` whose
  `source_choice_id` points at the exact spellbook choice in the same source.
  The prepared subset must contain the declared number of distinct references
  from that resolved spellbook; compilers and UI must never choose the first N
  spells implicitly.
- A feature that changes how a granted spell is cast declares a generic
  `grant_spell.casting_override` (named cost resources and, when needed, a full
  targeting replacement). Adapters match the grant by immutable reference and
  never select the override by invocation/spell identity.
- Every declared rule obligation has both focused unit evidence and a mandatory
  two-player-character scenario using the released database record.
- Tests may provide deterministic dice and explicit spatial facts, but may not
  replace a production entity's mechanics with a hand-authored happy-path rule.

## Production content changes

Before a production content migration:

1. capture and verify a restorable database dump;
2. export exact preimages and hashes of every target record;
3. run a read-only plan and reject unexpected drift;
4. apply idempotently through authenticated tooling;
5. re-export the production snapshot and run live compilation plus semantic
   certification against the resulting bytes;
6. retain an exact rollback payload and post-apply audit report.

Changing a pinned hash without reviewing the byte-level and semantic diff is
never a valid way to make a release green.

## Sheet combat certification artifact

The two-sheet combat adapter consumes
`frontend/src/character/sheetCombatCertification.generated.json`, not the
curated Rules Lab browser fixture. The artifact is generated from all 448
compiled micro-MVP roots and records every root (including roots with no combat
action), every exact combat action, source-scoped spell grants, the complete
prepared-source state and Magic Initiate provenance. Runtime loading verifies
its schema/version, source and content SHA-256 hashes, the 448-root denominator
and all exact signatures before exposing the catalog. Actor access fails closed
when ritual authority, payment resources, preparation capacity, available or
prepared spells, source identity, capability ownership or action bytes differ.

The artifact is never edited by hand. After a mechanics/compiler change:

1. run the complete compiler/readiness and semantic test gate and review the
   content/release hash diff;
2. run `npm run sheet-combat-certification:generate` from `frontend`;
3. review the generated action/access/provenance diff;
4. run `npm run sheet-combat-certification:check` (CI runs the same dry check).

Generating the file before the full compile gate, or updating it merely to
silence drift, does not certify a release.

## CharacterV3 atomic runtime-command inventory contract

`POST /api/characters-v3/runtime-commands` may carry `inventory_items` only as
a complete engine-produced quantity snapshot in a participant runtime patch.
The locked database preimage remains authoritative for item identity and
location. The server accepts unchanged or reduced quantities and a fully
consumed omitted row; it rejects new cards, quantity increases, container
moves, duplicate card/container rows, orphan/self containers, non-canonical
card references, zero/negative quantities and oversized snapshots.

This channel exists so a declared item cost such as ammunition is committed in
the same owner-checked CAS transaction as HP, resources, effects, continuation
state, events and the idempotency receipt. It does not accept equipment,
character-build fields, ownership changes, item grants or transfers. Those
remain separate mechanics and APIs. A stale participant revision or invalid
event rolls back every participant projection, including inventory; replaying
the same command bytes returns the stored response without consuming another
item or appending duplicate events.
