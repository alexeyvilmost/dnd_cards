import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINI_MVP_COLLECTION_SIZES,
  MINI_MVP_MANIFEST,
  flattenMiniMvpManifest,
  validateMiniMvpManifest,
} from './mini-mvp-manifest.mjs';
import { flattenMicroMvpManifest } from './micro-mvp-manifest.mjs';

test('mini-MVP manifest pins the exact PHB 2024 level-1 denominator', () => {
  assert.deepEqual(validateMiniMvpManifest(), []);
  assert.deepEqual(MINI_MVP_COLLECTION_SIZES, {
    classes: 12,
    species: 10,
    backgrounds: 16,
    originFeats: 10,
    fightingStyles: 10,
    cantrips: 34,
    firstLevelSpells: 64,
  });
  assert.equal(flattenMiniMvpManifest().length, 156);
});

test('mini-MVP is a strict superset of every micro-MVP stable selector', () => {
  const miniSelectors = new Set(flattenMiniMvpManifest().map((item) => item.selector.cardNumber));
  const missing = flattenMicroMvpManifest()
    .map((item) => item.selector.cardNumber)
    .filter((cardNumber) => !miniSelectors.has(cardNumber));
  assert.deepEqual(missing, []);
});

test('spell and feat entries pin level/category and PHB source', () => {
  for (const item of flattenMiniMvpManifest()) {
    assert.equal(item.expected.source, 'PHB 2024', item.key);
    if (item.collection === 'cantrips') assert.equal(item.expected.level, 0, item.key);
    if (item.collection === 'firstLevelSpells') assert.equal(item.expected.level, 1, item.key);
    if (item.collection === 'originFeats') assert.equal(item.expected.category, 'origin', item.key);
    if (item.collection === 'fightingStyles') {
      assert.equal(item.expected.category, 'fighting_style', item.key);
    }
  }
  assert.equal(MINI_MVP_MANIFEST.sourceTrack, 'phb-2024');
});

