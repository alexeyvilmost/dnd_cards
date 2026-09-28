// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cached, clearApiCache, subscribeApiCacheInvalidation } from './apiCache';
import { readWithReviewUpdates, updateReviewStatus } from './contentReview';

const mocks = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('./client', () => ({ apiClient: mocks }));
afterEach(() => { clearApiCache(); vi.clearAllMocks(); });

it('patches only the saved entity in ready detail/list caches without invalidation or extra reads', async () => {
  const row = { id: 'one', support: { status: 'not_verified' }, name: 'Первый' };
  const other = { id: 'two', support: { status: 'narrative' }, name: 'Второй' };
  const loader = vi.fn(async () => row);
  const listLoader = vi.fn(async () => ({ spells: [row, other], total: 2 }));
  await cached('/api/spells/one', 60_000, loader);
  await cached('/api/spells?school=abjuration', 60_000, listLoader);
  await cached('/api/resources/one', 60_000, loader);
  const invalidated = vi.fn();
  const unsubscribe = subscribeApiCacheInvalidation(invalidated);
  mocks.patch.mockResolvedValue({ data: { entity_type: 'spell', entity_id: 'one', support: { status: 'verified' } } });
  try {
    await updateReviewStatus('spell', 'one', 'verified');
    expect(invalidated).not.toHaveBeenCalled();
    expect((await cached('/api/spells/one', 60_000, loader)).support.status).toBe('verified');
    const list = await cached('/api/spells?school=abjuration', 60_000, listLoader);
    expect(list.spells[0]).toEqual({...row,support:{status:'verified'}});
    expect(list.spells[1]).toBe(other);
    expect(await cached('/api/resources/one', 60_000, loader)).toBe(row);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(listLoader).toHaveBeenCalledTimes(1);
  } finally { unsubscribe(); }
});

it.each(['cached', 'uncached'] as const)('patches a %s pending read without restarting it or losing the saved status', async mode => {
  let finish!: (value: { cards: { id: string; support: { status: string } }[] }) => void;
  const read = vi.fn(() => new Promise<{ cards: { id: string; support: { status: string } }[] }>(resolve => { finish = resolve; }));
  const pending = mode === 'cached' ? cached('/api/cards|identity:owner',60_000,read) : readWithReviewUpdates('card',read);
  mocks.patch.mockResolvedValue({ data: { entity_type: 'card', entity_id: 'one', support: { status: 'verified_partial' } } });
  await updateReviewStatus('card','one','verified_partial');
  finish({ cards: [{id:'one',support:{status:'not_verified'}},{id:'two',support:{status:'not_tested'}}] });
  expect((await pending).cards.map(row=>row.support.status)).toEqual(['verified_partial','not_tested']);
  expect(read).toHaveBeenCalledTimes(1);
});
