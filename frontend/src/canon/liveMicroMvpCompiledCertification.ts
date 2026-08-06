import { createHash } from 'node:crypto';
import { canonicalStringify } from '../rules-core/determinism';
import {
  createMicroMvpCoverageDenominator,
  MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY,
  MICRO_MVP_SEMANTIC_ASPECT,
} from '../rules-core/coverage/microMvpDenominator';
import { MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION } from '../rules-core/coverage/microMvpEvidenceExecution';
import {
  assertMicroMvpL1OverlayReady,
  compileMicroMvpL1MaterializedCatalogs,
  microMvpL1RootSemanticProjection,
  MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID,
  MicroMvpL1OverlayReadinessError,
  type CompiledMicroMvpL1Provider,
} from './microMvpL1Overlay';
import { materializeMicroMvpL1ContentPatch } from './declarativeMechanicsPatch';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from './prodSnapshotL1Fixtures';

const VOLATILE_CATALOG_FIELDS = new Set([
  'support',
  'created_at',
  'updated_at',
  'deleted_at',
]);
const UUID_REFERENCE_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const UNORDERED_ROOT_PROJECTION_ARRAYS = new Set([
  'actions',
  'decisions',
  'effects',
  'languageGrants',
  'spells',
]);

type JsonObject = Record<string, unknown>;

export interface LiveMicroMvpCatalogInputAttestation {
  schemaVersion: 2;
  algorithm: 'sha256/canonical-json-v1';
  /** Exact equality here is the blocking catalog gate. It is calculated from
   * the compiled micro-MVP roots, not from unrelated rows in the global DB. */
  reviewedSemanticProjectionHash: string;
  liveSemanticProjectionHash: string;
  /** Compiler-native hashes retain DB UUIDs and are therefore diagnostic. */
  compilerRaw: {
    reviewedContentHash: string;
    liveContentHash: string;
    contentHashMatchesReviewed: boolean;
    reviewedReleaseHash: string;
    liveReleaseHash: string;
    releaseHashMatchesReviewed: boolean;
  };
  /** Full-catalog hashes are diagnostic only. The release-evidence artifact
   * separately binds its exact live raw hash and rechecks it before mutation. */
  fullCatalog: {
    schemaVersion: 1;
    algorithm: 'sha256/canonical-json-v1';
    reviewedRawHash: string;
    liveRawHash: string;
    rawMatchesReviewed: boolean;
    reviewedNormalizedHash: string;
    liveNormalizedHash: string;
    normalizedMatchesReviewed: boolean;
    reviewedCollectionCardinalities: Readonly<Record<keyof SnapshotCatalogs, number>>;
    liveCollectionCardinalities: Readonly<Record<keyof SnapshotCatalogs, number>>;
    collections: readonly LiveMicroMvpCatalogCollectionDrift[];
  };
}

export interface LiveMicroMvpCatalogCollectionDrift {
  collection: keyof SnapshotCatalogs;
  pinnedCount: number;
  liveCount: number;
  pinnedHash: string;
  liveHash: string;
  missingCount: number;
  extraCount: number;
  changedCount: number;
  /** Stable, bounded samples keep CI errors useful without flooding the log. */
  missingIdentities: readonly string[];
  extraIdentities: readonly string[];
  changedIdentities: readonly string[];
}

export interface LiveMicroMvpSemanticEvidenceProfile {
  schemaVersion: 1;
  id: typeof MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID;
  certificationVersion: string;
  release: {
    releaseId: string;
    rulesHash: string;
    contentHash: string;
    releaseHash: string;
  };
  denominator: {
    matrixId: string;
    matrixSchemaVersion: number;
    entityCount: number;
    obligationCount: number;
    coverageCellCount: number;
  };
  evidence: {
    manifestSchemaVersion: number;
    aspectId: string;
    requiredTypes: readonly string[];
    requiredSlotCount: number;
  };
}

export interface LiveMicroMvpCompiledCertification {
  catalogInput: LiveMicroMvpCatalogInputAttestation;
  provider: CompiledMicroMvpL1Provider;
  semanticEvidenceProfile: LiveMicroMvpSemanticEvidenceProfile;
}

