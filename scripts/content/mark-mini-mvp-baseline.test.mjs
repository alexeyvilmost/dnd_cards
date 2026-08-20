import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleMiniMvpBaselineRecords,
  planMiniMvpBaseline,
} from './mark-mini-mvp-baseline.mjs';

const record = (key, codes) => ({
  key,
  collection: 'cantrips',
  entityType: 'spell',
  cardNumber: key,
  expectedName: key,
  entityId: `id:${key}`,
  issues: codes.map((code) => ({ kind: 'test', code, message: code })),
});

test('baseline admits only missing certificates without structural defects', () => {
  const report = { records: [
    record('safe', ['certification_missing', 'dependency_not_ready']),
    record('drifted', ['certification_missing', 'name_mismatch']),
    record('narrative', ['certification_missing', 'spell_narrative_only']),
    record('already-marked', ['coverage_incomplete']),
  ] };
  assert.deepEqual(
    eligibleMiniMvpBaselineRecords(report).map((item) => item.key),
    ['safe'],
  );
});

test('baseline plan requires the exact resolved live entity', () => {
  const report = { records: [record('safe', ['certification_missing'])] };
  const catalogs = { spell: [{ id: 'id:safe', card_number: 'safe' }] };
  assert.equal(planMiniMvpBaseline(report, catalogs).length, 1);
  assert.throws(() => planMiniMvpBaseline(report, { spell: [] }), /expected one resolved/);
});
