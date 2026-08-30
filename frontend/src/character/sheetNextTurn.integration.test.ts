import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import {
  createWorld,
  type ActorState,
  type RulesCatalog,
  type RulesetReference,
} from '../rules-core/domain';
import type { SheetCombatParticipantSeed } from './sheetCombatSession';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import { writeSheetCanonicalWorld } from './sheetCanonicalWorld';
import {
  persistedSourceTurnCharacterIds,
  prepareSheetNextTurnAtomicCommit,
} from './sheetNextTurn';
import type { ForgeCharacter } from './types';

const SOURCE_ID = '00000000-0000-4000-8000-000000000011';
const TARGET_ID = '00000000-0000-4000-8000-000000000012';
const RULESET = {
  systemId: 'dnd5e-2024',
  releaseId: 'sheet-next-turn-test',
  contentHash: `sha256:${'c'.repeat(64)}`,
  errataVersion: '2024',
} satisfies RulesetReference;
const EMPTY_CATALOG: RulesCatalog = { getAction: () => undefined };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtime(): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: { action: 0 },
    maxResources: { action: 1 },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: runtime(),
  };
}

function canonical(id: string, world: ReturnType<typeof createWorld>): SheetCanonicalRuntime {
  return {
    actorId: id,
    world,
    actions: [],
    catalog: EMPTY_CATALOG,
    cards: [],
    resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
}

function character(value: ActorState, world: ReturnType<typeof createWorld>): ForgeCharacter {
  return {
    id: value.id,
    user_id: 'owner',
    name: value.name,
    system_id: RULESET.systemId,
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 3,
    level: 1,
    max_hp: value.runtime.hp.max,
    current_hp: value.runtime.hp.current,
    speed: 30,
    proficiency_bonus: 2,
    resources: clone(value.runtime.resources),
    max_resources: clone(value.runtime.maxResources),
    inventory_items: [],
    active_effects: clone(value.runtime.activeEffects),
    turn_state: writeSheetCanonicalWorld({}, value.id, world),
    runtime_revision: 4,
    access_mode: 'owner',
    created_at: '',
    updated_at: '',
  };
}

function fixture(armed: boolean): {
  source: SheetCombatParticipantSeed;
  target: SheetCombatParticipantSeed;
} {
  const sourceActor = actor(SOURCE_ID);
  const targetActor = actor(TARGET_ID);
  targetActor.runtime.activeEffects = [{
    id: 'ray-of-sickness:poisoned',
    name: 'Отравленный · Луч болезни',
    source: 'Луч болезни',
    sourceId: SOURCE_ID,
    ownerId: TARGET_ID,
    mechanics: { kind: 'condition', value: 'poisoned' },
    sourceTurnExpiry: {
      sourceActorId: SOURCE_ID,
      ownerActorId: TARGET_ID,
      boundary: 'end',
      ...(armed ? { armed: true as const } : {}),
    },
  }];
  const sourceWorld = createWorld({
    id: 'source-world',
    ruleset: RULESET,
    actors: [sourceActor, targetActor],
  });
  const targetWorld = createWorld({
    id: 'target-world',
    ruleset: RULESET,
    actors: [targetActor],
  });
  return {
    source: {
      character: character(sourceActor, sourceWorld),
      canonical: canonical(SOURCE_ID, sourceWorld),
    },
    target: {
      character: character(targetActor, targetWorld),
      canonical: canonical(TARGET_ID, targetWorld),
    },
  };
}

async function prepare(armed: boolean, commandId: string) {
  const { source, target } = fixture(armed);
  return {
    source,
    target,
    prepared: await prepareSheetNextTurnAtomicCommit({
      commandId,
      source,
      externalParticipants: [target],
      endSource: async (state) => ({
        state,
        events: [{ type: 'turn_ended' }],
      }),
      startSource: async (state) => ({
        state: { ...state, resources: { ...state.resources, action: 1 } },
        events: [{ type: 'turn_started' }],
      }),
    }),
  };
}

describe('detached sheet source-turn atomic transition', () => {
  it('discovers only the external character whose effect references the source turn', () => {
    const { source } = fixture(false);
    expect(persistedSourceTurnCharacterIds(source.character.turn_state, SOURCE_ID))
      .toEqual([TARGET_ID]);
  });

  it('arms the target on the first new turn and commits caster reset plus target together', async () => {
    const { prepared } = await prepare(false, '00000000-0000-4000-8000-000000000021');
    expect(prepared.request.participants.map((row) => row.character_id))
      .toEqual([SOURCE_ID, TARGET_ID]);
    expect(prepared.request.participants.find((row) => row.character_id === SOURCE_ID)?.patch.resources)
      .toMatchObject({ action: 1 });
    const targetEffects = prepared.request.participants.find((row) => row.character_id === TARGET_ID)
      ?.patch.active_effects as RuntimeState['activeEffects'] | undefined;
    expect(targetEffects?.[0].sourceTurnExpiry?.armed).toBe(true);
    expect(prepared.request.events.map((row) => row.type))
      .toEqual(['turn_ended', 'turn_started']);
  });

  it('expires the armed target at the next source end boundary and journals it for the target', async () => {
    const { prepared } = await prepare(true, '00000000-0000-4000-8000-000000000022');
    expect(prepared.request.participants.find((row) => row.character_id === TARGET_ID)
      ?.patch.active_effects).toEqual([]);
    const targetEvents = prepared.request.events.filter((row) => row.character_id === TARGET_ID);
    expect(targetEvents).toHaveLength(1);
    expect(targetEvents[0]).toMatchObject({
      type: 'effect_expired',
      payload: { type: 'effect_expired', name: 'Отравленный · Луч болезни' },
    });
  });
});
