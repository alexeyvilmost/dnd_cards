import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../types';

const getCards = vi.hoisted(() => vi.fn());
const getMyItemCatalog = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../api/authSession', () => ({ readPersistedAuthToken: () => identity.token }));

vi.mock('../api/client', () => ({
  cardsApi: { getCards, getMyItemCatalog },
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
    getMyItemCatalog.mockReset().mockResolvedValue({ cards: [], total: 0 });
    identity.token = null;
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
    expect(getMyItemCatalog).not.toHaveBeenCalled();
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

  it('invalidates the index on logout and cannot retain an administrative result', async () => {
    identity.token = 'admin';
    getCards.mockResolvedValueOnce({ cards: [card('hidden')], total: 1 }).mockResolvedValueOnce({ cards: [card('public')], total: 1 });
    const { getCardsIndex, getCachedCardsIndex } = await import('./cardsIndex');
    expect((await getCardsIndex()).has('hidden')).toBe(true);
    identity.token = null;
    expect(getCachedCardsIndex()).toBeNull();
    expect((await getCardsIndex()).has('hidden')).toBe(false);
  });

  it('discards an old administrative response that finishes after switching accounts', async () => {
    identity.token = 'admin';
    let finish!: (value: unknown) => void;
    getCards.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ cards: [card('public')], total: 1 });
    const { getCardsIndex } = await import('./cardsIndex');
    const oldRequest = getCardsIndex();
    identity.token = 'player';
    finish({ cards: [card('hidden')], total: 1 });
    const result = await oldRequest;
    expect(result.has('hidden')).toBe(false);
    expect(result.has('public')).toBe(true);
  });

  it('merges all private pages without duplicate cards', async () => {
    identity.token = 'player';
    getCards.mockResolvedValue({ cards: [card('public')], total: 1 });
    getMyItemCatalog.mockResolvedValueOnce({ cards: [card('public'), ...Array.from({ length: 99 }, (_, i) => card(`owned${i}`))], total: 101 })
      .mockResolvedValueOnce({ cards: [card('last-owned')], total: 101 });
    const { getCardsIndex } = await import('./cardsIndex');
    const result = await getCardsIndex();
    expect(result.size).toBe(101);
    expect(result.has('last-owned')).toBe(true);
    expect(getMyItemCatalog).toHaveBeenNthCalledWith(2, { page: 2, limit: 100, fields: 'list' });
  });

  it('discards an old private response after logout', async () => {
    identity.token = 'player';
    getCards.mockResolvedValue({ cards: [card('public')], total: 1 });
    let finish!: (value: unknown) => void;
    getMyItemCatalog.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { getCardsIndex } = await import('./cardsIndex');
    const pending = getCardsIndex();
    await vi.waitFor(() => expect(getMyItemCatalog).toHaveBeenCalledOnce());
    identity.token = null;
    finish({ cards: [card('private')], total: 1 });
    const result = await pending;
    expect(result.has('private')).toBe(false);
    expect(result.has('public')).toBe(true);
  });

  it('does not cache an incomplete index when the private request fails', async () => {
    identity.token = 'player';
    getCards.mockResolvedValue({ cards: [card('public')], total: 1 });
    getMyItemCatalog.mockRejectedValueOnce(new Error('private unavailable')).mockResolvedValueOnce({ cards: [card('owned')], total: 1 });
    const { getCardsIndex, getCachedCardsIndex } = await import('./cardsIndex');
    await expect(getCardsIndex()).rejects.toThrow('private unavailable');
    expect(getCachedCardsIndex()).toBeNull();
    expect((await getCardsIndex()).has('owned')).toBe(true);
  });

  it.each(['/api/characters-v3', '/api/character-templates', '/api/roguelike', '/api/cards', '/api/entity-tags', '/api/'])('refreshes the same-session index after %s changes', async (prefix) => {
    identity.token = 'player';
    getCards.mockResolvedValue({ cards: [card('public')], total: 1 });
    getMyItemCatalog.mockResolvedValueOnce({ cards: [], total: 0 }).mockResolvedValueOnce({ cards: [card('acquired')], total: 1 });
    const { getCardsIndex, getCachedCardsIndex } = await import('./cardsIndex');
    const { bustPrefix } = await import('../api/apiCache');
    expect((await getCardsIndex()).has('acquired')).toBe(false);
    bustPrefix(prefix);
    expect(getCachedCardsIndex()).toBeNull();
    expect((await getCardsIndex()).has('acquired')).toBe(true);
  });

  it('does not publish a private response predating a successful acquisition', async () => {
    identity.token = 'player';
    getCards.mockResolvedValue({ cards: [card('public')], total: 1 });
    let finish!: (value: unknown) => void;
    getMyItemCatalog.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ cards: [card('acquired')], total: 1 });
    const { getCardsIndex } = await import('./cardsIndex');
    const { bustPrefix } = await import('../api/apiCache');
    const old = getCardsIndex();
    await vi.waitFor(() => expect(getMyItemCatalog).toHaveBeenCalledOnce());
    bustPrefix('/api/roguelike');
    finish({ cards: [], total: 0 });
    expect((await old).has('acquired')).toBe(true);
  });

  it('keeps the index cached for unrelated spell changes', async () => {
    getCards.mockResolvedValue({ cards: [card('public')], total: 1 });
    const { getCardsIndex } = await import('./cardsIndex');
    const { bustPrefix } = await import('../api/apiCache');
    const initial = await getCardsIndex();
    bustPrefix('/api/spells');
    expect(await getCardsIndex()).toBe(initial);
  });
});
