import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
const object = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Capacity belongs to the container card. Unknown measurements never count as zero. */
export function containerTransferIssue(state: RuntimeState, cards: ReadonlyMap<string, Card>, containerId: string, addedId: string, quantity: number): string | null {
  const container = cards.get(containerId);
  if (!container || container.type !== 'container') return 'Целевой предмет не является контейнером';
  const raw = container.mechanics?.storage_profile;
  if (raw === undefined) return null;
  if (!object(raw) || Object.keys(raw).some(key => !['max_weight_lb', 'max_volume_cubic_ft', 'max_liquid_oz', 'max_units', 'item_units'].includes(key))) return 'Некорректная вместимость контейнера';
  for (const key of ['max_weight_lb', 'max_volume_cubic_ft', 'max_liquid_oz', 'max_units']) if (raw[key] !== undefined && !positive(raw[key])) return 'Некорректная вместимость контейнера';
  const owners = state.inventory.filter(row => row.cardId === containerId).reduce((sum, row) => sum + row.qty, 0);
  if (owners < 1) return 'Контейнер отсутствует в инвентаре';
  const rows = [...state.inventory.filter(row => row.containerId === containerId), { cardId: addedId, qty: quantity }];
  const units = raw.item_units;
  if (raw.max_units !== undefined && (!object(units) || Object.values(units).some(value => !positive(value)))) return 'Некорректные ограничения содержимого';
  const measure = (id: string, key: 'weight' | 'volume_cubic_ft' | 'liquid_oz', visited = new Set<string>()): number | string => {
    if (visited.has(id)) return 'Цикл вложенных контейнеров';
    const card = cards.get(id);
    if (!card) return 'Карточка содержимого ещё не загружена';
    const physical = object(card.mechanics?.physical_profile) ? card.mechanics.physical_profile : {};
    const value = key === 'weight' ? card.weight : physical[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return `У предмета «${card.name}» не задан ${key === 'weight' ? 'вес' : key === 'liquid_oz' ? 'объём жидкости' : 'внешний объём'}`;
    if (key !== 'weight') return value;
    let result = value;
    const next = new Set([...visited, id]);
    for (const child of state.inventory.filter(row => row.containerId === id)) {
      const nested = measure(child.cardId, key, next);
      if (typeof nested === 'string') return nested;
      result += nested * child.qty;
    }
    return result;
  };
  if (raw.max_units !== undefined && object(units)) {
    let count = 0;
    for (const row of rows) {
      const card = cards.get(row.cardId), unit = units[row.cardId] ?? (card?.card_number ? units[card.card_number] : undefined);
      if (!positive(unit)) return `Этот контейнер не предназначен для «${card?.name ?? row.cardId}»`;
      count += unit * row.qty;
    }
    if (count > Number(raw.max_units) * owners) return 'Превышено допустимое число предметов в контейнере';
  }
  for (const [limit, key, label] of [['max_weight_lb', 'weight', 'вес'], ['max_volume_cubic_ft', 'volume_cubic_ft', 'объём'], ['max_liquid_oz', 'liquid_oz', 'объём жидкости']] as const) {
    if (raw[limit] === undefined) continue;
    if (raw.max_volume_cubic_ft !== undefined && raw.max_liquid_oz !== undefined) {
      const allLiquid = rows.every(row => object(cards.get(row.cardId)?.mechanics?.physical_profile)
        && Number.isFinite((cards.get(row.cardId)!.mechanics!.physical_profile as Dict).liquid_oz));
      if (allLiquid && key === 'volume_cubic_ft' || !allLiquid && key === 'liquid_oz') continue;
    }
    let total = 0;
    for (const row of rows) { const amount = measure(row.cardId, key); if (typeof amount === 'string') return amount; total += amount * row.qty; }
    if (total > Number(raw[limit]) * owners + 1e-9) return `Превышен допустимый ${label} содержимого`;
  }
  return null;
}
