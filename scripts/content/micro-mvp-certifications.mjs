#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiUrl, fetchAll, login } from './api.mjs';
import {
  COLLECTION_ENTITY_TYPES,
  ENTITY_ENDPOINTS,
  resolveManifestEntry,
} from './micro-micro-gate.mjs';
import {
  MICRO_MVP_COLLECTION_SIZES,
  MICRO_MVP_MANIFEST,
  flattenMicroMvpManifest,
  validateMicroMvpManifest,
} from './micro-mvp-manifest.mjs';
import {
  buildCertificationIndex,
  canonicalJson,
  certificationHashes,
  contentHash,
  sha256Canonical,
} from './certification-hash.mjs';
import {
  MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
  REQUIRED_RELEASE_GATES,
  assertExactHttpOrigin,
  microMvpCatalogFingerprint,
  microMvpReleaseEvidenceBinding,
  readMicroMvpReleaseEvidence,
  validateMicroMvpTestCoverageSummary,
} from './micro-mvp-release-evidence.mjs';
import { assertPrivateRegularFile } from './private-artifact.mjs';

/**
 * This version names the certified milestone, not the retired product name.
 * Changing the executable obligation suite requires a new version even when
 * the catalog bytes themselves stay unchanged.
 */
export const MICRO_MVP_CERTIFICATION_VERSION = 'micro-mvp-l1-rules-core-v4';

/**
 * A release timestamp is data, not wall-clock state.  The CLI may override it
 * explicitly, but never silently substitutes the time at which it happens to
 * run.  This makes a reviewed plan reproducible and lets postimage validation
 * compare `certified_at` byte-for-byte.
 */
export const MICRO_MVP_CERTIFIED_AT = '2026-08-05T00:00:00Z';

/** Conditions are engine effects and therefore certified beside the 49 core
 * catalog entries. Their behavior identity is declared in mechanics, while
 * card_number remains only a stable database selector. */
export const MICRO_MVP_CONDITION_TARGETS = Object.freeze([
  ['blinded', 'COND-blinded'],
  ['charmed', 'COND-charmed'],
  ['deafened', 'COND-deafened'],
  ['exhaustion', 'COND-exhaustion'],
  ['frightened', 'COND-frightened'],
  ['grappled', 'COND-grappled'],
  ['incapacitated', 'COND-incapacitated'],
  ['invisible', 'COND-invisible'],
  ['paralyzed', 'COND-paralyzed'],
  ['petrified', 'COND-petrified'],
  ['poisoned', 'COND-poisoned'],
  ['prone', 'COND-prone'],
  ['restrained', 'COND-restrained'],
  ['stunned', 'COND-stunned'],
  ['unconscious', 'COND-unconscious'],
].map(([id, cardNumber]) => Object.freeze({
  key: `condition.${id}`,
  collection: 'conditions',
  entity_type: 'effect',
  table: 'effects',
  id,
  cardNumber,
})));

const CONTENT_PATCH = JSON.parse(readFileSync(new URL(
  '../../frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
  import.meta.url,
), 'utf8'));
const CONDITION_PATCH_BY_CARD = new Map(CONTENT_PATCH.conditionPatches.map((declaration) => (
  [declaration.cardNumber, declaration]
)));
const CONDITION_CERTIFIED_FIELDS = Object.freeze([
  'name', 'name_en', 'description', 'effect_type', 'repeatable', 'mechanics',
]);

function selectedConditionFields(value) {
  return Object.fromEntries(CONDITION_CERTIFIED_FIELDS.map((field) => [field, value?.[field]]));
}

export const MICRO_MVP_CONDITION_MECHANICS = Object.freeze(Object.fromEntries(
  MICRO_MVP_CONDITION_TARGETS.map((target) => {
    const declaration = CONDITION_PATCH_BY_CARD.get(target.cardNumber);
    if (!declaration
      || declaration.fields?.mechanics?.condition?.id !== target.id
      || canonicalJson(declaration.fields.mechanics) !== canonicalJson(declaration.createFields?.mechanics)) {
      throw new Error(`${target.key}: versioned content patch has no exact condition mechanics`);
    }
    return [target.id, Object.freeze(JSON.parse(JSON.stringify(declaration.fields.mechanics)))];
  }),
));
export const MICRO_MVP_CONDITION_FIELDS = Object.freeze(Object.fromEntries(
  MICRO_MVP_CONDITION_TARGETS.map((target) => {
    const declaration = CONDITION_PATCH_BY_CARD.get(target.cardNumber);
    const fields = selectedConditionFields(declaration?.fields);
    const createFields = selectedConditionFields(declaration?.createFields);
    if (fields.effect_type !== 'condition'
      || canonicalJson(fields) !== canonicalJson(createFields)) {
      throw new Error(`${target.key}: versioned content patch has no exact condition fields`);
    }
    return [target.id, Object.freeze(JSON.parse(JSON.stringify(fields)))];
  }),
));

/**
 * Content support is attached to the full PHB card while this release proves
 * only its level-1 micro-MVP slice.  `verified_partial` is therefore deliberate:
 * the release evidence is complete for the milestone without claiming that a
 * class, species, feat, or spell is already complete through level 20.
 */
export const MICRO_MVP_LIMITATIONS = Object.freeze({
  classes: [
    'Сертифицирована полная механика micro-MVP для персонажа 1-го уровня; уровни 2–20, подклассы и их выборы относятся к следующим вехам.',
  ],
  species: [
    'Сертифицированы все особенности вида, доступные персонажу 1-го уровня; особенности, открывающиеся на последующих уровнях, относятся к следующим вехам.',
  ],
  backgrounds: [
    'Сертифицирована сборка 1-го уровня; официальный grant черты происхождения намеренно заменён продуктовым правилом free_origin_feat_choice_v1.',
  ],
  originFeats: [
    'Сертифицировано поведение черты на 1-м уровне; пересчёт и взаимодействия после повышения уровня относятся к следующим вехам.',
  ],
  cantrips: [
    'Сертифицировано исполнение на 1-м уровне; увеличение числа костей и лучей на последующих уровнях относится к следующим вехам.',
  ],
  firstLevelSpells: [
    'Сертифицировано исполнение заклинания слотом 1-го уровня; применение слотами более высокого уровня относится к следующим вехам.',
  ],
  fightingStyles: [
    'Сертифицировано поведение стиля у Воина 1-го уровня; получение и сочетание дополнительных стилей на последующих уровнях относится к следующим вехам.',
  ],
});

// No entity-specific implementation gaps remain inside the micro-MVP scope.
// Future limitations belong here only when they name behavior inside that
// scope; milestone boundaries stay in MICRO_MVP_LIMITATIONS above.
export const MICRO_MVP_ENTITY_LIMITATIONS = Object.freeze({});

const coreDenominator = () => Object.values(MICRO_MVP_COLLECTION_SIZES)
  .reduce((total, size) => total + size, 0);
const expectedDenominator = () => coreDenominator() + MICRO_MVP_CONDITION_TARGETS.length;

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const stableClone = (value) => JSON.parse(JSON.stringify(value));

