import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertForgeSheetRootSupportRunMode,
  buildForgeSheetRootCertificationBatch,
  currentMicroMvpCoveredForgeRootCardNumbers,
  forgeSheetRootCoverageProblems,
  forgeSheetRootSupportPayload,
  forgeSheetRootSupportReadinessProblems,
  planForgeSheetRootSupport,
  selectForgeSheetRootSupportPlan,
} from './mark-mini-mvp-forge-sheet-roots.mjs';
import { buildCertificationIndex, certificationHashes } from './certification-hash.mjs';
import {
  MICRO_MVP_CERTIFICATION_VERSION,
  MICRO_MVP_CONDITION_TARGETS,
} from './micro-mvp-certifications.mjs';
import { currentMicroMvpReleaseIdentity } from './micro-mvp-release-evidence.mjs';
import { flattenMiniMvpManifest } from './mini-mvp-manifest.mjs';
import { flattenMiniMvpSpeciesVariants } from './mini-mvp-manifest.mjs';

const ROOT_COLLECTIONS = new Set(['classes', 'species', 'backgrounds', 'originFeats']);
const ENTITY_TYPE_BY_COLLECTION = {
  classes: 'class',
  species: 'race',
  speciesLineages: 'race',
  backgrounds: 'background',
  originFeats: 'feat',
};

