import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManualCantripSupportBatch,
  MANUAL_CANTRIP_SUPPORT_VERSION,
  planManualCantripSupport,
} from './certify-mini-mvp-cantrips-manual.mjs';
import { EXPECTED_CANTRIP_NAMES } from './cantrips-2024.mjs';

function catalogs() {
  return {
    spell: EXPECTED_CANTRIP_NAMES.map((name, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      card_number: `TEST-${String(index + 1).padStart(4, '0')}`,
      name,
      level: 0,
      source: 'PHB 2024',
      mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] } },
    })),
  };
}

test('manual cantrip plan pins all 35 exact rows and three review dimensions', () => {
  const records = planManualCantripSupport(catalogs(), '2026-09-01T06:00:00Z');
  assert.equal(records.length, 35);
  assert.ok(records.every(({ support }) => (
    support.certification_version === MANUAL_CANTRIP_SUPPORT_VERSION
      && support.status.startsWith('verified_')
      && support.test_coverage.required === 3
      && support.test_coverage.passed === 3
      && support.test_coverage.percent === 100
      && support.content_hash.startsWith('sha256:')
      && support.dependency_hash.startsWith('sha256:')
  )));
});

test('manual cantrip batch uses exact current entity preimages', () => {
  const records = planManualCantripSupport(catalogs(), '2026-09-01T06:00:00Z');
  const batch = buildManualCantripSupportBatch(records, 'fixed-id');
  assert.equal(batch.expected_count, 35);
  assert.equal(batch.entries.length, 35);
  assert.equal(batch.operation_id, 'manual-cantrips:fixed-id');
  assert.ok(batch.entries.every((entry, index) => (
    entry.entity_type === 'spell'
      && entry.entity_id === records[index].entity.id
      && entry.expected_current === records[index].entity
      && entry.support === records[index].support
  )));
});

test('manual cantrip plan fails closed on a missing or duplicate live row', () => {
  const missing = catalogs();
  missing.spell.pop();
  assert.throws(
    () => planManualCantripSupport(missing, '2026-09-01T06:00:00Z'),
    /expected one live level-0 spell, got 0/,
  );
  const duplicate = catalogs();
  duplicate.spell.push({ ...duplicate.spell[0], id: '00000000-0000-4000-8000-999999999999' });
  assert.throws(
    () => planManualCantripSupport(duplicate, '2026-09-01T06:00:00Z'),
    /expected one live level-0 spell, got 2/,
  );
});
