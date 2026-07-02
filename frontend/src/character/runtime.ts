import type { ForgeCharacter } from './types';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import type { Card } from '../types';
import type { CharacterRuleState } from './rules/types';

export function forgeToRuntimeState(c: ForgeCharacter): RuntimeState {
  const inv = (c.inventory_items ?? []).map((row) => ({
    cardId: row.card_id,
    qty: row.qty,
  }));
  return {
    hp: { current: c.current_hp ?? 0, max: c.max_hp ?? 0, temp: 0 },
    resources: { ...(c.resources ?? {}) },
    maxResources: { ...(c.max_resources ?? {}) },
    equipment: { ...(c.equipment ?? {}) },
    inventory: inv,
    activeEffects: [],
  };
}

export function runtimeInventoryPayload(state: RuntimeState) {
  return state.inventory.map((row) => ({ card_id: row.cardId, qty: row.qty }));
}

export function buildCharacterContext(
  ruleState: CharacterRuleState,
  draft: { level: number; abilities: Record<string, number> },
  equippedCards: Card[],
): CharacterContext {
  return {
    abilityMods: ruleState.abilityMods,
    profBonus: ruleState.proficiencyBonus,
    level: draft.level,
    classLevels: ruleState.classLevels,
    characterSpeed: ruleState.speed,
    equippedCards,
    knownCards: equippedCards,
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
