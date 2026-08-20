import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forgeSheetRootCoverageProblems,
  forgeSheetRootSupportPayload,
  planForgeSheetRootSupport,
} from './mark-mini-mvp-forge-sheet-roots.mjs';
import { buildCertificationIndex } from './certification-hash.mjs';
import { flattenMiniMvpManifest } from './mini-mvp-manifest.mjs';

const ROOT_COLLECTIONS = new Set(['classes', 'species', 'backgrounds', 'originFeats']);

function fixture(blockedCard = null) {
  const entries = flattenMiniMvpManifest().filter((entry) => ROOT_COLLECTIONS.has(entry.collection));
  const records = entries.map((entry) => ({
    key: entry.key,
    cardNumber: entry.selector.cardNumber,
    expectedName: entry.label,
    entityType: entry.entityType,
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
  assert.equal(planForgeSheetRootSupport(ready.report, ready.catalogs).length, 48);
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
  );
  assert.equal(payload.status, 'verified_partial');
  assert.deepEqual(payload.test_coverage, {
    schema_version: 1,
    scope: 'mini-mvp-forge-sheet-v1',
    required: 3,
    passed: 2,
    percent: 66,
  });
  assert.equal(payload.mechanics_locked, false);
});
