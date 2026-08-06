import { encountersApi, type EncounterApply } from '../battle/encountersApi';
import type { Combatant } from '../battle/encounterTypes';
import { charactersV3Api, type PatchCharacterRuntimeRequest } from './api';
import type { ForgeCharacter } from './types';

const owns = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

function encounterOwnedPatch(payload: PatchCharacterRuntimeRequest): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  if (owns(payload, 'current_hp') && payload.current_hp !== undefined) set.hp = payload.current_hp;
  if (owns(payload, 'active_effects') && payload.active_effects !== undefined) set.activeEffects = payload.active_effects;
  if (payload.turn_state && owns(payload.turn_state, 'temp_hp')) {
    const temp = Number(payload.turn_state.temp_hp);
    if (Number.isFinite(temp)) set.temp = temp;
  }
  return Object.keys(set).length ? set : null;
}
/**
 * Persists ordinary runtime fields through CharacterV3 PATCH. While linked to
 * an encounter, HP/effects/temp HP are then sent through encounter Apply with
 * an explicit version precondition; the backend PATCH deliberately preserves
 * those encounter-owned fields.
 */
export async function persistCharacterRuntime(
  character: ForgeCharacter,
  payload: PatchCharacterRuntimeRequest,
  applyEncounter?: EncounterApply,
): Promise<ForgeCharacter> {
  const updated = await charactersV3Api.patchRuntime(character.id, payload);
  const encounterID = updated.current_encounter_id ?? character.current_encounter_id;
  const encounterSet = encounterOwnedPatch(payload);
  if (!encounterID || !encounterSet) return updated;

  const encounter = await encountersApi.get(encounterID);
  const actor = encounter.state?.combatants?.find((combatant) => combatant.characterId === character.id);
  if (!actor) {
    throw new Error('Персонаж помечен участником боя, но отсутствует в состоянии боя');
  }
  const result = applyEncounter
    ? await applyEncounter({ patches: [{ actor_id: actor.actorId, set: encounterSet }] }, encounter.seq)
    : await encountersApi.apply(
      encounterID,
      encounter.seq,
      { patches: [{ actor_id: actor.actorId, set: encounterSet }] },
    );
  const committed = result.state.combatants.find((combatant) => combatant.actorId === actor.actorId) as Combatant | undefined;
  if (!committed) throw new Error('Сервер удалил персонажа из боя до применения runtime');

  return {
    ...updated,
    ...(owns(encounterSet, 'hp') ? { current_hp: committed.hp } : {}),
    ...(owns(encounterSet, 'activeEffects') ? { active_effects: committed.activeEffects ?? [] } : {}),
    ...(owns(encounterSet, 'temp')
      ? { turn_state: { ...(updated.turn_state ?? {}), temp_hp: committed.temp ?? 0 } }
      : {}),
  };
}