function releaseEvidenceSupport(evidence) {
  if (!evidence) return {};
  return {
    evidence_id: evidence.evidenceId,
    evidence_hash: evidence.sha256,
    evidence_completed_at: evidence.completedAt,
    gate_source_hash: evidence.release.sourceHash,
    source_content_hash: evidence.release.sourceContentHash,
    rules_hash: evidence.release.rulesHash,
    release_content_hash: evidence.release.contentHash,
    release_hash: evidence.release.releaseHash,
    patch_hash: evidence.release.patchHash,
    catalog_hash: evidence.catalog.hash,
  };
}

function entityCoverageSupport(evidence, key, entityType) {
  if (!evidence) return {};
  const coverage = evidence.testCoverage?.entities?.[key];
  if (!coverage) throw new Error(`${key}: release evidence has no entity test coverage`);
  if (coverage.passed !== coverage.required || coverage.percent !== 100) {
    throw new Error(`${key}: release evidence entity coverage is incomplete`);
  }
  return {
    test_coverage: stableClone(coverage),
    ...(['action', 'effect', 'spell'].includes(entityType) ? { mechanics_locked: true } : {}),
  };
}

function assertReleaseEvidenceBinding(evidence, { apiBase, catalogs } = {}) {
  const requiredGateIds = REQUIRED_RELEASE_GATES.map((gate) => gate.id);
  const deployment = evidence?.deploymentAttestation;
  if (!evidence || evidence.schemaVersion !== MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION
    || !UUID_PATTERN.test(evidence.evidenceId ?? '')
    || !SHA256_PATTERN.test(evidence.sha256 ?? '')
    || !nonEmptyString(evidence.apiBase)
    || !nonEmptyString(evidence.release?.releaseId)
    || !Number.isSafeInteger(evidence.release?.sourceFileCount)
    || evidence.release.sourceFileCount < 1
    || !Array.isArray(evidence.gateIds)
    || canonicalJson(evidence.gateIds) !== canonicalJson(requiredGateIds)
    || !deployment
    || !/^[0-9a-f]{40}$/.test(deployment.sourceCommit ?? '')
    || deployment.sourceCommit !== deployment.expectedDeployedCommit
    || deployment.basis !== 'operator-supplied-commit-identity'
    || deployment.externalVerificationRequired !== true
    || !evidence.release || !evidence.catalog) {
    throw new Error('certification plan is missing a valid release evidence binding');
  }
  assertExactHttpOrigin(evidence.frontendBase, 'release evidence frontendBase');
  assertRfc3339Utc(evidence.startedAt, 'release evidence startedAt');
  assertRfc3339Utc(evidence.completedAt, 'release evidence completedAt');
  if (Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)) {
    throw new Error('release evidence completed before it started');
  }
  if (apiBase && evidence.apiBase !== apiBase) {
    throw new Error('release evidence API differs from the certification plan API');
  }
  for (const [field, value] of Object.entries({
    sourceHash: evidence.release.sourceHash,
    sourceContentHash: evidence.release.sourceContentHash,
    rulesHash: evidence.release.rulesHash,
    contentHash: evidence.release.contentHash,
    releaseHash: evidence.release.releaseHash,
    patchHash: evidence.release.patchHash,
    catalogHash: evidence.catalog.hash,
  })) {
    if (!SHA256_PATTERN.test(value ?? '')) throw new Error(`release evidence ${field} is invalid`);
  }
  validateMicroMvpTestCoverageSummary(evidence.testCoverage, evidence.release);
  if (catalogs
    && canonicalJson(evidence.catalog) !== canonicalJson(microMvpCatalogFingerprint(catalogs))) {
    throw new Error('release evidence catalog fingerprint differs from the certification preimages');
  }
  return evidence;
}

function withoutUpdatedAt(entity) {
  return Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'updated_at'));
}

