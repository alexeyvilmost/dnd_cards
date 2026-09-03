import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEVEL5_MINI_MVP_COLLECTION_SIZES,
  LEVEL5_MINI_MVP_MANIFEST,
  flattenLevel5MiniMvpManifest,
  validateLevel5MiniMvpManifest,
} from './level5-mini-mvp-manifest.mjs';

test('pins the exact PHB 2024 denominator through character level 5', () => {
  assert.deepEqual(validateLevel5MiniMvpManifest(), []);
  assert.deepEqual(
    Object.fromEntries(Object.entries(LEVEL5_MINI_MVP_MANIFEST.collections).map(([key, values]) => [key, values.length])),
    LEVEL5_MINI_MVP_COLLECTION_SIZES,
  );
  assert.equal(flattenLevel5MiniMvpManifest().length, 266);
});

test('keeps four level-3 subclasses for every base class through level 5', () => {
  const counts = new Map();
  for (const subclass of LEVEL5_MINI_MVP_MANIFEST.collections.subclasses) {
    const parent = subclass.expected.parentCardNumber;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
    assert.equal(subclass.expected.unlockLevel, 3);
    assert.equal(subclass.expected.throughLevel, 5);
  }
  assert.equal(counts.size, 12);
  assert.ok([...counts.values()].every((count) => count === 4));
});

test('pins all twelve level-4 Ability Score Improvement gates', () => {
  const gates = LEVEL5_MINI_MVP_MANIFEST.collections.baseClassFeatureGates;
  const asi = gates.filter((entry) => entry.selector.featureKey === 'ability-score-improvement');
  assert.equal(asi.length, 12);
  assert.equal(new Set(asi.map((entry) => entry.selector.parentCardNumber)).size, 12);
  assert.ok(asi.every((entry) => entry.selector.level === 4));
});

test('pins the five level-5 Extra Attack classes and their two-attack contract', () => {
  const extraAttack = LEVEL5_MINI_MVP_MANIFEST.collections.baseClassFeatureGates
    .filter((entry) => entry.selector.featureKey === 'extra-attack');
  assert.deepEqual(
    extraAttack.map((entry) => entry.selector.parentCardNumber).sort(),
    ['CLASS-barbarian', 'CLASS-monk', 'CLASS-paladin', 'CLASS-ranger', 'CLASS-warrior'].sort(),
  );
  assert.ok(extraAttack.every((entry) => entry.expected.attacksPerAttackAction === 2));
});

test('pins seven level-3 and eight level-5 species unlocks', () => {
  const counts = new Map();
  for (const entry of LEVEL5_MINI_MVP_MANIFEST.collections.speciesUnlocks) {
    counts.set(entry.expected.level, (counts.get(entry.expected.level) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), { 3: 7, 5: 8 });
});

test('pins every level-4 General feat as its own certification row', () => {
  const feats = LEVEL5_MINI_MVP_MANIFEST.collections.generalFeats;
  assert.equal(feats.length, 43);
  assert.equal(new Set(feats.map((entry) => entry.selector.cardNumber)).size, 43);
  assert.deepEqual(
    feats.map((entry) => entry.selector.cardNumber),
    Array.from({ length: 43 }, (_, index) => `FEAT-${String(index + 11).padStart(4, '0')}`),
  );
  assert.ok(feats.every((entry) => entry.expected.category === 'general' && entry.expected.unlockLevel === 4));
});

test('pins 63 level-2 and 52 level-3 PHB spells and excludes both homebrew rows', () => {
  const level2 = LEVEL5_MINI_MVP_MANIFEST.collections.secondLevelSpells;
  const level3 = LEVEL5_MINI_MVP_MANIFEST.collections.thirdLevelSpells;
  assert.ok(level2.every((entry) => entry.expected.level === 2));
  assert.ok(level3.every((entry) => entry.expected.level === 3));
  const cards = new Set([...level2, ...level3].map((entry) => entry.selector.cardNumber));
  assert.equal(cards.has('SPELL-0483'), false);
  assert.equal(cards.has('SPELL-0485'), false);
});
