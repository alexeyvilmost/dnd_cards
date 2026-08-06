import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { createWorld, type UncommittedRuleEvent, type WorldState } from './domain';
import { foldEvents } from './reducer';
import { migrateWorldState } from './worldMigration';

type PactCard = 'EFF-pact-blade' | 'EFF-pact-chain' | 'EFF-pact-tome';
type MutableRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function worldFor(root: CompiledMicroMvpL1Root): WorldState {
  return createWorld({
    id: `pact-state:${root.selectedInvocationEffectIds[0]}`,
    ruleset: {
      systemId: 'dnd5e-2024',
      releaseId: 'pact-state-test',
      contentHash: 'pact-state-test-content',
      errataVersion: '2024-test',
    },
    actors: [clone(root.actor)],
    objects: clone([...root.initialWorldObjects]),
  });
}

function rawActor(world: MutableRecord, actorId: string): MutableRecord {
  return (world.actors as MutableRecord)[actorId] as MutableRecord;
}

function rawPacts(world: MutableRecord, actorId: string): MutableRecord {
  return rawActor(world, actorId).warlockPacts as MutableRecord;
}

function worldWithBladeBond(
  root: CompiledMicroMvpL1Root,
  conjured = true,
): {
  world: MutableRecord;
  bond: MutableRecord;
  weapon: MutableRecord;
} {
  const world = clone(worldFor(root)) as unknown as MutableRecord;
  const blade = rawPacts(world, root.actor.id).blade as MutableRecord;
  const weaponObjectId = `${root.actor.id}:active-pact-weapon`;
  const weaponCardId = 'card:test-pact-longsword';
  const weapon: MutableRecord = {
    id: weaponObjectId,
    name: 'Active Pact Longsword',
    kind: 'item',
    size: 'small',
    itemCardId: weaponCardId,
    ownerActorId: root.actor.id,
    carriedByActorId: root.actor.id,
    sourceActorId: root.actor.id,
    sourceActionId: blade.sourceEntityId,
    tags: ['melee', 'pact_weapon', 'weapon'],
  };
  (world.objects as MutableRecord)[weaponObjectId] = weapon;
  const bond: MutableRecord = {
    sourceEntityId: blade.sourceEntityId,
    warlockActorId: root.actor.id,
    weaponObjectId,
    weaponCardId,
    weaponType: 'longsword',
    normalDamageType: 'slashing',
    conjured,
    bondedAtRevision: 1,
    continuousSeparationSeconds: 0,
    lastDistanceBoardRevision: null,
  };
  blade.activeBond = bond;
  return { world, bond, weapon };
}

function worldWithChainFamiliar(
  root: CompiledMicroMvpL1Root,
  familiarKind: 'playerCharacter' | 'summonedActor' = 'summonedActor',
): {
  world: MutableRecord;
  familiarState: MutableRecord;
  familiarActorId: string;
} {
  const world = clone(worldFor(root)) as unknown as MutableRecord;
  const chain = rawPacts(world, root.actor.id).chain as MutableRecord;
  const familiarActorId = `${root.actor.id}:familiar`;
  const familiarState: MutableRecord = {
    actorId: familiarActorId,
    ownerActorId: root.actor.id,
    formId: 'imp',
    sourceEntityId: chain.sourceEntityId,
    reactionAvailable: true,
  };
  chain.activeFamiliar = familiarState;
  const familiarActor = clone(rawActor(world, root.actor.id));
  familiarActor.id = familiarActorId;
  familiarActor.name = 'Pact Familiar';
  familiarActor.kind = familiarKind;
  delete familiarActor.warlockPacts;
  (world.actors as MutableRecord)[familiarActorId] = familiarActor;
  return { world, familiarState, familiarActorId };
}

