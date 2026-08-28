import { validateConditionDatabaseMaterialization } from '../src/canon/conditionDatabaseMaterialization';
import {
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type ConditionEffectRecord,
} from '../src/canon/conditionDatabaseContract';
import { MICRO_MVP_L1_CONTENT_PATCH } from '../src/canon/declarativeMechanicsPatch';
import {
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from '../src/canon/microMvpL1ReleaseIdentity';
import {
  certificationContractIssues,
  type EntitySupportCertification,
} from '../src/content/supportStatus';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from '../../scripts/content/certification-hash.mjs';

type JsonRecord = Record<string, unknown>;
type Catalogs = Record<string, JsonRecord[]>;

const FIXTURE_RELEASE_SCHEMA_VERSION = 1 as const;
const FIXTURE_RELEASE_COMPLETED_AT = '2026-08-28T00:00:00Z' as const;
const COLLECTION_ENTITY_TYPES = Object.freeze({
  cards: 'card',
  races: 'race',
  classes: 'class',
  backgrounds: 'background',
  feats: 'feat',
  spells: 'spell',
  effects: 'effect',
  actions: 'action',
  resources: 'resource',
  variables: 'variable',
} as const);

export interface PlaywrightConditionReleaseIdentity {
  schemaVersion: typeof FIXTURE_RELEASE_SCHEMA_VERSION;
  kind: 'playwright-certified-condition-database-release';
  evidenceId: string;
  evidenceHash: string;
  completedAt: typeof FIXTURE_RELEASE_COMPLETED_AT;
  catalogHash: string;
  gateSourceHash: string;
  conditionCount: number;
}

export interface PlaywrightCertifiedConditionRelease {
  catalogs: Catalogs;
  identity: PlaywrightConditionReleaseIdentity;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function evidenceUuid(hash: string): string {
  const bytes = hash.replace(/^sha256:/, '').slice(0, 32).split('');
  if (bytes.length !== 32) throw new Error('Playwright condition evidence hash is invalid');
  bytes[12] = '4';
  bytes[16] = '8';
  const value = bytes.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`
    + `-${value.slice(16, 20)}-${value.slice(20)}`;
}

function certificationCatalogs(catalogs: Catalogs): Record<string, JsonRecord[]> {
  return Object.fromEntries(Object.entries(COLLECTION_ENTITY_TYPES).map(([collection, entityType]) => {
    const rows = catalogs[collection];
    if (!Array.isArray(rows)) {
      throw new Error(`Playwright condition release is missing ${collection}`);
    }
    return [entityType, rows];
  }));
}

function exactConditionRows(catalogs: Catalogs): Array<{
  row: JsonRecord;
  cardNumber: string;
  conditionId: string;
}> {
  const targets = MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.map((declaration) => {
    const mechanics = record(declaration.fields.mechanics, `${declaration.cardNumber}.mechanics`);
    const condition = record(mechanics.condition, `${declaration.cardNumber}.mechanics.condition`);
    const conditionId = String(condition.id ?? '').trim();
    if (!conditionId) throw new Error(`${declaration.cardNumber} has no condition id`);
    return { cardNumber: declaration.cardNumber, conditionId };
  });
  if (new Set(targets.map((target) => target.cardNumber)).size !== targets.length
    || new Set(targets.map((target) => target.conditionId)).size !== targets.length) {
    throw new Error('Playwright condition release targets are duplicated');
  }

  const rows = catalogs.effects;
  if (!Array.isArray(rows)) throw new Error('Playwright condition release is missing effects');
  const selected = targets.map((target) => {
    const matches = rows.filter((row) => row.card_number === target.cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${target.cardNumber} must resolve to exactly one database effect`);
    }
    const rowCondition = record(
      record(matches[0].mechanics, `${target.cardNumber}.mechanics`).condition,
      `${target.cardNumber}.mechanics.condition`,
    );
    if (matches[0].effect_type !== 'condition' || rowCondition.id !== target.conditionId) {
      throw new Error(`${target.cardNumber} does not match its exact condition identity`);
    }
    if (typeof matches[0].id !== 'string' || !matches[0].id.trim()) {
      throw new Error(`${target.cardNumber} has no database entity id`);
    }
    return { row: matches[0], ...target };
  });
  if (new Set(selected.map(({ row }) => row.id)).size !== selected.length) {
    throw new Error('Playwright condition release database ids are duplicated');
  }
  validateConditionDatabaseMaterialization(
    selected.map(({ row }) => row as unknown as ConditionEffectRecord),
  );
  return selected;
}

