import test from 'node:test';
import assert from 'node:assert/strict';
import { planStructuralBaselineRepair } from './repair-mini-mvp-structural-baseline.mjs';

function catalogs(overrides = {}) {
  return {
    class: [
      { id: 'barbarian', card_number: 'CLASS-barbarian', name: 'Варвар', source: null },
      { id: 'monk', card_number: 'CLASS-monk', name: 'Монах', source: null },
    ],
    race: [{
      id: 'halfling',
      card_number: 'RACE-0006',
      name: 'Полурослик',
      source: 'PHB 2024',
      lineages: [{ name: 'Легконогий' }, { name: 'Крепкий' }],
    }],
    ...overrides,
  };
}

test('structural repair plans the two missing sources and legacy halfling lineages', () => {
  const plan = planStructuralBaselineRepair(catalogs());
  assert.deepEqual(plan.map((item) => [item.cardNumber, item.patch]), [
    ['CLASS-barbarian', { source: 'PHB 2024' }],
    ['CLASS-monk', { source: 'PHB 2024' }],
    ['RACE-0006', { lineages: [] }],
  ]);
});

test('structural repair is idempotent on the expected PHB 2024 postimage', () => {
  const ready = catalogs();
  ready.class.forEach((entity) => { entity.source = 'PHB 2024'; });
  ready.race[0].lineages = [];
  assert.deepEqual(planStructuralBaselineRepair(ready), []);
});

test('structural repair refuses an unknown source or lineage preimage', () => {
  const wrongSource = catalogs();
  wrongSource.class[0].source = 'Homebrew';
  assert.throws(() => planStructuralBaselineRepair(wrongSource), /refusing unexpected source/);

  const wrongLineage = catalogs();
  wrongLineage.race[0].lineages = [{ name: 'Неизвестный' }];
  assert.throws(() => planStructuralBaselineRepair(wrongLineage), /refusing unexpected lineages/);
});
