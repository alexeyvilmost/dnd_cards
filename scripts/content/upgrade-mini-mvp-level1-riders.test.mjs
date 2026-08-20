import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINI_MVP_LEVEL1_RIDER_PATCHES,
  planMiniMvpLevel1RiderUpgrade,
} from './upgrade-mini-mvp-level1-riders.mjs';

function payloads(mechanics) {
  const result = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.kind === 'string') result.push(value);
    Object.values(value).forEach(visit);
  };
  visit(mechanics.effects);
  return result;
}

test('level-1 rider patch is exact and uses reusable typed primitives', () => {
  assert.equal(MINI_MVP_LEVEL1_RIDER_PATCHES.length, 4);
  assert.equal(new Set(MINI_MVP_LEVEL1_RIDER_PATCHES.map((item) => item.cardNumber)).size, 4);
  for (const patch of MINI_MVP_LEVEL1_RIDER_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash, patch.cardNumber);
    assert.ok(payloads(patch.mechanics).some((payload) => payload.kind !== 'narrative'));
    assert.ok(Array.isArray(patch.mechanics.spell_class_list_ids));
    assert.equal(patch.mechanics.targeting.range, undefined);
  }
  const riderSpells = MINI_MVP_LEVEL1_RIDER_PATCHES.filter((patch) => (
    payloads(patch.mechanics).some((payload) => payload.kind === 'damage_rider')
  ));
  assert.deepEqual(riderSpells.map((patch) => patch.cardNumber).sort(), [
    'SPELL-0165', 'SPELL-0223', 'SPELL-0287',
  ]);
});

test('level-1 rider planner rejects drift and is idempotent', () => {
  const after = MINI_MVP_LEVEL1_RIDER_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
  }));
  assert.ok(planMiniMvpLevel1RiderUpgrade(after).every((item) => !item.changeRequired));
  assert.throws(
    () => planMiniMvpLevel1RiderUpgrade(after.map((spell, index) => (
      index === 0 ? { ...spell, mechanics: { activation: {} } } : spell
    ))),
    /mechanics drift/,
  );
});
