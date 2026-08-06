import { describe, expect, it } from 'vitest';
import { createWorld } from './domain';
import type { ActorState, UncommittedRuleEvent, WorldState } from './domain';
import { foldEvents } from './reducer';
import type { SpellcastingAccessState } from './spellcastingAccess';
import { migrateWorldState } from './worldMigration';
import {
  DWARF_SPECIES_CARD,
  STONECUNNING_CARD,
} from './dwarfTraits';

const actor = {
  id: 'a', name: 'A', kind: 'playerCharacter' as const, controllerId: 'owner',
  capabilities: { actionIds: ['z', 'a', 'a'] },
  character: {
    abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 1,
  },
  runtime: {
    hp: { current: 1, max: 1, temp: 0 }, resources: {}, maxResources: {},
    equipment: {}, inventory: [], activeEffects: [],
  },
};

const SPELL_ACTION_IDS = [
  'light', 'hex', 'detect-magic', 'shield', 'cure-wounds', 'mage-armor', 'find-familiar',
] as const;

function spellcastingActor(): ActorState {
  const spellcastingAccess: SpellcastingAccessState = {
    // Deliberately non-canonical ordering exercises migration normalization.
    grants: [
      {
        grantId: 'grant:tome:find-familiar', actionId: 'find-familiar', sourceId: 'EFF-pact-tome',
        access: 'ritual_only', level: 1, spellcastingAbility: 'cha', ritual: true,
      },
      {
        grantId: 'grant:invocation:mage-armor', actionId: 'mage-armor',
        sourceId: 'EFF-armor-of-shadows', access: 'innate', level: 1, spellcastingAbility: 'cha',
      },
      {
        grantId: 'grant:feat:cure-wounds', actionId: 'cure-wounds', sourceId: 'FEAT-magic-initiate',
        access: 'always_prepared', level: 1, spellcastingAbility: 'wis', ritual: false,
        freeUseResource: 'freeuse:cure-wounds', slotResource: 'future_spell_slot_1',
      },
      {
        grantId: 'grant:wizard:detect-magic', actionId: 'detect-magic', sourceId: 'CLASS-wizard',
        access: 'spellbook', level: 1, spellcastingAbility: 'int', ritual: true,
        slotResource: 'spell_slot_1',
      },
      {
        grantId: 'grant:warlock:hex', actionId: 'hex', sourceId: 'CLASS-warlock',
        access: 'known', level: 1, spellcastingAbility: 'cha', slotResource: 'spell_slot_1',
      },
      {
        grantId: 'grant:cleric:light', actionId: 'light', sourceId: 'CLASS-cleric',
        access: 'cantrip', level: 0, spellcastingAbility: 'wis',
      },
      {
        grantId: 'grant:wizard:shield', actionId: 'shield', sourceId: 'CLASS-wizard',
        access: 'spellbook', level: 1, spellcastingAbility: 'int', slotResource: 'spell_slot_1',
      },
    ],
    preparedSources: {
      unused: undefined,
      'CLASS-wizard': {
        sourceId: 'CLASS-wizard', capacity: 1,
        availableActionIds: ['shield', 'detect-magic'], preparedActionIds: ['detect-magic'],
      },
    },
  };
  return {
    ...actor,
    capabilities: { actionIds: [...SPELL_ACTION_IDS].reverse() },
    runtime: {
      ...actor.runtime,
      resources: { spell_slot_1: 1, 'freeuse:cure-wounds': 1 },
      maxResources: { spell_slot_1: 2, 'freeuse:cure-wounds': 1 },
    },
    spellcastingAccess,
  };
}

function spellWorld(): WorldState {
  return createWorld({
    id: 'spell-access-world',
    ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
    actors: [spellcastingActor()],
  });
}

type MutableRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rawActor(world: unknown): MutableRecord {
  return ((world as MutableRecord).actors as MutableRecord).a as MutableRecord;
}

function rawAccess(world: unknown): MutableRecord {
  return rawActor(world).spellcastingAccess as MutableRecord;
}

