#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';
import {
  MICRO_MVP_CERTIFICATION_VERSION,
  MICRO_MVP_CONDITION_TARGETS,
} from './micro-mvp-certifications.mjs';
import { currentMicroMvpReleaseIdentity } from './micro-mvp-release-evidence.mjs';
import { assessMiniMvpCatalogs, fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';
import { postExactSupportBatch } from './exact-support-batch-client.mjs';

export const FORGE_SHEET_SUPPORT_VERSION = 'mini-mvp-forge-sheet-v2';
export const FORGE_SHEET_ROOT_COLLECTIONS = Object.freeze([
  'classes', 'species', 'backgrounds', 'originFeats',
]);
const UTC_RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_READINESS_DIAGNOSTICS = 20;
const MICRO_EVIDENCE_IDENTITY_FIELDS = Object.freeze([
  'certification_version', 'certified_at', 'evidence_id', 'evidence_hash',
  'evidence_completed_at', 'gate_source_hash', 'source_content_hash',
  'rules_hash', 'release_content_hash', 'release_hash', 'patch_hash',
  'catalog_hash',
]);

const fixture = JSON.parse(readFileSync(new URL(
  '../../frontend/src/canon/data/mini-mvp-forge-sheet-fixture.v1.json',
  import.meta.url,
), 'utf8'));

function declaredRootCardNumbers() {
  return new Set([
    ...FORGE_SHEET_ROOT_COLLECTIONS.flatMap((collection) => (
      MINI_MVP_MANIFEST.collections[collection].map((entry) => entry.selector.cardNumber)
    )),
    ...(fixture.coverage?.lineages ?? []),
  ]);
}

export function forgeSheetRootCoverageProblems() {
  const problems = [];
  if (fixture.schemaVersion !== 2 || fixture.strategy !== 'cyclic-covering-set-with-lineages-v2') {
    problems.push('Forge fixture has an unsupported schema or strategy');
  }
  const expectedLineages = MINI_MVP_MANIFEST.collections.species.flatMap((entry) => (
    (entry.expected?.variantSelectors ?? []).map((selector) => selector.cardNumber)
  ));
  if (JSON.stringify(fixture.coverage?.lineages) !== JSON.stringify(expectedLineages)) {
    problems.push('lineages: fixture coverage differs from the mini-MVP manifest');
  }
  for (const collection of FORGE_SHEET_ROOT_COLLECTIONS) {
    const expected = MINI_MVP_MANIFEST.collections[collection]
      .map((entry) => entry.selector.cardNumber);
    const actual = fixture.coverage?.[collection];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${collection}: fixture coverage differs from the mini-MVP manifest`);
    }
  }
  const observed = new Set(fixture.roots.flatMap((root) => [
    root.classCardNumber,
    root.raceCardNumber,
    root.lineageCardNumber,
    root.backgroundCardNumber,
    root.featCardNumber,
  ]));
  for (const cardNumber of declaredRootCardNumbers()) {
    if (!observed.has(cardNumber)) problems.push(`${cardNumber}: absent from Forge root rows`);
  }
  return problems;
}

export function planForgeSheetRootSupport(report, catalogs) {
  const fixtureProblems = forgeSheetRootCoverageProblems();
  if (fixtureProblems.length > 0) throw new Error(fixtureProblems.join('; '));
  const targets = declaredRootCardNumbers();
  return report.records.filter((record) => targets.has(record.cardNumber)).map((record) => {
    const blocking = record.issues.filter((item) => (
      item.kind === 'data'
      || item.kind === 'mechanics'
      || item.code === 'reference_unresolved'
    ));
    if (blocking.length > 0) {
      throw new Error(`${record.cardNumber}: root is not structurally clean: ${blocking.map((item) => item.code).join(', ')}`);
    }
    const matches = (catalogs[record.entityType] ?? [])
      .filter((entity) => entity.id === record.entityId);
    if (matches.length !== 1) {
      throw new Error(`${record.cardNumber}: expected one live entity, got ${matches.length}`);
    }
    return { record, entity: matches[0] };
  });
}

export function selectForgeSheetRootSupportPlan(plan, {
  cardNumbers = [],
  missingOnly = false,
  expectedCount = null,
  protectedCardNumbers = new Set(),
} = {}) {
  if (!Array.isArray(plan) || !Array.isArray(cardNumbers)) {
    throw new TypeError('Forge/sheet support plan and cardNumbers must be arrays');
  }
  const normalizedTargets = cardNumbers.map((cardNumber) => {
    if (typeof cardNumber !== 'string' || !cardNumber.trim()) {
      throw new Error('--card-number must be a non-empty stable card number');
    }
    return cardNumber.trim();
  });
  if (new Set(normalizedTargets).size !== normalizedTargets.length) {
    throw new Error('--card-number values must be unique');
  }
  const planByCardNumber = new Map(plan.map((item) => [item.record.cardNumber, item]));
  if (planByCardNumber.size !== plan.length) {
    throw new Error('Forge/sheet support plan contains duplicate card numbers');
  }
  for (const cardNumber of normalizedTargets) {
    if (!planByCardNumber.has(cardNumber)) {
      throw new Error(`${cardNumber}: not a declared Forge/sheet root`);
    }
  }

  const targetSet = new Set(normalizedTargets);
  const selected = plan.filter((item) => (
    (targetSet.size === 0 || targetSet.has(item.record.cardNumber))
      && (!missingOnly || item.entity.support == null)
      && !protectedCardNumbers.has(item.record.cardNumber)
  ));
  if (expectedCount !== null) {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new Error('--expected-count must be a non-negative integer');
    }
    if (selected.length !== expectedCount) {
      throw new Error(
        `Forge/sheet selected count ${selected.length} differs from --expected-count ${expectedCount}`,
      );
    }
  }
  return selected;
}

export function forgeSheetRootSupportPayload(entity, entityType, index, certifiedAt) {
  if (typeof certifiedAt !== 'string' || !certifiedAt.trim()) {
    throw new Error('certifiedAt is required for Forge/sheet support');
  }
  const hashes = certificationHashes(entity, entityType, index);
  return {
    status: 'verified_partial',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: FORGE_SHEET_SUPPORT_VERSION,
    certified_at: certifiedAt,
    limitations: [
      'Проверены live-структура, ссылки, родительская принадлежность вариантов и завершённая сборка тем же data-driven конвейером, что использует кузница.',
      'Каждый вариант вида прошёл production UI: кузница, атомарное создание, сохранение lineage_id, стартового инвентаря/золота и открытие реального листа.',
      'Отдельные механические сценарии всех выдаваемых действий и эффектов ещё не сертифицированы; варианты снаряжения Б/В не входят в этот браузерный прогон.',
    ],
    note: 'Корневая или вариантная сущность mini-MVP подтверждена данными и реальным Forge→save→sheet; без блокировки механики.',
    test_coverage: {
      schema_version: 1,
      scope: FORGE_SHEET_SUPPORT_VERSION,
      required: 3,
      passed: 3,
      percent: 100,
    },
    mechanics_locked: false,
  };
}

function supportFieldDiff(expected, actual) {
  const keys = [...new Set([
    ...Object.keys(expected),
    ...Object.keys(actual),
  ])].sort();
  return keys.filter((key) => sha256Canonical({
    present: Object.prototype.hasOwnProperty.call(expected, key),
    value: expected[key],
  }) !== sha256Canonical({
    present: Object.prototype.hasOwnProperty.call(actual, key),
    value: actual[key],
  }));
}

function validUtc(value) {
  return typeof value === 'string'
    && UTC_RFC3339.test(value)
    && !Number.isNaN(Date.parse(value));
}

function completeMicroCoverage(coverage) {
  return coverage?.schema_version === 1
    && coverage.scope === 'micro-mvp-l1'
    && Number.isSafeInteger(coverage.required)
    && coverage.required > 0
    && coverage.passed === coverage.required
    && coverage.percent === 100;
}

function microEvidenceIdentity(support) {
  return sha256Canonical(Object.fromEntries(MICRO_EVIDENCE_IDENTITY_FIELDS.map((field) => (
    [field, support?.[field] ?? null]
  ))));
}

function validCurrentMicroSupport(entity, entityType, index, release, {
  status,
  mechanicsLocked = null,
  limitations = null,
} = {}) {
  const support = entity?.support;
  if (!support || typeof support !== 'object' || Array.isArray(support)) return false;
  const hashes = certificationHashes(entity, entityType, index);
  if (support.status !== status
    || support.certification_version !== MICRO_MVP_CERTIFICATION_VERSION
    || support.content_hash !== hashes.contentHash
    || support.dependency_hash !== hashes.dependencyHash
    || !validUtc(support.certified_at)
    || !validUtc(support.evidence_completed_at)
    || !UUID.test(support.evidence_id ?? '')
    || !SHA256.test(support.evidence_hash ?? '')
    || !SHA256.test(support.catalog_hash ?? '')
    || support.gate_source_hash !== release.sourceHash
    || support.source_content_hash !== release.sourceContentHash
    || support.rules_hash !== release.rulesHash
    || support.release_content_hash !== release.contentHash
    || support.release_hash !== release.releaseHash
    || support.patch_hash !== release.patchHash
    || !completeMicroCoverage(support.test_coverage)
    || typeof support.note !== 'string'
    || !support.note.trim()) {
    return false;
  }
  if (mechanicsLocked !== null && support.mechanics_locked !== mechanicsLocked) return false;
  if (limitations === 'empty'
    && (!Array.isArray(support.limitations) || support.limitations.length !== 0)) return false;
  if (limitations === 'nonempty'
    && (!Array.isArray(support.limitations)
      || !support.limitations.some((item) => typeof item === 'string' && item.trim()))) return false;
  return true;
}

function currentMicroConditionEvidenceIdentity(catalogs, index, release) {
  const supports = MICRO_MVP_CONDITION_TARGETS.flatMap((target) => {
    const matches = (catalogs.effect ?? []).filter((entity) => (
      entity.card_number === target.cardNumber
        && entity.effect_type === 'condition'
        && entity.mechanics?.condition?.id === target.id
    ));
    const valid = matches.length === 1 && validCurrentMicroSupport(
      matches[0],
      'effect',
      index,
      release,
      { status: 'verified_mechanical', mechanicsLocked: true, limitations: 'empty' },
    );
    if (!valid) return [];
    return [matches[0].support];
  });
  if (supports.length !== MICRO_MVP_CONDITION_TARGETS.length) return null;
  const identities = new Set(supports.map(microEvidenceIdentity));
  return identities.size === 1 ? identities.values().next().value : null;
}

export function currentMicroMvpCoveredForgeRootCardNumbers(plan, catalogs) {
  const index = buildCertificationIndex(catalogs);
  const release = currentMicroMvpReleaseIdentity();
  const conditionEvidenceIdentity = currentMicroConditionEvidenceIdentity(catalogs, index, release);
  if (!conditionEvidenceIdentity) return new Set();
  return new Set(plan.flatMap((item) => {
    const valid = validCurrentMicroSupport(
      item.entity,
      item.record.entityType,
      index,
      release,
      { status: 'verified_partial', limitations: 'nonempty' },
    );
    const sameEvidence = microEvidenceIdentity(item.entity.support) === conditionEvidenceIdentity;
    return valid && sameEvidence
      ? [item.record.cardNumber]
      : [];
  }));
}

export function forgeSheetRootSupportReadinessProblems(plan, catalogs) {
  const index = buildCertificationIndex(catalogs);
  const microCovered = currentMicroMvpCoveredForgeRootCardNumbers(plan, catalogs);
  return plan.flatMap((item) => {
    const support = item.entity.support;
    if (!support || typeof support !== 'object' || Array.isArray(support)) {
      return [`${item.record.cardNumber}: support is missing or invalid`];
    }
    const certifiedAt = support.certified_at;
    if (typeof certifiedAt !== 'string'
      || !UTC_RFC3339.test(certifiedAt)
      || Number.isNaN(Date.parse(certifiedAt))) {
      return [`${item.record.cardNumber}: support.certified_at is not UTC RFC3339`];
    }
    const expected = forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      index,
      certifiedAt,
    );
    if (sha256Canonical(support) === sha256Canonical(expected)) return [];
    if (microCovered.has(item.record.cardNumber)) return [];
    const fields = supportFieldDiff(expected, support);
    return [
      `${item.record.cardNumber}: support is neither exact ${FORGE_SHEET_SUPPORT_VERSION}`
        + ` nor a current ${MICRO_MVP_CERTIFICATION_VERSION} postimage; Forge payload differs in`
        + ` (${fields.join(', ') || 'unknown fields'})`,
    ];
  });
}

export function buildForgeSheetRootCertificationBatch(records, operationId = randomUUID()) {
  const entries = records.map((record) => ({
    entity_type: record.entityType,
    entity_id: record.entity.id,
    expected_current: record.entity,
    support: record.support,
  }));
  return {
    schema_version: 1,
    mode: 'certification_apply',
    plan_hash: sha256Canonical({
      schemaVersion: 1,
      operation: FORGE_SHEET_SUPPORT_VERSION,
      entries,
    }),
    operation_id: `mini-mvp-forge-sheet:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

async function applyRecordsAtomically(records, token, key) {
  const batch = buildForgeSheetRootCertificationBatch(records);
  return postExactSupportBatch({
    baseUrl: apiUrl(),
    batch,
    token,
    certificationKey: key,
  });
}

function optionValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${name}`) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function singleOption(argv, name) {
  const values = optionValues(argv, name);
  if (values.length > 1) throw new Error(`--${name} may be specified only once`);
  return values[0] ?? null;
}

function expectedCountOption(argv) {
  const value = singleOption(argv, 'expected-count');
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new Error('--expected-count must be a non-negative integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('--expected-count must be a non-negative integer');
  }
  return parsed;
}

export function assertForgeSheetRootSupportRunMode({
  apply,
  all,
  cardNumbers,
  missingOnly,
  checkReady,
}) {
  const hasSelector = cardNumbers.length > 0 || missingOnly;
  if (checkReady && (apply || all || hasSelector)) {
    throw new Error('--check-ready is read-only and cannot be combined with apply or selectors');
  }
  if (all && hasSelector) {
    throw new Error('--all cannot be combined with --card-number or --missing-only');
  }
  if (apply && !all && !hasSelector) {
    throw new Error('--apply requires explicit --all, --card-number, or --missing-only scope');
  }
}

export async function runForgeSheetRootSupport(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const apply = options.apply ?? argv.includes('--apply');
  const certifiedAt = options.certifiedAt ?? singleOption(argv, 'certified-at');
  const all = options.all ?? argv.includes('--all');
  const cardNumbers = options.cardNumbers ?? optionValues(argv, 'card-number');
  const missingOnly = options.missingOnly ?? argv.includes('--missing-only');
  const expectedCount = options.expectedCount ?? expectedCountOption(argv);
  const checkReady = options.checkReady ?? argv.includes('--check-ready');
  assertForgeSheetRootSupportRunMode({
    apply, all, cardNumbers, missingOnly, checkReady,
  });

  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const completePlan = planForgeSheetRootSupport(report, catalogs);
  if (checkReady) {
    const problems = forgeSheetRootSupportReadinessProblems(completePlan, catalogs);
    if (problems.length > 0) {
      const shown = problems.slice(0, MAX_READINESS_DIAGNOSTICS);
      const omitted = problems.length - shown.length;
      throw new Error(
        `Forge/sheet certification readiness failed for ${problems.length}/${completePlan.length} roots:\n`
          + shown.map((problem) => `  - ${problem}`).join('\n')
          + (omitted > 0 ? `\n  - ... ${omitted} more` : ''),
      );
    }
    console.log(`READY ${apiUrl()}: ${completePlan.length}/${completePlan.length} exact Forge/sheet roots`);
    return completePlan;
  }

  const protectedCardNumbers = currentMicroMvpCoveredForgeRootCardNumbers(completePlan, catalogs);
  const plan = selectForgeSheetRootSupportPlan(completePlan, {
    cardNumbers,
    missingOnly,
    expectedCount,
    protectedCardNumbers,
  });
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} Forge/sheet roots`);
  for (const item of plan) console.log(`  ${apply ? '◑' : '✓'} ${item.record.cardNumber} ${item.record.expectedName}`);
  if (!apply || plan.length === 0) return plan;
  if (!certifiedAt) throw new Error('--apply requires --certified-at');
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const index = buildCertificationIndex(catalogs);
  const records = plan.map((item) => ({
    entityType: item.record.entityType,
    entity: item.entity,
    support: forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      index,
      certifiedAt,
    ),
  }));
  const receipt = await applyRecordsAtomically(records, token, key);
  console.log(`Applied ${records.length} Forge/sheet certifications atomically; operation ${receipt.operation_id}`);
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runForgeSheetRootSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