function assertRfc3339Utc(value, label = 'certified_at') {
  if (!nonEmptyString(value)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an explicit UTC RFC3339 timestamp`);
  }
}

function duplicateValues(items, selector) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const value = selector(item);
    if (!nonEmptyString(value)) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

/**
 * Certification hashes use id/card_number references transitively.  Ambiguous
 * identities would therefore make a seemingly valid hash describe an
 * accidental dependency graph.  Reject them before producing any plan.
 */
export function assertCertificationCatalogIntegrity(entityGroups, {
  requiredEntityTypes = Object.keys(ENTITY_ENDPOINTS),
} = {}) {
  for (const entityType of requiredEntityTypes) {
    const entities = entityGroups?.[entityType];
    if (!Array.isArray(entities)) {
      throw new Error(`catalog ${entityType} must be an array`);
    }
    const duplicateIds = duplicateValues(entities, (entity) => entity?.id);
    const duplicateCards = duplicateValues(entities, (entity) => entity?.card_number);
    if (duplicateIds.length || duplicateCards.length) {
      throw new Error(
        `catalog ${entityType} has duplicate identities`
        + `${duplicateIds.length ? `; ids: ${duplicateIds.join(', ')}` : ''}`
        + `${duplicateCards.length ? `; card_numbers: ${duplicateCards.join(', ')}` : ''}`,
      );
    }
  }
}

function certificationBaseTargets(entityGroups, index) {
  const core = flattenMicroMvpManifest(MICRO_MVP_MANIFEST).map((item) => {
    const type = COLLECTION_ENTITY_TYPES[item.collection];
    const resolved = resolveManifestEntry(item, entityGroups[type] ?? []);
    if (!resolved.entity || !['not_certified', 'ready'].includes(resolved.status)) {
      throw new Error(`${item.key}: невозможно построить покрытие (${resolved.status})`);
    }
    return { key: item.key, type, entity: resolved.entity };
  });
  const conditions = MICRO_MVP_CONDITION_TARGETS.map((target) => {
    const matches = (entityGroups.effect ?? []).filter((entity) => (
      entity?.card_number === target.cardNumber
      && entity?.mechanics?.condition?.id === target.id
    ));
    if (matches.length !== 1) {
      throw new Error(`${target.key}: невозможно однозначно построить покрытие состояния`);
    }
    return { key: target.key, type: 'effect', entity: matches[0] };
  });
  return [...core, ...conditions].map((target) => ({
    ...target,
    identity: `${target.type}:${target.entity.id}`,
    dependencies: certificationHashes(target.entity, target.type, index).dependencies,
  }));
}

function dependencyCoverageKey(type, entity) {
  if (!nonEmptyString(entity?.card_number)) {
    throw new Error(`${type}:${entity?.id ?? '<unknown>'}: dependency has no stable card_number`);
  }
  return `dependency.${type}.${entity.card_number}`;
}

function addCoverageContributor(contributors, identity, key) {
  const keys = contributors.get(identity) ?? new Set();
  keys.add(key);
  contributors.set(identity, keys);
}

/**
 * Expand the 64 independently tested root/state rows to the exact transitive
 * DB closure they exercised. A dependency is green only if every root usage
 * that reaches it is green; counts remain auditable rather than becoming a
 * boolean inherited badge.
 */
export function expandMicroMvpCoverageSummaryForCatalogs(summary, entityGroups) {
  validateMicroMvpTestCoverageSummary(summary);
  assertCertificationCatalogIntegrity(entityGroups);
  const index = buildCertificationIndex(entityGroups);
  const targets = certificationBaseTargets(entityGroups, index);
  const expectedBaseKeys = new Set(targets.map((target) => target.key));
  const actualBaseKeys = Object.keys(summary.entities).filter((key) => !key.startsWith('dependency.'));
  if (actualBaseKeys.length !== expectedBaseKeys.size
    || actualBaseKeys.some((key) => !expectedBaseKeys.has(key))) {
    throw new Error('base test coverage does not exactly match the micro-MVP roots and conditions');
  }

  const contributors = new Map();
  const entitiesByIdentity = new Map();
  const baseKeyByIdentity = new Map();
  for (const target of targets) {
    if (baseKeyByIdentity.has(target.identity)) {
      throw new Error(`${target.identity}: duplicate base certification identity`);
    }
    baseKeyByIdentity.set(target.identity, target.key);
    entitiesByIdentity.set(target.identity, { type: target.type, entity: target.entity });
    addCoverageContributor(contributors, target.identity, target.key);
    for (const dependency of target.dependencies) {
      if (!ENTITY_ENDPOINTS[dependency.type]) continue;
      const indexed = index.byIdentity.get(dependency.identity);
      if (!indexed) throw new Error(`${dependency.identity}: dependency disappeared from catalog index`);
      entitiesByIdentity.set(dependency.identity, indexed);
      addCoverageContributor(contributors, dependency.identity, target.key);
    }
  }

  const entries = [...contributors.entries()].map(([identity, contributorKeys]) => {
    const indexed = entitiesByIdentity.get(identity);
    const key = baseKeyByIdentity.get(identity)
      ?? dependencyCoverageKey(indexed.type, indexed.entity);
    const coverages = [...contributorKeys].sort().map((contributorKey) => {
      const coverage = summary.entities[contributorKey];
      if (!coverage) throw new Error(`${identity}: missing contributor coverage ${contributorKey}`);
      return coverage;
    });
    const required = coverages.reduce((total, coverage) => total + coverage.required, 0);
    const passed = coverages.reduce((total, coverage) => total + coverage.passed, 0);
    return [key, {
      schema_version: 1,
      scope: 'micro-mvp-l1',
      required,
      passed,
      percent: Math.floor((passed * 100) / required),
    }];
  }).sort(([left], [right]) => left.localeCompare(right));
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error('expanded test coverage contains duplicate stable entity keys');
  }
  const entities = Object.fromEntries(entries);
  const required = entries.reduce((total, [, coverage]) => total + coverage.required, 0);
  const passed = entries.reduce((total, [, coverage]) => total + coverage.passed, 0);
  return validateMicroMvpTestCoverageSummary({
    ...summary,
    required,
    passed,
    percent: Math.floor((passed * 100) / required),
    entities,
  });
}

export async function loadCertificationCatalogs(fetcher = fetchAll, {
  baseUrl = apiUrl(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const catalogs = Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([entityType, [path, key]]) => [
      entityType,
      await fetcher(path, key, { baseUrl, fetchImpl, limit: 1000 }),
    ]),
  ));
  assertCertificationCatalogIntegrity(catalogs);
  return catalogs;
}

export function assertExactCertificationDenominator(records) {
  const manifestIssues = validateMicroMvpManifest(MICRO_MVP_MANIFEST);
  if (manifestIssues.length) {
    throw new Error(`micro-MVP manifest is invalid: ${manifestIssues.join('; ')}`);
  }

  const manifestEntries = flattenMicroMvpManifest(MICRO_MVP_MANIFEST);
  const baseDenominator = expectedDenominator();
  if (manifestEntries.length !== coreDenominator()) {
    throw new Error(
      `micro-MVP manifest denominator drift: collections declare ${coreDenominator()}, manifest has ${manifestEntries.length}`,
    );
  }
  if (!Array.isArray(records) || records.length < baseDenominator) {
    throw new Error(
      `micro-MVP certification denominator must contain at least ${baseDenominator} records, got ${records?.length ?? '<non-array>'}`,
    );
  }

  const expectedTargets = [
    ...manifestEntries.map((item) => ({
      ...item,
      entity_type: COLLECTION_ENTITY_TYPES[item.collection],
      table: ENTITY_ENDPOINTS[COLLECTION_ENTITY_TYPES[item.collection]][0].replace('/api/', ''),
      cardNumber: item.selector.cardNumber,
    })),
    ...MICRO_MVP_CONDITION_TARGETS,
  ];
  const expectedKeys = new Set(expectedTargets.map((item) => item.key));
  const expectedByKey = new Map(expectedTargets.map((item) => [item.key, item]));
  const baseRecords = records.filter((record) => record?.collection !== 'dependencies');
  const dependencyRecords = records.filter((record) => record?.collection === 'dependencies');
  const actualKeys = baseRecords.map((record) => record?.key);
  const duplicateKeys = duplicateValues(records, (record) => record?.key);
  const missingKeys = [...expectedKeys].filter((key) => !actualKeys.includes(key));
  const unexpectedKeys = actualKeys.filter((key) => !expectedKeys.has(key));
  if (duplicateKeys.length || missingKeys.length || unexpectedKeys.length) {
    throw new Error(
      'micro-MVP certification keys do not exactly match the manifest'
      + `${duplicateKeys.length ? `; duplicates: ${duplicateKeys.join(', ')}` : ''}`
      + `${missingKeys.length ? `; missing: ${missingKeys.join(', ')}` : ''}`
      + `${unexpectedKeys.length ? `; unexpected: ${unexpectedKeys.join(', ')}` : ''}`,
    );
  }

  const duplicateIds = duplicateValues(records, (record) => (
    nonEmptyString(record?.entity_type) && nonEmptyString(record?.id)
      ? `${record.entity_type}:${record.id}`
      : null
  ));
  const duplicateCards = duplicateValues(records, (record) => (
    nonEmptyString(record?.entity_type) && nonEmptyString(record?.card_number)
      ? `${record.entity_type}:${record.card_number}`
      : null
  ));
  const invalidIdentity = records.find((record) => (
    !nonEmptyString(record?.entity_type)
    || !nonEmptyString(record?.id)
    || !nonEmptyString(record?.card_number)
  ));
  if (invalidIdentity || duplicateIds.length || duplicateCards.length) {
    throw new Error(
      'micro-MVP certification target identities are invalid or duplicated'
      + `${invalidIdentity ? `; invalid: ${invalidIdentity?.key ?? '<unknown>'}` : ''}`
      + `${duplicateIds.length ? `; ids: ${duplicateIds.join(', ')}` : ''}`
      + `${duplicateCards.length ? `; card_numbers: ${duplicateCards.join(', ')}` : ''}`,
    );
  }

  for (const record of baseRecords) {
    const expected = expectedByKey.get(record.key);
    if (record.collection !== expected.collection
      || record.entity_type !== expected.entity_type
      || record.card_number !== expected.cardNumber
      || record.table !== expected.table) {
      throw new Error(`${record.key}: certification identity does not match its manifest entry`);
    }
  }

  for (const [collection, expectedSize] of Object.entries(MICRO_MVP_COLLECTION_SIZES)) {
    const actual = records.filter((record) => record.collection === collection).length;
    if (actual !== expectedSize) {
      throw new Error(
        `micro-MVP certification collection ${collection} must contain ${expectedSize}, got ${actual}`,
      );
    }
  }
  const conditionCount = records.filter((record) => record.collection === 'conditions').length;
  if (conditionCount !== MICRO_MVP_CONDITION_TARGETS.length) {
    throw new Error(
      `micro-MVP certification collection conditions must contain ${MICRO_MVP_CONDITION_TARGETS.length}, got ${conditionCount}`,
    );
  }

  const baseIdentities = new Set(baseRecords.map((record) => `${record.entity_type}:${record.id}`));
  const expectedDependencies = new Map();
  for (const record of baseRecords) {
    if (!Array.isArray(record.dependencies)) {
      throw new Error(`${record.key}: certification dependencies must be an array`);
    }
    for (const dependency of record.dependencies) {
      if (!ENTITY_ENDPOINTS[dependency?.type] || baseIdentities.has(dependency?.identity)) continue;
      const existing = expectedDependencies.get(dependency.identity);
      if (existing && existing.content_hash !== dependency.content_hash) {
        throw new Error(`${dependency.identity}: inconsistent dependency content hashes`);
      }
      expectedDependencies.set(dependency.identity, dependency);
    }
  }
  const actualDependencyIdentities = new Set(dependencyRecords.map((record) => (
    `${record.entity_type}:${record.id}`
  )));
  const missingDependencies = [...expectedDependencies.keys()]
    .filter((identity) => !actualDependencyIdentities.has(identity));
  const unexpectedDependencies = [...actualDependencyIdentities]
    .filter((identity) => !expectedDependencies.has(identity));
  if (dependencyRecords.length !== expectedDependencies.size
    || missingDependencies.length || unexpectedDependencies.length) {
    throw new Error(
      'micro-MVP dependency certification closure is incomplete'
      + `${missingDependencies.length ? `; missing: ${missingDependencies.join(', ')}` : ''}`
      + `${unexpectedDependencies.length ? `; unexpected: ${unexpectedDependencies.join(', ')}` : ''}`,
    );
  }
  for (const record of dependencyRecords) {
    const identity = `${record.entity_type}:${record.id}`;
    const expected = expectedDependencies.get(identity);
    if (record.key !== dependencyCoverageKey(record.entity_type, record.before)
      || record.table !== ENTITY_ENDPOINTS[record.entity_type]?.[0].replace('/api/', '')
      || contentHash(record.before) !== expected.content_hash
      || record.card_number !== record.before?.card_number) {
      throw new Error(`${record.key}: dependency certification identity or content is invalid`);
    }
  }
}

export function prepareMicroMvpCertifications(entityGroups, {
  certifiedAt = MICRO_MVP_CERTIFIED_AT,
  evidence = null,
} = {}) {
  assertRfc3339Utc(certifiedAt);
  if (evidence) assertReleaseEvidenceBinding(evidence, { catalogs: entityGroups });
  assertCertificationCatalogIntegrity(entityGroups, {
    requiredEntityTypes: [...new Set([...Object.values(COLLECTION_ENTITY_TYPES), 'effect'])],
  });
  const index = buildCertificationIndex(entityGroups);
  const coreRecords = flattenMicroMvpManifest(MICRO_MVP_MANIFEST).map((item) => {
    const entityType = COLLECTION_ENTITY_TYPES[item.collection];
    const resolved = resolveManifestEntry(item, entityGroups[entityType] ?? []);
    if (!resolved.entity || !['not_certified', 'ready'].includes(resolved.status)) {
      throw new Error(`${item.key}: невозможно сертифицировать (${resolved.status})`);
    }
    const hashes = certificationHashes(resolved.entity, entityType, index);
    const limitations = [
      ...MICRO_MVP_LIMITATIONS[item.collection],
      ...(MICRO_MVP_ENTITY_LIMITATIONS[item.key] ?? []),
    ];
    return {
      key: item.key,
      collection: item.collection,
      entity_type: entityType,
      table: ENTITY_ENDPOINTS[entityType][0].replace('/api/', ''),
      id: resolved.entity.id,
      card_number: resolved.entity.card_number,
      name: resolved.entity.name,
      before: stableClone(resolved.entity),
      beforeHash: sha256Canonical(resolved.entity),
      support: {
        status: 'verified_partial',
        content_hash: hashes.contentHash,
        dependency_hash: hashes.dependencyHash,
        certification_version: MICRO_MVP_CERTIFICATION_VERSION,
        certified_at: certifiedAt,
        limitations,
        note: 'Полностью проверено автоматическим rules-core acceptance-аудитом в границах micro-MVP первого уровня.',
        ...releaseEvidenceSupport(evidence),
        ...entityCoverageSupport(evidence, item.key, entityType),
      },
      dependencies: hashes.dependencies,
    };
  });
  const conditionRecords = MICRO_MVP_CONDITION_TARGETS.map((target) => {
    const matches = (entityGroups.effect ?? []).filter((entity) => {
      const condition = entity?.mechanics?.condition;
      return condition && typeof condition === 'object' && condition.id === target.id;
    });
    if (matches.length !== 1 || matches[0].card_number !== target.cardNumber) {
      throw new Error(
        `${target.key}: expected one effect with mechanics.condition.id=${target.id} and card_number=${target.cardNumber}`,
      );
    }
    const entity = matches[0];
    if (entity.effect_type !== 'condition') {
      throw new Error(
        `${target.key}: effect_type must be condition so the browser condition API can load it`,
      );
    }
    const expectedFields = MICRO_MVP_CONDITION_FIELDS[target.id];
    if (canonicalJson(selectedConditionFields(entity)) !== canonicalJson(expectedFields)) {
      throw new Error(
        `${target.key}: condition fields differ from the exact versioned content patch`,
      );
    }
    const hashes = certificationHashes(entity, 'effect', index);
    return {
      key: target.key,
      collection: target.collection,
      entity_type: target.entity_type,
      table: target.table,
      id: entity.id,
      card_number: entity.card_number,
      name: entity.name,
      before: stableClone(entity),
      beforeHash: sha256Canonical(entity),
      support: {
        status: 'verified_mechanical',
        content_hash: hashes.contentHash,
        dependency_hash: hashes.dependencyHash,
        certification_version: MICRO_MVP_CERTIFICATION_VERSION,
        certified_at: certifiedAt,
        limitations: [],
        note: 'Полностью проверено micro-MVP атомарными unit- и two-PC обязательствами состояний PHB 2024.',
        ...releaseEvidenceSupport(evidence),
        ...entityCoverageSupport(evidence, target.key, 'effect'),
      },
      dependencies: hashes.dependencies,
    };
  });
  const baseRecords = [...coreRecords, ...conditionRecords];
  const baseIdentities = new Set(baseRecords.map((record) => (
    `${record.entity_type}:${record.id}`
  )));
  const dependencyTargets = new Map();
  for (const record of baseRecords) {
    for (const dependency of record.dependencies) {
      if (!ENTITY_ENDPOINTS[dependency.type] || baseIdentities.has(dependency.identity)) continue;
      dependencyTargets.set(dependency.identity, dependency);
    }
  }
  const dependencyRecords = [...dependencyTargets.values()]
    .sort((left, right) => left.identity.localeCompare(right.identity))
    .map((target) => {
      const indexed = index.byIdentity.get(target.identity);
      if (!indexed) throw new Error(`${target.identity}: dependency disappeared from catalog index`);
      const entity = indexed.entity;
      const entityType = indexed.type;
      const key = dependencyCoverageKey(entityType, entity);
      const hashes = certificationHashes(entity, entityType, index);
      return {
        key,
        collection: 'dependencies',
        entity_type: entityType,
        table: ENTITY_ENDPOINTS[entityType][0].replace('/api/', ''),
        id: entity.id,
        card_number: entity.card_number,
        name: entity.name,
        before: stableClone(entity),
        beforeHash: sha256Canonical(entity),
        support: {
          status: ['action', 'effect', 'spell'].includes(entityType)
            ? 'verified_mechanical'
            : 'verified_partial',
          content_hash: hashes.contentHash,
          dependency_hash: hashes.dependencyHash,
          certification_version: MICRO_MVP_CERTIFICATION_VERSION,
          certified_at: certifiedAt,
          limitations: [],
          note: 'Проверено во всех micro-MVP корневых сценариях, которые транзитивно используют эту сущность.',
          ...releaseEvidenceSupport(evidence),
          ...entityCoverageSupport(evidence, key, entityType),
        },
        dependencies: hashes.dependencies,
      };
    });
  const records = [...baseRecords, ...dependencyRecords];
  assertExactCertificationDenominator(records);
  return records;
}

function immutableCertificationRecord(record) {
  return {
    key: record.key,
    collection: record.collection,
    entity_type: record.entity_type,
    table: record.table,
    id: record.id,
    card_number: record.card_number,
    name: record.name,
    before: record.before,
    beforeHash: record.beforeHash,
    support: record.support,
    dependencies: record.dependencies,
  };
}

function planFields(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    bundleId: plan.bundleId,
    createdAt: plan.createdAt,
    apiBase: plan.apiBase,
    manifestVersion: plan.manifestVersion,
    certificationVersion: plan.certificationVersion,
    certifiedAt: plan.certifiedAt,
    evidence: plan.evidence ?? null,
    denominator: plan.denominator,
    records: plan.records.map(immutableCertificationRecord),
  };
}

export function certificationPlanHash(plan) {
  return sha256Canonical(planFields(plan));
}

export function assertCertificationPlanIntegrity(plan, { requireEvidence = false } = {}) {
  if (plan?.schemaVersion !== 2
    || plan?.kind !== 'micro-mvp-content-certification-bundle'
    || !UUID_PATTERN.test(plan?.bundleId ?? '')) {
    throw new Error('invalid micro-MVP certification bundle format');
  }
  assertRfc3339Utc(plan.certifiedAt, 'plan certifiedAt');
  assertRfc3339Utc(plan.createdAt, 'bundle createdAt');
  assertExactCertificationDenominator(plan.records);
  if (plan.denominator !== plan.records.length) {
    throw new Error(
      `micro-MVP certification plan denominator must equal its ${plan.records.length} exact records, got ${String(plan.denominator)}`,
    );
  }
  if (!nonEmptyString(plan.apiBase)) throw new Error('certification plan API base is empty');
  if (plan.manifestVersion !== MICRO_MVP_MANIFEST.manifestVersion) {
    throw new Error('micro-MVP manifest version drift');
  }
  if (plan.certificationVersion !== MICRO_MVP_CERTIFICATION_VERSION) {
    throw new Error('micro-MVP certification version drift');
  }
  if (plan.evidence) {
    assertReleaseEvidenceBinding(plan.evidence, { apiBase: plan.apiBase });
  } else if (requireEvidence) {
    throw new Error('persisted certification plan requires release evidence');
  }
  for (const record of plan.records) {
    const expectedStatus = record.collection === 'conditions'
      || (record.collection === 'dependencies'
        && ['action', 'effect', 'spell'].includes(record.entity_type))
      ? 'verified_mechanical'
      : 'verified_partial';
    if (record.support?.status !== expectedStatus
      || record.support?.certification_version !== plan.certificationVersion
      || record.support?.certified_at !== plan.certifiedAt) {
      throw new Error(`${record.key}: certification evidence differs from the plan release identity`);
    }
    const expectedReleaseEvidence = releaseEvidenceSupport(plan.evidence);
    for (const [field, expected] of Object.entries(expectedReleaseEvidence)) {
      if (record.support?.[field] !== expected) {
        throw new Error(`${record.key}: support release evidence differs from the immutable plan`);
      }
    }
    const expectedCoverage = entityCoverageSupport(
      plan.evidence,
      record.key,
      record.entity_type,
    );
    for (const [field, expected] of Object.entries(expectedCoverage)) {
      if (canonicalJson(record.support?.[field]) !== canonicalJson(expected)) {
        throw new Error(`${record.key}: support test coverage differs from the immutable plan`);
      }
    }
    if (!record.before || typeof record.before !== 'object' || Array.isArray(record.before)
      || !Object.prototype.hasOwnProperty.call(record.before, 'support')
      || record.before.id !== record.id
      || record.before.card_number !== record.card_number
      || sha256Canonical(record.before) !== record.beforeHash) {
      throw new Error(`${record.key}: exact full certification preimage is missing or invalid`);
    }
  }
  if (plan.planHash !== certificationPlanHash(plan)) {
    throw new Error('micro-MVP certification plan integrity hash is missing or invalid');
  }
}

export function createMicroMvpCertificationPlanFromCatalogs(entityGroups, {
  baseUrl = apiUrl(),
  certifiedAt = MICRO_MVP_CERTIFIED_AT,
  bundleId = randomUUID(),
  createdAt = new Date().toISOString(),
  evidence = null,
} = {}) {
  if (!nonEmptyString(baseUrl)) throw new Error('API_URL must not be empty');
  if (evidence) assertReleaseEvidenceBinding(evidence, { apiBase: baseUrl, catalogs: entityGroups });
  const records = prepareMicroMvpCertifications(entityGroups, { certifiedAt, evidence });
  const plan = {
    schemaVersion: 2,
    kind: 'micro-mvp-content-certification-bundle',
    bundleId,
    status: 'planned',
    createdAt,
    apiBase: baseUrl,
    manifestVersion: MICRO_MVP_MANIFEST.manifestVersion,
    certificationVersion: MICRO_MVP_CERTIFICATION_VERSION,
    certifiedAt,
    evidence: evidence ? stableClone(evidence) : null,
    denominator: records.length,
    records,
  };
  plan.planHash = certificationPlanHash(plan);
  return plan;
}

export async function createMicroMvpCertificationPlan({
  baseUrl = apiUrl(),
  certifiedAt = MICRO_MVP_CERTIFIED_AT,
  catalogLoader = () => loadCertificationCatalogs(fetchAll, { baseUrl }),
  evidence = null,
} = {}) {
  const catalogs = await catalogLoader();
  return createMicroMvpCertificationPlanFromCatalogs(catalogs, {
    baseUrl, certifiedAt, evidence,
  });
}

export function writeCertificationBundleAtomic(path, bundle, { refuseOverwrite = false } = {}) {
  if (!nonEmptyString(path)) throw new Error('--bundle must be a non-empty path');
  assertCertificationPlanIntegrity(bundle, { requireEvidence: true });
  const destination = resolve(path);
  const existing = assertPrivateRegularFile(
    destination,
    'certification bundle',
    { allowMissing: true },
  );
  if (refuseOverwrite && existing.exists) {
    throw new Error(`refusing to overwrite existing certification bundle: ${destination}`);
  }
  const directory = dirname(destination);
  mkdirSync(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, destination);
    // Windows does not permit fsync on directory handles. The file itself is
    // already durable before the atomic rename; POSIX additionally persists
    // the directory entry so a power loss cannot lose the rename.
    if (process.platform !== 'win32') {
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  assertPrivateRegularFile(destination, 'certification bundle');
  return destination;
}

export function readCertificationBundle(path) {
  if (!nonEmptyString(path)) {
    throw new Error('--bundle must point to an existing certification bundle');
  }
  const { path: resolved } = assertPrivateRegularFile(path, 'certification bundle');
  const bundle = JSON.parse(readFileSync(resolved, 'utf8'));
  assertCertificationPlanIntegrity(bundle, { requireEvidence: true });
  return bundle;
}

function exactCertificationTarget(entities, record) {
  const byId = entities.filter((entity) => entity.id === record.id);
  const byCard = entities.filter((entity) => entity.card_number === record.card_number);
  if (byId.length !== 1 || byCard.length !== 1 || byId[0] !== byCard[0]) {
    throw new Error(
      `${record.key}: postimage identity is missing, duplicated, or split `
      + `(${record.entity_type}:${record.id}/${record.card_number})`,
    );
  }
  return byId[0];
}

function assertCertificationPostimage(entity, record, index = null) {
  if (canonicalJson(entity.support ?? null) !== canonicalJson(record.support)) {
    throw new Error(`${record.key}: exact support postimage verification failed`);
  }
  if (contentHash(entity) !== record.support.content_hash) {
    throw new Error(`${record.key}: entity content changed during certification`);
  }
  if (index) {
    const hashes = certificationHashes(entity, record.entity_type, index);
    if (hashes.dependencyHash !== record.support.dependency_hash) {
      throw new Error(`${record.key}: dependency graph changed during certification`);
    }
  }
}

function samePlannedRecords(left, right) {
  return canonicalJson(left.map(immutableCertificationRecord))
    === canonicalJson(right.map(immutableCertificationRecord));
}

/** Support certification itself changes support (and may change updated_at),
 * so a resumed apply cannot compare the raw post-write catalog to the
 * pre-write release evidence. Reconstruct only the 64 immutable planned
 * preimages while leaving every non-target row untouched. The regular atomic
 * classifier still proves each target is exactly preimage or requested state;
 * this view keeps full-catalog drift protection valid across crash recovery. */
function releaseEvidenceCatalogView(plan, catalogs) {
  const preimages = new Map(plan.records.map((record) => [
    `${record.entity_type}:${record.id}`,
    record.before,
  ]));
  const observed = new Set();
  const view = Object.fromEntries(Object.entries(catalogs).map(([entityType, rows]) => [
    entityType,
    rows.map((row) => {
      const identity = `${entityType}:${row.id}`;
      const before = preimages.get(identity);
      if (!before) return row;
      observed.add(identity);
      return before;
    }),
  ]));
  if (observed.size !== preimages.size) {
    throw new Error('release evidence catalog is missing a planned certification target');
  }
  return view;
}

function expectedSupportPostimage(expectedCurrent, support) {
  return { ...stableClone(expectedCurrent), support: stableClone(support) };
}

function sameExceptUpdatedAt(left, right) {
  return canonicalJson(withoutUpdatedAt(left)) === canonicalJson(withoutUpdatedAt(right));
}

function classifyAtomicSupportState(plan, catalogs, { rollback = false } = {}) {
  let hasExpectedOnly = false;
  let hasRequestedOnly = false;
  const currentByKey = new Map();
  for (const record of plan.records) {
    const current = exactCertificationTarget(catalogs[record.entity_type], record);
    const expected = rollback ? record.after : record.before;
    const expectedHash = rollback ? record.afterHash : record.beforeHash;
    if (!expected || sha256Canonical(expected) !== expectedHash) {
      throw new Error(`${record.key}: ${rollback ? 'applied postimage' : 'preimage'} is missing or invalid`);
    }
    const requestedSupport = rollback ? record.before.support : record.support;
    const isExpected = sha256Canonical(current) === expectedHash;
    const isRequested = sameExceptUpdatedAt(
      current,
      expectedSupportPostimage(expected, requestedSupport),
    );
    if (!isExpected && !isRequested) {
      throw new Error(`${record.key}: current full entity is neither exact expected nor requested postimage`);
    }
    if (isExpected && !isRequested) hasExpectedOnly = true;
    if (isRequested && !isExpected) hasRequestedOnly = true;
    currentByKey.set(record.key, current);
  }
  if (hasExpectedOnly && hasRequestedOnly) {
    throw new Error('atomic certification set is mixed between expected and requested states');
  }
  return {
    state: hasRequestedOnly ? 'requested' : 'expected',
    currentByKey,
  };
}

async function postAtomicSupportBatch(plan, {
  mode,
  rollback = false,
  baseUrl,
  token,
  certificationKey,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/content-support/batch-exact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Content-Certification-Key': certificationKey,
    },
    body: JSON.stringify({
      schema_version: 1,
      mode,
      plan_hash: plan.planHash,
      operation_id: `${plan.bundleId}:${rollback ? 'rollback' : 'apply'}`,
      expected_count: plan.denominator,
      entries: plan.records.map((record) => ({
        entity_type: record.entity_type,
        entity_id: record.id,
        expected_current: rollback ? record.after : record.before,
        support: rollback ? record.before.support : record.support,
      })),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST atomic exact-support batch -> ${response.status}: ${text.slice(0, 500)}`);
  }
  const body = text ? JSON.parse(text) : null;
  if (body?.plan_hash !== plan.planHash || body?.total !== plan.denominator
    || body?.mode !== mode) {
    throw new Error('atomic exact-support batch returned an invalid receipt');
  }
  return body;
}

