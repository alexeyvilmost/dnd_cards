import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS,
  REVIEWED_FIGHTING_STYLE_EFFECT_SPECS,
  buildFightingStylePrimitiveReleaseEvidence,
  buildFightingStylePrimitiveCertificationBatch,
  prepareFightingStylePrimitiveCertifications,
} from './certify-mini-mvp-fighting-style-primitives.mjs';

const CERTIFIED_AT = '2026-08-20T13:00:00Z';
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

function fixture() {
  const effects = REVIEWED_FIGHTING_STYLE_EFFECT_SPECS.map((patch, index) => ({
    id: `00000000-0000-4000-8000-0000000001${index}`,
    card_number: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
    support: null,
  }));
  const feats = FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS.map((spec, index) => ({
    id: `00000000-0000-4000-8000-0000000002${index}`,
    card_number: spec.featCardNumber,
    name: spec.featCardNumber,
    related_effects: [effects.find((effect) => effect.card_number === spec.effectCardNumber).id],
    support: null,
  }));
  const catalogs = {
    class: [], race: [], background: [], feat: feats, spell: [], action: [],
    effect: effects, card: [], resource: [], variable: [],
  };
  const report = {
    records: feats.map((feat) => ({
      collection: 'fightingStyles',
      cardNumber: feat.card_number,
      entityId: feat.id,
      issues: [
        { kind: 'certification', code: 'certification_version_mismatch' },
        { kind: 'dependency', code: 'dependency_not_ready' },
      ],
    })),
  };
  return { catalogs, report };
}

test('prepares exactly eight locked effects and eight fully covered Fighting Style roots', () => {
  const { catalogs, report } = fixture();
  const releaseEvidence = {
    sourceCommit: SOURCE_COMMIT,
    evidenceHash: `sha256:${'1'.repeat(64)}`,
    gateSourceHash: `sha256:${'2'.repeat(64)}`,
    sourceContentHash: `sha256:${'3'.repeat(64)}`,
    rulesHash: `sha256:${'4'.repeat(64)}`,
    contentHash: `sha256:${'5'.repeat(64)}`,
    releaseHash: `sha256:${'6'.repeat(64)}`,
    patchHash: `sha256:${'7'.repeat(64)}`,
    catalogHash: `sha256:${'8'.repeat(64)}`,
  };
  const records = prepareFightingStylePrimitiveCertifications(catalogs, report, {
    certifiedAt: CERTIFIED_AT,
    releaseEvidence,
  });
  assert.equal(records.length, 16);
  assert.equal(records.filter((record) => record.entityType === 'effect').length, 8);
  assert.equal(records.filter((record) => record.support.mechanics_locked).length, 8);
  for (const record of records) {
    assert.equal(record.support.certification_version, 'mini-mvp-l1-v1');
    assert.deepEqual(record.support.test_coverage, {
      schema_version: 1, scope: 'mini-mvp-l1', required: 3, passed: 3, percent: 100,
    });
    assert.equal(record.support.evidence_hash, releaseEvidence.evidenceHash);
    assert.equal(record.support.release_hash, releaseEvidence.releaseHash);
    assert.deepEqual(record.support.limitations, []);
  }
  const batch = buildFightingStylePrimitiveCertificationBatch(records, 'test-operation');
  assert.equal(batch.expected_count, 16);
  assert.equal(batch.entries.length, 16);
  assert.match(batch.plan_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(batch.operation_id, 'mini-mvp-fighting-styles:test-operation');
});

test('refuses mechanics drift, reference drift, and structural blockers', () => {
  const releaseEvidence = {
    sourceCommit: SOURCE_COMMIT,
    evidenceHash: `sha256:${'1'.repeat(64)}`,
    gateSourceHash: `sha256:${'2'.repeat(64)}`,
    sourceContentHash: `sha256:${'3'.repeat(64)}`,
    rulesHash: `sha256:${'4'.repeat(64)}`,
    contentHash: `sha256:${'5'.repeat(64)}`,
    releaseHash: `sha256:${'6'.repeat(64)}`,
    patchHash: `sha256:${'7'.repeat(64)}`,
    catalogHash: `sha256:${'8'.repeat(64)}`,
  };
  {
    const { catalogs, report } = fixture();
    catalogs.effect[0].mechanics = { activation: { mode: 'active' } };
    assert.throws(
      () => prepareFightingStylePrimitiveCertifications(catalogs, report, { certifiedAt: CERTIFIED_AT, releaseEvidence }),
      /live mechanics differ from reviewed postimage/u,
    );
  }
  {
    const { catalogs, report } = fixture();
    catalogs.feat[0].related_effects = ['00000000-0000-4000-8000-000000009999'];
    assert.throws(
      () => prepareFightingStylePrimitiveCertifications(catalogs, report, { certifiedAt: CERTIFIED_AT, releaseEvidence }),
      /must reference only/u,
    );
  }
  {
    const { catalogs, report } = fixture();
    report.records[0].issues.push({ kind: 'mechanics', code: 'feat_mechanics_missing' });
    assert.throws(
      () => prepareFightingStylePrimitiveCertifications(catalogs, report, { certifiedAt: CERTIFIED_AT, releaseEvidence }),
      /structural\/mechanical blockers/u,
    );
  }
});

test('derives every release-level hash reproducibly from source and exact catalog content', async () => {
  const { catalogs } = fixture();
  const first = await buildFightingStylePrimitiveReleaseEvidence(catalogs, {
    sourceCommit: SOURCE_COMMIT,
    localSourceCommit: SOURCE_COMMIT,
    verifyDeployment: false,
  });
  const second = await buildFightingStylePrimitiveReleaseEvidence(catalogs, {
    sourceCommit: SOURCE_COMMIT,
    localSourceCommit: SOURCE_COMMIT,
    verifyDeployment: false,
  });
  assert.deepEqual(first, second);
  for (const [key, value] of Object.entries(first)) {
    if (key !== 'sourceCommit') assert.match(value, /^sha256:[0-9a-f]{64}$/u, key);
  }
  catalogs.effect[0].description = 'drift';
  const drifted = await buildFightingStylePrimitiveReleaseEvidence(catalogs, {
    sourceCommit: SOURCE_COMMIT,
    localSourceCommit: SOURCE_COMMIT,
    verifyDeployment: false,
  });
  assert.notEqual(drifted.catalogHash, first.catalogHash);
  assert.notEqual(drifted.contentHash, first.contentHash);
  assert.notEqual(drifted.releaseHash, first.releaseHash);
});
