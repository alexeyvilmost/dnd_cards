import { addToInventory, forgeToRuntimeState, removeFromInventory } from './runtime';
import type { ForgeCharacter } from './types';
import { equipItem, unequipSlot } from '../engine/equipment';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';

export function inventoryQty(state: RuntimeState, cardId: string): number {
  return state.inventory.find((r) => r.cardId === cardId)?.qty ?? 0;
}

function displacedItemIds(before: RuntimeState['equipment'], after: RuntimeState['equipment']): string[] {
  const prev = new Set(Object.values(before).filter((id): id is string => !!id));
  const next = new Set(Object.values(after).filter((id): id is string => !!id));
  const out: string[] = [];
  for (const id of prev) {
    if (!next.has(id)) out.push(id);
  }
  return out;
}

/** Надеть предмет из инвентаря (qty −1; снятые предметы возвращаются в сумку). */
export function equipFromInventory(state: RuntimeState, card: Card): { state: RuntimeState; error?: string } {
  if (inventoryQty(state, card.id) < 1) {
    return { state, error: 'Предмета нет в инвентаре' };
  }
  const res = equipItem(state, card);
  if (res.error) return res;

  let next = res.state;
  for (const id of displacedItemIds(state.equipment, next.equipment)) {
    next = addToInventory(next, id, 1);
  }
  next = removeFromInventory(next, card.id, 1);
  return { state: next };
}

/** Снять предмет в инвентарь (+1 qty). */
export function unequipToInventory(state: RuntimeState, slot: string): RuntimeState {
  const id = state.equipment[slot as keyof RuntimeState['equipment']];
  if (!id) return state;
  let next = unequipSlot(state, slot);
  return addToInventory(next, id, 1);
}

export function collectEquippedCards(
  equipment: Record<string, string | null | undefined>,
  cardMap: Map<string, Card>,
): Card[] {
  const weaponOrder = ['main_hand', 'off_hand'] as const;
  const otherOrder = ['head', 'body'] as const;
  const seen = new Set<string>();
  const out: Card[] = [];

  for (const slot of [...otherOrder, ...weaponOrder]) {
    const id = equipment[slot];
    if (id && !seen.has(id) && cardMap.has(id)) {
      seen.add(id);
      out.push(cardMap.get(id)!);
    }
  }
  return out;
}

export function characterCurrency(c: ForgeCharacter): Record<string, number> {
  return { gold: 0, silver: 0, copper: 0, ...(c.currency ?? {}) };
}

/** Покупка карты: списание валюты + предмет в инвентарь. */
export function purchaseItem(
  character: ForgeCharacter,
  card: Card,
): { runtime: RuntimeState; currency: Record<string, number>; error?: string } {
  const runtime = forgeToRuntimeState(character);
  const currency = characterCurrency(character);
  const price = card.price ?? 0;
  const curKey = card.price_currency || 'gold';
  if (price > 0 && (currency[curKey] ?? 0) < price) {
    return { runtime, currency, error: 'Недостаточно средств' };
  }
  if (price > 0) currency[curKey] = (currency[curKey] ?? 0) - price;
  return { runtime: addToInventory(runtime, card.id, 1), currency };
}
