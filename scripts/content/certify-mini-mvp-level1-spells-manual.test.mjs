import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManualLevel1SpellSupportBatch,
  MANUAL_LEVEL1_SUPPORT_VERSION,
  planManualLevel1SpellSupport,
} from './certify-mini-mvp-level1-spells-manual.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

function catalogs() {
  return {
    spell: MINI_MVP_MANIFEST.collections.firstLevelSpells.map((entry, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      card_number: entry.selector.cardNumber,
      name: entry.label,
      level: 1,
      source: 'PHB 2024',
      mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] } },
      support: {
        status: index === 0 ? 'verified_mechanical' : 'verified_partial',
        limitations: index === 0 ? [] : ['Existing declared boundary'],
      },
    })),
  };
}

test('manual level-1 plan pins all 64 exact rows and three review dimensions', () => {
  const records = planManualLevel1SpellSupport(catalogs(), '2026-09-01T09:00:00Z');
  assert.equal(records.length, 64);
  assert.ok(records.every(({ support }) => (
    support.certification_version === MANUAL_LEVEL1_SUPPORT_VERSION
      && support.status.startsWith('verified_')
      && support.test_coverage.required === 3
      && support.test_coverage.passed === 3
      && support.test_coverage.percent === 100
      && support.content_hash.startsWith('sha256:')
      && support.dependency_hash.startsWith('sha256:')
  )));
  assert.equal(records[0].support.status, 'verified_mechanical');
  assert.deepEqual(records[1].support.limitations, ['Existing declared boundary']);
});

test('manual level-1 batch uses exact current entity preimages', () => {
  const records = planManualLevel1SpellSupport(catalogs(), '2026-09-01T09:00:00Z');
  const batch = buildManualLevel1SpellSupportBatch(records, 'fixed-id');
  assert.equal(batch.expected_count, 64);
  assert.equal(batch.entries.length, 64);
  assert.equal(batch.operation_id, 'manual-level1-spells:fixed-id');
  assert.ok(batch.entries.every((entry, index) => (
    entry.entity_type === 'spell'
      && entry.entity_id === records[index].entity.id
      && entry.expected_current === records[index].entity
      && entry.support === records[index].support
  )));
});

test('manual level-1 plan gives legacy partial rows an explicit limitation', () => {
  const input = catalogs();
  input.spell[1].support.limitations = [];
  const records = planManualLevel1SpellSupport(input, '2026-09-01T09:00:00Z');
  assert.equal(records[1].support.status, 'verified_partial');
  assert.equal(records[1].support.limitations.length, 1);
  assert.match(records[1].support.limitations[0], /ручного разрешения/);
});

test('manual level-1 plan never unlocks an existing mechanics lock', () => {
  const input = catalogs();
  input.spell[2].support.mechanics_locked = true;
  const records = planManualLevel1SpellSupport(input, '2026-09-01T09:00:00Z');
  assert.equal(records[2].changeRequired, false);
  assert.strictEqual(records[2].support, input.spell[2].support);
});

test('manual level-1 plan fails closed on missing, duplicate, or renamed rows', () => {
  const missing = catalogs();
  missing.spell.pop();
  assert.throws(
    () => planManualLevel1SpellSupport(missing, '2026-09-01T09:00:00Z'),
    /expected one live level-1 spell, got 0/,
  );
  const duplicate = catalogs();
  duplicate.spell.push({ ...duplicate.spell[0], id: '00000000-0000-4000-8000-999999999999' });
  assert.throws(
    () => planManualLevel1SpellSupport(duplicate, '2026-09-01T09:00:00Z'),
    /expected one live level-1 spell, got 2/,
  );
  const renamed = catalogs();
  renamed.spell[0].name = 'Renamed';
  assert.throws(
    () => planManualLevel1SpellSupport(renamed, '2026-09-01T09:00:00Z'),
    /expected «.+», got «Renamed»/,
  );
});
