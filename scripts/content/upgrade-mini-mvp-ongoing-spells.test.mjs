import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINI_MVP_ONGOING_SPELL_PATCHES,
  planMiniMvpOngoingSpellUpgrade,
} from './upgrade-mini-mvp-ongoing-spells.mjs';

function payloadKinds(mechanics) {
  const result = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.kind === 'string') result.push(value.kind);
    Object.values(value).forEach(visit);
  };
  visit(mechanics.effects);
  return result;
}

test('ongoing spell patch uses reusable executable primitives', () => {
  assert.equal(MINI_MVP_ONGOING_SPELL_PATCHES.length, 3);
  assert.equal(new Set(MINI_MVP_ONGOING_SPELL_PATCHES.map((item) => item.cardNumber)).size, 3);
  for (const patch of MINI_MVP_ONGOING_SPELL_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash, patch.cardNumber);
    assert.ok(payloadKinds(patch.mechanics).some((kind) => kind !== 'narrative'));
    assert.ok(Array.isArray(patch.mechanics.spell_class_list_ids));
    assert.equal(patch.mechanics.targeting.range, undefined);
  }
  assert.ok(payloadKinds(
    MINI_MVP_ONGOING_SPELL_PATCHES.find((patch) => patch.cardNumber === 'SPELL-0181').mechanics,
  ).includes('triggered_effect'));
});

test('ongoing spell planner rejects drift and is idempotent', () => {
  const after = MINI_MVP_ONGOING_SPELL_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
  }));
  assert.ok(planMiniMvpOngoingSpellUpgrade(after).every((item) => !item.changeRequired));
  assert.throws(
    () => planMiniMvpOngoingSpellUpgrade(after.map((spell, index) => (
      index === 0 ? { ...spell, mechanics: { activation: {} } } : spell
    ))),
    /mechanics drift/,
  );
});
