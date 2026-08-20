import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MINI_MVP_UTILITY_CANTRIP_PATCHES,
  MINI_MVP_SHILLELAGH_WEAPON_PATCHES,
  assertMiniMvpUtilityCantripPlanUnlocked,
  planMiniMvpUtilityCantripUpgrade,
  planMiniMvpShillelaghWeaponUpgrade,
} from './upgrade-mini-mvp-utility-cantrips.mjs';

function kinds(value, result = []) {
  if (Array.isArray(value)) value.forEach((candidate) => kinds(candidate, result));
  else if (value && typeof value === 'object') {
    if (typeof value.kind === 'string') result.push(value.kind);
    Object.values(value).forEach((candidate) => kinds(candidate, result));
  }
  return result;
}

test('utility cantrip patches pin reusable executable primitives and explicit adapter gaps', () => {
  assert.equal(MINI_MVP_UTILITY_CANTRIP_PATCHES.length, 5);
  const allKinds = MINI_MVP_UTILITY_CANTRIP_PATCHES.flatMap((patch) => kinds(patch.mechanics));
  for (const kind of [
    'remote_manipulator', 'weapon_enchantment', 'communication_link',
    'world_interaction', 'stabilize',
  ]) assert.ok(allKinds.includes(kind), `missing ${kind}`);
  assert.ok(allKinds.includes('narrative'));
  for (const patch of MINI_MVP_UTILITY_CANTRIP_PATCHES) {
    assert.notEqual(patch.expectedBeforeHash, patch.expectedAfterHash);
  }
});

test('Shillelagh weapon profile patches cover every explicit live club/quarterstaff Card', () => {
  assert.equal(MINI_MVP_SHILLELAGH_WEAPON_PATCHES.length, 4);
  const after = MINI_MVP_SHILLELAGH_WEAPON_PATCHES.map((patch, index) => ({
    id: `card-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
  }));
  assert.ok(planMiniMvpShillelaghWeaponUpgrade(after).every((item) => !item.changeRequired));
  assert.throws(
    () => planMiniMvpShillelaghWeaponUpgrade(after.map((card, index) => (
      index === 2 ? { ...card, mechanics: {} } : card
    ))),
    /mechanics drift/,
  );
});

test('utility cantrip planner is exact, idempotent, drift-sensitive, and lock-aware', () => {
  const after = MINI_MVP_UTILITY_CANTRIP_PATCHES.map((patch, index) => ({
    id: `spell-${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
    support: index === 0 ? { mechanics_locked: true } : null,
  }));
  const plan = planMiniMvpUtilityCantripUpgrade(after);
  assert.ok(plan.every((item) => !item.changeRequired));
  assert.doesNotThrow(() => assertMiniMvpUtilityCantripPlanUnlocked(plan));
  assert.throws(
    () => assertMiniMvpUtilityCantripPlanUnlocked([{ ...plan[0], changeRequired: true }]),
    /SPELL-0173/,
  );
  assert.throws(
    () => planMiniMvpUtilityCantripUpgrade(after.map((spell, index) => (
      index === 4 ? { ...spell, mechanics: {} } : spell
    ))),
    /mechanics drift/,
  );
});
