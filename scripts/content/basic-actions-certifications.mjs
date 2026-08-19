#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { apiUrl, fetchAll, login } from './api.mjs';
import { ENTITY_ENDPOINTS } from './micro-micro-gate.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';

export const BASIC_ACTIONS_CERTIFICATION_VERSION = 'micro-mvp-basic-actions-v2';
export const BASIC_ACTIONS_EVIDENCE_ID = '9a983f0b-f3df-4aaf-a124-e8b78eec06a1';
export const BASIC_ACTIONS_SCOPE = 'micro-mvp-basic-actions-v2';

export const BASIC_ACTION_CERTIFICATION_CONTRACT = Object.freeze([
  {
    cardNumber: 'action_basic_weapon',
    status: 'verified_mechanical',
    mechanicsLocked: true,
    evidence: [
      'frontend/e2e/sheet-combat.spec.ts::Magic Initiate Fighter attacks the scene dummy from a real sheet without catalog poisoning',
      'frontend/e2e-live/real-backend-canary.spec.ts::public sheet certificate: Forge Magic Initiate Fighter uses Longbow and Thunderwave',
      'frontend/src/character/sheetCombatWeaponActions.integration.test.ts',
      'frontend/src/character/sheetCombatWeaponCertification.test.ts',
    ],
  },
  {
    cardNumber: 'action_basic_offhand',
    status: 'verified_mechanical',
    mechanicsLocked: true,
    evidence: [
      'frontend/src/character/sheetCombatWeaponActions.integration.test.ts',
      'frontend/src/rules-core/lightWeaponExtraAttack.test.ts',
    ],
  },
  {
    cardNumber: 'action_basic_unarmed',
    status: 'verified_partial',
    mechanicsLocked: false,
    limitations: [
      'Урон Безоружного удара и выбор цели проверены в живом листе; варианты Захват и Толчок реализованы в rules-core, но ещё не подключены к этой строке листа.',
    ],
    evidence: [
      'frontend/e2e/sheet-combat.spec.ts::unarmed strike uses the same scene-target declaration before its roll',
      'frontend/src/rules-core/attackRuntime.integration.test.ts',
    ],
  },
  {
    cardNumber: 'action_basic_dash',
    status: 'verified_partial',
    mechanicsLocked: false,
    limitations: [
      'Трата действия и модификатор доступного перемещения проверены; сама геометрия перемещения пока ведётся игроком на сцене.',
    ],
    evidence: [
      'frontend/e2e/sheet-combat.spec.ts::Dash, Disengage persistence and Dodge execute from their real basic-action rows',
    ],
  },
  {
    cardNumber: 'action_basic_disengage',
    status: 'verified_partial',
    mechanicsLocked: false,
    limitations: [
      'Лист сохраняет эффект запрета провоцируемой атаки и снимает его в начале следующего хода; сама система атак по возможности ещё не подключена к этому модификатору.',
    ],
    evidence: [
      'frontend/e2e/sheet-combat.spec.ts::Dash, Disengage persistence and Dodge execute from their real basic-action rows',
    ],
  },
  {
    cardNumber: 'action_basic_dodge',
    status: 'verified_partial',
    mechanicsLocked: false,
    limitations: [
      'Преимущество спасбросков Ловкости и помеха атакам проверены; доска пока не завершает эффект автоматически при Скорости 0.',
    ],
    evidence: [
      'frontend/e2e/sheet-combat.spec.ts::Dash, Disengage persistence and Dodge execute from their real basic-action rows',
      'frontend/src/mvp/runtime.mvp.test.ts::Уклонение вешает активный эффект; атаки по себе получают помеху',
      'frontend/src/engine/weapon.test.ts::Уклонение (R2 / KB-025): помеха проецируется на атакующего',
    ],
  },
  {
    cardNumber: 'action_help',
    status: 'verified_partial',
    mechanicsLocked: false,
    limitations: [
      'Преимущество следующей проверки характеристики проверено; выбор конкретной задачи и отдельный вариант помощи атаке ещё не полностью выражены в UI.',
    ],
    evidence: [
      'frontend/e2e/sheet-combat.spec.ts::Help executes from the real sheet row and exposes its certified target limitation',
      'frontend/src/rules-core/interactionPrimitives.test.ts::applies Help and a generic one-shot bonus to the matching check and consumes only matching next-check effects',
      'frontend/src/rules-core/testing/microMvpScenarioCorpus.test.ts::SC-05 consumes Help but keeps Guidance for its concentration duration',
    ],
  },
]);

