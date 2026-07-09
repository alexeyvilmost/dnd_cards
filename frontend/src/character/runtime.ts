import type { ForgeCharacter } from './types';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import type { Card } from '../types';
import type { CharacterClass } from '../types';
import type { CharacterRuleState } from './rules/types';

/** Синхронизирует max HP в runtime с расчётным значением правил. */
export function alignRuntimeHp(state: RuntimeState, computedMax: number): RuntimeState {
  if (computedMax <= 0) return state;
  return {
    ...state,
    hp: {
      ...state.hp,
      max: computedMax,
      current: Math.min(state.hp.current, computedMax),
    },
  };
}

export function forgeToRuntimeState(c: ForgeCharacter): RuntimeState {
  const inv = (c.inventory_items ?? []).map((row) => ({
    cardId: row.card_id,
    qty: row.qty,
  }));
  return {
    hp: {
      current: c.current_hp ?? 0,
      max: c.max_hp ?? 0,
      temp: typeof c.turn_state?.temp_hp === 'number' ? c.turn_state.temp_hp : 0,
    },
    resources: { ...(c.resources ?? {}) },
    maxResources: { ...(c.max_resources ?? {}) },
    equipment: { ...(c.equipment ?? {}) },
    inventory: inv,
    activeEffects: parseActiveEffects(c.active_effects),
  };
}

function parseActiveEffects(raw: unknown): RuntimeState['activeEffects'] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e === 'object') as RuntimeState['activeEffects'];
}

export function runtimeInventoryPayload(state: RuntimeState) {
  return state.inventory.map((row) => ({ card_id: row.cardId, qty: row.qty }));
}

export function classLevelKey(klass: CharacterClass | null): string | null {
  if (!klass) return null;
  const cn = klass.card_number || '';
  const m = cn.match(/CLASS[-_](.+)/i);
  if (m) return m[1].toLowerCase().replace(/-/g, '_');
  return klass.id;
}

export function buildCharacterContext(
  ruleState: CharacterRuleState,
  draft: { level: number; abilities: Record<string, number> },
  equippedCards: Card[],
  klass?: CharacterClass | null,
): CharacterContext {
  const classKey = classLevelKey(klass ?? null);
  return {
    abilityMods: ruleState.abilityMods,
    profBonus: ruleState.proficiencyBonus,
    level: draft.level,
    classLevels: classKey ? { [classKey]: draft.level } : undefined,
    variables: ruleState.variables,
    characterSpeed: ruleState.speed,
    baseSpeed: ruleState.baseSpeed,
    hitDie: klass?.hit_die ?? null,
    equippedCards,
    knownCards: equippedCards,
    spellcastingMod: ruleState.spellcasting
      ? ruleState.abilityMods[ruleState.spellcasting.ability]
      : undefined,
    saveProficiencies: ruleState.proficiencies.savingThrows,
    skillProficiencies: ruleState.proficiencies.skills,
    skillExpertise: ruleState.expertise.skills,
  };
}

export function buildExecuteContext(
  ruleState: CharacterRuleState,
  draft: { level: number; abilities: Record<string, number> },
  equippedCards: Card[],
  klass: CharacterClass | null | undefined,
  passives: Record<string, unknown>[],
): import('../mvp/contracts').ExecuteContext & { passives?: Record<string, unknown>[] } {
  return {
    character: buildCharacterContext(ruleState, draft, equippedCards, klass),
    passives,
    rng: () => Math.random(),
  };
}

export function carryingCapacity(strScore: number): number {
  return strScore * 15;
}

export function addToInventory(state: RuntimeState, cardId: string, qty = 1): RuntimeState {
  const inventory = state.inventory.map((row) => ({ ...row }));
  const row = inventory.find((r) => r.cardId === cardId);
  if (row) row.qty += qty;
  else inventory.push({ cardId, qty });
  return { ...state, inventory };
}

export function removeFromInventory(state: RuntimeState, cardId: string, qty = 1): RuntimeState {
  const inventory = state.inventory
    .map((row) => (row.cardId === cardId ? { ...row, qty: row.qty - qty } : { ...row }))
    .filter((row) => row.qty > 0);
  return { ...state, inventory };
}
