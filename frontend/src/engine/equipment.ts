/**
 * Экипировка и вес (фаза C2–C3).
 */
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { registerCard } from './cardRegistry';

export type EquipmentSlotKey = 'head' | 'body' | 'main_hand' | 'off_hand';

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

function handsOccupied(equipment: Record<string, string | null | undefined>): boolean {
  return !!(equipment.main_hand || equipment.off_hand);
}

function bothHandsFree(equipment: Record<string, string | null | undefined>): boolean {
  return !equipment.main_hand && !equipment.off_hand;
}

function cloneEquipment(state: RuntimeState): Record<string, string | null> {
  const eq: Record<string, string | null> = {
    head: state.equipment.head ?? null,
    body: state.equipment.body ?? null,
    main_hand: state.equipment.main_hand ?? null,
    off_hand: state.equipment.off_hand ?? null,
  };
  return eq;
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

  return { state, error: `Неизвестный тип предмета: ${card.name}` };
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
