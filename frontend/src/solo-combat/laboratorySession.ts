import type {ForgeCharacter} from '../character/types';
import {runtimeInventoryPayload} from '../character/runtime';
import {writeDedicatedCombatTurnState} from './turnState';
import {readSoloCombatState, writeSoloCombatState} from './persistence';
import {controlledCharacterIds, type SoloCombatState} from './types';

const key = (id: string) => `bagofholding:combat-lab:${id}`;
export function readLaboratorySession(id: string): {state: SoloCombatState; characters: Record<string, ForgeCharacter>} | null {
  const raw = localStorage.getItem(key(id));
  if (!raw) return null;
  const saved = JSON.parse(raw);
  if(saved.version !== 1 || !saved.characters?.[id]) throw Error('Сохранённая тестовая сцена несовместима. Создайте новую сцену.');
  const state = readSoloCombatState(saved.turnState, id, saved.characters[id].runtime_revision ?? 0);
  if(!state) throw Error('Не удалось прочитать тестовую сцену. Создайте новую сцену.');
  return {state, characters: saved.characters};
}
export function laboratoryCharacter(source: ForgeCharacter, rootId: string): ForgeCharacter {
  const session = readLaboratorySession(rootId);
  const row = structuredClone(session?.characters[source.id] ?? source);
  row.current_encounter_id = null;
  row.turn_state = writeSoloCombatState(row.turn_state, source.id === rootId ? session?.state ?? null : null);
  return row;
}
export function saveLaboratorySession(id: string, state: SoloCombatState, characters: Record<string, ForgeCharacter>) {
  const rows = {...characters};
  for (const actorId of controlledCharacterIds(state)) {
    const row = rows[actorId], actor = state.world.actors[actorId];
    if(!row || !actor) throw Error('Лист участника тестовой сцены не загружен');
    rows[actorId] = {...row, current_hp: actor.runtime.hp.current, max_hp: actor.runtime.hp.max,
      resources: actor.runtime.resources, max_resources: actor.runtime.maxResources,
      active_effects: actor.runtime.activeEffects, inventory_items: runtimeInventoryPayload(actor.runtime),
      equipment: actor.runtime.equipment,
      turn_state: writeDedicatedCombatTurnState(row.turn_state, actor.runtime, state, {actorId, includeSnapshot: false})};
  }
  localStorage.setItem(key(id), JSON.stringify({version: 1, turnState: writeSoloCombatState(null,state), characters: rows}));
  return rows;
}
export function clearLaboratorySession(id: string) { localStorage.removeItem(key(id)); }
