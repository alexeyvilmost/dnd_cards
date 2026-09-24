import { cardsApi } from '../api/client';
import { readPersistedAuthToken } from '../api/authSession';
import { subscribeApiCacheInvalidation } from '../api/apiCache';
import type { Card } from '../types';

// Кэш индекса карт (id -> Card) для резолва ссылок (контейнеры, снаряжение предысторий).
let cache: Map<string, Card> | null = null;
let inflight: Promise<Map<string, Card>> | null = null;
let sessionKey: string | null | undefined;
let generation = 0;

function invalidateIndex() {
  generation++;
  cache = null;
  inflight = null;
}

// Acquisitions, templates and shop/reward changes can alter private additions
// without changing the signed-in user. Public HTTP pages keep their own cache.
const unsubscribe = subscribeApiCacheInvalidation(({ prefix }) => {
  if (prefix === null || prefix === '/api/' || ['/api/cards', '/api/characters-v3',
    '/api/character-templates', '/api/roguelike', '/api/entity-tags', '/api/my-item-catalog'].includes(prefix)) invalidateIndex();
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);

function syncSession() {
  const current = readPersistedAuthToken();
  if (current !== sessionKey) {
    sessionKey = current;
    invalidateIndex();
  }
  return current;
}

export async function getCardsIndex(force = false): Promise<Map<string, Card>> {
  const requestSession = syncSession();
  if (cache && !force) return cache;
  if (inflight) return inflight;
  const requestGeneration = generation;
  const stale = () => generation !== requestGeneration || readPersistedAuthToken() !== requestSession;
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
      // Personal additions serve runtime references only, never CardLibrary.
      if (stale()) return getCardsIndex();
      if (requestSession) {
        let ownedPage = 1;
        let ownedCount = 0;
        let hasMoreOwnedItems = true;
        while (hasMoreOwnedItems) {
          const res = await cardsApi.getMyItemCatalog({ page: ownedPage, limit: 100, fields: 'list' });
          all.push(...res.cards);
          ownedCount += res.cards.length;
          if (stale()) return getCardsIndex();
          hasMoreOwnedItems = res.cards.length === 100 && ownedCount < res.total;
          if (hasMoreOwnedItems) ownedPage++;
        }
      }
      // A response started by an administrator cannot populate a player's index
      // after logout or an account switch, even if the old request finishes last.
      if (stale()) return getCardsIndex();
      cache = new Map(all.map((c) => [c.id, c]));
      return cache;
    } finally {
      // A transient request failure must not poison the process-wide resolver
      // with the same rejected promise for the rest of the browser session.
      if (sessionKey === requestSession && generation === requestGeneration) inflight = null;
    }
  })();
  return inflight;
}

export function getCachedCardsIndex(): Map<string, Card> | null {
  syncSession();
  return cache;
}