function persistCertificationProgress(plan, bundlePath) {
  if (!nonEmptyString(bundlePath)) {
    throw new Error('--bundle is required for durable certification mutation state');
  }
  writeCertificationBundleAtomic(bundlePath, plan);
}

function captureAppliedCertificationPostimages(plan, catalogs, bundlePath) {
  for (const record of plan.records) {
    const entity = exactCertificationTarget(catalogs[record.entity_type], record);
    if (!sameExceptUpdatedAt(entity, expectedSupportPostimage(record.before, record.support))) {
      throw new Error(`${record.key}: atomic apply postimage differs from the planned entity`);
    }
    record.after = stableClone(entity);
    record.afterHash = sha256Canonical(entity);
  }
  plan.status = 'applied-unverified';
  persistCertificationProgress(plan, bundlePath);

  const index = buildCertificationIndex(catalogs);
  try {
    for (const record of plan.records) {
      assertCertificationPostimage(record.after, record, index);
    }
  } catch (error) {
    plan.status = 'applied-verification-failed';
    plan.failure = error instanceof Error ? error.message : String(error);
    persistCertificationProgress(plan, bundlePath);
    throw error;
  }
  plan.status = 'applied';
  plan.appliedAt = new Date().toISOString();
  delete plan.failure;
  persistCertificationProgress(plan, bundlePath);
}

