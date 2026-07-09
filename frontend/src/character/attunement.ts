/**
 * Настройка на предметы (PHB 2024): максимум 3 предмета одновременно;
 * настроиться или прервать настройку можно только на коротком отдыхе
 * (реализация: изменения разрешены сразу после короткого/долгого отдыха,
 * начало нового хода закрывает окно до следующего отдыха).
 * Состояние — в turn_state (attuned_ids, attunement_unlocked).
 */
import type { Card } from '../types';

export const MAX_ATTUNED = 3;

export function readAttunedIds(turnState: Record<string, unknown> | null | undefined): string[] {
  const raw = turnState?.attuned_ids;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function attunementUnlocked(turnState: Record<string, unknown> | null | undefined): boolean {
  return turnState?.attunement_unlocked === true;
}

export function isAttuned(turnState: Record<string, unknown> | null | undefined, cardId: string): boolean {
  return readAttunedIds(turnState).includes(cardId);
}

export function toggleAttuned(attuned: string[], cardId: string): string[] {
  return attuned.includes(cardId)
    ? attuned.filter((id) => id !== cardId)
    : [...attuned, cardId];
}

export type ItemGateMode = 'equipped' | 'carried' | 'attuned';
type Dict = Record<string, unknown>;

/**
 * Условие применимости механики предмета (данными, не хардкодом): equipped | carried | attuned.
 * Хранится в mechanics.activation.while или top-level mechanics.while (для пассивных предметов без
 * блока activation). Нераспознанное/отсутствует → undefined (прежнее поведение = equipped).
 */
export function itemWhile(card: Card): ItemGateMode | undefined {
  const m = card.mechanics as Dict | null;
  if (!m || typeof m !== 'object') return undefined;
  const act = m.activation as Dict | undefined;
  // `||`, не `??`: пустая/невалидная activation.while ('') не должна затенять top-level mechanics.while.
  const raw = (act && typeof act === 'object' ? act.while : undefined) || m.while;
  const s = String(raw ?? '').toLowerCase();
  return s === 'equipped' || s === 'carried' || s === 'attuned' ? s : undefined;
}

export interface ItemGateContext {
  equipment: Record<string, string | null | undefined>;
  inventory: ReadonlyArray<{ cardId: string; qty: number }>;
  attuned: string[];
}

const isEquipped = (equipment: ItemGateContext['equipment'], id: string): boolean =>
  Object.values(equipment).some((v) => v === id);
const isCarried = (ctx: ItemGateContext, id: string): boolean =>
  isEquipped(ctx.equipment, id) || (ctx.inventory.find((r) => r.cardId === id)?.qty ?? 0) > 0;

/**
 * Единый гейт применимости предмета (данными). Настройка — ЖЁСТКОЕ требование независимо от локации
 * (PHB: без настройки магия молчит). Локационная ось из `while`:
 *  • нет / equipped → активна, пока предмет НАДЕТ (прежнее поведение, обратная совместимость);
 *  • carried → пока НАДЕТ ИЛИ ЛЕЖИТ В СУМКЕ (equipped ⊆ carried);
 *  • attuned → пока на предмет настроены.
 */
export function itemGate(card: Card, ctx: ItemGateContext): boolean {
  if (!card.mechanics || typeof card.mechanics !== 'object') return false;
  if (card.requires_attunement && !ctx.attuned.includes(card.id)) return false;
  const w = itemWhile(card);
  if (w === 'carried') return isCarried(ctx, card.id);
  if (w === 'attuned') return ctx.attuned.includes(card.id);
  return isEquipped(ctx.equipment, card.id);
}

export interface ItemMechanic {
  card: Card;
  mechanics: Record<string, unknown>;
}

/**
 * Механики предметов, прошедших гейт (для passives/runtimeSources/действий). Кандидаты — надетые
 * (слоты) + носимые (сумка); каждая механика фильтруется своим itemGate. Дедуп по id. Инвентарь
 * необязателен: без него — только надетые (обратная совместимость).
 */
export function collectItemMechanics(
  equipment: Record<string, string | null | undefined>,
  cardMap: Map<string, Card>,
  turnState: Record<string, unknown> | null | undefined,
  inventory: ReadonlyArray<{ cardId: string; qty: number }> = [],
): ItemMechanic[] {
  const ctx: ItemGateContext = { equipment, inventory, attuned: readAttunedIds(turnState) };
  const seen = new Set<string>();
  const out: ItemMechanic[] = [];
  for (const id of [...Object.values(equipment), ...inventory.map((r) => r.cardId)]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const card = cardMap.get(id);
    if (!card || !itemGate(card, ctx)) continue;
    out.push({ card, mechanics: { name: card.name, ...(card.mechanics as Record<string, unknown>) } });
  }
  return out;
}
