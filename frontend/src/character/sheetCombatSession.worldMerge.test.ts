import { describe, expect, it } from 'vitest';
import { createWorld, type ActorState, type RulesetReference } from '../rules-core/domain';
import { castFindFamiliar } from '../rules-core/findFamiliar';
import { materializeCanonicalFamiliarActor } from '../rules-core/familiarRuntime';
import { migrateWorldState } from '../rules-core/worldMigration';
import type { ForgeCharacter } from './types';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import {
  mergeSheetCombatParticipantWorlds,
  SheetCombatSessionError,
  type SheetCombatParticipantSeed,
} from './sheetCombatSession';

const RULESET: RulesetReference = {
  systemId: 'dnd5e-2024',
  releaseId: 'micro-mvp:test',
  contentHash: 'sha256:test',
  errataVersion: '2024-test',
};
const SOURCE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const SUMMON = `${TARGET}:familiar`;
const SUMMON_ACTION = 'action:find-familiar';
const SUMMON_SOURCE = '00000000-0000-4000-8000-000000000001';

function actor(id: string): ActorState {
  return {
    id,
    name: id === SOURCE ? 'Source' : 'Target',
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: { actionIds: id === TARGET ? [SUMMON_ACTION] : [] },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 1, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: id === SOURCE ? [{
        id: 'effect:source-concentration',
        name: 'Concentration effect',
        mechanics: { kind: 'modifier', op: 'add', value: 1 },
        source: 'spell:test',
        ownerId: SOURCE,
        sourceId: SOURCE,
      }] : [],
    },
  };
}

function targetFamiliar(owner: ActorState): ActorState {
  const familiar = castFindFamiliar({
    familiarActorId: SUMMON,
    ownerActorId: owner.id,
    policy: { kind: 'base', sourceEntityId: SUMMON_SOURCE },
    method: 'ritual',
    formId: 'owl',
    spiritType: 'fey',
    resources: { level1SpellSlots: 0, incenseGp: 10 },
    incenseOfferingGp: 10,
    materialCostGp: 10,
    baseCastingTimeSeconds: 3_600,
    mechanicsPolicy: {
      connectionRangeFt: 100,
      reappearRangeFt: 30,
      ritualCastingAddedSeconds: 600,
    },
    existingFamiliar: null,
  }).familiar;
  return materializeCanonicalFamiliarActor({
    familiar,
    owner,
    summoningActionId: SUMMON_ACTION,
  });
}

function character(id: string): ForgeCharacter {
  return {
    id,
    user_id: `user:${id}`,
    name: id,
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 1,
    level: 1,
    max_hp: 10,
    current_hp: 10,
    speed: 30,
    proficiency_bonus: 2,
    runtime_revision: 1,
    access_mode: 'owner',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

function seed(id: string, world: ReturnType<typeof createWorld>): SheetCombatParticipantSeed {
  const canonical = {
    actorId: id,
    world,
    actions: [],
    catalog: { getAction: () => undefined, listActions: () => [] },
    cards: [],
    resourceBindings: {},
    actionFor: () => { throw new Error('not used by world merge'); },
  } as SheetCanonicalRuntime;
  return { character: character(id), canonical };
}

function participantWorlds(): SheetCombatParticipantSeed[] {
  const sourceActor = actor(SOURCE);
  const sourceWorld = createWorld({
    id: 'source-world',
    ruleset: RULESET,
    actors: [sourceActor],
    objects: [{
      id: 'object:source-focus',
      name: 'Source focus',
      kind: 'item',
      size: 'tiny',
      carriedByActorId: SOURCE,
    }],
  });
  sourceWorld.revision = 7;
  sourceWorld.logicalClock = 11;
  sourceWorld.processedCommandIds = ['command:source'];
  sourceWorld.concentrations[SOURCE] = {
    id: 'concentration:source',
    sourceActorId: SOURCE,
    actionId: 'spell:test',
    startedAtRevision: 3,
    effectLinks: [{ actorId: SOURCE, effectId: 'effect:source-concentration' }],
  };
  sourceWorld.attackActions['attack:source'] = {
    id: 'attack:source',
    actorId: SOURCE,
    startedAtRevision: 5,
    turnKey: 'turn:source:1',
    status: 'open',
    sequence: {
      id: 'attack:source',
      actorId: SOURCE,
      totalAttacks: 1,
      attacksRemaining: 1,
      entries: [],
      usedReplacementKeys: [],
    },
  };

  const targetActor = actor(TARGET);
  const familiar = targetFamiliar(targetActor);
  const targetWorld = createWorld({
    id: 'target-world',
    ruleset: RULESET,
    actors: [targetActor, familiar],
    objects: [{
      id: 'object:target-tome',
      name: 'Target tome',
      kind: 'item',
      size: 'small',
      ownerActorId: TARGET,
    }],
  });
  targetWorld.revision = 4;
  targetWorld.logicalClock = 13;
  targetWorld.processedCommandIds = ['command:target'];
  return [seed(SOURCE, sourceWorld), seed(TARGET, targetWorld)];
}

describe('sheet combat participant-world merge', () => {
  it('preserves every participant lifecycle closure and survives JSON migration', () => {
    const merged = mergeSheetCombatParticipantWorlds({
      seeds: participantWorlds(),
      ruleset: RULESET,
      worldId: 'sheet-combat:test',
      sceneMode: 'encounter',
    });

    expect(Object.keys(merged.actors).sort()).toEqual([SOURCE, TARGET, SUMMON].sort());
    expect(merged.actors[SUMMON].familiarState?.ownerActorId).toBe(TARGET);
    expect(Object.keys(merged.objects).sort()).toEqual([
      'object:source-focus', 'object:target-tome',
    ]);
    expect(merged.concentrations[SOURCE]).toMatchObject({
      id: 'concentration:source',
      effectLinks: [{ actorId: SOURCE, effectId: 'effect:source-concentration' }],
    });
    expect(merged.attackActions['attack:source']?.sequence.attacksRemaining).toBe(1);
    expect(merged.processedCommandIds).toEqual(['command:source', 'command:target']);
    expect(merged.revision).toBe(7);
    expect(merged.logicalClock).toBe(13);
    expect(merged.scene).toEqual({
      mode: 'encounter', initiative: [SOURCE, TARGET], activeIndex: 0, round: 1,
      turnStarted: true,
    });

    const restored = migrateWorldState(JSON.parse(JSON.stringify(merged)));
    expect(restored).toEqual(merged);
  });

  it('fails closed for an object without an explicit participant reference', () => {
    const seeds = participantWorlds();
    seeds[1].canonical.world.objects['object:unowned'] = {
      id: 'object:unowned', name: 'Unowned', kind: 'environment', size: 'small',
    };
    expect(() => mergeSheetCombatParticipantWorlds({
      seeds,
      ruleset: RULESET,
      worldId: 'sheet-combat:test',
      sceneMode: 'encounter',
    })).toThrowError(SheetCombatSessionError);
  });
});