function fixture(blockedCard = null) {
  const entries = [
    ...flattenMiniMvpManifest().filter((entry) => ROOT_COLLECTIONS.has(entry.collection)),
    ...flattenMiniMvpSpeciesVariants(),
  ];
  const records = entries.map((entry) => ({
    key: entry.key,
    cardNumber: entry.selector.cardNumber,
    expectedName: entry.label,
    entityType: ENTITY_TYPE_BY_COLLECTION[entry.collection],
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

function withCurrentMicroEvidence(ready, rootCardNumber) {
  const release = currentMicroMvpReleaseIdentity();
  const envelope = {
    certification_version: MICRO_MVP_CERTIFICATION_VERSION,
    certified_at: '2026-08-28T00:00:00Z',
    evidence_id: '00000000-0000-4000-8000-000000000001',
    evidence_hash: `sha256:${'1'.repeat(64)}`,
    evidence_completed_at: '2026-08-28T00:00:00Z',
    gate_source_hash: release.sourceHash,
    source_content_hash: release.sourceContentHash,
    rules_hash: release.rulesHash,
    release_content_hash: release.contentHash,
    release_hash: release.releaseHash,
    patch_hash: release.patchHash,
    catalog_hash: `sha256:${'2'.repeat(64)}`,
  };
  ready.catalogs.effect = MICRO_MVP_CONDITION_TARGETS.map((target, position) => ({
    id: `condition:${position}`,
    card_number: target.cardNumber,
    name: target.id,
    effect_type: 'condition',
    mechanics: { condition: { id: target.id } },
  }));
  const root = Object.values(ready.catalogs).flat()
    .find((entity) => entity.card_number === rootCardNumber);
  assert.ok(root);
  const index = buildCertificationIndex(ready.catalogs);
  for (const condition of ready.catalogs.effect) {
    const hashes = certificationHashes(condition, 'effect', index);
    condition.support = {
      status: 'verified_mechanical',
      content_hash: hashes.contentHash,
      dependency_hash: hashes.dependencyHash,
      ...envelope,
      limitations: [],
      note: 'Current condition evidence',
      mechanics_locked: true,
      test_coverage: {
        schema_version: 1, scope: 'micro-mvp-l1', required: 1, passed: 1, percent: 100,
      },
    };
  }
  const rootHashes = certificationHashes(root, 'class', index);
  root.support = {
    status: 'verified_partial',
    content_hash: rootHashes.contentHash,
    dependency_hash: rootHashes.dependencyHash,
    ...envelope,
    limitations: ['Level-1 release scope'],
    note: 'Current micro root evidence',
    test_coverage: {
      schema_version: 1, scope: 'micro-mvp-l1', required: 1, passed: 1, percent: 100,
    },
  };
  return root;
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

test('missing-only selection targets one explicit null support and never a non-null support', () => {
  const ready = fixture();
  const plan = planForgeSheetRootSupport(ready.report, ready.catalogs);
  const target = plan.find((item) => item.record.cardNumber === 'RACE-0011-stone');
  assert.ok(target);
  target.entity.support = null;
  assert.deepEqual(
    selectForgeSheetRootSupportPlan(plan, {
      cardNumbers: ['RACE-0011-stone'],
      missingOnly: true,
      expectedCount: 1,
    }),
    [target],
  );

  target.entity.support = { status: 'untested', certification_version: 'revoked-v1' };
  assert.deepEqual(selectForgeSheetRootSupportPlan(plan, {
    cardNumbers: ['RACE-0011-stone'],
    missingOnly: true,
  }), []);
  assert.throws(
    () => selectForgeSheetRootSupportPlan(plan, {
      cardNumbers: ['RACE-0011-stone'],
      missingOnly: true,
      expectedCount: 1,
    }),
    /selected count 0 differs from --expected-count 1/,
  );
});

test('target selection rejects unknown, duplicate, and unexpected denominators', () => {
  const ready = fixture();
  const plan = planForgeSheetRootSupport(ready.report, ready.catalogs);
  assert.throws(
    () => selectForgeSheetRootSupportPlan(plan, { cardNumbers: ['RACE-unknown'] }),
    /not a declared Forge\/sheet root/,
  );
  assert.throws(
    () => selectForgeSheetRootSupportPlan(plan, {
      cardNumbers: ['RACE-0011-stone', 'RACE-0011-stone'],
    }),
    /must be unique/,
  );
  assert.throws(
    () => selectForgeSheetRootSupportPlan(plan, { expectedCount: 71 }),
    /selected count 72 differs from --expected-count 71/,
  );
});

test('apply requires an explicit broad or targeted scope', () => {
  assert.throws(
    () => assertForgeSheetRootSupportRunMode({
      apply: true, all: false, cardNumbers: [], missingOnly: false, checkReady: false,
    }),
    /requires explicit --all, --card-number, or --missing-only scope/,
  );
  assert.doesNotThrow(() => assertForgeSheetRootSupportRunMode({
    apply: true, all: false, cardNumbers: ['RACE-0011-stone'], missingOnly: true,
    checkReady: false,
  }));
  assert.throws(
    () => assertForgeSheetRootSupportRunMode({
      apply: false, all: false, cardNumbers: ['RACE-0011-stone'], missingOnly: false,
      checkReady: true,
    }),
    /--check-ready is read-only/,
  );
});

test('readiness recomputes the exact payload using each existing certified_at', () => {
  const ready = fixture();
  const plan = planForgeSheetRootSupport(ready.report, ready.catalogs);
  const index = buildCertificationIndex(ready.catalogs);
  for (const item of plan) {
    item.entity.support = forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      index,
      '2026-08-22T00:00:00.000Z',
    );
  }
  assert.deepEqual(forgeSheetRootSupportReadinessProblems(plan, ready.catalogs), []);

  const missing = plan.find((item) => item.record.cardNumber === 'RACE-0011-stone');
  assert.ok(missing);
  missing.entity.support = null;
  assert.deepEqual(forgeSheetRootSupportReadinessProblems(plan, ready.catalogs), [
    'RACE-0011-stone: support is missing or invalid',
  ]);

  missing.entity.support = forgeSheetRootSupportPayload(
    missing.entity,
    missing.record.entityType,
    index,
    '2026-08-22T00:00:00.000Z',
  );
  missing.entity.support.status = 'untested';
  assert.match(
    forgeSheetRootSupportReadinessProblems(plan, ready.catalogs)[0],
    /RACE-0011-stone: support is neither exact.*\(status\)/,
  );
});

test('current micro-v4 roots from the condition evidence apply are ready and protected', () => {
  const ready = fixture();
  const microRoot = withCurrentMicroEvidence(ready, 'CLASS-wizard');
  const plan = planForgeSheetRootSupport(ready.report, ready.catalogs);
  const protectedCardNumbers = currentMicroMvpCoveredForgeRootCardNumbers(plan, ready.catalogs);
  assert.deepEqual([...protectedCardNumbers], ['CLASS-wizard']);

  for (const item of plan) {
    if (item.entity === microRoot) continue;
    item.entity.support = forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      buildCertificationIndex(ready.catalogs),
      '2026-08-28T00:00:00Z',
    );
  }
  assert.deepEqual(forgeSheetRootSupportReadinessProblems(plan, ready.catalogs), []);
  assert.equal(selectForgeSheetRootSupportPlan(plan, {
    cardNumbers: ['CLASS-wizard'],
    protectedCardNumbers,
  }).length, 0);
  const safeBroadSelection = selectForgeSheetRootSupportPlan(plan, { protectedCardNumbers });
  assert.equal(safeBroadSelection.length, plan.length - 1);
  assert.equal(safeBroadSelection.some((item) => item.record.cardNumber === 'CLASS-wizard'), false);

  const originalLimitations = microRoot.support.limitations;
  microRoot.support.limitations = ['   '];
  assert.equal(
    currentMicroMvpCoveredForgeRootCardNumbers(plan, ready.catalogs).has('CLASS-wizard'),
    false,
  );
  microRoot.support.limitations = originalLimitations;

  const missingCondition = ready.catalogs.effect.pop();
  assert.ok(missingCondition);
  assert.equal(
    currentMicroMvpCoveredForgeRootCardNumbers(plan, ready.catalogs).has('CLASS-wizard'),
    false,
  );
  ready.catalogs.effect.push(missingCondition);

  microRoot.support.catalog_hash = `sha256:${'f'.repeat(64)}`;
  const staleProtected = currentMicroMvpCoveredForgeRootCardNumbers(plan, ready.catalogs);
  assert.equal(staleProtected.has('CLASS-wizard'), false);
  assert.equal(selectForgeSheetRootSupportPlan(plan, {
    cardNumbers: ['CLASS-wizard'],
    protectedCardNumbers: staleProtected,
  }).length, 1);
  assert.match(
    forgeSheetRootSupportReadinessProblems(plan, ready.catalogs)[0],
    /CLASS-wizard: support is neither exact/,
  );
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

test('one selected missing root produces one exact-CAS batch entry', () => {
  const ready = fixture();
  const plan = planForgeSheetRootSupport(ready.report, ready.catalogs);
  const target = plan.find((item) => item.record.cardNumber === 'RACE-0011-stone');
  assert.ok(target);
  target.entity.support = null;
  const selected = selectForgeSheetRootSupportPlan(plan, {
    cardNumbers: ['RACE-0011-stone'],
    missingOnly: true,
    expectedCount: 1,
  });
  const index = buildCertificationIndex(ready.catalogs);
  const records = selected.map((item) => ({
    entityType: item.record.entityType,
    entity: item.entity,
    support: forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      index,
      '2026-08-22T00:00:00.000Z',
    ),
  }));
  const batch = buildForgeSheetRootCertificationBatch(records, 'one-missing-root');
  assert.equal(batch.expected_count, 1);
  assert.equal(batch.entries[0].entity_id, target.entity.id);
  assert.equal(batch.entries[0].expected_current.support, null);
});
