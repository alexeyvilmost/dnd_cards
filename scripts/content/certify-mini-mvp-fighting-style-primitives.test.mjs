import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS,
  FIGHTING_STYLE_PRIMITIVE_EVIDENCE_HASH,
  buildFightingStylePrimitiveCertificationBatch,
  prepareFightingStylePrimitiveCertifications,
} from './certify-mini-mvp-fighting-style-primitives.mjs';
import { MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES } from './upgrade-mini-mvp-fighting-style-primitives.mjs';

const CERTIFIED_AT = '2026-08-20T13:00:00Z';

function fixture() {
  const effects = MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES.map((patch, index) => ({
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

test('prepares exactly four locked effects and four fully covered Fighting Style roots', () => {
  const { catalogs, report } = fixture();
  const records = prepareFightingStylePrimitiveCertifications(catalogs, report, {
    certifiedAt: CERTIFIED_AT,
  });
  assert.equal(records.length, 8);
  assert.equal(records.filter((record) => record.entityType === 'effect').length, 4);
  assert.equal(records.filter((record) => record.support.mechanics_locked).length, 4);
  for (const record of records) {
    assert.equal(record.support.certification_version, 'mini-mvp-l1-v1');
    assert.deepEqual(record.support.test_coverage, {
      schema_version: 1, scope: 'mini-mvp-l1', required: 3, passed: 3, percent: 100,
    });
    assert.equal(record.support.evidence_hash, FIGHTING_STYLE_PRIMITIVE_EVIDENCE_HASH);
    assert.deepEqual(record.support.limitations, []);
  }
  const batch = buildFightingStylePrimitiveCertificationBatch(records, 'test-operation');
  assert.equal(batch.expected_count, 8);
  assert.equal(batch.entries.length, 8);
  assert.match(batch.plan_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(batch.operation_id, 'mini-mvp-fighting-styles:test-operation');
});

test('refuses mechanics drift, reference drift, and structural blockers', () => {
  {
    const { catalogs, report } = fixture();
    catalogs.effect[0].mechanics = { activation: { mode: 'active' } };
    assert.throws(
      () => prepareFightingStylePrimitiveCertifications(catalogs, report, { certifiedAt: CERTIFIED_AT }),
      /live mechanics differ from reviewed postimage/u,
    );
  }
  {
    const { catalogs, report } = fixture();
    catalogs.feat[0].related_effects = ['00000000-0000-4000-8000-000000009999'];
    assert.throws(
      () => prepareFightingStylePrimitiveCertifications(catalogs, report, { certifiedAt: CERTIFIED_AT }),
      /must reference only/u,
    );
  }
  {
    const { catalogs, report } = fixture();
    report.records[0].issues.push({ kind: 'mechanics', code: 'feat_mechanics_missing' });
    assert.throws(
      () => prepareFightingStylePrimitiveCertifications(catalogs, report, { certifiedAt: CERTIFIED_AT }),
      /structural\/mechanical blockers/u,
    );
  }
});
