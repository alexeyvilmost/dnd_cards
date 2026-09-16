import { addToInventory, forgeToRuntimeState, removeFromInventory } from './runtime';
import type { ForgeCharacter } from './types';
import { equipItem, planEquip, unequipSlot } from '../engine/equipment';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { priceInCopper, spendCopper } from '../utils/money';

type MechanicsRecord = Record<string, unknown>;

function mechanicsResults(mechanics: MechanicsRecord): MechanicsRecord[] {
  const effects = Array.isArray(mechanics.effects) ? mechanics.effects as MechanicsRecord[] : [];
  return effects.flatMap((effect) => {
    const results = effect.result ?? effect.results;
    return Array.isArray(results) ? results as MechanicsRecord[] : [];
  });
}

export function nonmagicalPurchasePriceMultiplier(
  passives: readonly MechanicsRecord[] = [],
): number {
  return passives.flatMap(mechanicsResults).reduce((multiplier, payload) => {
    const appliesTo = payload.applies_to as MechanicsRecord | undefined;
    if (payload.kind !== 'modifier'
      || appliesTo?.value !== 'nonmagical_purchase_price'
      || payload.op !== 'multiply') return multiplier;
    const factor = Number(payload.value);
    return Number.isFinite(factor) && factor > 0 ? multiplier * factor : multiplier;
  }, 1);
}

export function isExplicitlyMagicalItem(card: Card): boolean {
  const mechanics = card.mechanics as MechanicsRecord | null | undefined;
  if (mechanics?.magical === true) return true;
  const labels = [...(card.properties ?? [])]
    .map((value) => String(value).trim().toLocaleLowerCase('ru'));
  return labels.some((value) => ['magic', 'magical', 'магия', 'магический', 'магическое'].includes(value));
}

export function purchasePrice(
  card: Card,
  passives: readonly MechanicsRecord[] = [],
): { listed: number; payable: number; multiplier: number; discounted: boolean } {
  const listed = Math.max(0, Number(card.price ?? 0) || 0);
  const multiplier = isExplicitlyMagicalItem(card)
    ? 1
    : nonmagicalPurchasePriceMultiplier(passives);
  const rate = priceInCopper(1, card.price_currency || 'gold');
  const payable = Math.max(0, Math.ceil(listed * multiplier * rate - 1e-8) / rate);
  return { listed, payable, multiplier, discounted: payable < listed };
}

/** Всего предмета в инвентаре (S4: сумма по ВСЕМ локациям — верхний уровень + все контейнеры). */
export function inventoryQty(state: RuntimeState, cardId: string): number {
  return state.inventory.reduce((s, r) => (r.cardId === cardId ? s + r.qty : s), 0);
}

/** Содержимое контейнера (S4): строки инвентаря с containerId === cardId контейнера. */
export function containerContents(state: RuntimeState, containerCardId: string): RuntimeState['inventory'] {
  return state.inventory.filter((r) => r.containerId === containerCardId);
}

/**
 * Суммарный вес содержимого контейнера (S4/S6): Σ weightOf(cardId)*qty, рекурсивно по вложенным
 * контейнерам, с guard'ом от циклов (контейнер А внутри Б внутри А). weightOf best-effort (нет карты → 0).
 */
export function containerWeight(
  state: RuntimeState,
  containerCardId: string,
  weightOf: (cardId: string) => number,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(containerCardId)) return 0; // цикл вложенности
  seen.add(containerCardId);
  let total = 0;
  for (const r of containerContents(state, containerCardId)) {
    total += (weightOf(r.cardId) || 0) * r.qty;
    total += containerWeight(state, r.cardId, weightOf, seen) * r.qty; // вложенный контейнер
  }
  return total;
}

/** Перенести qty предмета с ВЕРХНЕГО уровня внутрь контейнера (S4). Нельзя вложить контейнер в себя. */
export function moveToContainer(state: RuntimeState, cardId: string, containerCardId: string, qty = 1): RuntimeState {
  if (!cardId || !containerCardId || cardId === containerCardId) return state;
  if(!Number.isSafeInteger(qty)||qty<1)return state;
  // Moving a parent into its descendant would make its contents unreachable.
  const visited=new Set<string>();const ancestors=[containerCardId];
  while(ancestors.length){const id=ancestors.pop()!;if(id===cardId)return state;if(visited.has(id))continue;visited.add(id);for(const r of state.inventory)if(r.cardId===id&&r.containerId)ancestors.push(r.containerId);}
  const need = qty;
  const src = state.inventory.find((r) => r.cardId === cardId && r.containerId == null);
  if (!src || src.qty < need) return state; // недостаточно на верхнем уровне
  const inventory = state.inventory
    .map((r) => (r === src ? { ...r, qty: r.qty - need } : { ...r }))
    .filter((r) => r.qty > 0);
  const dst = inventory.find((r) => r.cardId === cardId && r.containerId === containerCardId);
  if (dst) dst.qty += need;
  else inventory.push({ cardId, qty: need, containerId: containerCardId });
  return { ...state, inventory };
}

/** Достать qty предмета из контейнера на верхний уровень (S4). */
export function moveOutOfContainer(state: RuntimeState, cardId: string, containerCardId: string, qty = 1): RuntimeState {
  if(!Number.isSafeInteger(qty)||qty<1)return state;
  const need = qty;
  const src = state.inventory.find((r) => r.cardId === cardId && r.containerId === containerCardId);
  if (!src || src.qty < need) return state;
  const inventory = state.inventory
    .map((r) => (r === src ? { ...r, qty: r.qty - need } : { ...r }))
    .filter((r) => r.qty > 0);
  const dst = inventory.find((r) => r.cardId === cardId && r.containerId == null);
  if (dst) dst.qty += need;
  else inventory.push({ cardId, qty: need });
  return { ...state, inventory };
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

/** Надеть с автоматической заменой: если целевой слот занят и обычное надевание
 *  падает (руки/кольца заняты), сначала снимаем занимающий предмет, потом надеваем. */
export function equipCardSwapping(state: RuntimeState, card: Card): { state: RuntimeState; error?: string } {
  const first = equipFromInventory(state, card);
  if (!first.error) return first;
  const plan = planEquip(state, card);
  if (plan.slots.length) {
    let s = state;
    for (const slot of plan.slots) s = unequipToInventory(s, slot);
    return equipFromInventory(s, card);
  }
  return first;
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
  passives: readonly MechanicsRecord[] = [],
  quantity = 1,
): {
  runtime: RuntimeState;
  currency: Record<string, number>;
  pricePaid: number;
  discountApplied: boolean;
  error?: string;
} {
  const runtime = forgeToRuntimeState(character);
  let currency = characterCurrency(character);
  const price = purchasePrice(card, passives);
  const curKey = card.price_currency || 'gold';
  const nextCurrency = Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1000
    ? spendCopper(currency, priceInCopper(price.payable * quantity, curKey)) : null;
  if (!nextCurrency) {
    return {
      runtime,
      currency,
      pricePaid: 0,
      discountApplied: price.discounted,
      error: 'Недостаточно средств',
    };
  }
  currency = nextCurrency;
  return {
    runtime: addToInventory(runtime, card.id, quantity),
    currency,
    pricePaid: price.payable * quantity,
    discountApplied: price.discounted,
  };
}
