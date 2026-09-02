import { afterEach, describe, expect, it, vi } from 'vitest';
import { encountersApi, type EncounterApply } from '../battle/encountersApi';
import { charactersV3Api } from './api';
import { persistCharacterRuntime } from './runtimePersistence';
import type { ForgeCharacter } from './types';
import { createWorld, type ActorState, type RulesetReference } from '../rules-core/domain';
import type { RuntimeState } from '../mvp/contracts';
import { readSoloCombatState, writeSoloCombatState } from '../solo-combat/persistence';
import { SOLO_COMBAT_SCHEMA_VERSION, type SoloCombatState } from '../solo-combat/types';

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

  it('keeps HP and temporary HP aligned with an active dedicated combat envelope', async () => {
    const runtime: RuntimeState = {
      hp: { current: 9, max: 12, temp: 0 },
      resources: { action: 0 },
      maxResources: { action: 1 },
      equipment: {}, inventory: [], activeEffects: [],
      deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    };
    const actor: ActorState = {
      id: 'character-1', name: 'Hero', kind: 'playerCharacter', controllerId: 'owner',
      capabilities: { actionIds: [] },
      character: {
        abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        profBonus: 2, level: 1,
      },
      runtime,
    };
    const ruleset: RulesetReference = {
      systemId: 'dnd5e-2024', releaseId: 'runtime-sync-test',
      contentHash: `sha256:${'a'.repeat(64)}`, errataVersion: '2024',
    };
    const world = createWorld({ id: 'solo:runtime-sync', ruleset, actors: [actor] });
    const combat: SoloCombatState = {
      schemaVersion: SOLO_COMBAT_SCHEMA_VERSION,
      characterId: actor.id,
      runtimeRevision: 4,
      world,
      catalogActions: [], sideByActorId: { [actor.id]: 'side:party' },
      actorPresentation: {}, playerActionIds: [], certifiedPlayerActionIds: [],
      monsterActionIds: {}, opportunityActionIds: {}, resourceBindings: {},
      tokens: { [actor.id]: { actorId: actor.id, position: { x: 1, y: 1 }, color: '#ffffff' } },
      boardRevision: 1, movementRemainingFt: { [actor.id]: 30 },
      initiativeBonuses: { [actor.id]: 0 }, initiative: [], log: [], outcome: 'active',
    };
    const source = {
      ...character(false), runtime_revision: 4,
      turn_state: writeSoloCombatState({ temp_hp: 0 }, combat),
    };
    const patch = vi.spyOn(charactersV3Api, 'patchRuntime').mockImplementation(async (_id, payload) => ({
      ...source,
      runtime_revision: 5,
      current_hp: payload.current_hp ?? source.current_hp,
      turn_state: payload.turn_state ?? source.turn_state,
    }));

    await persistCharacterRuntime(source, {
      current_hp: 9,
      turn_state: {
        ...(source.turn_state ?? {}),
        temp_hp: 5,
        death_saves: { successes: 0, failures: 0, stable: true, dead: false },
      },
    });

    const payload = patch.mock.calls[0][1];
    expect(payload.expected_runtime_revision).toBe(4);
    const restored = readSoloCombatState(payload.turn_state, actor.id, 5);
    expect(restored?.world.actors[actor.id].runtime.hp).toEqual({ current: 9, max: 12, temp: 5 });
    expect(restored?.world.actors[actor.id].runtime.deathSaves).toEqual({
      successes: 0, failures: 0, stable: true, dead: false,
    });
    expect(restored?.participantRuntimeRevisions?.[actor.id]).toBe(5);
  });
});
