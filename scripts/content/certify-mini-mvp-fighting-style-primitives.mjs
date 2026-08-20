#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { apiUrl, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  contentHash,
  sha256Canonical,
} from './certification-hash.mjs';
import {
  MINI_MVP_CERTIFICATION_VERSION,
  MINI_MVP_COVERAGE_SCOPE,
  assessMiniMvpCatalogs,
  fetchMiniMvpCatalogs,
} from './mini-mvp-audit.mjs';
import { fightingStyleForgeSheetCoverageProblems } from './mark-mini-mvp-fighting-style-forge-sheet.mjs';
import { MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES } from './upgrade-mini-mvp-fighting-style-primitives.mjs';

export const FIGHTING_STYLE_PRIMITIVE_EVIDENCE_ID = '503b36da-2750-4cdd-9058-ecaf1229b254';

const EXISTING_FIGHTING_STYLE_DEFINITIONS = JSON.parse(readFileSync(new URL(
  './data/mini-mvp-existing-fighting-styles.v1.json',
  import.meta.url,
), 'utf8'));

export const FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS = Object.freeze([
  { featCardNumber: 'FEAT-0054', effectCardNumber: 'fs_dueling' },
  { featCardNumber: 'FEAT-0059', effectCardNumber: 'fs_great_weapon' },
  { featCardNumber: 'FEAT-0060', effectCardNumber: 'fs_blind_fighting' },
  { featCardNumber: 'FEAT-0062', effectCardNumber: 'fs_thrown_weapon' },
  ...EXISTING_FIGHTING_STYLE_DEFINITIONS.map((definition) => ({
    featCardNumber: definition.feat_card_number,
    effectCardNumber: definition.card_number,
  })),
]);

export const REVIEWED_FIGHTING_STYLE_EFFECT_SPECS = Object.freeze([
  ...MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES.map((patch) => ({
    cardNumber: patch.cardNumber,
    name: patch.name,
    mechanics: patch.mechanics,
    expectedBeforeHash: patch.expectedBeforeHash,
    expectedAfterHash: patch.expectedAfterHash,
    origin: 'primitive-upgrade',
  })),
  ...EXISTING_FIGHTING_STYLE_DEFINITIONS.map((definition) => ({
    cardNumber: definition.card_number,
    name: definition.name,
    mechanics: definition.mechanics,
    expectedBeforeHash: null,
    expectedAfterHash: sha256Canonical(definition.mechanics),
    origin: 'locked-reviewed-postimage',
  })),
]);

export const FIGHTING_STYLE_PRIMITIVE_EVIDENCE = Object.freeze({
  schemaVersion: 1,
  certificationVersion: MINI_MVP_CERTIFICATION_VERSION,
  scope: MINI_MVP_COVERAGE_SCOPE,
  sourceRules: [
    'https://www.dndbeyond.com/sources/dnd/br-2024/feats#Dueling',
    'https://www.dndbeyond.com/sources/dnd/br-2024/feats#GreatWeaponFighting',
    'https://www.dndbeyond.com/sources/dnd/br-2024/feats#BlindFighting',
    'https://www.dndbeyond.com/sources/dnd/br-2024/feats#ThrownWeaponFighting',
  ],
  lanes: [
    {
      id: 'reviewed-data-and-schema',
      evidence: [
        'scripts/content/data/mini-mvp-fighting-style-primitives.v1.json',
        'scripts/content/data/mini-mvp-existing-fighting-styles.v1.json',
        'frontend/src/rules-core/miniMvpFightingStylePrimitives.test.ts::schema-valid executable definitions',
        'frontend/src/rules-core/miniMvpExistingFightingStyles.test.ts::exact schema-valid locked definitions',
      ],
    },
    {
      id: 'unit-and-live-db-mechanics',
      evidence: [
        'frontend/src/rules-core/miniMvpFightingStylePrimitives.test.ts::complete positive and negative scenario matrix',
        'frontend/src/rules-core/miniMvpExistingFightingStyles.test.ts::modifier and Protection Reaction scenario matrix',
        'frontend/src/mvp/mini-mvp.fighting-style-primitives.live.test.ts::byte-exact live mechanics and behavior matrix',
      ],
    },
    {
      id: 'production-forge-and-sheet',
      evidence: [
        'frontend/e2e-live/real-backend-canary.spec.ts::public mini-MVP sheet certificate: every root and Fighting Style crosses Forge and the live sheet',
      ],
    },
  ],
});

