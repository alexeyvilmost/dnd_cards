import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINI_MVP_TRAVERSAL_SPELL_PATCHES,
  planMiniMvpTraversalSpellUpgrade,
} from './upgrade-mini-mvp-traversal-spells.mjs';

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

test('traversal spell patch uses reusable executable primitives', () => {
  assert.equal(MINI_MVP_TRAVERSAL_SPELL_PATCHES.length, 3);
  const allKinds = MINI_MVP_TRAVERSAL_SPELL_PATCHES.flatMap((patch) => payloadKinds(patch.mechanics));
  assert.ok(allKinds.includes('triggered_effect'));
  assert.ok(allKinds.includes('fall_protection'));
  assert.ok(allKinds.includes('movement_option'));
  for (const patch of MINI_MVP_TRAVERSAL_SPELL_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash, patch.cardNumber);
    assert.ok(payloadKinds(patch.mechanics).some((kind) => kind !== 'narrative'));
    assert.ok(Array.isArray(patch.mechanics.spell_class_list_ids));
  }
});

test('traversal spell planner rejects drift and is idempotent', () => {
  const after = MINI_MVP_TRAVERSAL_SPELL_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
  }));
  assert.ok(planMiniMvpTraversalSpellUpgrade(after).every((item) => !item.changeRequired));
  assert.throws(
    () => planMiniMvpTraversalSpellUpgrade(after.map((spell, index) => (
      index === 1 ? { ...spell, mechanics: { activation: {} } } : spell
    ))),
    /mechanics drift/,
  );
});
