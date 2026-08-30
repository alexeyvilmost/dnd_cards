import test from 'node:test';
import assert from 'node:assert/strict';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';
import {
  buildMiniMvpSpellActivationSupportBatch,
  planMiniMvpSpellActivationSupport,
} from './mark-mini-mvp-spell-activation.mjs';

function catalogs(status = null) {
  const entries = [
    ...MINI_MVP_MANIFEST.collections.cantrips,
    ...MINI_MVP_MANIFEST.collections.firstLevelSpells,
  ];
  return {
    spell: entries.map((entry, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      card_number: entry.selector.cardNumber,
      name: entry.label,
      level: entry.expected.level,
      mechanics: { activation: { mode: 'active', cost: [] }, effects: [] },
      support: status ? { status } : null,
    })),
  };
}

test('activation support plan covers the exact 34 + 64 denominator', () => {
  const plan = planMiniMvpSpellActivationSupport(catalogs(), '2026-08-30T08:00:00Z');
  assert.equal(plan.length, 98);
  assert.equal(plan.filter((entry) => entry.entity.level === 0).length, 34);
  assert.equal(plan.filter((entry) => entry.entity.level === 1).length, 64);
  assert.ok(plan.every((entry) => entry.changeRequired));
  assert.ok(plan.every((entry) => entry.support.status === 'verified_partial'));
});

test('existing verified support is preserved and exact batch targets only pending rows', () => {
  const existing = planMiniMvpSpellActivationSupport(
    catalogs('verified_mechanical'), '2026-08-30T08:00:00Z',
  );
  assert.ok(existing.every((entry) => !entry.changeRequired));
  const pending = planMiniMvpSpellActivationSupport(catalogs(), '2026-08-30T08:00:00Z').slice(0, 2);
  const batch = buildMiniMvpSpellActivationSupportBatch(pending, 'test-operation');
  assert.equal(batch.expected_count, 2);
  assert.equal(batch.entries.length, 2);
  assert.match(batch.plan_hash, /^sha256:[0-9a-f]{64}$/);
});
