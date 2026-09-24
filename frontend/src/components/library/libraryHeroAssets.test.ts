import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { LIBRARY_CATALOG } from './libraryCatalog';
import { libraryHeroArt } from './libraryHeroArt';

it('ships a separate optimized illustration for every library section', () => {
  expect(new Set(Object.values(libraryHeroArt)).size).toBe(LIBRARY_CATALOG.length);
  for (const { id } of LIBRARY_CATALOG) {
    const file = resolve('public', libraryHeroArt[id].replace(/^\//, ''));
    expect(statSync(file).size).toBeLessThan(250_000);
    expect([...readFileSync(file).subarray(0, 3)]).toEqual([255, 216, 255]);
  }
});
