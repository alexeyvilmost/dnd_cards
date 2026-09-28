import { describe, expect, it, vi } from 'vitest';
import { loadCatalogPages } from './catalogPages';

describe('complete catalog loading', () => {
  it('follows capped server pages and preserves entities of every status', async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      total: 3,
      spells: page === 1 ? [{ id: 'a', support: { status: 'verified' } }] : page === 2
        ? [{ id: 'b', support: { status: 'not_verified' } }]
        : [{ id: 'c', support: { status: 'narrative' } }],
    }));
    const result = await loadCatalogPages(fetchPage, 'spells');
    expect(result.spells.map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it('does not request remaining pages after the active search changes', async () => {
    let current = true;
    const fetchPage = vi.fn(async () => {
      current = false;
      return { total: 2, races: [{ id: 'a' }] };
    });
    await expect(loadCatalogPages(fetchPage, 'races', true, () => current)).rejects.toThrow('superseded');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reports incomplete pagination instead of silently showing a false total', async () => {
    const fetchPage = vi.fn(async () => ({ total: 2, cards: [{ id: 'a' }] }));
    await expect(loadCatalogPages(fetchPage, 'cards')).rejects.toThrow('весь каталог');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('keeps ordinary library scrolling paginated when statistics are disabled', async () => {
    const fetchPage = vi.fn(async () => ({ total: 10, cards: [{ id: 'a' }] }));
    expect((await loadCatalogPages(fetchPage, 'cards', false)).cards).toHaveLength(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