export class LiveMicroMvpCatalogDriftError extends Error {
  constructor(
    readonly reviewedSemanticProjectionHash: string,
    readonly liveSemanticProjectionHash: string,
    readonly collections: readonly LiveMicroMvpCatalogCollectionDrift[],
  ) {
    super([
      'Live micro-MVP compiled semantic projection differs from the reviewed release: '
        + `reviewed=${reviewedSemanticProjectionHash}; live=${liveSemanticProjectionHash}`,
      ...collections.map((drift) => (
        `${drift.collection}: ${drift.pinnedCount}→${drift.liveCount}; `
          + `missing=${drift.missingCount}`
          + ` [${drift.missingIdentities.slice(0, 5).join(', ')}]; `
          + `extra=${drift.extraCount}`
          + ` [${drift.extraIdentities.slice(0, 5).join(', ')}]; `
          + `changed=${drift.changedCount}`
          + ` [${drift.changedIdentities.slice(0, 5).join(', ')}]`
      )),
    ].join('\n'));
    this.name = 'LiveMicroMvpCatalogDriftError';
  }
}

function semanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as JsonObject;
  return Object.fromEntries(Object.keys(record)
    .filter((key) => !VOLATILE_CATALOG_FIELDS.has(key) && record[key] !== undefined)
    .sort()
    .map((key) => [key, semanticValue(record[key])]));
}

function entityOrderKey(value: unknown): string {
  const record = value && typeof value === 'object' ? value as JsonObject : {};
  return [
    record.card_number,
    record.resource_id,
    record.variable_id,
    record.id,
    canonicalStringify(value),
  ].map((part) => String(part ?? '')).join('\u0000');
}

function normalizedCollection(values: readonly unknown[]): unknown[] {
  return values
    .map(semanticValue)
    .sort((left, right) => entityOrderKey(left).localeCompare(entityOrderKey(right)));
}

function rawCollection(values: readonly unknown[]): unknown[] {
  return [...values]
    .sort((left, right) => entityOrderKey(left).localeCompare(entityOrderKey(right)));
}

function canonicalHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

/**
 * Hashes every catalog collection consumed by the compiler. Top-level record
 * order and persistence metadata are non-semantic; nested array order remains
 * semantic and is deliberately preserved.
 */
export function microMvpCatalogInputHash(catalogs: SnapshotCatalogs): string {
  const normalized = Object.fromEntries(
    (Object.keys(catalogs) as Array<keyof SnapshotCatalogs>).sort().map((collection) => [
      collection,
      normalizedCollection(catalogs[collection]),
    ]),
  );
  return canonicalHash(normalized);
}

/**
 * Full raw catalog fingerprint used only for diagnostics in this layer. It
 * includes persistence/support fields while ignoring only top-level response
 * order. The release-evidence CLI owns the authoritative TOCTOU fingerprint
 * and compares it against the same live catalog before certification writes.
 */
export function microMvpRawCatalogInputHash(catalogs: SnapshotCatalogs): string {
  const normalized = Object.fromEntries(
    (Object.keys(catalogs) as Array<keyof SnapshotCatalogs>).sort().map((collection) => [
      collection,
      rawCollection(catalogs[collection]),
    ]),
  );
  return canonicalHash(normalized);
}

function catalogCardinalities(
  catalogs: SnapshotCatalogs,
): Record<keyof SnapshotCatalogs, number> {
  return Object.fromEntries(
    (Object.keys(catalogs) as Array<keyof SnapshotCatalogs>)
      .map((collection) => [collection, catalogs[collection].length]),
  ) as Record<keyof SnapshotCatalogs, number>;
}

/**
 * Hashes the compiler-owned executable 448-root projection after replacing DB
 * surrogate UUIDs with stable catalog identities. Production POST assigns a
 * fresh UUID to created effects; a byte-identical fixture UUID must therefore
 * never be part of release semantics. Nested mechanic/action order remains
 * semantic, while the compiler's top-level set-like arrays are re-sorted after
 * canonicalization.
 */
