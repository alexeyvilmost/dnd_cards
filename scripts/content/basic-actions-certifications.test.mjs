import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  BASIC_ACTIONS_EVIDENCE_HASH,
  BASIC_ACTION_CERTIFICATION_CONTRACT,
  buildBasicActionCertificationBatch,
} from './basic-actions-certifications.mjs';

const EXPECTED_CARDS = [
  'action_basic_dash',
  'action_basic_disengage',
  'action_basic_dodge',
  'action_basic_offhand',
  'action_basic_unarmed',
  'action_basic_weapon',
  'action_help',
];
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('basic-action certificate has an exact seven-row denominator and reviewed hash', () => {
  assert.deepEqual(
    BASIC_ACTION_CERTIFICATION_CONTRACT.map((entry) => entry.cardNumber).sort(),
    EXPECTED_CARDS,
  );
  assert.equal(new Set(BASIC_ACTION_CERTIFICATION_CONTRACT.map((entry) => entry.cardNumber)).size, 7);
  assert.equal(
    BASIC_ACTIONS_EVIDENCE_HASH,
    'sha256:64e356cef7bdda49c508cdffc7a28ef2efb0bdc2c89aeeb43dce8fd15799780e',
  );
});

test('every evidence locator exists and named tests remain present', () => {
  for (const contract of BASIC_ACTION_CERTIFICATION_CONTRACT) {
    assert.ok(contract.evidence.length > 0, `${contract.cardNumber}: evidence is empty`);
    for (const locator of contract.evidence) {
      const [relativePath, testName] = locator.split('::');
      const path = resolve(REPO_ROOT, relativePath);
      assert.ok(existsSync(path), `${locator}: file is missing`);
      if (testName) {
        assert.match(readFileSync(path, 'utf8'), new RegExp(
          testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        ), `${locator}: named evidence is missing`);
      }
    }
  }
});

test('only fully canonical weapon primitives are mechanically locked', () => {
  const locked = BASIC_ACTION_CERTIFICATION_CONTRACT
    .filter((entry) => entry.mechanicsLocked)
    .map((entry) => entry.cardNumber)
    .sort();
  assert.deepEqual(locked, ['action_basic_offhand', 'action_basic_weapon']);
  for (const entry of BASIC_ACTION_CERTIFICATION_CONTRACT) {
    if (entry.status === 'verified_partial') {
      assert.ok(entry.limitations?.some((value) => value.trim()), `${entry.cardNumber}: limitation missing`);
    }
  }
});

test('apply payload is one exact-CAS transaction over all seven current DB rows', () => {
  const records = BASIC_ACTION_CERTIFICATION_CONTRACT.map((contract, index) => ({
    contract,
    entity: { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, support: null },
    payload: { status: contract.status, mechanics_locked: contract.mechanicsLocked },
  }));
  const batch = buildBasicActionCertificationBatch(records, 'test-operation');
  assert.equal(batch.mode, 'certification_apply');
  assert.equal(batch.operation_id, 'basic-actions:test-operation');
  assert.equal(batch.expected_count, 7);
  assert.match(batch.plan_hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    batch.entries.map((entry) => entry.expected_current),
    records.map((record) => record.entity),
  );
  assert.ok(batch.entries.every((entry) => entry.entity_type === 'action'));
});
