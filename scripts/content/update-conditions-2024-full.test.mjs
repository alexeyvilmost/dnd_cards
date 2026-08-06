import test from 'node:test';
import assert from 'node:assert/strict';
import { PHB_2024_CONDITION_ROWS } from './update-conditions-2024-full.mjs';

test('full condition migration has the exact 15 stable PHB 2024 rows', () => {
  assert.deepEqual(PHB_2024_CONDITION_ROWS.map((row) => row.card_number).sort(), [
    'COND-blinded', 'COND-charmed', 'COND-deafened', 'COND-exhaustion',
    'COND-frightened', 'COND-grappled', 'COND-incapacitated', 'COND-invisible',
    'COND-paralyzed', 'COND-petrified', 'COND-poisoned', 'COND-prone',
    'COND-restrained', 'COND-stunned', 'COND-unconscious',
  ]);
  assert.equal(new Set(PHB_2024_CONDITION_ROWS.map((row) => row.card_number)).size, 15);
  for (const row of PHB_2024_CONDITION_ROWS) {
    assert.ok(row.mechanics.effects[0].result.length > 0, `${row.card_number} mechanics`);
  }
});

test('Unconscious is not composed through Paralyzed', () => {
  const row = PHB_2024_CONDITION_ROWS.find((candidate) => candidate.card_number === 'COND-unconscious');
  assert.deepEqual(row.mechanics.includes, ['incapacitated', 'prone']);
  assert.equal(row.mechanics.includes.includes('paralyzed'), false);
});

test('Exhaustion and Petrified carry their exceptional mechanics as data', () => {
  const exhaustion = PHB_2024_CONDITION_ROWS.find((row) => row.card_number === 'COND-exhaustion');
  assert.deepEqual(exhaustion.mechanics.stacking, { mode: 'levels', max: 6 });
  assert.deepEqual(exhaustion.mechanics.long_rest, { remove_levels: 1 });
  assert.deepEqual(exhaustion.mechanics.thresholds, [{ at_level: 6, outcome: 'death' }]);

  const petrified = PHB_2024_CONDITION_ROWS.find((row) => row.card_number === 'COND-petrified');
  assert.ok(petrified.mechanics.effects[0].result.some((payload) => (
    payload.kind === 'resistance' && payload.damage_type === 'all'
  )));
  assert.ok(petrified.mechanics.effects[0].result.some((payload) => (
    payload.kind === 'condition_immunity' && payload.condition === 'poisoned'
  )));
});

test('distance, visibility and speech clauses are explicit data primitives', () => {
  const payloads = (cardNumber) => PHB_2024_CONDITION_ROWS
    .find((row) => row.card_number === cardNumber).mechanics.effects[0].result;

  for (const cardNumber of ['COND-paralyzed', 'COND-prone', 'COND-unconscious']) {
    assert.ok(payloads(cardNumber).some((payload) => (
      payload.when?.some((predicate) => predicate.kind === 'distance_to_condition_owner')
    )), `${cardNumber} must use an explicit distance fact`);
    assert.equal(payloads(cardNumber).some((payload) => payload.range != null), false);
  }

  const invisible = payloads('COND-invisible').filter((payload) => payload.applies_to?.roll === 'attack');
  assert.equal(invisible.length, 2);
  assert.ok(invisible.every((payload) => (
    payload.when?.some((predicate) => predicate.kind === 'observer_can_see_condition_owner')
  )));

  assert.ok(payloads('COND-incapacitated').some((payload) => (
    payload.op === 'deny' && payload.applies_to?.roll === 'speech'
  )));
});