/** Apply all 64 support values in one server transaction. No per-row fallback
 * exists: before the call, on retry, and after a lost response the complete
 * set must classify globally as all-preimage or all-requested. */
export async function applyMicroMvpCertificationPlan(plan, {
  baseUrl,
  confirmApi,
  token,
  certificationKey,
  bundlePath,
  fetchImpl = globalThis.fetch,
  catalogLoader = () => loadCertificationCatalogs(fetchAll, { baseUrl, fetchImpl }),
} = {}) {
  assertCertificationPlanIntegrity(plan, { requireEvidence: true });
  if (!['planned', 'applying', 'apply-failed', 'apply-outcome-unknown', 'applied-unverified', 'applied-verification-failed', 'applied'].includes(plan.status)) {
    throw new Error(`bundle status ${String(plan.status)} cannot be applied`);
  }
  if (!nonEmptyString(token)) throw new Error('API token/login is required for --apply');
  if (!nonEmptyString(certificationKey)) throw new Error('CONTENT_CERTIFICATION_KEY is required for --apply');
  if (!nonEmptyString(baseUrl) || confirmApi !== baseUrl || plan.apiBase !== baseUrl) {
    throw new Error('--confirm-api must exactly equal API_URL and the planned API base');
  }

  let catalogs = await catalogLoader();
  assertReleaseEvidenceBinding(plan.evidence, {
    apiBase: baseUrl,
    catalogs: releaseEvidenceCatalogView(plan, catalogs),
  });
  let classification = classifyAtomicSupportState(plan, catalogs);
  if (classification.state === 'expected') {
    const beforeRecords = prepareMicroMvpCertifications(catalogs, {
      certifiedAt: plan.certifiedAt,
      evidence: plan.evidence,
    });
    if (!samePlannedRecords(beforeRecords, plan.records)) {
      throw new Error('live catalog changed after certification bundle; refusing all writes');
    }
    plan.status = 'applying';
    plan.applyStartedAt ??= new Date().toISOString();
    delete plan.failure;
    persistCertificationProgress(plan, bundlePath);
    try {
      await postAtomicSupportBatch(plan, {
        mode: 'certification_apply', baseUrl,
        token: token.trim(), certificationKey: certificationKey.trim(), fetchImpl,
      });
    } catch (requestError) {
      catalogs = await catalogLoader();
      try {
        classification = classifyAtomicSupportState(plan, catalogs);
      } catch (reconcileError) {
        plan.status = 'apply-outcome-unknown';
        plan.failure = reconcileError instanceof Error ? reconcileError.message : String(reconcileError);
        persistCertificationProgress(plan, bundlePath);
        throw requestError;
      }
      if (classification.state === 'expected') {
        plan.status = 'apply-failed';
        plan.failure = requestError instanceof Error ? requestError.message : String(requestError);
        persistCertificationProgress(plan, bundlePath);
        throw requestError;
      }
    }
  }

  catalogs = await catalogLoader();
  try {
    classification = classifyAtomicSupportState(plan, catalogs);
  } catch (error) {
    plan.status = 'apply-outcome-unknown';
    plan.failure = error instanceof Error ? error.message : String(error);
    persistCertificationProgress(plan, bundlePath);
    throw error;
  }
  if (classification.state !== 'requested') {
    const error = new Error('atomic certification endpoint returned without committing the complete requested state');
    plan.status = 'apply-failed';
    plan.failure = error.message;
    persistCertificationProgress(plan, bundlePath);
    throw error;
  }
  captureAppliedCertificationPostimages(plan, catalogs, bundlePath);

  return {
    applied: plan.denominator,
    denominator: plan.denominator,
    planHash: plan.planHash,
    atomic: true,
  };
}

