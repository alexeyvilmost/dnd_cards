import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEVEL3_MINI_MVP_COLLECTION_SIZES,
  LEVEL3_MINI_MVP_MANIFEST,
  flattenLevel3MiniMvpManifest,
  validateLevel3MiniMvpManifest,
} from './level3-mini-mvp-manifest.mjs';

test('pins the exact level-3 expansion denominator', () => {
  assert.deepEqual(validateLevel3MiniMvpManifest(), []);
  assert.deepEqual(
    Object.fromEntries(Object.entries(LEVEL3_MINI_MVP_MANIFEST.collections).map(([key, values]) => [key, values.length])),
    LEVEL3_MINI_MVP_COLLECTION_SIZES,
  );
  assert.equal(flattenLevel3MiniMvpManifest().length, 131);
});

test('pins four subclasses for every base class', () => {
  const counts = new Map();
  for (const subclass of LEVEL3_MINI_MVP_MANIFEST.collections.subclasses) {
    const parent = subclass.expected.parentCardNumber;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  assert.equal(counts.size, 12);
  assert.ok([...counts.values()].every((count) => count === 4));
});

test('pins only level-2 spells and level-3 species unlocks', () => {
  assert.ok(LEVEL3_MINI_MVP_MANIFEST.collections.secondLevelSpells.every((entry) => entry.expected.level === 2));
  assert.ok(LEVEL3_MINI_MVP_MANIFEST.collections.speciesUnlocks.every((entry) => entry.expected.level === 3));
});
