import test from 'node:test';
import assert from 'node:assert/strict';
import definitions from './data/mini-mvp-utility-level1-spells.v1.json' with { type: 'json' };
import {
  MINI_MVP_UTILITY_LEVEL1_PATCHES,
  assertMiniMvpUtilityLevel1PlanUnlocked,
  planMiniMvpUtilityLevel1Upgrade,
} from './upgrade-mini-mvp-utility-level1-spells.mjs';

function liveRows(mechanicsByCardNumber = {}) {
  return definitions.map((definition) => ({
    id: `id:${definition.card_number}`,
    card_number: definition.card_number,
    name: definition.name,
    mechanics: mechanicsByCardNumber[definition.card_number] ?? definition.mechanics,
    support: null,
  }));
}

test('utility level-1 manifest pins all remaining narrative-only spells', () => {
  assert.equal(MINI_MVP_UTILITY_LEVEL1_PATCHES.length, 13);
  assert.equal(new Set(MINI_MVP_UTILITY_LEVEL1_PATCHES.map((item) => item.cardNumber)).size, 13);
  assert.ok(MINI_MVP_UTILITY_LEVEL1_PATCHES.every((item) => item.expectedBeforeHash !== item.expectedAfterHash));
});

test('upgrade planner accepts only exact reviewed postimages', () => {
  const plan = planMiniMvpUtilityLevel1Upgrade(liveRows());
  assert.ok(plan.every((item) => item.changeRequired === false));
  const drifted = liveRows({
    'SPELL-0161': { activation: { mode: 'active' }, effects: [] },
  });
  assert.throws(() => planMiniMvpUtilityLevel1Upgrade(drifted), /mechanics drift/);
});

test('upgrade refuses to overwrite a locked row', () => {
  assert.throws(() => assertMiniMvpUtilityLevel1PlanUnlocked([{
    cardNumber: 'SPELL-0161',
    changeRequired: true,
    support: { mechanics_locked: true },
  }]), /Locked mechanics/);
});