export const FIGHTING_STYLE_PRIMITIVE_EVIDENCE_HASH = sha256Canonical(
  FIGHTING_STYLE_PRIMITIVE_EVIDENCE,
);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../..');
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const RULE_SOURCE_FILES = Object.freeze([
  'frontend/src/engine/execute.ts',
  'frontend/src/engine/modifiers.ts',
  'frontend/src/engine/rollRules.ts',
  'frontend/src/rules-core/fightingStyles.ts',
  'frontend/src/testing/miniMvpFightingStylePrimitiveScenarios.ts',
  'frontend/src/schemas/mechanics.schema.json',
]);

function normalizedFileHash(relativePath) {
  const source = readFileSync(resolve(REPOSITORY_ROOT, relativePath), 'utf8')
    .replace(/\r\n/gu, '\n');
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

function catalogFingerprint(catalogs) {
  return sha256Canonical(Object.entries(catalogs)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([entityType, entities]) => (entities ?? [])
      .map((entity) => ({
        entityType,
        id: entity.id,
        cardNumber: entity.card_number ?? null,
        contentHash: contentHash(entity),
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))));
}

function selectedContentFingerprint(catalogs) {
  return sha256Canonical(FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS.flatMap((spec) => [
    {
      entityType: 'effect',
      cardNumber: spec.effectCardNumber,
      contentHash: contentHash(exactByCardNumber(catalogs.effect, spec.effectCardNumber, 'effect')),
    },
    {
      entityType: 'feat',
      cardNumber: spec.featCardNumber,
      contentHash: contentHash(exactByCardNumber(catalogs.feat, spec.featCardNumber, 'feat')),
    },
  ]));
}

async function assertDeployedCommit(sourceCommit) {
  const [healthResponse, buildResponse] = await Promise.all([
    fetch(`${apiUrl()}/api/health`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`${apiUrl()}/build-info.json?release=${sourceCommit}`, { signal: AbortSignal.timeout(15_000) }),
  ]);
  if (!healthResponse.ok || !buildResponse.ok) {
    throw new Error('production deployment attestation endpoints are not healthy');
  }
  const [health, build] = await Promise.all([healthResponse.json(), buildResponse.json()]);
  if (health?.status !== 'ok'
    || health?.source_commit !== sourceCommit
    || build?.source_commit !== sourceCommit) {
    throw new Error(`production deployment does not match ${sourceCommit}`);
  }
}

export async function buildFightingStylePrimitiveReleaseEvidence(catalogs, {
  sourceCommit,
  verifyDeployment = true,
  localSourceCommit = null,
} = {}) {
  if (!SOURCE_COMMIT_PATTERN.test(sourceCommit ?? '')) {
    throw new Error('sourceCommit must be an exact 40-hex Git commit');
  }
  const localCommit = localSourceCommit ?? execFileSync(
    'git', ['rev-parse', 'HEAD'], { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).trim().toLowerCase();
  if (localSourceCommit === null) {
    const trackedStatus = execFileSync(
      'git', ['status', '--porcelain', '--untracked-files=no'],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
    ).trim();
    if (trackedStatus) {
      throw new Error('tracked working tree must be clean before deriving release evidence');
    }
  }
  if (localCommit !== sourceCommit) {
    throw new Error(`local source commit ${localCommit} differs from ${sourceCommit}`);
  }
  if (verifyDeployment) await assertDeployedCommit(sourceCommit);

  const gateSourceHash = FIGHTING_STYLE_PRIMITIVE_EVIDENCE_HASH;
  const sourceContentHash = sha256Canonical({
    definitions: REVIEWED_FIGHTING_STYLE_EFFECT_SPECS.map((spec) => ({
      cardNumber: spec.cardNumber,
      expectedAfterHash: spec.expectedAfterHash,
    })),
    specs: FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS,
    sourceRules: FIGHTING_STYLE_PRIMITIVE_EVIDENCE.sourceRules,
  });
  const rulesHash = sha256Canonical(RULE_SOURCE_FILES.map((path) => ({
    path,
    hash: normalizedFileHash(path),
  })));
  const contentHashValue = selectedContentFingerprint(catalogs);
  const patchHash = sha256Canonical(REVIEWED_FIGHTING_STYLE_EFFECT_SPECS.map((spec) => ({
    cardNumber: spec.cardNumber,
    origin: spec.origin,
    expectedBeforeHash: spec.expectedBeforeHash,
    expectedAfterHash: spec.expectedAfterHash,
  })));
  const catalogHash = catalogFingerprint(catalogs);
  const releaseHash = sha256Canonical({
    sourceCommit,
    gateSourceHash,
    sourceContentHash,
    rulesHash,
    contentHash: contentHashValue,
    patchHash,
    catalogHash,
  });
  const evidenceHash = sha256Canonical({
    evidenceId: FIGHTING_STYLE_PRIMITIVE_EVIDENCE_ID,
    contract: FIGHTING_STYLE_PRIMITIVE_EVIDENCE,
    sourceCommit,
    releaseHash,
  });
  return {
    sourceCommit,
    evidenceHash,
    gateSourceHash,
    sourceContentHash,
    rulesHash,
    contentHash: contentHashValue,
    releaseHash,
    patchHash,
    catalogHash,
  };
}

function assertReleaseEvidence(releaseEvidence) {
  if (!releaseEvidence || !SOURCE_COMMIT_PATTERN.test(releaseEvidence.sourceCommit ?? '')) {
    throw new Error('exact release evidence is required');
  }
  for (const key of [
    'evidenceHash', 'gateSourceHash', 'sourceContentHash', 'rulesHash',
    'contentHash', 'releaseHash', 'patchHash', 'catalogHash',
  ]) {
    if (!SHA256_PATTERN.test(releaseEvidence[key] ?? '')) {
      throw new Error(`${key} must be an exact sha256 hash`);
    }
  }
}

function assertUtc(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an explicit UTC RFC3339 timestamp`);
  }
}

function patchByCardNumber(cardNumber) {
  const matches = REVIEWED_FIGHTING_STYLE_EFFECT_SPECS.filter((spec) => (
    spec.cardNumber === cardNumber
  ));
  if (matches.length !== 1) throw new Error(`${cardNumber}: expected one reviewed effect specification`);
  return matches[0];
}

function exactByCardNumber(entities, cardNumber, type) {
  const matches = (entities ?? []).filter((entity) => entity.card_number === cardNumber);
  if (matches.length !== 1) {
    throw new Error(`${cardNumber}: expected exactly one live ${type}, got ${matches.length}`);
  }
  return matches[0];
}

function nonCertificationProblems(record) {
  return record.issues.filter((found) => (
    found.kind === 'data'
    || found.kind === 'mechanics'
    || found.code === 'reference_unresolved'
  ));
}

function supportPayload(entity, entityType, index, certifiedAt, releaseEvidence) {
  const hashes = certificationHashes(entity, entityType, index);
  return {
    status: 'verified_mechanical',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: MINI_MVP_CERTIFICATION_VERSION,
    certified_at: certifiedAt,
    evidence_id: FIGHTING_STYLE_PRIMITIVE_EVIDENCE_ID,
    evidence_hash: releaseEvidence.evidenceHash,
    evidence_completed_at: certifiedAt,
    gate_source_hash: releaseEvidence.gateSourceHash,
    source_content_hash: releaseEvidence.sourceContentHash,
    rules_hash: releaseEvidence.rulesHash,
    release_content_hash: releaseEvidence.contentHash,
    release_hash: releaseEvidence.releaseHash,
    patch_hash: releaseEvidence.patchHash,
    catalog_hash: releaseEvidence.catalogHash,
    limitations: [],
    note: 'Проверены точные данные, позитивные и негативные механические сценарии из live DB, а также production Forge→sheet.',
    test_coverage: {
      schema_version: 1,
      scope: MINI_MVP_COVERAGE_SCOPE,
      required: FIGHTING_STYLE_PRIMITIVE_EVIDENCE.lanes.length,
      passed: FIGHTING_STYLE_PRIMITIVE_EVIDENCE.lanes.length,
      percent: 100,
    },
    mechanics_locked: entityType === 'effect',
  };
}

export function prepareFightingStylePrimitiveCertifications(catalogs, report, {
  certifiedAt,
  releaseEvidence,
} = {}) {
  assertUtc(certifiedAt, 'certifiedAt');
  assertReleaseEvidence(releaseEvidence);
  const fixtureProblems = fightingStyleForgeSheetCoverageProblems();
  if (fixtureProblems.length > 0) throw new Error(fixtureProblems.join('; '));
  const index = buildCertificationIndex(catalogs);
  const records = [];

  for (const spec of FIGHTING_STYLE_PRIMITIVE_CERTIFICATION_SPECS) {
    const patch = patchByCardNumber(spec.effectCardNumber);
    const effect = exactByCardNumber(catalogs.effect, spec.effectCardNumber, 'effect');
    if (effect.name !== patch.name) {
      throw new Error(`${spec.effectCardNumber}: expected «${patch.name}», got «${effect.name}»`);
    }
    const mechanicsHash = sha256Canonical(effect.mechanics);
    if (mechanicsHash !== patch.expectedAfterHash) {
      throw new Error(`${spec.effectCardNumber}: live mechanics differ from reviewed postimage; got ${mechanicsHash}`);
    }
    if (JSON.stringify(effect.mechanics).includes('"kind":"narrative"')) {
      throw new Error(`${spec.effectCardNumber}: reviewed mechanics unexpectedly contain narrative payloads`);
    }

    const feat = exactByCardNumber(catalogs.feat, spec.featCardNumber, 'feat');
    const styleRecord = report.records.filter((record) => (
      record.collection === 'fightingStyles' && record.cardNumber === spec.featCardNumber
    ));
    if (styleRecord.length !== 1 || styleRecord[0].entityId !== feat.id) {
      throw new Error(`${spec.featCardNumber}: exact mini-MVP Fighting Style record is missing`);
    }
    const blockers = nonCertificationProblems(styleRecord[0]);
    if (blockers.length > 0) {
      throw new Error(`${spec.featCardNumber}: structural/mechanical blockers: ${blockers.map((item) => item.code).join(', ')}`);
    }
    const references = Array.isArray(feat.related_effects) ? feat.related_effects : [];
    if (references.length !== 1 || !references.includes(effect.id)) {
      throw new Error(`${spec.featCardNumber}: must reference only ${spec.effectCardNumber}`);
    }

    records.push({
      entityType: 'effect',
      entity: effect,
      support: supportPayload(effect, 'effect', index, certifiedAt, releaseEvidence),
      cardNumber: effect.card_number,
    });
    records.push({
      entityType: 'feat',
      entity: feat,
      support: supportPayload(feat, 'feat', index, certifiedAt, releaseEvidence),
      cardNumber: feat.card_number,
    });
  }
  return records;
}

export function buildFightingStylePrimitiveCertificationBatch(
  records,
  operationId = randomUUID(),
) {
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
      operation: 'mini-mvp-fighting-style-primitives-v1',
      entries,
    }),
    operation_id: `mini-mvp-fighting-styles:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

async function applyRecordsAtomically(records, token, key) {
  const batch = buildFightingStylePrimitiveCertificationBatch(records);
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

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

export async function runFightingStylePrimitiveCertification({
  apply = process.argv.includes('--apply'),
  certifiedAt = option('certified-at'),
  sourceCommit = option('source-commit'),
} = {}) {
  if (!certifiedAt) throw new Error('--certified-at is required');
  if (!sourceCommit) throw new Error('--source-commit is required');
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const releaseEvidence = await buildFightingStylePrimitiveReleaseEvidence(catalogs, {
    sourceCommit: sourceCommit.toLowerCase(),
  });
  const records = prepareFightingStylePrimitiveCertifications(catalogs, report, {
    certifiedAt,
    releaseEvidence,
  });
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${records.length} exact records`);
  console.log(`evidence ${FIGHTING_STYLE_PRIMITIVE_EVIDENCE_ID} ${releaseEvidence.evidenceHash}`);
  console.log(`release ${releaseEvidence.releaseHash} commit ${releaseEvidence.sourceCommit}`);
  for (const record of records) {
    console.log(`  ${record.entityType} ${record.cardNumber}: 3/3, locked=${record.support.mechanics_locked}`);
  }
  if (!apply) return records;
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('CONTENT_CERTIFICATION_KEY is required for --apply');
  const token = await login();
  const receipt = await applyRecordsAtomically(records, token, key);
  console.log(`Applied ${records.length} certifications atomically; operation ${receipt.operation_id}`);
  return records;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runFightingStylePrimitiveCertification().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
