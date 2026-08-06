import { beforeEach, describe, expect, it, vi } from 'vitest';
import { charactersV3Api } from './api';
import {
  MANUAL_EFFECT_RUNTIME_REVISION_REASON,
  persistDetachedManualEffects,
} from './manualEffectPersistence';
import { ONLINE_ENCOUNTER_MANUAL_EFFECT_BLOCK_REASON } from './manualEffectMutationPolicy';
import type { ForgeCharacter } from './types';

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
});
