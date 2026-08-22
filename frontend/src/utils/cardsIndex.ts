import { cardsApi } from '../api/client';
import type { Card } from '../types';

// Кэш индекса карт (id -> Card) для резолва ссылок (контейнеры, снаряжение предысторий).
let cache: Map<string, Card> | null = null;
let inflight: Promise<Map<string, Card>> | null = null;

export async function getCardsIndex(force = false): Promise<Map<string, Card>> {
  if (cache && !force) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const all: Card[] = [];
      let page = 1;
      // The shared index resolves identities, names, container references and
      // canonical card closure. Detailed previews and equipped-card mechanics
      // are hydrated by their entity endpoints; downloading every base64 image
      // and mechanics payload here blocks every sheet action behind megabytes
      // of unrelated content.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await cardsApi.getCards({ page, limit: 100, fields: 'list' });
        all.push(...res.cards);
        if (res.cards.length < 100 || all.length >= res.total || page > 40) break;
        page++;
      }
      cache = new Map(all.map((c) => [c.id, c]));
      return cache;
    } finally {
      // A transient request failure must not poison the process-wide resolver
      // with the same rejected promise for the rest of the browser session.
      inflight = null;
    }
  })();
  return inflight;
}

export function getCachedCardsIndex(): Map<string, Card> | null {
  return cache;
}
