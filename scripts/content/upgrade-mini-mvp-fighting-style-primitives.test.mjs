import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMiniMvpFightingStylePlanUnlocked,
  MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES,
  planMiniMvpFightingStylePrimitiveUpgrade,
} from './upgrade-mini-mvp-fighting-style-primitives.mjs';

test('four narrative Fighting Styles receive reusable executable primitives', () => {
  assert.equal(MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES.length, 4);
  assert.equal(new Set(MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES.map((item) => item.cardNumber)).size, 4);
  for (const patch of MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash, patch.cardNumber);
    assert.doesNotMatch(JSON.stringify(patch.mechanics), /"kind":"narrative"/u);
  }
});

test('Fighting Style primitive planner is exact, idempotent, drift-sensitive, and lock-aware', () => {
  const after = MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES.map((patch, index) => ({
    id: `effect-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
    support: null,
  }));
  assert.ok(planMiniMvpFightingStylePrimitiveUpgrade(after).every((item) => !item.changeRequired));
  assert.throws(
    () => planMiniMvpFightingStylePrimitiveUpgrade(after.slice(1)),
    new RegExp(`${MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES[0].cardNumber}: expected exactly one`),
  );
  assert.throws(
    () => planMiniMvpFightingStylePrimitiveUpgrade(after.map((item, index) => (
      index === 0 ? { ...item, mechanics: { activation: { mode: 'active' } } } : item
    ))),
    /mechanics drift/,
  );
  assert.throws(
    () => assertMiniMvpFightingStylePlanUnlocked([{
      cardNumber: 'fs_dueling', changeRequired: true, support: { mechanics_locked: true },
    }]),
    /Locked mechanics must be revoked/,
  );
});