describe('compiled Warlock pact state migration and replay', () => {
  let variants: Record<PactCard, CompiledMicroMvpL1Root>;

  beforeAll(async () => {
    const provider = await compileMicroMvpL1Overlay();
    const stableKey = provider.roots.find((root) => (
      root.matrixCase.klass.card_number === 'CLASS-warlock'
    ))!.stableKey;
    const cards: PactCard[] = ['EFF-pact-blade', 'EFF-pact-chain', 'EFF-pact-tome'];
    const roots = await compileMicroMvpL1ChoiceVariants(cards.map((card) => ({
      stableKey,
      overrides: { warlock_invocation_l1: [card] },
    })));
    variants = Object.fromEntries(cards.map((card, index) => [card, roots[index]])) as Record<
      PactCard,
      CompiledMicroMvpL1Root
    >;
  }, 60_000);

  it('round-trips all three exact compiled projections and preserves them byte-identically on replay', () => {
    for (const [card, root] of Object.entries(variants) as Array<[
      PactCard,
      CompiledMicroMvpL1Root,
    ]>) {
      const migrated = migrateWorldState(clone(worldFor(root)));
      expect(migrated.actors[root.actor.id].warlockPacts, card)
        .toEqual(root.actor.warlockPacts);
      expect(migrated.objects, card).toEqual(Object.fromEntries(
        root.initialWorldObjects.map((object) => [object.id, object]),
      ));
      expect(migrateWorldState(clone(migrated)), card).toEqual(migrated);

      const events: UncommittedRuleEvent[] = [
        {
          ordinal: 0,
          sourceActorId: root.actor.id,
          obligationIds: ['system:pact-state-replay'],
          payload: {
            type: 'ActorRuntimePatched',
            actorId: root.actor.id,
            reason: 'action',
            patch: {
              hp: {
                ...migrated.actors[root.actor.id].runtime.hp,
                temp: 1,
              },
            },
          },
        },
        {
          ordinal: 1,
          sourceActorId: root.actor.id,
          obligationIds: ['system:command-commit'],
          payload: {
            type: 'CommandCommitted',
            commandId: `replay:${card}`,
            revision: 1,
            logicalClock: 1,
          },
        },
      ];
      const expected = foldEvents(migrated, events);
      const replayed = foldEvents(clone(migrated), clone(events));
      expect(JSON.stringify(replayed), card).toBe(JSON.stringify(expected));
      expect(replayed.actors[root.actor.id].warlockPacts, card)
        .toEqual(migrated.actors[root.actor.id].warlockPacts);
    }
  });

  it('never invents Pact runtime state while upgrading a legacy actor', () => {
    const root = variants['EFF-pact-blade'];
    const legacy = clone(worldFor(root)) as unknown as MutableRecord;
    legacy.schemaVersion = 1;
    delete rawActor(legacy, root.actor.id).warlockPacts;
    const migrated = migrateWorldState(legacy);
    expect(migrated.actors[root.actor.id]).not.toHaveProperty('warlockPacts');
  });

  it('normalizes source-owned actor traits and rejects every malformed persisted branch', () => {
    const root = variants['EFF-pact-blade'];
    const valid = clone(worldFor(root)) as unknown as MutableRecord;
    rawActor(valid, root.actor.id).traits = {
      conditionImmunities: [
        {
          condition: 'unconscious', requiredCauseTags: ['sleep', 'magical'],
          sourceEntityIds: ['species', 'feature'],
        },
        { condition: 'charmed', sourceEntityIds: ['species'] },
      ],
      restProfile: {
        longRestHours: 4, sleepRequired: false, sourceEntityIds: ['species', 'feature'],
      },
    };
    expect(migrateWorldState(valid).actors[root.actor.id].traits).toEqual({
      conditionImmunities: [
        { condition: 'charmed', sourceEntityIds: ['species'] },
        {
          condition: 'unconscious', requiredCauseTags: ['magical', 'sleep'],
          sourceEntityIds: ['feature', 'species'],
        },
      ],
      restProfile: {
        longRestHours: 4, sleepRequired: false, sourceEntityIds: ['feature', 'species'],
      },
    });

    const empty = clone(worldFor(root)) as unknown as MutableRecord;
    rawActor(empty, root.actor.id).traits = {};
    expect(migrateWorldState(empty).actors[root.actor.id].traits).toEqual({});

    const cases: Array<[string, (traits: MutableRecord) => void, RegExp]> = [
      ['condition array', (traits) => { traits.conditionImmunities = null; }, /conditionImmunities must be an array/],
      ['immunity object', (traits) => { traits.conditionImmunities = [null]; }, /conditionImmunities\[0\] must be an object/],
      ['immunity source', (traits) => {
        traits.conditionImmunities = [{ condition: 'charmed', sourceEntityIds: [] }];
      }, /sourceEntityIds cannot be empty/],
      ['duplicate immunity', (traits) => {
        traits.conditionImmunities = [
          { condition: 'charmed', sourceEntityIds: ['a'] },
          { condition: 'charmed', sourceEntityIds: ['b'] },
        ];
      }, /duplicate rules/],
      ['rest object', (traits) => { traits.restProfile = null; }, /restProfile must be an object/],
      ['rest finite', (traits) => {
        traits.restProfile = { longRestHours: 'four', sleepRequired: false, sourceEntityIds: ['a'] };
      }, /longRestHours must be greater/],
      ['rest positive', (traits) => {
        traits.restProfile = { longRestHours: 0, sleepRequired: false, sourceEntityIds: ['a'] };
      }, /longRestHours must be greater/],
      ['rest bounded', (traits) => {
        traits.restProfile = { longRestHours: 25, sleepRequired: false, sourceEntityIds: ['a'] };
      }, /longRestHours must be greater/],
      ['sleep boolean', (traits) => {
        traits.restProfile = { longRestHours: 8, sleepRequired: 'yes', sourceEntityIds: ['a'] };
      }, /sleepRequired must be boolean/],
      ['rest source', (traits) => {
        traits.restProfile = { longRestHours: 8, sleepRequired: true, sourceEntityIds: [] };
      }, /sourceEntityIds cannot be empty/],
    ];
    for (const [label, mutate, message] of cases) {
      const world = clone(worldFor(root)) as unknown as MutableRecord;
      const traits: MutableRecord = {};
      rawActor(world, root.actor.id).traits = traits;
      mutate(traits);
      expect(() => migrateWorldState(world), label).toThrow(message);
    }
  });

  it('binds every variant-owned ID before serialization and creates runtime entities only when justified', () => {
    const blade = variants['EFF-pact-blade'];
    expect(blade.actor.warlockPacts).toEqual({
      blade: expect.objectContaining({
        kind: 'blade', ownerActorId: blade.actor.id, activeBond: null,
      }),
    });
    expect(blade.initialWorldObjects).toEqual([]);

    const chain = variants['EFF-pact-chain'];
    expect(chain.actor.warlockPacts).toEqual({
      chain: expect.objectContaining({
        kind: 'chain', ownerActorId: chain.actor.id, activeFamiliar: null,
        template: expect.objectContaining({ normalFormSource: 'find_familiar_spell' }),
      }),
    });
    expect(chain.initialWorldObjects).toEqual([]);

    const tome = variants['EFF-pact-tome'];
    const tomeState = tome.actor.warlockPacts?.tome;
    expect(tomeState?.ownerActorId).toBe(tome.actor.id);
    expect(tomeState?.tome.ownerActorId).toBe(tome.actor.id);
    expect(tomeState?.tome.bookObjectId).toBe(`${tome.actor.id}:book-of-shadows`);
    expect(tome.initialWorldObjects).toEqual([expect.objectContaining({
      id: `${tome.actor.id}:book-of-shadows`,
      ownerActorId: tome.actor.id,
      carriedByActorId: tome.actor.id,
    })]);
    expect(clone({
      actorId: tome.actor.id,
      pacts: tome.actor.warlockPacts,
      objects: tome.initialWorldObjects,
    })).toEqual({
      actorId: tome.actor.id,
      pacts: tome.actor.warlockPacts,
      objects: tome.initialWorldObjects,
    });
  });

  it('fails closed when Blade or Chain state loses capability, action, template, or actor ownership', () => {
    const blade = variants['EFF-pact-blade'];
    const bladeCases: Array<[string, (world: MutableRecord) => void, RegExp]> = [
      ['source capability', (world) => {
        const actor = rawActor(world, blade.actor.id);
        delete ((actor.capabilities as MutableRecord).featureSources as MutableRecord)['warlock.pact.blade'];
      }, /not owned by warlock\.pact\.blade/],
      ['owned action', (world) => {
        ((rawPacts(world, blade.actor.id).blade as MutableRecord).bondActionId) = 'foreign-action';
      }, /bondActionId is not owned/],
      ['bond object', (world) => {
        const state = rawPacts(world, blade.actor.id).blade as MutableRecord;
        state.activeBond = {
          sourceEntityId: state.sourceEntityId,
          warlockActorId: blade.actor.id,
          weaponObjectId: 'missing-pact-weapon',
          weaponType: 'longsword',
          normalDamageType: 'slashing',
          conjured: true,
          bondedAtRevision: 1,
          continuousSeparationSeconds: 0,
        };
      }, /weaponObjectId must exist/],
    ];
    for (const [label, mutate, message] of bladeCases) {
      const world = clone(worldFor(blade)) as unknown as MutableRecord;
      mutate(world);
      expect(() => migrateWorldState(world), label).toThrow(message);
    }

    const chain = variants['EFF-pact-chain'];
    const chainCases: Array<[string, (world: MutableRecord) => void, RegExp]> = [
      ['special forms', (world) => {
        const state = rawPacts(world, chain.actor.id).chain as MutableRecord;
        (state.template as MutableRecord).specialFormIds = ['imp'];
      }, /must equal the PHB 2024 Pact Chain forms/],
      ['find familiar action', (world) => {
        const state = rawPacts(world, chain.actor.id).chain as MutableRecord;
        (state.template as MutableRecord).findFamiliarActionId = 'foreign-action';
      }, /findFamiliarActionId is not owned/],
      ['summoned actor', (world) => {
        const state = rawPacts(world, chain.actor.id).chain as MutableRecord;
        state.activeFamiliar = {
          actorId: 'missing-familiar',
          ownerActorId: chain.actor.id,
          formId: 'imp',
          sourceEntityId: state.sourceEntityId,
          reactionAvailable: true,
        };
      }, /must reference a summonedActor/],
    ];
    for (const [label, mutate, message] of chainCases) {
      const world = clone(worldFor(chain)) as unknown as MutableRecord;
      mutate(world);
      expect(() => migrateWorldState(world), label).toThrow(message);
    }
  });

  it('round-trips active Blade bonds and rejects every malformed persisted lifecycle branch', () => {
    const root = variants['EFF-pact-blade'];
    const conjured = worldWithBladeBond(root);
    expect(migrateWorldState(conjured.world).actors[root.actor.id].warlockPacts?.blade?.activeBond)
      .toEqual(conjured.bond);

    const existing = worldWithBladeBond(root, false);
    delete existing.weapon.ownerActorId;
    delete existing.weapon.sourceActorId;
    delete existing.weapon.sourceActionId;
    delete existing.weapon.tags;
    expect(migrateWorldState(existing.world).actors[root.actor.id].warlockPacts?.blade?.activeBond)
      .toEqual(existing.bond);

    const foreignAttuned = worldWithBladeBond(root, false);
    delete foreignAttuned.weapon.ownerActorId;
    delete foreignAttuned.weapon.sourceActorId;
    delete foreignAttuned.weapon.sourceActionId;
    delete foreignAttuned.weapon.tags;
    foreignAttuned.weapon.attunedToActorId = 'other-warlock';
    const otherActor = clone(rawActor(foreignAttuned.world, root.actor.id));
    otherActor.id = 'other-warlock';
    otherActor.name = 'Other Warlock';
    delete otherActor.warlockPacts;
    (foreignAttuned.world.actors as MutableRecord)['other-warlock'] = otherActor;
    expect(() => migrateWorldState(foreignAttuned.world))
      .toThrow(/weaponObjectId is attuned to another actor/);

    const fractionalObservation = worldWithBladeBond(root);
    fractionalObservation.bond.continuousSeparationSeconds = 0.5;
    expect(migrateWorldState(fractionalObservation.world).actors[root.actor.id]
      .warlockPacts?.blade?.activeBond?.continuousSeparationSeconds).toBe(0.5);

    const cases: Array<[string, (fixture: ReturnType<typeof worldWithBladeBond>) => void, RegExp]> = [
      ['invocation source', ({ bond }) => { bond.sourceEntityId = 'foreign-source'; }, /must match its invocation/],
      ['warlock owner', ({ bond }) => { bond.warlockActorId = 'other-warlock'; }, /must match its owner/],
      ['conjured boolean', ({ bond }) => { bond.conjured = 'yes'; }, /conjured must be boolean/],
      ['conjured weapon owner', ({ weapon }) => { weapon.ownerActorId = 'other-warlock'; }, /source-owned conjured pact weapon/],
      ['conjured weapon source actor', ({ weapon }) => { weapon.sourceActorId = 'other-warlock'; }, /source-owned conjured pact weapon/],
      ['conjured weapon source action', ({ weapon }) => { weapon.sourceActionId = 'foreign-action'; }, /source-owned conjured pact weapon/],
      ['conjured weapon tag', ({ weapon }) => { weapon.tags = ['weapon']; }, /source-owned conjured pact weapon/],
      ['non-finite distance time', ({ bond }) => { bond.continuousSeparationSeconds = Number.NaN; }, /non-negative finite/],
      ['negative distance time', ({ bond }) => { bond.continuousSeparationSeconds = -1; }, /non-negative finite/],
    ];
    for (const [label, mutate, message] of cases) {
      const fixture = worldWithBladeBond(root);
      mutate(fixture);
      expect(() => migrateWorldState(fixture.world), label).toThrow(message);
    }
  });

  it('round-trips a Chain familiar and rejects malformed identity and world cross-references', () => {
    const root = variants['EFF-pact-chain'];
    const valid = worldWithChainFamiliar(root);
    expect(migrateWorldState(valid.world).actors[root.actor.id].warlockPacts?.chain?.activeFamiliar)
      .toEqual(valid.familiarState);

    const cases: Array<[string, (fixture: ReturnType<typeof worldWithChainFamiliar>) => void, RegExp]> = [
      ['familiar owner', ({ familiarState }) => {
        familiarState.ownerActorId = 'other-warlock';
      }, /ownerActorId must match its owner/],
      ['invocation source', ({ familiarState }) => {
        familiarState.sourceEntityId = 'foreign-source';
      }, /sourceEntityId must match its invocation/],
      ['self reference', ({ familiarState }) => { familiarState.actorId = root.actor.id; }, /cannot be its owner/],
      ['reaction availability', ({ familiarState }) => {
        familiarState.reactionAvailable = 1;
      }, /reactionAvailable must be boolean/],
    ];
    for (const [label, mutate, message] of cases) {
      const fixture = worldWithChainFamiliar(root);
      mutate(fixture);
      expect(() => migrateWorldState(fixture.world), label).toThrow(message);
    }

    const wrongKind = worldWithChainFamiliar(root, 'playerCharacter');
    expect(() => migrateWorldState(wrongKind.world)).toThrow(/must reference a summonedActor/);
  });

  it('fails closed for unsupported, empty, mistyped, or foreign-owned Pact projections', () => {
    const blade = variants['EFF-pact-blade'];
    const chain = variants['EFF-pact-chain'];
    const tome = variants['EFF-pact-tome'];
    const cases: Array<[string, CompiledMicroMvpL1Root, (world: MutableRecord) => void, RegExp]> = [
      ['unsupported key', blade, (world) => {
        rawPacts(world, blade.actor.id).futurePact = {};
      }, /futurePact is not a supported Pact state/],
      ['empty state', blade, (world) => {
        rawActor(world, blade.actor.id).warlockPacts = {};
      }, /must contain at least one Pact state/],
      ['Blade kind', blade, (world) => {
        (rawPacts(world, blade.actor.id).blade as MutableRecord).kind = 'chain';
      }, /kind must be blade/],
      ['Blade owner', blade, (world) => {
        (rawPacts(world, blade.actor.id).blade as MutableRecord).ownerActorId = 'other-warlock';
      }, /ownerActorId must match its actor/],
      ['Chain kind', chain, (world) => {
        (rawPacts(world, chain.actor.id).chain as MutableRecord).kind = 'blade';
      }, /kind must be chain/],
      ['Chain owner', chain, (world) => {
        (rawPacts(world, chain.actor.id).chain as MutableRecord).ownerActorId = 'other-warlock';
      }, /ownerActorId must match its actor/],
      ['Chain normal form source', chain, (world) => {
        const state = rawPacts(world, chain.actor.id).chain as MutableRecord;
        (state.template as MutableRecord).normalFormSource = 'invocation';
      }, /normalFormSource must be find_familiar_spell/],
      ['Tome kind', tome, (world) => {
        (rawPacts(world, tome.actor.id).tome as MutableRecord).kind = 'blade';
      }, /kind must be tome/],
    ];
    for (const [label, root, mutate, message] of cases) {
      const world = clone(worldFor(root)) as unknown as MutableRecord;
      mutate(world);
      expect(() => migrateWorldState(world), label).toThrow(message);
    }
  });

  it('fails closed when Tome state, focus object, or prepared Warlock grants diverge', () => {
    const root = variants['EFF-pact-tome'];
    const cases: Array<[string, (world: MutableRecord) => void, RegExp]> = [
      ['book missing', (world) => {
        const objects = world.objects as MutableRecord;
        for (const id of Object.keys(objects)) delete objects[id];
      }, /not a carried source-owned Book of Shadows focus/],
      ['focus tag missing', (world) => {
        const objects = world.objects as MutableRecord;
        const book = Object.values(objects)[0] as MutableRecord;
        book.tags = ['book_of_shadows'];
      }, /Book of Shadows focus/],
      ['wrong owner', (world) => {
        const tome = rawPacts(world, root.actor.id).tome as MutableRecord;
        tome.ownerActorId = 'other-warlock';
      }, /ownerActorId must match/],
      ['nested invocation source', (world) => {
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        (state.tome as MutableRecord).sourceEntityId = 'foreign-source';
      }, /must match its invocation source and owner/],
      ['selection cardinality', (world) => {
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        (state.tome as MutableRecord).cantripActionIds = [];
      }, /exactly three cantrips/],
      ['foreign selected action', (world) => {
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        const tome = state.tome as MutableRecord;
        const cantrips = tome.cantripActionIds as string[];
        cantrips[0] = 'foreign-action';
      }, /spell action not owned/],
      ['cross-list duplicate', (world) => {
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        const tome = state.tome as MutableRecord;
        const cantrips = tome.cantripActionIds as string[];
        const rituals = tome.ritualActionIds as string[];
        rituals[0] = cantrips[0];
      }, /spell selections must be distinct/],
      ['invalid creation rest', (world) => {
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        (state.tome as MutableRecord).createdAfterRest = 'none';
      }, /createdAfterRest must be short or long/],
      ['missing spell access', (world) => {
        delete rawActor(world, root.actor.id).spellcastingAccess;
      }, /requires actor spellcastingAccess/],
      ['cantrip grant semantics', (world) => {
        const actor = rawActor(world, root.actor.id);
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        const tome = state.tome as MutableRecord;
        const access = actor.spellcastingAccess as MutableRecord;
        const grants = access.grants as MutableRecord[];
        const bookObjectId = tome.bookObjectId;
        const cantrips = tome.cantripActionIds as string[];
        grants.find((grant) => (
          grant.sourceId === bookObjectId && cantrips.includes(grant.actionId as string)
        ))!.spellcastingAbility = 'wis';
      }, /invalid Book of Shadows cantrip grant/],
      ['grant semantics', (world) => {
        const actor = rawActor(world, root.actor.id);
        const access = actor.spellcastingAccess as MutableRecord;
        const grants = access.grants as MutableRecord[];
        const ritual = grants.find((grant) => grant.sourceId === (
          ((rawPacts(world, root.actor.id).tome as MutableRecord).tome as MutableRecord).bookObjectId
        ) && grant.level === 1)!;
        ritual.access = 'ritual_only';
        delete ritual.slotResource;
      }, /invalid prepared Warlock ritual grant/],
      ['grant ownership', (world) => {
        const actor = rawActor(world, root.actor.id);
        const access = actor.spellcastingAccess as MutableRecord;
        const grants = access.grants as MutableRecord[];
        const bookObjectId = (
          (rawPacts(world, root.actor.id).tome as MutableRecord).tome as MutableRecord
        ).bookObjectId;
        grants.find((grant) => grant.sourceId === bookObjectId)!.sourceId = 'foreign-book';
      }, /spellGrantIds must exactly own/],
      ['grant outside selection', (world) => {
        const actor = rawActor(world, root.actor.id);
        const state = rawPacts(world, root.actor.id).tome as MutableRecord;
        const tome = state.tome as MutableRecord;
        const selected = new Set([
          ...tome.cantripActionIds as string[],
          ...tome.ritualActionIds as string[],
        ]);
        const replacement = (actor.capabilities as MutableRecord).actionIds as string[];
        const outsideActionId = replacement.find((actionId) => !selected.has(actionId));
        expect(outsideActionId).toBeTruthy();
        const access = actor.spellcastingAccess as MutableRecord;
        const grants = access.grants as MutableRecord[];
        const bookGrant = grants.find((grant) => (
          grant.sourceId === tome.bookObjectId
          && (tome.cantripActionIds as string[]).includes(grant.actionId as string)
        ))!;
        bookGrant.actionId = outsideActionId;
      }, /grant points outside its selected spells/],
    ];
    for (const [label, mutate, message] of cases) {
      const world = clone(worldFor(root)) as unknown as MutableRecord;
      mutate(world);
      expect(() => migrateWorldState(world), label).toThrow(message);
    }
  });
});
