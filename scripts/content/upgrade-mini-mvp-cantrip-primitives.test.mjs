import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINI_MVP_CANTRIP_PRIMITIVE_PATCHES,
  planMiniMvpCantripPrimitiveUpgrade,
} from './upgrade-mini-mvp-cantrip-primitives.mjs';

function mechanicsKinds(mechanics) {
  const kinds = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.kind === 'string') kinds.push(value.kind);
    Object.values(value).forEach(visit);
  };
  visit(mechanics.effects);
  return kinds;
}

test('mini-MVP cantrip patch replaces four known narrative stubs with reusable payloads', () => {
  assert.equal(MINI_MVP_CANTRIP_PRIMITIVE_PATCHES.length, 4);
  assert.equal(new Set(MINI_MVP_CANTRIP_PRIMITIVE_PATCHES.map((item) => item.cardNumber)).size, 4);
  for (const patch of MINI_MVP_CANTRIP_PRIMITIVE_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash, patch.cardNumber);
    assert.ok(mechanicsKinds(patch.mechanics).some((kind) => kind !== 'narrative'), patch.cardNumber);
  }
});

test('planner is exact, drift-sensitive, and idempotent', () => {
  const before = MINI_MVP_CANTRIP_PRIMITIVE_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: null,
  }));
  // Replace canonical hash calculation with the exact reviewed preimage by
  // first checking the stricter unknown-drift branch on synthetic content.
  assert.throws(() => planMiniMvpCantripPrimitiveUpgrade(before), /mechanics drift/);

  const after = MINI_MVP_CANTRIP_PRIMITIVE_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
  }));
  assert.ok(planMiniMvpCantripPrimitiveUpgrade(after).every((item) => !item.changeRequired));
  assert.throws(
    () => planMiniMvpCantripPrimitiveUpgrade(after.slice(1)),
    new RegExp(`${MINI_MVP_CANTRIP_PRIMITIVE_PATCHES[0].cardNumber}: expected exactly one`),
  );
});