function captureRolledBackCertificationPostimages(plan, catalogs, bundlePath) {
  for (const record of plan.records) {
    const entity = exactCertificationTarget(catalogs[record.entity_type], record);
    const expected = expectedSupportPostimage(record.after, record.before.support);
    if (!sameExceptUpdatedAt(entity, expected)
      || !sameExceptUpdatedAt(entity, record.before)) {
      throw new Error(`${record.key}: rollback did not restore the exact preimage outside updated_at`);
    }
    record.rollbackAfter = stableClone(entity);
    record.rollbackAfterHash = sha256Canonical(entity);
  }
  plan.status = 'rolled-back';
  plan.rolledBackAt = new Date().toISOString();
  delete plan.rollbackFailure;
  persistCertificationProgress(plan, bundlePath);
}

export async function rollbackMicroMvpCertificationPlan(plan, {
  baseUrl,
  confirmApi,
  token,
  certificationKey,
  bundlePath,
  fetchImpl = globalThis.fetch,
  catalogLoader = () => loadCertificationCatalogs(fetchAll, { baseUrl, fetchImpl }),
} = {}) {
  assertCertificationPlanIntegrity(plan, { requireEvidence: true });
  if (![
    'applied', 'applied-verification-failed', 'rolling-back',
    'rollback-failed', 'rollback-outcome-unknown', 'rolled-back',
  ].includes(plan.status)) {
    throw new Error(`bundle status ${String(plan.status)} cannot be rolled back`);
  }
  if (!nonEmptyString(token)) throw new Error('API token/login is required for --rollback');
  if (!nonEmptyString(certificationKey)) throw new Error('CONTENT_CERTIFICATION_KEY is required for --rollback');
  if (!nonEmptyString(baseUrl) || confirmApi !== baseUrl || plan.apiBase !== baseUrl) {
    throw new Error('--confirm-api must exactly equal API_URL and the bundled API base');
  }

  let catalogs = await catalogLoader();
  let classification = classifyAtomicSupportState(plan, catalogs, { rollback: true });
  if (classification.state === 'expected') {
    plan.status = 'rolling-back';
    plan.rollbackStartedAt ??= new Date().toISOString();
    delete plan.rollbackFailure;
    persistCertificationProgress(plan, bundlePath);
    try {
      await postAtomicSupportBatch(plan, {
        mode: 'exact_rollback', rollback: true, baseUrl,
        token: token.trim(), certificationKey: certificationKey.trim(), fetchImpl,
      });
    } catch (requestError) {
      catalogs = await catalogLoader();
      try {
        classification = classifyAtomicSupportState(plan, catalogs, { rollback: true });
      } catch (reconcileError) {
        plan.status = 'rollback-outcome-unknown';
        plan.rollbackFailure = reconcileError instanceof Error
          ? reconcileError.message
          : String(reconcileError);
        persistCertificationProgress(plan, bundlePath);
        throw requestError;
      }
      if (classification.state === 'expected') {
        plan.status = 'rollback-failed';
        plan.rollbackFailure = requestError instanceof Error
          ? requestError.message
          : String(requestError);
        persistCertificationProgress(plan, bundlePath);
        throw requestError;
      }
    }
  }

  catalogs = await catalogLoader();
  try {
    classification = classifyAtomicSupportState(plan, catalogs, { rollback: true });
  } catch (error) {
    plan.status = 'rollback-outcome-unknown';
    plan.rollbackFailure = error instanceof Error ? error.message : String(error);
    persistCertificationProgress(plan, bundlePath);
    throw error;
  }
  if (classification.state !== 'requested') {
    const error = new Error('atomic rollback endpoint returned without restoring the complete preimage set');
    plan.status = 'rollback-failed';
    plan.rollbackFailure = error.message;
    persistCertificationProgress(plan, bundlePath);
    throw error;
  }
  captureRolledBackCertificationPostimages(plan, catalogs, bundlePath);
  return {
    rolledBack: plan.denominator,
    denominator: plan.denominator,
    planHash: plan.planHash,
    atomic: true,
  };
}

