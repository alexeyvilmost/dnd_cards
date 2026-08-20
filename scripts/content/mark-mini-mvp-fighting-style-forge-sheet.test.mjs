import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCertificationIndex } from './certification-hash.mjs';
import {
  fightingStyleForgeSheetCoverageProblems,
  fightingStyleForgeSheetSupportPayload,
  NARRATIVE_FIGHTING_STYLE_CARD_NUMBERS,
  planFightingStyleForgeSheetSupport,
} from './mark-mini-mvp-fighting-style-forge-sheet.mjs';

function fixture({ blocked = null, executable = null } = {}) {
  const effects = [];
  const feats = NARRATIVE_FIGHTING_STYLE_CARD_NUMBERS.map((cardNumber, index) => {
    const effectId = `effect:${cardNumber}`;
    effects.push({
      id: effectId,
      card_number: `EFFECT-${index}`,
      mechanics: executable === cardNumber
        ? { activation: { mode: 'passive' }, effects: [{ result: [{ kind: 'modifier', value: '+2' }] }] }
        : { activation: { mode: 'passive' }, effects: [{ result: [{ kind: 'narrative', description: 'todo' }] }] },
    });
    return { id: `feat:${cardNumber}`, card_number: cardNumber, related_effects: [effectId] };
  });
  return {
    catalogs: { feat: feats, effect: effects },
    report: {
      records: feats.map((feat) => ({
        key: `fighting-style:${feat.card_number}`,
        collection: 'fightingStyles',
        entityId: feat.id,
        cardNumber: feat.card_number,
        expectedName: feat.card_number,
        issues: blocked === feat.card_number
          ? [{ kind: 'data', code: 'drift' }]
          : [{ kind: 'certification', code: 'expected' }],
      })),
    },
  };
}

test('Fighting Style browser fixture covers the exact mini-MVP denominator', () => {
  assert.deepEqual(fightingStyleForgeSheetCoverageProblems(), []);
  const ready = fixture();
  assert.equal(planFightingStyleForgeSheetSupport(ready.report, ready.catalogs).length, 6);
});

test('partial marker fails closed on data drift and on an already executable style', () => {
  const blocked = fixture({ blocked: 'FEAT-0054' });
  assert.throws(
    () => planFightingStyleForgeSheetSupport(blocked.report, blocked.catalogs),
    /FEAT-0054: style is not structurally clean/,
  );
  const executable = fixture({ executable: 'FEAT-0054' });
  assert.throws(
    () => planFightingStyleForgeSheetSupport(executable.report, executable.catalogs),
    /refusing to overwrite a style that is no longer narrative-only/,
  );
});

test('narrative Fighting Style support remains 2/3 and unlocked', () => {
  const entity = { id: 'feat-id', card_number: 'FEAT-test' };
  const payload = fightingStyleForgeSheetSupportPayload(
    entity,
    buildCertificationIndex({ feat: [entity] }),
  );
  assert.equal(payload.status, 'verified_partial');
  assert.equal(payload.test_coverage.percent, 66);
  assert.equal(payload.test_coverage.passed, 2);
  assert.equal(payload.mechanics_locked, false);
});