function rawGrants(world: unknown): MutableRecord[] {
  return rawAccess(world).grants as MutableRecord[];
}

function rawPrepared(world: unknown): MutableRecord {
  return rawAccess(world).preparedSources as MutableRecord;
}

describe('persisted WorldState migration', () => {
  it('creates schema v5 worlds and normalizes lifecycle, capabilities, Attack facts, and world objects', () => {
    const world = createWorld({
      id: 'new',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
      objects: [{ id: 'torch', name: 'Torch', kind: 'item', size: 'tiny', flammable: true }],
    });
    expect(world.schemaVersion).toBe(5);
    const migrated = migrateWorldState(world);
    expect(migrated.actors.a.capabilities.actionIds).toEqual(['a', 'z']);
    expect(migrated.objects.torch).toEqual({
      id: 'torch', name: 'Torch', kind: 'item', size: 'tiny', flammable: true,
    });
    expect(migrated.actors.a.attackProfile).toMatchObject({
      attacksPerAction: 1, size: 2, reachFt: 5,
    });
    expect(migrated.attackActions).toEqual({});
    expect(migrated.grapples).toEqual({});
  });

  it('round-trips optional resource recovery declarations and rejects malformed persisted policies', () => {
    const resource = 'uses_arbitrary-action';
    const withRecovery: ActorState = {
      ...actor,
      character: {
        ...actor.character,
        resourceRecharge: { [resource]: 'short_rest' },
        resourceRecovery: {
          [resource]: {
            short_rest: { mode: 'fixed', amount: 1 },
            long_rest: { mode: 'full' },
          },
        },
      },
      runtime: {
        ...actor.runtime,
        resources: { [resource]: 0 },
        maxResources: { [resource]: 2 },
      },
    };
    const serialized = JSON.parse(JSON.stringify(createWorld({
      id: 'resource-recovery-world',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [withRecovery],
    })));
    const migrated = migrateWorldState(serialized);
    expect(migrated.actors.a.character.resourceRecovery).toEqual({
      [resource]: {
        short_rest: { mode: 'fixed', amount: 1 },
        long_rest: { mode: 'full' },
      },
    });
    expect(migrateWorldState(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);

    const unsorted = clone(serialized) as unknown as MutableRecord;
    const unsortedActor = rawActor(unsorted);
    const unsortedCharacter = unsortedActor.character as MutableRecord;
    const unsortedRuntime = unsortedActor.runtime as MutableRecord;
    const secondResource = 'uses_z-action';
    unsortedCharacter.resourceRecovery = {
      [secondResource]: null,
      [resource]: withRecovery.character.resourceRecovery![resource],
    };
    unsortedRuntime.resources = { [secondResource]: 0, [resource]: 0 };
    unsortedRuntime.maxResources = { [secondResource]: 2, [resource]: 2 };
    expect(Object.keys(
      migrateWorldState(unsorted).actors.a.character.resourceRecovery!,
    )).toEqual([resource, secondResource]);
    expect(migrateWorldState(unsorted).actors.a.character.resourceRecovery?.[secondResource])
      .toBeNull();

    const malformed = clone(serialized) as unknown as MutableRecord;
    const malformedCharacter = rawActor(malformed).character as MutableRecord;
    malformedCharacter.resourceRecovery = {
      [resource]: {
        short_rest: { mode: 'fixed', amount: 0 },
        long_rest: { mode: 'full' },
      },
    };
    expect(() => migrateWorldState(malformed))
      .toThrow(/short_rest must declare a positive fixed amount/);

    const orphaned = clone(serialized) as unknown as MutableRecord;
    const orphanedCharacter = rawActor(orphaned).character as MutableRecord;
    orphanedCharacter.resourceRecovery = {
      missing: {
        short_rest: { mode: 'fixed', amount: 1 },
        long_rest: { mode: 'full' },
      },
    };
    expect(() => migrateWorldState(orphaned))
      .toThrow(/must map to an actor resource and maximum/);

    const unexpectedKey = clone(serialized) as unknown as MutableRecord;
    const unexpectedCharacter = rawActor(unexpectedKey).character as MutableRecord;
    unexpectedCharacter.resourceRecovery = {
      [resource]: {
        short_rest: { mode: 'fixed', amount: 1 },
        long_rest: { mode: 'full' },
        clientOnlyHint: true,
      },
    };
    expect(() => migrateWorldState(unexpectedKey))
      .toThrow(/must contain exactly long_rest, short_rest/);

    const malformedLongRest = clone(serialized) as unknown as MutableRecord;
    const malformedLongRestCharacter = rawActor(malformedLongRest).character as MutableRecord;
    malformedLongRestCharacter.resourceRecovery = {
      [resource]: {
        short_rest: { mode: 'fixed', amount: 1 },
        long_rest: { mode: 'fixed' },
      },
    };
    expect(() => migrateWorldState(malformedLongRest))
      .toThrow(/long_rest must declare full recovery/);
  });

  it('upgrades missing v4 lifecycle to alive but fails closed for missing or uncommitted v5 death facts', () => {
    const current = createWorld({
      id: 'lifecycle-v5',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
    });
    const legacy = clone(current) as unknown as MutableRecord;
    legacy.schemaVersion = 4;
    delete rawActor(legacy).lifecycle;
    expect(migrateWorldState(legacy).actors.a.lifecycle).toEqual({ status: 'alive' });

    const missing = clone(current) as unknown as MutableRecord;
    delete rawActor(missing).lifecycle;
    expect(() => migrateWorldState(missing)).toThrow(/lifecycle is required in world schema 5/);

    const uncommitted = clone(current) as unknown as MutableRecord;
    uncommitted.revision = 2;
    rawActor(uncommitted).lifecycle = {
      status: 'dead',
      adjudication: {
        type: 'ActorDeathAdjudicated',
        provenance: 'canonical_actor_lifecycle',
        factId: 'death:a',
        actorId: 'a',
        adjudicatedBy: 'gm',
        observedAtWorldRevision: 2,
        rulesetContentHash: 'h',
      },
    };
    expect(() => migrateWorldState(uncommitted))
      .toThrow(/must precede the persisted committed world revision/);
  });

  it('requires complete schema-v5 ledgers and validates canonical item actor/hand references', () => {
    const current = createWorld({
      id: 'item-ledger-v5',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
    });

    const missingObjects = clone(current) as unknown as MutableRecord;
    delete missingObjects.objects;
    expect(() => migrateWorldState(missingObjects))
      .toThrow(/world\.objects is required in world schema 5/);

    const missingConcentrations = clone(current) as unknown as MutableRecord;
    delete missingConcentrations.concentrations;
    expect(() => migrateWorldState(missingConcentrations))
      .toThrow(/world\.concentrations must be an object/);

    const unknownHolder = clone(current) as unknown as MutableRecord;
    unknownHolder.objects = {
      weapon: {
        id: 'weapon', name: 'Weapon', kind: 'item', size: 'small',
        itemCardId: 'card:weapon', carriedByActorId: 'missing',
        heldByActorId: 'missing', heldInHand: 'main_hand',
      },
    };
    expect(() => migrateWorldState(unknownHolder))
      .toThrow(/heldByActorId must reference a world actor/);

    const unknownAttunement = clone(current) as unknown as MutableRecord;
    unknownAttunement.objects = {
      weapon: {
        id: 'weapon', name: 'Weapon', kind: 'item', size: 'small',
        itemCardId: 'card:weapon', attunedToActorId: 'missing',
      },
    };
    expect(() => migrateWorldState(unknownAttunement))
      .toThrow(/attunedToActorId must reference a world actor/);

    const duplicateHand = clone(current) as unknown as MutableRecord;
    duplicateHand.objects = Object.fromEntries(['one', 'two'].map((id) => [id, {
      id, name: id, kind: 'item', size: 'small', itemCardId: `card:${id}`,
      carriedByActorId: 'a', heldByActorId: 'a', heldInHand: 'main_hand',
    }]));
    expect(() => migrateWorldState(duplicateHand))
      .toThrow(/duplicates a canonical held-item slot/);
  });

  it('upgrades v1 without inventing action ownership or concentration', () => {
    const current = createWorld({
      id: 'old',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
    });
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.concentrations;
    const legacyActors = legacy.actors as Record<string, Record<string, unknown>>;
    delete legacyActors.a.capabilities;
    const migrated = migrateWorldState(legacy);
    expect(migrated).toMatchObject({
      schemaVersion: 5, concentrations: {}, objects: {}, attackActions: {}, grapples: {},
    });
    expect(migrated.actors.a.capabilities.actionIds).toEqual([]);
  });

  it('upgrades schema v2 by adding an empty object ledger', () => {
    const legacy = JSON.parse(JSON.stringify(createWorld({
      id: 'v2',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
    }))) as Record<string, unknown>;
    legacy.schemaVersion = 2;
    delete legacy.objects;
    expect(migrateWorldState(legacy)).toMatchObject({
      schemaVersion: 5, objects: {}, attackActions: {}, grapples: {},
    });
  });

  it('rejects duplicate world-object IDs at creation', () => {
    expect(() => createWorld({
      id: 'duplicates',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
      objects: [
        { id: 'same', name: 'A', kind: 'item', size: 'tiny' },
        { id: 'same', name: 'B', kind: 'item', size: 'small' },
      ],
    })).toThrow(/World object IDs must be unique/);
  });

  it('replays JSON-persisted world-object events byte-identically from a v3 checkpoint', () => {
    const initial = createWorld({
      id: 'object-replay',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
    });
    const payloads = [
      {
        type: 'WorldObjectMutationRecorded' as const,
        event: {
          type: 'WorldObjectCreated' as const,
          object: {
            id: 'torch', name: 'Torch', kind: 'item' as const, size: 'tiny' as const,
            illumination: {
              id: 'light-1', sourceActorId: 'a', sourceActionId: 'light',
              brightRadiusFt: 20, dimAdditionalRadiusFt: 20, roundsLeft: 600,
            },
          },
        },
      },
      {
        type: 'WorldObjectMutationRecorded' as const,
        event: {
          type: 'WorldObjectPatched' as const,
          objectId: 'torch', patch: { ignited: true }, unset: ['illumination' as const],
          reason: 'fixture_patch',
        },
      },
      {
        type: 'WorldObjectMutationRecorded' as const,
        event: {
          type: 'WorldObjectObserved' as const,
          objectId: 'torch', actorId: 'a', observation: 'fixture_observation',
        },
      },
      { type: 'CommandCommitted' as const, commandId: 'object-command', revision: 1, logicalClock: 1 },
    ];
    const events: UncommittedRuleEvent[] = payloads.map((payload, ordinal) => ({
      ordinal, sourceActorId: 'a', obligationIds: ['system:world-object'], payload,
    }));
    const expected = foldEvents(initial, events);
    const checkpoint = JSON.parse(JSON.stringify(initial)) as WorldState;
    const persistedEvents = JSON.parse(JSON.stringify(events)) as UncommittedRuleEvent[];
    const replayed = foldEvents(checkpoint, persistedEvents);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(expected));
    expect(replayed.objects.torch).toMatchObject({ ignited: true });
    expect(replayed.objects.torch.illumination).toBeUndefined();
  });

  it('normalizes every spell access kind and preserves source-scoped access through JSON migration and replay', () => {
    const source = spellWorld();
    const originalGrantOrder = source.actors.a.spellcastingAccess?.grants.map((grant) => grant.grantId);
    const migrated = migrateWorldState(source);
    const access = migrated.actors.a.spellcastingAccess;
    expect(access).toBeDefined();
    expect(access?.grants.map((grant) => grant.access).sort()).toEqual([
      'always_prepared', 'cantrip', 'innate', 'known', 'ritual_only', 'spellbook', 'spellbook',
    ]);
    expect(access?.grants.map((grant) => grant.sourceId)).toEqual([
      'CLASS-cleric', 'CLASS-warlock', 'CLASS-wizard',
      'CLASS-wizard', 'EFF-armor-of-shadows', 'EFF-pact-tome', 'FEAT-magic-initiate',
    ]);
    expect(access?.grants.find((grant) => grant.actionId === 'cure-wounds')).toEqual({
      grantId: 'grant:feat:cure-wounds',
      actionId: 'cure-wounds',
      sourceId: 'FEAT-magic-initiate',
      access: 'always_prepared',
      level: 1,
      spellcastingAbility: 'wis',
      freeUseResource: 'freeuse:cure-wounds',
      slotResource: 'future_spell_slot_1',
    });
    expect(access?.grants.find((grant) => grant.access === 'ritual_only')).toMatchObject({
      actionId: 'find-familiar', ritual: true, spellcastingAbility: 'cha',
    });
    expect(access?.preparedSources).toEqual({
      'CLASS-wizard': {
        sourceId: 'CLASS-wizard', capacity: 1,
        availableActionIds: ['detect-magic', 'shield'], preparedActionIds: ['detect-magic'],
      },
    });
    expect(source.actors.a.spellcastingAccess?.grants.map((grant) => grant.grantId))
      .toEqual(originalGrantOrder);

    const persistedCheckpoint = JSON.parse(JSON.stringify(migrated)) as WorldState;
    expect(migrateWorldState(persistedCheckpoint)).toEqual(migrated);
    const events: UncommittedRuleEvent[] = [
      {
        ordinal: 0, sourceActorId: 'a', obligationIds: ['system:test'],
        payload: {
          type: 'ActorRuntimePatched', actorId: 'a', reason: 'action',
          patch: { hp: { current: 1, max: 1, temp: 1 } },
        },
      },
      {
        ordinal: 1, sourceActorId: 'a', obligationIds: ['system:command-commit'],
        payload: { type: 'CommandCommitted', commandId: 'spell-access-replay', revision: 1, logicalClock: 1 },
      },
    ];
    const replayed = foldEvents(
      persistedCheckpoint,
      JSON.parse(JSON.stringify(events)) as UncommittedRuleEvent[],
    );
    expect(replayed.actors.a.spellcastingAccess).toEqual(access);
    expect(JSON.parse(JSON.stringify(replayed)).actors.a.spellcastingAccess).toEqual(access);
  });

  it('does not invent optional spellcasting access for legacy actors', () => {
    for (const schemaVersion of [1, 2, 3]) {
      const raw = clone(createWorld({
        id: `no-spell-access-v${schemaVersion}`,
        ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
        actors: [actor],
      })) as unknown as MutableRecord;
      raw.schemaVersion = schemaVersion;
      rawActor(raw).spellcastingAccess = undefined;
      expect(migrateWorldState(raw).actors.a).not.toHaveProperty('spellcastingAccess');
    }
  });

  it('rejects malformed spell grants, resource mappings, provenance, abilities, and prepared sources', () => {
    type InvalidCase = {
      label: string;
      mutate: (world: MutableRecord) => void;
      message: RegExp;
    };
    const cases: InvalidCase[] = [
      {
        label: 'access is null',
        mutate: (world) => { rawActor(world).spellcastingAccess = null; },
        message: /spellcastingAccess must be an object/,
      },
      {
        label: 'grants missing',
        mutate: (world) => { delete rawAccess(world).grants; },
        message: /grants must be an array/,
      },
      {
        label: 'prepared sources missing',
        mutate: (world) => { delete rawAccess(world).preparedSources; },
        message: /preparedSources must be an object/,
      },
      {
        label: 'runtime missing',
        mutate: (world) => { rawActor(world).runtime = null; },
        message: /runtime must be an object/,
      },
      {
        label: 'runtime resources missing',
        mutate: (world) => { delete (rawActor(world).runtime as MutableRecord).resources; },
        message: /runtime.resources must be an object/,
      },
      {
        label: 'runtime max resources missing',
        mutate: (world) => { delete (rawActor(world).runtime as MutableRecord).maxResources; },
        message: /runtime.maxResources must be an object/,
      },
      {
        label: 'grant is not an object',
        mutate: (world) => { (rawAccess(world).grants as unknown[])[0] = null; },
        message: /grants\[0\] must be an object/,
      },
      {
        label: 'grant id wrong type',
        mutate: (world) => { rawGrants(world)[0].grantId = 7; },
        message: /grantId must be a non-empty string/,
      },
      {
        label: 'action id blank',
        mutate: (world) => { rawGrants(world)[0].actionId = ' '; },
        message: /actionId must be a non-empty string/,
      },
      {
        label: 'source id blank',
        mutate: (world) => { rawGrants(world)[0].sourceId = ''; },
        message: /sourceId must be a non-empty string/,
      },
      {
        label: 'action is not actor owned',
        mutate: (world) => { rawGrants(world)[0].actionId = 'foreign-spell'; },
        message: /actionId is not owned/,
      },
      {
        label: 'access kind invalid',
        mutate: (world) => { rawGrants(world)[0].access = 'prepared'; },
        message: /access is invalid/,
      },
      {
        label: 'level fractional',
        mutate: (world) => { rawGrants(world)[0].level = 1.5; },
        message: /level must be an integer/,
      },
      {
        label: 'level negative',
        mutate: (world) => { rawGrants(world)[0].level = -1; },
        message: /level must be an integer/,
      },
      {
        label: 'level too high',
        mutate: (world) => { rawGrants(world)[0].level = 10; },
        message: /level must be an integer/,
      },
      {
        label: 'ability invalid',
        mutate: (world) => { rawGrants(world)[0].spellcastingAbility = 'luck'; },
        message: /spellcastingAbility is invalid/,
      },
      {
        label: 'ritual invalid',
        mutate: (world) => { rawGrants(world)[0].ritual = 'yes'; },
        message: /ritual must be boolean/,
      },
      {
        label: 'free resource blank',
        mutate: (world) => { rawGrants(world)[5].freeUseResource = ''; },
        message: /freeUseResource must be a non-empty string/,
      },
      {
        label: 'slot resource wrong type',
        mutate: (world) => { rawGrants(world)[3].slotResource = 1; },
        message: /slotResource must be a non-empty string/,
      },
      {
        label: 'cantrip has level',
        mutate: (world) => { rawGrants(world)[5].level = 1; },
        message: /cantrip access requires spell level 0/,
      },
      {
        label: 'level zero non-cantrip',
        mutate: (world) => { rawGrants(world)[4].level = 0; },
        message: /level 0 spells require cantrip access/,
      },
      {
        label: 'cantrip has payment',
        mutate: (world) => { rawGrants(world)[5].slotResource = 'spell_slot_1'; },
        message: /cantrips cannot declare payment resources/,
      },
      {
        label: 'ritual only lacks ritual provenance',
        mutate: (world) => { delete rawGrants(world)[0].ritual; },
        message: /ritual_only access requires ritual=true/,
      },
      {
        label: 'normal levelled grant lacks resource',
        mutate: (world) => { delete rawGrants(world)[4].slotResource; },
        message: /levelled normal casting requires a resource mapping/,
      },
      {
        label: 'free resource missing',
        mutate: (world) => {
          delete ((rawActor(world).runtime as MutableRecord).resources as MutableRecord)['freeuse:cure-wounds'];
        },
        message: /freeUseResource must map to a valid actor resource/,
      },
      {
        label: 'free resource exceeds max',
        mutate: (world) => {
          ((rawActor(world).runtime as MutableRecord).resources as MutableRecord)['freeuse:cure-wounds'] = 2;
        },
        message: /freeUseResource must map to a valid actor resource/,
      },
      {
        label: 'free resource corrupt',
        mutate: (world) => {
          ((rawActor(world).runtime as MutableRecord).resources as MutableRecord)['freeuse:cure-wounds'] = -1;
        },
        message: /must be a non-negative integer/,
      },
      {
        label: 'slot mapping lacks max',
        mutate: (world) => {
          delete ((rawActor(world).runtime as MutableRecord).maxResources as MutableRecord).spell_slot_1;
        },
        message: /slotResource has an inconsistent actor resource mapping/,
      },
      {
        label: 'slot mapping lacks current',
        mutate: (world) => {
          delete ((rawActor(world).runtime as MutableRecord).resources as MutableRecord).spell_slot_1;
        },
        message: /slotResource has an inconsistent actor resource mapping/,
      },
      {
        label: 'slot current exceeds max',
        mutate: (world) => {
          ((rawActor(world).runtime as MutableRecord).resources as MutableRecord).spell_slot_1 = 3;
        },
        message: /slotResource has an inconsistent actor resource mapping/,
      },
      {
        label: 'duplicate grant id',
        mutate: (world) => { rawGrants(world)[1].grantId = rawGrants(world)[0].grantId; },
        message: /unique grantId/,
      },
      {
        label: 'duplicate provenance',
        mutate: (world) => {
          rawGrants(world)[1].sourceId = rawGrants(world)[0].sourceId;
          rawGrants(world)[1].actionId = rawGrants(world)[0].actionId;
        },
        message: /unique sourceId\/actionId provenance/,
      },
      {
        label: 'prepared source invalid key',
        mutate: (world) => {
          rawPrepared(world)[''] = {
            sourceId: '', capacity: 0, availableActionIds: [], preparedActionIds: [],
          };
        },
        message: /preparedSources key must be a non-empty string/,
      },
      {
        label: 'prepared source not object',
        mutate: (world) => { rawPrepared(world)['CLASS-wizard'] = null; },
        message: /CLASS-wizard must be an object/,
      },
      {
        label: 'prepared source mismatched id',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).sourceId = 'other';
        },
        message: /sourceId must match its key/,
      },
      {
        label: 'prepared source fractional capacity',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).capacity = 0.5;
        },
        message: /capacity must be a non-negative integer/,
      },
      {
        label: 'prepared source negative capacity',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).capacity = -1;
        },
        message: /capacity must be a non-negative integer/,
      },
      {
        label: 'available ids not array',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).availableActionIds = null;
        },
        message: /availableActionIds must be an array/,
      },
      {
        label: 'available id invalid',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).availableActionIds = [7];
        },
        message: /availableActionIds\[0\] must be a non-empty string/,
      },
      {
        label: 'available ids duplicate',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).availableActionIds = [
            'detect-magic', 'detect-magic',
          ];
        },
        message: /availableActionIds must contain unique IDs/,
      },
      {
        label: 'prepared ids not array',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).preparedActionIds = null;
        },
        message: /preparedActionIds must be an array/,
      },
      {
        label: 'prepared ids duplicate',
        mutate: (world) => {
          const source = rawPrepared(world)['CLASS-wizard'] as MutableRecord;
          source.capacity = 2;
          source.preparedActionIds = ['detect-magic', 'detect-magic'];
        },
        message: /preparedActionIds must contain unique IDs/,
      },
      {
        label: 'capacity exceeds available',
        mutate: (world) => {
          const source = rawPrepared(world)['CLASS-wizard'] as MutableRecord;
          source.capacity = 3;
          source.preparedActionIds = ['detect-magic'];
        },
        message: /capacity exceeds available spells/,
      },
      {
        label: 'prepared subset does not fill capacity',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).preparedActionIds = [];
        },
        message: /preparedActionIds must exactly fill capacity/,
      },
      {
        label: 'prepared spell outside collection',
        mutate: (world) => {
          (rawPrepared(world)['CLASS-wizard'] as MutableRecord).preparedActionIds = ['hex'];
        },
        message: /prepares a spell outside/,
      },
      {
        label: 'available collection differs from spellbook grants',
        mutate: (world) => {
          const source = rawPrepared(world)['CLASS-wizard'] as MutableRecord;
          source.capacity = 0;
          source.availableActionIds = [];
          source.preparedActionIds = [];
        },
        message: /availableActionIds must equal its spellbook grants/,
      },
      {
        label: 'prepared source without spellbook grants',
        mutate: (world) => {
          rawPrepared(world).phantom = {
            sourceId: 'phantom', capacity: 0, availableActionIds: [], preparedActionIds: [],
          };
        },
        message: /has no spellbook grants/,
      },
      {
        label: 'spellbook grant without prepared source',
        mutate: (world) => { delete rawPrepared(world)['CLASS-wizard']; },
        message: /has no prepared source/,
      },
    ];

    const baseline = clone(spellWorld()) as unknown as MutableRecord;
    for (const invalid of cases) {
      const world = clone(baseline);
      invalid.mutate(world);
      expect(() => migrateWorldState(world), invalid.label).toThrow(invalid.message);
    }
  });

  it('rejects unknown schemas', () => {
    expect(() => migrateWorldState({ schemaVersion: 99, id: 'x', actors: {} })).toThrow(/Unsupported/);
  });

  it('upgrades a genuine schema-v3 checkpoint with authoritative Attack defaults', () => {
    const legacy = clone(createWorld({
      id: 'v3-attack-upgrade',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [{ ...actor, character: { ...actor.character, baseSize: 1 } }],
    })) as unknown as MutableRecord;
    legacy.schemaVersion = 3;
    delete legacy.attackActions;
    delete legacy.grapples;
    delete (rawActor(legacy)).attackProfile;
    const migrated = migrateWorldState(legacy);
    expect(migrated.actors.a.attackProfile).toEqual({
      attacksPerAction: 1,
      size: 1,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['system:dnd5e-2024:attack-action'],
    });
    expect(migrated).toMatchObject({ schemaVersion: 5, attackActions: {}, grapples: {} });
  });

  it('rejects forged schema-v4 Attack ledgers, grapple projections, and missing profile facts', () => {
    const base = clone(createWorld({
      id: 'v4-integrity',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor, { ...actor, id: 'b', name: 'B' }],
    })) as unknown as MutableRecord;

    const missingProfile = clone(base);
    delete (((missingProfile.actors as MutableRecord).a as MutableRecord).attackProfile);
    expect(() => migrateWorldState(missingProfile)).toThrow(/attackProfile is required/);

    const forgedSequence = clone(base);
    forgedSequence.attackActions = {
      attack: {
        id: 'attack', actorId: 'a', startedAtRevision: 0, turnKey: 'turn', status: 'open',
        sequence: {
          id: 'attack', actorId: 'a', totalAttacks: 1, attacksRemaining: 0,
          entries: [{
            ordinal: 1, kind: 'replacement', actionId: 'breath', replacementKey: 'breath',
            sourceEntityIds: ['feature:breath'],
          }],
          usedReplacementKeys: [],
        },
      },
    };
    expect(() => migrateWorldState(forgedSequence)).toThrow(/sequence is not a canonical/);

    const forgedGrapple = clone(base);
    forgedGrapple.grapples = {
      g: {
        id: 'g', grapplerActorId: 'a', targetActorId: 'b', sourcePart: 'main_hand',
        escapeDc: 12, reachFt: 5,
        sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'],
        startedAtRevision: 0,
      },
    };
    expect(() => migrateWorldState(forgedGrapple)).toThrow(/missing its exact target grapple projection/);
  });

  it('rejects forged Stonecunning provenance and scope while loading a schema-v4 checkpoint', () => {
    const value = clone(createWorld({
      id: 'stonecunning-integrity',
      ruleset: { systemId: 'dnd5e-2024', releaseId: 'r', contentHash: 'h', errataVersion: 'e' },
      actors: [actor],
    }));
    const mechanics = {
      kind: 'grant_sense',
      sense: 'tremorsense',
      range: 60,
      duration: { type: 'rounds', amount: 100 },
      senseScope: { kind: 'stonework' },
      sourceEntityIds: [DWARF_SPECIES_CARD, STONECUNNING_CARD],
    };
    value.actors.a.runtime.activeEffects.push({
      id: 'forged-stonecunning',
      name: 'Stonecunning',
      mechanics,
      roundsLeft: 100,
      source: STONECUNNING_CARD,
      ownerId: 'forged-owner',
      sourceId: 'a',
    });
    expect(() => migrateWorldState(value)).toThrow(
      /runtime\.activeEffects\[0\].*owner and source actor provenance/,
    );
  });
});
