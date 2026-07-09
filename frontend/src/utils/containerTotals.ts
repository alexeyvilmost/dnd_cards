import type { Card } from '../types';

// Контейнеры S6: контейнер = сумма веса и цены вложенного. Деривация над card.contents (не рантайм-
// инвентарь), рекурсивно для вложенных контейнеров, с нормализацией валют и cycle-guard.

// 1 ЗМ = 10 СМ = 100 ММ (D&D 2024).
const GOLD_PER: Record<string, number> = { gold: 1, silver: 0.1, copper: 0.01 };

/** Цена в золоте (ЗМ) с нормализацией валюты. */
export function priceInGold(price?: number | null, currency?: string | null): number {
  if (price == null) return 0;
  return (Number(price) || 0) * (GOLD_PER[currency || 'gold'] ?? 1);
}

/**
 * Сумма веса (фунты) и цены (ЗМ) содержимого контейнера по card.contents. Рекурсивно суммирует
 * вложенные контейнеры (контейнер внутри контейнера), с guard'ом от циклов и само-ссылки.
 * resolveCard — синхронный резолвер карты по id (best-effort: нет карты → позиция пропущена).
 */
export function containerTotals(
  card: Card,
  resolveCard: (id: string) => Card | undefined,
  seen: Set<string> = new Set(),
): { weight: number; gold: number } {
  const contents = Array.isArray(card.contents) ? card.contents : [];
  if (!contents.length || seen.has(card.id)) return { weight: 0, gold: 0 };
  seen.add(card.id);
  let weight = 0;
  let gold = 0;
  for (const ref of contents) {
    if (!ref?.card_id || ref.card_id === card.id) continue; // само-ссылка (дата-баг)
    const c = resolveCard(ref.card_id);
    if (!c) continue;
    const q = Math.max(1, Math.floor(Number(ref.quantity)) || 1);
    weight += (Number(c.weight) || 0) * q;
    gold += priceInGold(c.price, c.price_currency) * q;
    if (c.type === 'container' && Array.isArray(c.contents) && c.contents.length) {
      const inner = containerTotals(c, resolveCard, seen); // вложенный контейнер
      weight += inner.weight * q;
      gold += inner.gold * q;
    }
  }
  return { weight, gold };
}