export function microMvpCompiledSemanticProjectionHash(
  provider: CompiledMicroMvpL1Provider,
  catalogs: SnapshotCatalogs,
): string {
  const aliases = catalogReferenceAliases(catalogs);
  const roots = [...provider.roots]
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))
    .map((root) => {
      const projection = canonicalCatalogReferences(
        microMvpL1RootSemanticProjection(root),
        aliases,
      ) as JsonObject;
      return semanticValue(Object.fromEntries(Object.entries(projection).map(([key, value]) => [
        key,
        UNORDERED_ROOT_PROJECTION_ARRAYS.has(key) && Array.isArray(value)
          ? [...value].sort((left, right) => (
            canonicalStringify(semanticValue(left)).localeCompare(
              canonicalStringify(semanticValue(right)),
            )
          ))
          : value,
      ])));
    });
  const capabilityGaps = provider.capabilityGaps
    .map((gap) => semanticValue(canonicalCatalogReferences(gap, aliases)))
    .sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right)));
  const { release } = provider;
  return canonicalHash({
    schemaVersion: 2,
    compilerRelease: {
      id: release.id,
      systemId: release.systemId,
      rulesetVersion: release.rulesetVersion,
      errataVersion: release.errataVersion,
      sourceReleaseId: release.sourceReleaseId,
      sourceContentHash: release.sourceContentHash,
      overlayHash: release.overlayHash,
    },
    roots,
    capabilityGaps,
  });
}

function stableCatalogIdentity(
  collection: keyof SnapshotCatalogs,
  value: unknown,
): string {
  const record = value && typeof value === 'object' ? value as JsonObject : {};
  const identity = record.card_number ?? record.resource_id ?? record.variable_id;
  return `${collection}:${String(identity ?? `id:${String(record.id ?? '<blank>')}`)}`;
}

function catalogReferenceAliases(catalogs: SnapshotCatalogs): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const identities = new Map<string, number>();
  for (const collection of Object.keys(catalogs) as Array<keyof SnapshotCatalogs>) {
    for (const entity of catalogs[collection]) {
      const identity = stableCatalogIdentity(collection, entity);
      identities.set(identity, (identities.get(identity) ?? 0) + 1);
    }
  }
  for (const collection of Object.keys(catalogs) as Array<keyof SnapshotCatalogs>) {
    for (const entity of catalogs[collection]) {
      const identity = stableCatalogIdentity(collection, entity);
      // Ambiguous catalog identities remain fail-closed by retaining the row
      // ID. Unique card/resource/variable identities are portable across DBs.
      const canonical = identities.get(identity) === 1
        ? identity
        : `${identity}:id:${entity.id}`;
      aliases.set(entity.id.toLowerCase(), canonical);
    }
  }
  return aliases;
}

function canonicalCatalogReferences(
  value: unknown,
  aliases: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((nested) => canonicalCatalogReferences(nested, aliases));
  }
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    const exact = aliases.get(value.toLowerCase());
    if (exact) return exact;
    return value.replace(UUID_REFERENCE_PATTERN, (id) => aliases.get(id.toLowerCase()) ?? id);
  }
  return Object.fromEntries(Object.entries(value as JsonObject).map(([key, nested]) => (
    [key, canonicalCatalogReferences(nested, aliases)]
  )));
}

function catalogIdentity(value: unknown): string {
  const record = value && typeof value === 'object' ? value as JsonObject : {};
  return String(record.card_number ?? record.resource_id ?? record.variable_id ?? record.id ?? '<blank>');
}

function collectionDrift(
  collection: keyof SnapshotCatalogs,
  pinned: SnapshotCatalogs[typeof collection],
  live: SnapshotCatalogs[typeof collection],
): LiveMicroMvpCatalogCollectionDrift | undefined {
  const pinnedNormalized = normalizedCollection(pinned);
  const liveNormalized = normalizedCollection(live);
  const pinnedHash = canonicalHash(pinnedNormalized);
  const liveHash = canonicalHash(liveNormalized);
  if (pinnedHash === liveHash) return undefined;
  const byId = (values: readonly unknown[]): Map<string, unknown> => new Map(values.map((value) => {
    const record = value && typeof value === 'object' ? value as JsonObject : {};
    return [String(record.id ?? '<blank>'), value];
  }));
  const pinnedById = byId(pinnedNormalized);
  const liveById = byId(liveNormalized);
  const missingIdentities = [...pinnedById.entries()].flatMap(([id, value]) => (
    liveById.has(id) ? [] : [catalogIdentity(value)]
  )).sort();
  const extraIdentities = [...liveById.entries()].flatMap(([id, value]) => (
    pinnedById.has(id) ? [] : [catalogIdentity(value)]
  )).sort();
  const changedIdentities = [...pinnedById.entries()].flatMap(([id, value]) => {
    const candidate = liveById.get(id);
    return candidate !== undefined
      && canonicalStringify(value) !== canonicalStringify(candidate)
      ? [catalogIdentity(value)]
      : [];
  }).sort();
  return {
    collection,
    pinnedCount: pinned.length,
    liveCount: live.length,
    pinnedHash,
    liveHash,
    missingCount: missingIdentities.length,
    extraCount: extraIdentities.length,
    changedCount: changedIdentities.length,
    missingIdentities: missingIdentities.slice(0, 10),
    extraIdentities: extraIdentities.slice(0, 10),
    changedIdentities: changedIdentities.slice(0, 10),
  };
}

