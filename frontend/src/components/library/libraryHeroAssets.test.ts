import { readFileSync, statSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LIBRARY_CATALOG } from './libraryCatalog';
import { libraryHeroArt } from './libraryHeroArt';

it('ships a separate optimized illustration for every library section', () => {
  expect(new Set(Object.values(libraryHeroArt)).size).toBe(LIBRARY_CATALOG.length);
  for (const { id } of LIBRARY_CATALOG) {
    const file = new URL(`../../../public${libraryHeroArt[id]}`, import.meta.url);
    expect(statSync(file).size).toBeLessThan(250_000);
    expect([...readFileSync(file).subarray(0, 3)]).toEqual([255, 216, 255]);
  }
});
