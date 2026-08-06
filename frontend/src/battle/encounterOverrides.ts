import type { ForgeCharacter } from '../character/types';
import type { Combatant } from './encounterTypes';

export const ENCOUNTER_GM_OVERRIDE_PROVENANCE = 'gm_override:encounter_board' as const;

function positiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) <= 0) {
    throw new Error(`${label} должен быть явно задан положительным целым числом`);
  }
  return Number(parsed);
}

/** Enrollment may use a compiled rules snapshot or an explicit persisted AC,
 * but never invents the legacy AC 10 fallback. */
export function explicitEncounterArmorClass(
  character: Pick<ForgeCharacter, 'rule_state' | 'armor_class'>,
): number {
  const compiled = character.rule_state?.armorClass;
  if (compiled !== undefined && compiled !== null) {
    return positiveInteger(compiled, 'Скомпилированный КЗ персонажа');
  }
  return positiveInteger(character.armor_class, 'КЗ персонажа');
}

export function manualGmOverrideCombatant(input: {
  actorId: string;
  name: string;
  hp: string | number;
  ac: string | number;
}): Combatant {
  if (!input.actorId.trim()) throw new Error('ID участника должен быть явно задан');
  return {
    actorId: input.actorId,
    name: input.name.trim() || 'Существо',
    isMonster: true,
    hp: positiveInteger(input.hp, 'HP существа'),
    maxHp: positiveInteger(input.hp, 'HP существа'),
    ac: positiveInteger(input.ac, 'КЗ существа'),
    provenance: ENCOUNTER_GM_OVERRIDE_PROVENANCE,
  };
}
