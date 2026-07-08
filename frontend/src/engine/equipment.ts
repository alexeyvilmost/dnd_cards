/**
 * Экипировка и вес (фаза C2–C3).
 */
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { registerCard } from './cardRegistry';

export type EquipmentSlotKey =
  | 'head' | 'body' | 'main_hand' | 'off_hand'
  | 'gloves' | 'boots' | 'cloak' | 'necklace' | 'ring_1' | 'ring_2';

export const EQUIPMENT_SLOTS: EquipmentSlotKey[] = [
  'head', 'body', 'main_hand', 'off_hand', 'gloves', 'boots', 'cloak', 'necklace', 'ring_1', 'ring_2',
];

function cardProps(card: Card): string[] {
  const p = card.properties;
  if (!p) return [];
  if (Array.isArray(p)) return p.map(String);
  if (typeof p === 'object') return Object.values(p as Record<string, unknown>).map(String);
  return [];
}

function isTwoHanded(card: Card): boolean {
  return card.slot === 'two_hands' || cardProps(card).includes('two_handed');
}

function isShield(card: Card): boolean {
  return card.type === 'shield' || card.defense_type === 'shield';
}

function isBodyArmor(card: Card): boolean {
  return card.slot === 'body' || card.type === 'chest' || (!!card.defense_type && !isShield(card));
}

function bothHandsFree(equipment: Record<string, string | null | undefined>): boolean {
  return !equipment.main_hand && !equipment.off_hand;
}

function cloneEquipment(state: RuntimeState): Record<string, string | null> {
  const eq: Record<string, string | null> = {};
  for (const slot of EQUIPMENT_SLOTS) eq[slot] = state.equipment[slot] ?? null;
  return eq;
}

/** Слот ношения для «носимых» предметов (не оружие/броня/щит). */
function wearableSlot(card: Card, equipment: Record<string, string | null>): EquipmentSlotKey | null {
  const t = String(card.type ?? '');
  const s = String(card.slot ?? '');
  if (t === 'helmet' || s === 'head') return 'head';
  if (t === 'gloves' || s === 'arms') return 'gloves';
  if (t === 'boots' || s === 'feet') return 'boots';
  if (t === 'cloak' || s === 'cloak') return 'cloak';
  if (t === 'necklace' || s === 'necklace') return 'necklace';
  if (t === 'ring' || s === 'ring') {
    if (!equipment.ring_1) return 'ring_1';
    if (!equipment.ring_2) return 'ring_2';
    return null; // оба пальца заняты
  }
  return null;
}

function pickOneHandSlot(equipment: Record<string, string | null>, card: Card): 'main_hand' | 'off_hand' | null {
  if (isShield(card)) {
    if (equipment.main_hand && !equipment.off_hand) return 'off_hand';
    if (!equipment.main_hand) return 'main_hand';
    if (!equipment.off_hand) return 'off_hand';
    return null;
  }
  if (!equipment.main_hand) return 'main_hand';
  if (!equipment.off_hand) return 'off_hand';
  return null;
}

/** Надеть предмет в подходящий слот. */
export function equipItem(state: RuntimeState, card: Card): { state: RuntimeState; error?: string } {
  registerCard(card);
  const equipment = cloneEquipment(state);

  if (isBodyArmor(card)) {
    equipment.body = card.id;
    return { state: { ...state, equipment } };
  }

  if (isTwoHanded(card)) {
    if (!bothHandsFree(equipment)) {
      return { state, error: 'Обе руки заняты — сначала снимите оружие' };
    }
    equipment.main_hand = card.id;
    equipment.off_hand = card.id;
    return { state: { ...state, equipment } };
  }

  if (card.slot === 'one_hand' || card.type === 'weapon' || isShield(card)) {
    const slot = pickOneHandSlot(equipment, card);
    if (!slot) return { state, error: 'Руки заняты — сначала снимите предмет' };
    equipment[slot] = card.id;
    return { state: { ...state, equipment } };
  }

  // Носимые предметы: шлем, перчатки, сапоги, плащ, ожерелье, кольца (2 слота).
  const wear = wearableSlot(card, equipment);
  if (wear) {
    equipment[wear] = card.id;
    return { state: { ...state, equipment } };
  }
  if (card.type === 'ring' || card.slot === 'ring') {
    return { state, error: 'Оба кольца уже надеты — сначала снимите одно' };
  }

  return { state, error: `Неизвестный тип предмета: ${card.name}` };
}

/** Слот(ы), которые займёт предмет, и предмет, который при этом будет вытеснен.
 *  Используется диалогом надевания, чтобы показать «текущий → новый». */
export interface EquipPlan {
  slots: EquipmentSlotKey[];
  occupantId: string | null;
  error?: string;
}
export function planEquip(state: RuntimeState, card: Card): EquipPlan {
  const eq = cloneEquipment(state);
  if (isBodyArmor(card)) return { slots: ['body'], occupantId: eq.body ?? null };
  if (isTwoHanded(card)) {
    return { slots: ['main_hand', 'off_hand'], occupantId: eq.main_hand ?? eq.off_hand ?? null };
  }
  if (card.slot === 'one_hand' || card.type === 'weapon' || isShield(card)) {
    const free = pickOneHandSlot(eq, card);
    if (free) return { slots: [free], occupantId: null };
    const target: EquipmentSlotKey = isShield(card) ? 'off_hand' : 'main_hand';
    return { slots: [target], occupantId: eq[target] ?? null };
  }
  const wear = wearableSlot(card, eq);
  if (wear) return { slots: [wear], occupantId: null };
  if (card.type === 'ring' || card.slot === 'ring') {
    return { slots: ['ring_1'], occupantId: eq.ring_1 ?? null };
  }
  return { slots: [], occupantId: null, error: `Неизвестный тип предмета: ${card.name}` };
}

/** Снять предмет со слота (двуручное — освобождает обе руки). */
export function unequipSlot(state: RuntimeState, slot: string): RuntimeState {
  const equipment = cloneEquipment(state);
  const id = equipment[slot as EquipmentSlotKey];
  if (!id) return { ...state, equipment };

  if (equipment.main_hand && equipment.main_hand === equipment.off_hand) {
    equipment.main_hand = null;
    equipment.off_hand = null;
  } else {
    equipment[slot as EquipmentSlotKey] = null;
  }
  return { ...state, equipment };
}

/** Суммарный вес: инвентарь + экипированное (без двойного учёта). */
export function totalWeight(state: RuntimeState, cards: Map<string, Card>): number {
  let total = 0;
  const invQty = new Map<string, number>();
  for (const { cardId, qty } of state.inventory) {
    const w = cards.get(cardId)?.weight ?? 0;
    total += w * qty;
    invQty.set(cardId, (invQty.get(cardId) ?? 0) + qty);
  }

  const equipped = new Set<string>();
  for (const id of Object.values(state.equipment)) {
    if (id) equipped.add(id);
  }
  for (const cardId of equipped) {
    if ((invQty.get(cardId) ?? 0) > 0) continue;
    total += cards.get(cardId)?.weight ?? 0;
  }
  return total;
}

export function cardPropsList(card: Card): string[] {
  return cardProps(card);
}

export function isShieldCard(card: Card): boolean {
  return isShield(card);
}
