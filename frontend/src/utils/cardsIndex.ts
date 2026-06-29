import { cardsApi } from '../api/client';
import type { Card } from '../types';

// Кэш индекса карт (id -> Card) для резолва ссылок (контейнеры, снаряжение предысторий).
let cache: Map<string, Card> | null = null;
let inflight: Promise<Map<string, Card>> | null = null;

export async function getCardsIndex(force = false): Promise<Map<string, Card>> {
  if (cache && !force) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const all: Card[] = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await cardsApi.getCards({ page, limit: 100 });
      all.push(...res.cards);
      if (res.cards.length < 100 || all.length >= res.total || page > 40) break;
      page++;
    }
    cache = new Map(all.map((c) => [c.id, c]));
    inflight = null;
    return cache;
  })();
  return inflight;
}

export function getCachedCardsIndex(): Map<string, Card> | null {
  return cache;
}
