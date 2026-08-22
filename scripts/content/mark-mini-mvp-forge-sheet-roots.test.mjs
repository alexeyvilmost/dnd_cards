import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForgeSheetRootCertificationBatch,
  forgeSheetRootCoverageProblems,
  forgeSheetRootSupportPayload,
  planForgeSheetRootSupport,
} from './mark-mini-mvp-forge-sheet-roots.mjs';
import { buildCertificationIndex } from './certification-hash.mjs';
import { flattenMiniMvpManifest } from './mini-mvp-manifest.mjs';
import { flattenMiniMvpSpeciesVariants } from './mini-mvp-manifest.mjs';

const ROOT_COLLECTIONS = new Set(['classes', 'species', 'backgrounds', 'originFeats']);

function fixture(blockedCard = null) {
  const entries = [
    ...flattenMiniMvpManifest().filter((entry) => ROOT_COLLECTIONS.has(entry.collection)),
    ...flattenMiniMvpSpeciesVariants(),
  ];
  const records = entries.map((entry) => ({
    key: entry.key,
    cardNumber: entry.selector.cardNumber,
    expectedName: entry.label,
    entityType: entry.collection === 'speciesLineages' ? 'race' : entry.entityType,
    entityId: `id:${entry.selector.cardNumber}`,
    issues: entry.selector.cardNumber === blockedCard
      ? [{ kind: 'data', code: 'name_mismatch', message: 'drift' }]
      : [{ kind: 'certification', code: 'content_hash_stale', message: 'expected' }],
  }));
  const catalogs = {};
  for (const record of records) {
    (catalogs[record.entityType] ??= []).push({
      id: record.entityId,
      card_number: record.cardNumber,
    });
  }
  return { report: { records }, catalogs };
}

test('checked-in Forge fixture covers every mini-MVP root entity', () => {
  assert.deepEqual(forgeSheetRootCoverageProblems(), []);
  const ready = fixture();
  assert.equal(planForgeSheetRootSupport(ready.report, ready.catalogs).length, 72);
});

test('support plan fails closed on structural drift', () => {
  const blocked = fixture('CLASS-wizard');
  assert.throws(
    () => planForgeSheetRootSupport(blocked.report, blocked.catalogs),
    /CLASS-wizard: root is not structurally clean/,
  );
});

test('Forge/sheet support remains partial and unlocked', () => {
  const entity = { id: 'class-id', card_number: 'CLASS-test' };
  const payload = forgeSheetRootSupportPayload(
    entity,
    'class',
    buildCertificationIndex({ class: [entity] }),
    '2026-08-22T00:00:00.000Z',
  );
  assert.equal(payload.status, 'verified_partial');
  assert.deepEqual(payload.test_coverage, {
    schema_version: 1,
    scope: 'mini-mvp-forge-sheet-v2',
    required: 3,
    passed: 3,
    percent: 100,
  });
  assert.equal(payload.mechanics_locked, false);
  assert.equal(payload.certified_at, '2026-08-22T00:00:00.000Z');
});

test('Forge/sheet support is applied as one deterministic exact batch', () => {
  const record = {
    entityType: 'race',
    entity: { id: '00000000-0000-4000-8000-000000000001', support: null },
    support: {
      status: 'verified_partial',
      certified_at: '2026-08-22T00:00:00.000Z',
    },
  };
  const batch = buildForgeSheetRootCertificationBatch([record], 'fixed-operation');
  assert.equal(batch.mode, 'certification_apply');
  assert.equal(batch.operation_id, 'mini-mvp-forge-sheet:fixed-operation');
  assert.equal(batch.expected_count, 1);
  assert.deepEqual(batch.entries, [{
    entity_type: 'race',
    entity_id: record.entity.id,
    expected_current: record.entity,
    support: record.support,
  }]);
  assert.match(batch.plan_hash, /^sha256:[a-f0-9]{64}$/);
});
