import { describe, expect, it } from 'vitest';
import { buildLibrarySearchParams, libraryLocation, parseLibrarySearchParams } from './libraryNavigation';

describe('item library filter URLs', () => {
  it.each(['rarity=rare', 'rarity=common,rare', 'rarity=common&rarity=rare', 'rarities=common,rare'])('round trips %s with the canonical library path', query => {
    const params = new URLSearchParams(`${query}&tag=stable-tag-id&q=меч&card=kept`);
    const parsed = parseLibrarySearchParams(params);
    const rebuilt = buildLibrarySearchParams(parsed, params);
    expect(parseLibrarySearchParams(rebuilt)).toEqual(parsed);
    expect(rebuilt.get('card')).toBe('kept');
    expect(rebuilt.get('tag')).toBe('stable-tag-id');
    expect(libraryLocation(rebuilt).pathname).toBe('/library');
  });
  it('reset removes both multi-rarity aliases without removing a card deep link', () => {
    const params = new URLSearchParams('rarities=common,rare&rarity=epic&card=kept');
    const filters = { ...parseLibrarySearchParams(params), rarity: '' };
    expect(buildLibrarySearchParams(filters, params).toString()).toBe('card=kept');
  });
});
