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

/**
 * Механика предмета действует, когда он надет И (если требует настройки)
 * на него настроены.
 */
export function itemMechanicsActive(card: Card, attuned: string[]): boolean {
  if (!card.mechanics || typeof card.mechanics !== 'object') return false;
  if (card.requires_attunement) return attuned.includes(card.id);
  return true;
}

export interface ItemMechanic {
  card: Card;
  mechanics: Record<string, unknown>;
}

/** Механики надетых предметов с учётом настройки (для passives-потока). */
export function collectItemMechanics(
  equipment: Record<string, string | null | undefined>,
  cardMap: Map<string, Card>,
  turnState: Record<string, unknown> | null | undefined,
): ItemMechanic[] {
  const attuned = readAttunedIds(turnState);
  const seen = new Set<string>();
  const out: ItemMechanic[] = [];
  for (const id of Object.values(equipment)) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const card = cardMap.get(id);
    if (!card || !itemMechanicsActive(card, attuned)) continue;
    out.push({
      card,
      mechanics: { name: card.name, ...(card.mechanics as Record<string, unknown>) },
    });
  }
  return out;
}
