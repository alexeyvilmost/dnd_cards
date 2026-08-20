import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINI_MVP_CONTROL_SPELL_PATCHES,
  assertMiniMvpControlSpellPlanUnlocked,
  planMiniMvpControlSpellUpgrade,
} from './upgrade-mini-mvp-control-spells.mjs';

function kinds(value, result = []) {
  if (Array.isArray(value)) value.forEach((candidate) => kinds(candidate, result));
  else if (value && typeof value === 'object') {
    if (typeof value.kind === 'string') result.push(value.kind);
    Object.values(value).forEach((candidate) => kinds(candidate, result));
  }
  return result;
}

test('control spell patches pin reusable executable primitives and limitations', () => {
  assert.equal(MINI_MVP_CONTROL_SPELL_PATCHES.length, 3);
  const allKinds = MINI_MVP_CONTROL_SPELL_PATCHES.flatMap((patch) => kinds(patch.mechanics));
  assert.ok(allKinds.includes('condition_immunity'));
  assert.ok(allKinds.includes('turn_command'));
  assert.ok(allKinds.includes('targeting_ward'));
  assert.ok(allKinds.includes('narrative'));
  for (const patch of MINI_MVP_CONTROL_SPELL_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash);
  }
});

test('control spell planner is exact, idempotent, drift-sensitive, and lock-aware', () => {
  const after = MINI_MVP_CONTROL_SPELL_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
    support: index === 1 ? { mechanics_locked: true } : null,
  }));
  const plan = planMiniMvpControlSpellUpgrade(after);
  assert.ok(plan.every((item) => !item.changeRequired));
  assert.doesNotThrow(() => assertMiniMvpControlSpellPlanUnlocked(plan));
  assert.throws(
    () => assertMiniMvpControlSpellPlanUnlocked([{ ...plan[1], changeRequired: true }]),
    /SPELL-0272/,
  );
  assert.throws(
    () => planMiniMvpControlSpellUpgrade(after.map((spell, index) => (
      index === 2 ? { ...spell, mechanics: {} } : spell
    ))),
    /mechanics drift/,
  );
});
