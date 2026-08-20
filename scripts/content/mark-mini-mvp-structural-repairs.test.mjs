import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planStructuralRepairSupport,
  STRUCTURAL_REPAIR_SUPPORT_TARGETS,
} from './mark-mini-mvp-structural-repairs.mjs';

function fixture(blockedCard = null) {
  const records = STRUCTURAL_REPAIR_SUPPORT_TARGETS.map((cardNumber) => ({
    key: `key:${cardNumber}`,
    cardNumber,
    expectedName: cardNumber,
    entityType: cardNumber.startsWith('CLASS-') ? 'class' : cardNumber.startsWith('RACE-') ? 'race' : 'feat',
    entityId: `id:${cardNumber}`,
    issues: cardNumber === blockedCard
      ? [{ kind: 'data', code: 'name_mismatch', message: 'drift' }]
      : [{ kind: 'certification', code: 'content_hash_stale', message: 'expected after repair' }],
  }));
  const catalogs = {};
  for (const record of records) {
    (catalogs[record.entityType] ??= []).push({ id: record.entityId, card_number: record.cardNumber });
  }
  return { report: { records }, catalogs };
}

test('support refresh covers every repaired root only after structural audit is clean', () => {
  const ready = fixture();
  assert.equal(planStructuralRepairSupport(ready.report, ready.catalogs).length, 13);
  const blocked = fixture('RACE-0003');
  assert.throws(
    () => planStructuralRepairSupport(blocked.report, blocked.catalogs),
    /RACE-0003: structural repair is not clean/,
  );
});
