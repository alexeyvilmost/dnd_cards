import { beforeEach, describe, expect, it, vi } from 'vitest';
import { charactersV3Api } from './api';
import {
  MANUAL_EFFECT_CROSS_CHARACTER_CONCENTRATION_REASON,
  MANUAL_EFFECT_RUNTIME_REVISION_REASON,
  persistDetachedManualEffects,
  projectDetachedManualEffectsTurnState,
} from './manualEffectPersistence';
import { ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON } from './manualEffectMutationPolicy';
import type { ForgeCharacter } from './types';
import { createWorld, type ActorState, type RulesetReference } from '../rules-core/domain';
import type { RuntimeState } from '../mvp/contracts';
import { SHEET_CANONICAL_WORLD_KEY, writeSheetCanonicalWorld } from './sheetCanonicalWorld';

function character(overrides: Partial<ForgeCharacter> = {}): ForgeCharacter {
  return {
    id: 'character:manual-effect',
    user_id: 'user:owner',
    name: 'Persistence probe',
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    character_type: 'free',
    character_schema_version: 1,
    level: 1,
    max_hp: 10,
    current_hp: 10,
    speed: 30,
    proficiency_bonus: 2,
    active_effects: [],
    runtime_revision: 4,
    current_encounter_id: null,
    access_mode: 'owner',
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
    ...overrides,
  };
}

const effect = {
  id: 'condition:poisoned:one',
  name: 'Отравлен',
  mechanics: { kind: 'condition', value: 'poisoned' },
  source: 'manual:test',
};

const RULESET: RulesetReference = {
  systemId: 'dnd5e-2024',
  releaseId: 'manual-effect-test',
  contentHash: `sha256:${'a'.repeat(64)}`,
  errataVersion: '2024',
};

function runtime(activeEffects: RuntimeState['activeEffects'] = []): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: { action: 1 },
    maxResources: { action: 1 },
    equipment: {},
    inventory: [],
    activeEffects,
  };
}

function actor(id: string, activeEffects: RuntimeState['activeEffects'] = []): ActorState {
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
    runtime: runtime(activeEffects),
  };
}

describe('detached manual-effect persistence', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes only active effects with runtime CAS and accepts the exact detached response', async () => {
    const source = character();
    const patch = vi.spyOn(charactersV3Api, 'patchRuntime').mockResolvedValue(character({
      runtime_revision: 5,
      active_effects: [effect],
    }));

    await expect(persistDetachedManualEffects(source, [effect])).resolves.toMatchObject({
      runtime_revision: 5,
      active_effects: [effect],
    });
    expect(patch).toHaveBeenCalledWith(source.id, {
      expected_runtime_revision: 4,
      active_effects: [effect],
    });
  });

  it('does not call persistence for a known online sheet or a snapshot without CAS authority', async () => {
    const patch = vi.spyOn(charactersV3Api, 'patchRuntime');
    await expect(persistDetachedManualEffects(
      character({ current_encounter_id: 'encounter:owned' }),
      [effect],
    )).rejects.toThrow(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
    await expect(persistDetachedManualEffects(
      character({ runtime_revision: undefined }),
      [effect],
    )).rejects.toThrow(MANUAL_EFFECT_RUNTIME_REVISION_REASON);
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects a join-race response without forwarding the mutation into encounter authority', async () => {
    const source = character();
    const patch = vi.spyOn(charactersV3Api, 'patchRuntime').mockResolvedValue(character({
      current_encounter_id: 'encounter:joined-after-render',
      runtime_revision: 4,
      active_effects: [],
    }));

    await expect(persistDetachedManualEffects(source, [effect]))
      .rejects.toThrow(ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][1]).toEqual({
      expected_runtime_revision: 4,
      active_effects: [effect],
    });
  });

  it('rejects mismatched response bytes instead of announcing uncommitted local events', async () => {
    vi.spyOn(charactersV3Api, 'patchRuntime').mockResolvedValue(character({
      runtime_revision: 5,
      active_effects: [],
    }));
    await expect(persistDetachedManualEffects(character(), [effect]))
      .rejects.toThrow(/точную CAS-запись/);
  });

  it('atomically projects a concentration-ending condition into the canonical sheet world', () => {
    const id = 'character:manual-effect';
    const concentrationEffect = {
      id: 'detect-magic:effect',
      name: 'Detect Magic',
      mechanics: { kind: 'modifier', duration: { concentration: true } },
      source: 'spell:detect-magic',
    };
    const world = createWorld({
      id: 'world:manual-effect',
      ruleset: RULESET,
      actors: [actor(id, [concentrationEffect])],
    });
    world.concentrations[id] = {
      id: 'concentration:detect-magic',
      sourceActorId: id,
      actionId: 'spell:detect-magic',
      startedAtRevision: 0,
      effectLinks: [{ actorId: id, effectId: concentrationEffect.id }],
    };
    const source = character({
      turn_state: writeSheetCanonicalWorld({}, id, world),
      active_effects: [concentrationEffect],
    });

    const turnState = projectDetachedManualEffectsTurnState(source, [effect], {
      endsConcentration: true,
    });
    const envelope = turnState?.[SHEET_CANONICAL_WORLD_KEY] as { world: typeof world };
    expect(envelope.world.concentrations[id]).toBeUndefined();
    expect(envelope.world.actors[id].runtime.activeEffects).toEqual([effect]);
    expect(envelope.world.revision).toBe(1);
  });

  it('fails closed when detached concentration cleanup would need another character write', () => {
    const id = 'character:manual-effect';
    const allyId = 'character:ally';
    const world = createWorld({
      id: 'world:cross-character',
      ruleset: RULESET,
      actors: [actor(id), actor(allyId, [{
        id: 'bless:ally', name: 'Bless', mechanics: { kind: 'modifier' }, source: 'spell:bless',
      }])],
    });
    world.concentrations[id] = {
      id: 'concentration:bless',
      sourceActorId: id,
      actionId: 'spell:bless',
      startedAtRevision: 0,
      effectLinks: [{ actorId: allyId, effectId: 'bless:ally' }],
    };
    const source = character({ turn_state: writeSheetCanonicalWorld({}, id, world) });
    expect(() => projectDetachedManualEffectsTurnState(source, [effect], {
      endsConcentration: true,
    })).toThrow(MANUAL_EFFECT_CROSS_CHARACTER_CONCENTRATION_REASON);
  });
});