export function attestLiveMicroMvpCatalogInput(input: {
  liveCatalogs: SnapshotCatalogs;
  reviewedCatalogs: SnapshotCatalogs;
  liveProvider: CompiledMicroMvpL1Provider;
  reviewedProvider: CompiledMicroMvpL1Provider;
}): LiveMicroMvpCatalogInputAttestation {
  const reviewedSemanticProjectionHash = microMvpCompiledSemanticProjectionHash(
    input.reviewedProvider,
    input.reviewedCatalogs,
  );
  const liveSemanticProjectionHash = microMvpCompiledSemanticProjectionHash(
    input.liveProvider,
    input.liveCatalogs,
  );
  const collections = (Object.keys(input.reviewedCatalogs) as Array<keyof SnapshotCatalogs>)
    .flatMap((collection) => {
      const drift = collectionDrift(
        collection,
        input.reviewedCatalogs[collection],
        input.liveCatalogs[collection],
      );
      return drift ? [drift] : [];
    });
  if (liveSemanticProjectionHash !== reviewedSemanticProjectionHash) {
    throw new LiveMicroMvpCatalogDriftError(
      reviewedSemanticProjectionHash,
      liveSemanticProjectionHash,
      collections,
    );
  }
  const reviewedRawHash = microMvpRawCatalogInputHash(input.reviewedCatalogs);
  const liveRawHash = microMvpRawCatalogInputHash(input.liveCatalogs);
  const reviewedNormalizedHash = microMvpCatalogInputHash(input.reviewedCatalogs);
  const liveNormalizedHash = microMvpCatalogInputHash(input.liveCatalogs);
  return {
    schemaVersion: 2,
    algorithm: 'sha256/canonical-json-v1',
    reviewedSemanticProjectionHash,
    liveSemanticProjectionHash,
    compilerRaw: {
      reviewedContentHash: input.reviewedProvider.release.contentHash,
      liveContentHash: input.liveProvider.release.contentHash,
      contentHashMatchesReviewed: input.liveProvider.release.contentHash
        === input.reviewedProvider.release.contentHash,
      reviewedReleaseHash: input.reviewedProvider.release.releaseHash,
      liveReleaseHash: input.liveProvider.release.releaseHash,
      releaseHashMatchesReviewed: input.liveProvider.release.releaseHash
        === input.reviewedProvider.release.releaseHash,
    },
    fullCatalog: {
      schemaVersion: 1,
      algorithm: 'sha256/canonical-json-v1',
      reviewedRawHash,
      liveRawHash,
      rawMatchesReviewed: liveRawHash === reviewedRawHash,
      reviewedNormalizedHash,
      liveNormalizedHash,
      normalizedMatchesReviewed: liveNormalizedHash === reviewedNormalizedHash,
      reviewedCollectionCardinalities: catalogCardinalities(input.reviewedCatalogs),
      liveCollectionCardinalities: catalogCardinalities(input.liveCatalogs),
      collections,
    },
  };
}

function assertLiveMicroMvpReadyAfterSemanticAttestation(
  provider: CompiledMicroMvpL1Provider,
): void {
  try {
    assertMicroMvpL1OverlayReady(provider);
  } catch (error) {
    if (!(error instanceof MicroMvpL1OverlayReadinessError)) throw error;
    const remainingProblems = error.problems.filter((problem) => (
      !problem.startsWith('compiled content hash mismatch:')
      && !problem.startsWith('compiled release hash mismatch:')
    ));
    if (remainingProblems.length) throw error;
    // Raw compiler hashes contain source DB UUIDs. Exact equality of the
    // canonical projection above has already proved those are the only drift.
  }
}

