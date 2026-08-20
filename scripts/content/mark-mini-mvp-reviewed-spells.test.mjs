import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEWED_SPELL_SUPPORT_SPECS,
  planReviewedSpellSupport,
} from './mark-mini-mvp-reviewed-spells.mjs';

function reviewedRows() {
  return REVIEWED_SPELL_SUPPORT_SPECS.map((spec) => ({
    id: `id:${spec.cardNumber}`,
    card_number: spec.cardNumber,
    name: spec.name,
    mechanics: spec.mechanics,
  }));
}

test('reviewed spell support covers five exact evidence packages without duplicates', () => {
  assert.equal(REVIEWED_SPELL_SUPPORT_SPECS.length, 17);
  assert.equal(new Set(REVIEWED_SPELL_SUPPORT_SPECS.map((spec) => spec.cardNumber)).size, 17);
  assert.deepEqual(
    [...new Set(REVIEWED_SPELL_SUPPORT_SPECS.map((spec) => spec.group))].sort(),
    ['cantrip-primitives', 'control-spells', 'level1-riders', 'ongoing-spells', 'traversal-spells'],
  );
  assert.ok(REVIEWED_SPELL_SUPPORT_SPECS.every((spec) => (
    spec.limitations.some((text) => text.includes('реальный лист'))
  )));
});

test('support plan rejects mechanics drift instead of certifying it', () => {
  assert.equal(planReviewedSpellSupport(reviewedRows()).length, 17);
  const drifted = reviewedRows();
  drifted[0] = { ...drifted[0], mechanics: { activation: { mode: 'active' }, effects: [] } };
  assert.throws(() => planReviewedSpellSupport(drifted), /differ from reviewed postimage/);
});
