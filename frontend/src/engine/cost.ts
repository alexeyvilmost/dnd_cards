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
  return state.inventory.find((r) => r.cardId === cardId)?.qty ?? 0;
}
function spendInventory(state: RuntimeState, cardId: string, qty: number): RuntimeState {
  const inventory = state.inventory
    .map((row) => (row.cardId === cardId ? { ...row, qty: row.qty - qty } : { ...row }))
    .filter((row) => row.qty > 0);
  return { ...state, inventory };
}

/** Ключ ресурса: канон схемы {resource:'spell_slot', level:N} → spell_slot_N. */
export function costKey(entry: Dict): string {
  const resource = String(entry.resource ?? '');
  if (resource === 'spell_slot' && entry.level != null) return `spell_slot_${entry.level}`;
  return resource;
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
      const key = costKey(entry);
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
    const key = costKey(entry);
    resources[key] = (resources[key] ?? 0) - need;
    events.push(resourceSpentEvent(key, need, resources[key]));
  }

  return { state: { ...next, resources }, events };
}

/** Добавляет запись стоимости в activation.cost (S5: боеприпас оружия). Не мутирует вход. */
export function appendActivationCost(mech: Dict, entry: Dict): Dict {
  const act: Dict = { ...((mech.activation as Dict | undefined) ?? { mode: 'active' }) };
  const cost = Array.isArray(act.cost) ? [...(act.cost as Dict[])] : [];
  cost.push(entry);
  act.cost = cost;
  return { ...mech, activation: act };
}

/**
 * S4 «предмет=эффект»: добавляет к активационной стоимости САМОРАСХОД предмета
 * ({resource:'item', card_id:<self>, amount:1}), если механика помечена consumes_self
 * (в activation или top-level). Идемпотентно; по образцу applyActionUsesCost.
 */
export function applyItemConsumeCost(mech: Dict, selfCardId: string): Dict {
  const activation = mech.activation as Dict | undefined;
  const consumesSelf = activation?.consumes_self === true || mech.consumes_self === true;
  if (!consumesSelf || !selfCardId) return mech;
  const act: Dict = { ...(activation ?? { mode: 'active' }) };
  const cost = Array.isArray(act.cost) ? [...(act.cost as Dict[])] : [];
  if (cost.some((c) => c && (c as Dict).resource === 'item' && (c as Dict).card_id === selfCardId)) return mech;
  const name = typeof mech.name === 'string' ? mech.name : undefined;
  cost.push({ resource: 'item', card_id: selfCardId, amount: 1, ...(name ? { name } : {}) });
  act.cost = cost;
  return { ...mech, activation: act };
}
