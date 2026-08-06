import { afterEach, describe, expect, it, vi } from 'vitest';
import { encountersApi, type EncounterApply } from '../battle/encountersApi';
import { charactersV3Api } from './api';
import { persistCharacterRuntime } from './runtimePersistence';
import type { ForgeCharacter } from './types';

const character = (linked = true): ForgeCharacter => ({
  id: 'character-1',
  name: 'Hero',
  current_hp: 10,
  max_hp: 10,
  active_effects: [{ id: 'old', name: 'Old' }],
  turn_state: { temp_hp: 2, death_saves: { failures: 0 } },
  current_encounter_id: linked ? 'encounter-1' : null,
} as unknown as ForgeCharacter);

afterEach(() => vi.restoreAllMocks());

describe('persistCharacterRuntime encounter ownership', () => {
  it('uses only CharacterV3 PATCH when no encounter owns the runtime', async () => {
    const unlinked = character(false);
    const patch = vi.spyOn(charactersV3Api, 'patchRuntime').mockResolvedValue({ ...unlinked, current_hp: 7 });
    const getEncounter = vi.spyOn(encountersApi, 'get');

    await expect(persistCharacterRuntime(unlinked, { current_hp: 7 })).resolves.toMatchObject({ current_hp: 7 });
    expect(patch).toHaveBeenCalledWith('character-1', { current_hp: 7 });
    expect(getEncounter).not.toHaveBeenCalled();
  });

  it('routes protected fields through version-aware encounter Apply and keeps unrelated PATCH fields', async () => {
    const linked = character(true);
    vi.spyOn(charactersV3Api, 'patchRuntime').mockResolvedValue({
      ...linked,
      resources: { action: 0 },
      turn_state: { temp_hp: 2, death_saves: { failures: 1 } },
    });
    vi.spyOn(encountersApi, 'get').mockResolvedValue({
      id: 'encounter-1', name: 'Fight', owner_user_id: 'owner', seq: 12,
      state: {
        combatants: [{ actorId: 'hero-actor', characterId: 'character-1', name: 'Hero', hp: 10, maxHp: 10, temp: 2 }],
        round: 1, activeIndex: 0,
      },
    });
    const apply = vi.fn<EncounterApply>().mockResolvedValue({
      seq: 13,
      state: {
        combatants: [{
          actorId: 'hero-actor', characterId: 'character-1', name: 'Hero', hp: 6, maxHp: 10, temp: 4,
          activeEffects: [{ id: 'new', name: 'New' }],
        }],
        round: 1, activeIndex: 0,
      },
    });

    const result = await persistCharacterRuntime(linked, {
      current_hp: 6,
      resources: { action: 0 },
      active_effects: [{ id: 'new', name: 'New' }],
      turn_state: { temp_hp: 4, death_saves: { failures: 1 } },
    }, apply);

    expect(apply).toHaveBeenCalledWith({
      patches: [{ actor_id: 'hero-actor', set: {
        hp: 6,
        activeEffects: [{ id: 'new', name: 'New' }],
        temp: 4,
      } }],
    }, 12);
    expect(result).toMatchObject({
      current_hp: 6,
      resources: { action: 0 },
      active_effects: [{ id: 'new', name: 'New' }],
      turn_state: { temp_hp: 4, death_saves: { failures: 1 } },
    });
  });
});
