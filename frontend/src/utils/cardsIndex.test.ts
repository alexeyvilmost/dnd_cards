import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../types';

const getCards = vi.hoisted(() => vi.fn());

vi.mock('../api/client', () => ({
  cardsApi: { getCards },
}));

function card(id: string): Card {
  return {
    id,
    card_number: `CARD-${id}`,
    name: `Card ${id}`,
  } as Card;
}

describe('shared card index', () => {
  beforeEach(() => {
    vi.resetModules();
    getCards.mockReset();
  });

  it('paginates through the lightweight list projection and caches the result', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => card(String(index)));
    getCards
      .mockResolvedValueOnce({ cards: firstPage, total: 101 })
      .mockResolvedValueOnce({ cards: [card('100')], total: 101 });

    const { getCardsIndex } = await import('./cardsIndex');
    const first = await getCardsIndex();
    const cached = await getCardsIndex();

    expect(first).toBe(cached);
    expect(first).toHaveLength(101);
    expect(getCards).toHaveBeenNthCalledWith(1, { page: 1, limit: 100, fields: 'list' });
    expect(getCards).toHaveBeenNthCalledWith(2, { page: 2, limit: 100, fields: 'list' });
    expect(getCards).toHaveBeenCalledTimes(2);
  });

  it('clears a rejected in-flight request so a later mount can retry', async () => {
    getCards
      .mockRejectedValueOnce(new Error('temporary catalog failure'))
      .mockResolvedValueOnce({ cards: [card('retry')], total: 1 });

    const { getCardsIndex } = await import('./cardsIndex');
    await expect(getCardsIndex()).rejects.toThrow('temporary catalog failure');
    await expect(getCardsIndex()).resolves.toEqual(new Map([['retry', card('retry')]]));
    expect(getCards).toHaveBeenCalledTimes(2);
  });
});