function evidenceCardinalities(input: ReturnType<typeof createMicroMvpCoverageDenominator>): {
  coverageCellCount: number;
  requiredTypes: string[];
  requiredSlotCount: number;
} {
  const profiles = new Map(input.matrix.profiles.map((profile) => [profile.id, profile]));
  const cells = new Map<string, Set<string>>();
  for (const target of input.matrix.targets) {
    for (const profileId of target.capabilityProfileIds) {
      const profile = profiles.get(profileId);
      if (!profile) throw new Error(`Unknown micro-MVP capability profile ${profileId}`);
      for (const requirement of profile.requirements) {
        const key = [target.entityId, target.obligationId, requirement.aspectId].join('|');
        const types = cells.get(key) ?? new Set<string>();
        requirement.evidenceTypes.forEach((evidenceType) => types.add(evidenceType));
        cells.set(key, types);
      }
    }
  }
  const requiredTypes = [...new Set([...cells.values()].flatMap((types) => [...types]))].sort();
  return {
    coverageCellCount: cells.size,
    requiredTypes,
    requiredSlotCount: [...cells.values()].reduce((sum, types) => sum + types.size, 0),
  };
}

/**
 * GET-only live audit entrypoint. Production rows must already contain the
 * versioned patch (`verify-only`); their compiled semantic projection must then
 * equal the reviewed materialized release. Full-catalog drift is retained as
 * diagnostics and by the separate release-evidence TOCTOU contract.
 */
export async function compileLiveMicroMvpCertification(input: {
  catalogs: SnapshotCatalogs;
  certificationVersion: string;
}): Promise<LiveMicroMvpCompiledCertification> {
  if (!input.certificationVersion.trim()) throw new Error('certificationVersion is required');
  const reviewedCatalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
  const [reviewedProvider, provider] = await Promise.all([
    compileMicroMvpL1MaterializedCatalogs(reviewedCatalogs),
    // Never compensate live DB rows with the apply-mode compatibility adapter.
    compileMicroMvpL1MaterializedCatalogs(input.catalogs),
  ]);
  assertMicroMvpL1OverlayReady(reviewedProvider);
  const catalogInput = attestLiveMicroMvpCatalogInput({
    liveCatalogs: input.catalogs,
    reviewedCatalogs,
    liveProvider: provider,
    reviewedProvider,
  });
  // Projection equality is the catalog gate and produces a catalog-focused
  // drift error. The remaining readiness invariants are checked afterwards.
  assertLiveMicroMvpReadyAfterSemanticAttestation(provider);

  const manifest = await readMicroMvpSnapshotManifest();
  const denominator = createMicroMvpCoverageDenominator(manifest);
  const expectedRelease = denominator.currentRelease;
  const certifiedRelease = reviewedProvider.release;
  if (certifiedRelease.id !== expectedRelease.releaseId
    || certifiedRelease.overlayHash !== expectedRelease.rulesHash
    || certifiedRelease.contentHash !== expectedRelease.contentHash) {
    throw new Error(
      'Compiled live release is not the denominator release: '
        + `${certifiedRelease.id}/${certifiedRelease.overlayHash}/${certifiedRelease.contentHash}`,
    );
  }
  const cardinalities = evidenceCardinalities(denominator);
  if (denominator.entities.length !== MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY) {
    throw new Error(`Unexpected micro-MVP entity denominator ${denominator.entities.length}`);
  }
  const semanticEvidenceProfile: LiveMicroMvpSemanticEvidenceProfile = {
    schemaVersion: 1,
    id: MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID,
    certificationVersion: input.certificationVersion,
    release: {
      releaseId: certifiedRelease.id,
      rulesHash: certifiedRelease.overlayHash,
      contentHash: certifiedRelease.contentHash,
      releaseHash: certifiedRelease.releaseHash,
    },
    denominator: {
      matrixId: denominator.matrix.id,
      matrixSchemaVersion: denominator.matrix.schemaVersion,
      entityCount: denominator.entities.length,
      obligationCount: denominator.obligations.length,
      coverageCellCount: cardinalities.coverageCellCount,
    },
    evidence: {
      manifestSchemaVersion: MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION,
      aspectId: MICRO_MVP_SEMANTIC_ASPECT,
      requiredTypes: cardinalities.requiredTypes,
      requiredSlotCount: cardinalities.requiredSlotCount,
    },
  };
  return { catalogInput, provider, semanticEvidenceProfile };
}