function parseArgs(argv) {
  const flags = new Set();
  const values = new Map();
  const booleanOptions = new Set(['--apply', '--rollback', '--json', '--seed', '--help']);
  const valueOptions = new Set(['--confirm-api', '--certified-at', '--bundle', '--evidence']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (booleanOptions.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (valueOptions.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      values.set(arg, value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (flags.has('--apply') && flags.has('--rollback')) {
    throw new Error('--apply and --rollback are mutually exclusive');
  }
  if ((flags.has('--apply') || flags.has('--rollback')) && flags.has('--seed')) {
    throw new Error('--seed is read-only and cannot be combined with mutation');
  }
  return {
    apply: flags.has('--apply'),
    rollback: flags.has('--rollback'),
    json: flags.has('--json'),
    seed: flags.has('--seed'),
    help: flags.has('--help'),
    confirmApi: values.get('--confirm-api') ?? null,
    bundlePath: values.get('--bundle') ?? null,
    evidencePath: values.get('--evidence') ?? null,
    certifiedAt: values.get('--certified-at') ?? MICRO_MVP_CERTIFIED_AT,
    hasExplicitCertifiedAt: values.has('--certified-at'),
  };
}

function usage() {
  return [
    `Пакетная сертификация минимум ${expectedDenominator()} сущностей micro-MVP (49 core + 15 состояний + точное транзитивное DB-замыкание; по умолчанию read-only plan):`,
    '  npm run content:certify:micro -- --bundle backups/micro-mvp-certification.json \\',
    '    --evidence backups/micro-mvp-release-evidence.json \\',
    '    --certified-at 2026-08-05T00:00:00Z',
    '',
    'Production apply:',
    '  API_URL=https://backend.example CONTENT_CERTIFICATION_KEY=... API_TOKEN=... \\',
    '  npm run content:certify:micro -- --apply \\',
    '    --bundle backups/micro-mvp-certification.json \\',
    '    --evidence backups/micro-mvp-release-evidence.json \\',
    '    --confirm-api https://backend.example',
    '',
    'Atomic rollback:',
    '  API_URL=https://backend.example CONTENT_CERTIFICATION_KEY=... API_TOKEN=... \\',
    '  npm run content:certify:micro -- --rollback \\',
    '    --bundle backups/micro-mvp-certification.json \\',
    '    --confirm-api https://backend.example',
    '',
    'Persisted plan и apply требуют свежий --evidence, привязанный к API и текущим source/release/content/patch hashes.',
    'Если API_TOKEN отсутствует, --apply/--rollback выполняют login только через CONTENT_ADMIN_USERNAME/CONTENT_ADMIN_PASSWORD.',
    'Опции read-only: --json, --seed, --certified-at <UTC RFC3339>.',
    'Apply/rollback никогда не используют per-row fallback: один server-side transaction на весь denominator.',
  ].join('\n');
}

export async function runMicroMvpCertificationCommand({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  loginImpl = login,
  write = (message) => console.log(message),
  now = new Date(),
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    write(usage());
    return { mode: 'help' };
  }
  const baseUrl = env.API_URL || apiUrl();
  const catalogLoader = () => loadCertificationCatalogs(fetchAll, { baseUrl, fetchImpl });

  if (!args.apply && !args.rollback) {
    if (args.bundlePath && !args.evidencePath) {
      throw new Error('persisted --bundle plan requires --evidence');
    }
    const catalogs = await catalogLoader();
    const evidence = args.evidencePath
      ? microMvpReleaseEvidenceBinding(readMicroMvpReleaseEvidence(args.evidencePath, {
        apiBase: baseUrl, catalogs, now,
      }))
      : null;
    const plan = createMicroMvpCertificationPlanFromCatalogs(catalogs, {
      baseUrl,
      certifiedAt: args.certifiedAt,
      evidence,
    });
    if (args.bundlePath) {
      if (!args.hasExplicitCertifiedAt) {
        throw new Error('persisted --bundle plan requires explicit --certified-at');
      }
      const bundlePath = writeCertificationBundleAtomic(
        args.bundlePath,
        plan,
        { refuseOverwrite: true },
      );
      write(`BUNDLE ${plan.records.length}/${plan.denominator} saved atomically (0600): ${bundlePath}`);
    }
    if (args.seed) {
      write(JSON.stringify(
        plan.records.map(({ table, card_number, support }) => ({ table, card_number, support })),
        null,
        2,
      ));
    } else if (args.json) {
      write(JSON.stringify(plan, null, 2));
    } else {
      write(`PLAN ${plan.records.length}/${plan.denominator} certification(s) for ${plan.apiBase}`);
      write(`certified_at=${plan.certifiedAt} plan_hash=${plan.planHash}`);
      write('No API writes performed. Review the persisted bundle, then apply that exact file.');
    }
    return { mode: 'plan', plan };
  }

  if (!args.bundlePath) throw new Error('--apply/--rollback requires --bundle');
  const plan = readCertificationBundle(args.bundlePath);
  if (args.hasExplicitCertifiedAt && args.certifiedAt !== plan.certifiedAt) {
    throw new Error('--certified-at differs from the persisted certification bundle');
  }
  if (args.confirmApi !== baseUrl) {
    throw new Error('--confirm-api must exactly equal API_URL');
  }
  let expectedApplyEvidence = null;
  if (args.apply) {
    if (!args.evidencePath) throw new Error('--apply requires --evidence');
    const evidence = microMvpReleaseEvidenceBinding(readMicroMvpReleaseEvidence(
      args.evidencePath,
      { apiBase: baseUrl, now },
    ));
    if (canonicalJson(evidence) !== canonicalJson(plan.evidence)) {
      throw new Error('--evidence identity/hash differs from the immutable certification bundle');
    }
    expectedApplyEvidence = evidence;
  }
  const certificationKey = env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!certificationKey) {
    throw new Error(`CONTENT_CERTIFICATION_KEY is required for --${args.apply ? 'apply' : 'rollback'}`);
  }
  const token = env.API_TOKEN?.trim() || await loginImpl({
    user: env.CONTENT_ADMIN_USERNAME,
    pass: env.CONTENT_ADMIN_PASSWORD,
  });
  if (args.apply) {
    const revalidatedEvidence = microMvpReleaseEvidenceBinding(readMicroMvpReleaseEvidence(
      args.evidencePath,
      { apiBase: baseUrl, now },
    ));
    if (canonicalJson(revalidatedEvidence) !== canonicalJson(expectedApplyEvidence)
      || canonicalJson(revalidatedEvidence) !== canonicalJson(plan.evidence)) {
      throw new Error('--evidence changed while preparing certification apply');
    }
    const result = await applyMicroMvpCertificationPlan(plan, {
      baseUrl, confirmApi: args.confirmApi, token, certificationKey,
      bundlePath: args.bundlePath, fetchImpl, catalogLoader,
    });
    write(`APPLIED ATOMIC ${result.applied}/${result.denominator} certification(s); all postimages verified`);
    write(`certified_at=${plan.certifiedAt} plan_hash=${result.planHash}`);
    return { mode: 'apply', plan, result };
  }
  const result = await rollbackMicroMvpCertificationPlan(plan, {
    baseUrl, confirmApi: args.confirmApi, token, certificationKey,
    bundlePath: args.bundlePath, fetchImpl, catalogLoader,
  });
  write(`ROLLED BACK ATOMIC ${result.rolledBack}/${result.denominator} certification(s)`);
  write(`plan_hash=${result.planHash}`);
  return { mode: 'rollback', plan, result };
}

export async function main(argv = process.argv.slice(2)) {
  return runMicroMvpCertificationCommand({ argv });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message ?? error);
    console.error(usage());
    process.exitCode = 1;
  });
}
