import { migrateWorldState } from '../rules-core/worldMigration';
import { SOLO_COMBAT_KEY, SOLO_COMBAT_SCHEMA_VERSION, type SoloCombatState } from './types';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function readSoloCombatState(
  turnState: Record<string, unknown> | null | undefined,
  characterId: string,
  runtimeRevision: number,
): SoloCombatState | null {
  const raw = turnState?.[SOLO_COMBAT_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = clone(raw as SoloCombatState);
  if (value.schemaVersion !== SOLO_COMBAT_SCHEMA_VERSION
    || value.characterId !== characterId
    || !value.world || !Array.isArray(value.catalogActions)
    || !value.tokens || !Array.isArray(value.initiative)) return null;
  return { ...value, runtimeRevision, world: migrateWorldState(value.world) };
}
export function writeSoloCombatState(
  turnState: Record<string, unknown> | null | undefined,
  state: SoloCombatState | null,
): Record<string, unknown> {
  const next = { ...(turnState ?? {}) };
  if (state) next[SOLO_COMBAT_KEY] = clone(state);
  else delete next[SOLO_COMBAT_KEY];
  return next;
}
