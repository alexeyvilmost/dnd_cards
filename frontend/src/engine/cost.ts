/**
 * Проверка и трата стоимости действий (фаза D2).
 */
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import { itemConsumedEvent, resourceSpentEvent } from './events';

type Dict = Record<string, unknown>;

export function costAmount(entry: Dict): number {
  const raw = entry.amount;
  if (raw == null) return 1;
  // Неотрицательное целое: отрицательная стоимость-предмет иначе НАРАЩИВАЛА бы инвентарь
  // (spendInventory(qty, −n) = qty+n). '0' и 0 приводим одинаково (к 0).
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1;
}

/** Стоимость-предмет ({resource:'item', card_id}): тратит предмет из инвентаря, а не пул ресурсов. */
function isItemCost(entry: Dict): boolean {
  return String(entry.resource ?? '') === 'item';
}
function inventoryQty(state: RuntimeState, cardId: string): number {
  return state.inventory.reduce((s, r) => (r.cardId === cardId ? s + r.qty : s), 0); // S4: сумма по всем локациям
}
function spendInventory(state: RuntimeState, cardId: string, qty: number): RuntimeState {
  // S4: тратим ВСЕГО qty, предпочитая верхний уровень (стопки могут быть в разных контейнерах).
  let remaining = qty;
  const order = state.inventory
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.cardId === cardId)
    .sort((a, b) => ((a.r.containerId ? 1 : 0) - (b.r.containerId ? 1 : 0)) || (a.i - b.i));
  const take = new Map<number, number>();
  for (const { r, i } of order) {
    if (remaining <= 0) break;
    const t = Math.min(r.qty, remaining);
    take.set(i, t);
    remaining -= t;
  }
  const inventory = state.inventory
    .map((row, i) => (take.has(i) ? { ...row, qty: row.qty - (take.get(i) ?? 0) } : { ...row }))
    .filter((row) => row.qty > 0);
  return { ...state, inventory };
}

/** Ключ ресурса: канон схемы {resource:'spell_slot', level:N} → spell_slot_N. */
export function costKey(entry: Dict): string {
  const resource = String(entry.resource ?? '');
  if (resource === 'spell_slot' && entry.level != null) return `spell_slot_${entry.level}`;
  return resource;
}

/** `hit_die` — схемный абстрактный ключ; runtime хранит отдельный пул по размеру кости. */
function runtimeCostKey(state: RuntimeState, entry: Dict): string {
  const key = costKey(entry);
  if (key !== 'hit_die') return key;
  const requested = typeof entry.die === 'string' ? `hit_dice_${entry.die.toLowerCase()}` : null;
  if (requested && requested in state.resources) return requested;
  const available = Object.keys(state.resources)
    .filter((candidate) => candidate.startsWith('hit_dice_d') && (state.resources[candidate] ?? 0) > 0)
    .sort((a, b) => Number(b.slice('hit_dice_d'.length)) - Number(a.slice('hit_dice_d'.length)));
  return available[0] ?? 'hit_die';
}

export function canPay(state: RuntimeState, cost: Dict[]): { ok: boolean; missing: string[] } {
  // Суммируем потребность ПО КЛЮЧУ до сравнения: две записи на один card_id/ресурс иначе каждая
  // видела бы полный запас → canPay ложно проходил бы, а pay недосписывал (нарушение атомарности).
  const itemNeed = new Map<string, number>();
  const resNeed = new Map<string, number>();
  for (const entry of cost) {
    const need = costAmount(entry);
    if (isItemCost(entry)) {
      const cardId = String(entry.card_id ?? '');
      itemNeed.set(cardId, (itemNeed.get(cardId) ?? 0) + need);
    } else {
      const key = runtimeCostKey(state, entry);
      resNeed.set(key, (resNeed.get(key) ?? 0) + need);
    }
  }
  const missing: string[] = [];
  for (const [cardId, need] of itemNeed) {
    if (!cardId || inventoryQty(state, cardId) < need) missing.push(`item:${cardId}`);
  }
  for (const [key, need] of resNeed) {
    if ((state.resources[key] ?? 0) < need) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}

export function pay(state: RuntimeState, cost: Dict[]): { state: RuntimeState; events: EngineEvent[] } {
  const check = canPay(state, cost);
  if (!check.ok) return { state, events: [] };

  let next = state;
  const resources = { ...state.resources };
  const events: EngineEvent[] = [];

  for (const entry of cost) {
    const need = costAmount(entry);
    if (isItemCost(entry)) {
      const cardId = String(entry.card_id ?? '');
      next = spendInventory(next, cardId, need); // не трогает resources → мёрж ниже безопасен
      const name = typeof entry.name === 'string' ? entry.name : undefined;
      events.push(itemConsumedEvent(cardId, need, inventoryQty(next, cardId), name));
      continue;
    }
    const key = runtimeCostKey(state, entry);
    resources[key] = (resources[key] ?? 0) - need;
    events.push(resourceSpentEvent(key, need, resources[key]));
  }

  return { state: { ...next, resources }, events };
}

export const SELF_ITEM_RESOURCE = 'self_item';

/**
 * Bind an explicitly declared relative item cost to the concrete card.
 * `consumes_self` is intentionally ignored: costs have one authority,
 * `activation.cost`, and adapters may only resolve declared references.
 */
export function bindSelfItemCost(mech: Dict, selfCardId: string): Dict {
  const activation = mech.activation as Dict | undefined;
  if (!Array.isArray(activation?.cost)) return mech;
  const hasSelfItem = activation.cost.some((entry) => (
    !!entry && typeof entry === 'object' && (entry as Dict).resource === SELF_ITEM_RESOURCE
  ));
  if (!hasSelfItem) return mech;
  if (!selfCardId.trim()) throw new Error('activation.cost self_item requires a stable card id');
  const name = typeof mech.name === 'string' ? mech.name : undefined;
  const cost = (activation.cost as Dict[]).map((entry) => {
    if (entry?.resource !== SELF_ITEM_RESOURCE) return entry;
    if (entry.card_id !== undefined) {
      throw new Error('activation.cost self_item must not declare card_id');
    }
    return {
      ...entry,
      resource: 'item',
      card_id: selfCardId,
      ...(entry.amount === undefined ? { amount: 1 } : {}),
      ...(entry.name === undefined && name ? { name } : {}),
    };
  });
  return { ...mech, activation: { ...activation, cost } };
}