export const BASIC_ACTIONS_EVIDENCE_HASH = sha256Canonical({
  schemaVersion: 1,
  certificationVersion: BASIC_ACTIONS_CERTIFICATION_VERSION,
  scope: BASIC_ACTIONS_SCOPE,
  actions: BASIC_ACTION_CERTIFICATION_CONTRACT,
});

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function assertUtc(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an explicit UTC RFC3339 timestamp`);
  }
}

export async function loadBasicActionCertificationCatalogs(fetcher = fetchAll) {
  return Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([type, [path, key]]) => [
      type,
      await fetcher(path, key, { limit: 1000 }),
    ]),
  ));
}

export function prepareBasicActionCertifications(groups, {
  certifiedAt,
  evidenceCompletedAt,
} = {}) {
  assertUtc(certifiedAt, 'certifiedAt');
  assertUtc(evidenceCompletedAt, 'evidenceCompletedAt');
  const index = buildCertificationIndex(groups);
  const actions = groups.action ?? [];
  return BASIC_ACTION_CERTIFICATION_CONTRACT.map((contract) => {
    const matches = actions.filter((action) => action.card_number === contract.cardNumber);
    if (matches.length !== 1 || matches[0].type !== 'basic') {
      throw new Error(`${contract.cardNumber}: expected exactly one basic Action row`);
    }
    const entity = matches[0];
    const hashes = certificationHashes(entity, 'action', index);
    const required = contract.evidence.length;
    return {
      contract,
      entity,
      payload: {
        status: contract.status,
        content_hash: hashes.contentHash,
        dependency_hash: hashes.dependencyHash,
        certification_version: BASIC_ACTIONS_CERTIFICATION_VERSION,
        certified_at: certifiedAt,
        evidence_id: BASIC_ACTIONS_EVIDENCE_ID,
        evidence_hash: BASIC_ACTIONS_EVIDENCE_HASH,
        evidence_completed_at: evidenceCompletedAt,
        test_coverage: {
          schema_version: 1,
          scope: BASIC_ACTIONS_SCOPE,
          required,
          passed: required,
          percent: 100,
        },
        mechanics_locked: contract.mechanicsLocked,
        ...(contract.limitations ? { limitations: contract.limitations } : {}),
        ...(contract.note ? { note: contract.note } : {}),
      },
    };
  });
}

export function buildBasicActionCertificationBatch(records, operationId = randomUUID()) {
  const entries = records.map((record) => ({
    entity_type: 'action',
    entity_id: record.entity.id,
    expected_current: record.entity,
    support: record.payload,
  }));
  return {
    schema_version: 1,
    mode: 'certification_apply',
    plan_hash: sha256Canonical({
      schemaVersion: 1,
      operation: BASIC_ACTIONS_CERTIFICATION_VERSION,
      entries,
    }),
    operation_id: `basic-actions:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

async function applyRecordsAtomically(records, token, key) {
  const batch = buildBasicActionCertificationBatch(records);
  const response = await fetch(`${apiUrl()}/api/content-support/batch-exact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Content-Certification-Key': key,
    },
    body: JSON.stringify(batch),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`atomic certification apply returned ${response.status}: ${text.slice(0, 500)}`);
  }
  const receipt = text ? JSON.parse(text) : null;
  if (receipt?.schema_version !== 1
    || receipt?.mode !== batch.mode
    || receipt?.plan_hash !== batch.plan_hash
    || receipt?.total !== batch.expected_count
    || receipt?.cas !== 'atomic_exact_full_api_response_v1') {
    throw new Error('atomic certification apply returned an invalid receipt');
  }
  return receipt;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const evidenceCompletedAt = option('evidence-completed-at');
  const certifiedAt = option('certified-at') ?? evidenceCompletedAt;
  if (!evidenceCompletedAt || !certifiedAt) {
    throw new Error('--evidence-completed-at is required (and --certified-at may override it)');
  }
  const groups = await loadBasicActionCertificationCatalogs();
  const records = prepareBasicActionCertifications(groups, { certifiedAt, evidenceCompletedAt });
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  console.log(`evidence ${BASIC_ACTIONS_EVIDENCE_ID} ${BASIC_ACTIONS_EVIDENCE_HASH}`);
  for (const record of records) {
    console.log(`${record.contract.cardNumber}: ${record.payload.status}, ${record.payload.test_coverage.passed}/${record.payload.test_coverage.required}, locked=${record.payload.mechanics_locked}`);
  }
  if (!apply) return;
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('CONTENT_CERTIFICATION_KEY is required for --apply');
  const token = await login();
  const receipt = await applyRecordsAtomically(records, token, key);
  console.log(`Applied ${records.length} basic-action certifications atomically; operation ${receipt.operation_id}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
