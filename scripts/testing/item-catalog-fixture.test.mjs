import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildItemCatalogFixture} from './item-catalog-fixture.mjs';

test('portable item fixtures are the exact minimal projection of existing migration declarations', () => {
  const expected = buildItemCatalogFixture();
  for (const key of ['cards', 'spells', 'provenance']) {
    const actual = JSON.parse(readFileSync(new URL(`../../frontend/src/testing/fixtures/item-catalog.${key}.json`, import.meta.url)));
    assert.deepEqual(actual, expected[key]);
  }
  assert.equal(expected.cards.length, 13);
  assert.equal(expected.spells.length, 1);
  for (const row of [...expected.cards, ...expected.spells]) {
    assert.ok(row.mechanics && typeof row.mechanics === 'object');
    assert.ok(!Object.keys(row).some(key => /image|token|owner|author|created|updated|deleted|support|description/.test(key)));
  }
});