/**
 * Test-only database boundary used by the isolated Playwright API server.
 * It certifies only the exact 15 versioned condition roots. Every hash is
 * produced by the production certification projection/dependency algorithm;
 * arbitrary effects and future conditions remain untouched and untrusted.
 */
export function materializePlaywrightCertifiedConditionRelease(
  source: Catalogs,
): PlaywrightCertifiedConditionRelease {
  const catalogs = cloneJson(source);
  const selected = exactConditionRows(catalogs);
  const index = buildCertificationIndex(certificationCatalogs(catalogs));
  const roots = selected.map(({ row, cardNumber, conditionId }) => {
    const hashes = certificationHashes(row, 'effect', index);
    return {
      row,
      cardNumber,
      conditionId,
      entityId: String(row.id),
      contentHash: hashes.contentHash,
      dependencyHash: hashes.dependencyHash,
    };
  }).sort((left, right) => left.cardNumber.localeCompare(right.cardNumber));

  const catalogProjection = roots.map((root) => ({
    cardNumber: root.cardNumber,
    conditionId: root.conditionId,
    entityId: root.entityId,
    contentHash: root.contentHash,
    dependencyHash: root.dependencyHash,
  }));
  const catalogHash = sha256Canonical(catalogProjection);
  const releaseBinding = {
    // This is a self-contained test database release. Its exact 15-row catalog
    // is the source artifact; the executable rules/release/patch identities
    // remain the same pinned identities consumed by App bootstrap.
    sourceContentHash: catalogHash,
    rulesHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
    releaseContentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
    releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
    patchHash: PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
  };
  const gateSourceHash = sha256Canonical({
    schemaVersion: FIXTURE_RELEASE_SCHEMA_VERSION,
    kind: 'playwright-condition-database-materialization-gate',
    certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
    patchHash: PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
    targets: catalogProjection.map(({ cardNumber, conditionId, entityId }) => ({
      cardNumber, conditionId, entityId,
    })),
  });
  const evidenceHash = sha256Canonical({
    schemaVersion: FIXTURE_RELEASE_SCHEMA_VERSION,
    kind: 'playwright-certified-condition-database-release',
    completedAt: FIXTURE_RELEASE_COMPLETED_AT,
    certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
    releaseBinding,
    gateSourceHash,
    catalogHash,
    conditions: catalogProjection,
  });
  const evidenceId = evidenceUuid(evidenceHash);
  const sharedSupport = {
    status: 'verified_mechanical',
    certification_version: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
    certified_at: FIXTURE_RELEASE_COMPLETED_AT,
    evidence_id: evidenceId,
    evidence_hash: evidenceHash,
    evidence_completed_at: FIXTURE_RELEASE_COMPLETED_AT,
    gate_source_hash: gateSourceHash,
    source_content_hash: releaseBinding.sourceContentHash,
    rules_hash: releaseBinding.rulesHash,
    release_content_hash: releaseBinding.releaseContentHash,
    release_hash: releaseBinding.releaseHash,
    patch_hash: releaseBinding.patchHash,
    catalog_hash: catalogHash,
    test_coverage: {
      schema_version: 1,
      scope: 'micro-mvp-l1',
      required: 1,
      passed: 1,
      percent: 100,
    },
    mechanics_locked: true,
    note: 'Isolated Playwright database-release fixture; never production certification.',
  } as const satisfies EntitySupportCertification;

  for (const root of roots) {
    const support: EntitySupportCertification = {
      ...sharedSupport,
      content_hash: root.contentHash,
      dependency_hash: root.dependencyHash,
    };
    const issues = certificationContractIssues(support);
    if (issues.length) {
      throw new Error(`${root.cardNumber} has invalid fixture certification: ${issues.join('; ')}`);
    }
    root.row.support = support;
  }

  return {
    catalogs,
    identity: {
      schemaVersion: FIXTURE_RELEASE_SCHEMA_VERSION,
      kind: 'playwright-certified-condition-database-release',
      evidenceId,
      evidenceHash,
      completedAt: FIXTURE_RELEASE_COMPLETED_AT,
      catalogHash,
      gateSourceHash,
      conditionCount: roots.length,
    },
  };
}
