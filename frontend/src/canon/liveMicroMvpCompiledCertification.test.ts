import { describe, expect, it } from 'vitest';
import {
  MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from './microMvpL1Overlay';
import {
  compileLiveMicroMvpCertification,
  LiveMicroMvpCatalogDriftError,
  microMvpCatalogInputHash,
  microMvpCompiledSemanticProjectionHash,
  microMvpRawCatalogInputHash,
} from './liveMicroMvpCompiledCertification';
import {
  MICRO_MVP_L1_CONTENT_PATCH,
} from './declarativeMechanicsPatch';
import {
  materializeReviewedPostMigrationCatalogs,
  POST_MIGRATION_CATALOG_BOUNDARY,
} from './postMigrationCatalogBoundary';
import {
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from './prodSnapshotL1Fixtures';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function reviewedCatalogs(): SnapshotCatalogs {
  return materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
}

function reverseCollections(catalogs: SnapshotCatalogs): SnapshotCatalogs {
  return Object.fromEntries(Object.entries(catalogs).map(([key, values]) => (
    [key, [...values].reverse()]
  ))) as unknown as SnapshotCatalogs;
}

describe('live micro-MVP compiled certification boundary', () => {
  it('separates normalized semantic diagnostics from the full raw fingerprint', () => {
    const pinned = readProdSnapshotCatalogs();
    const reordered = reverseCollections(copy(pinned));
    const decorated = copy(reordered);
    const spell = decorated.spells[0] as typeof decorated.spells[number] & {
      created_at?: string;
      updated_at?: string;
    };
    spell.created_at = '2026-08-05T00:00:00.000Z';
    spell.updated_at = '2026-08-05T01:00:00.000Z';
    spell.support = {
      status: 'verified_partial',
      content_hash: 'runtime-certification-metadata-is-not-compiler-input',
      dependency_hash: 'runtime-certification-metadata-is-not-compiler-input',
      certification_version: 'test',
      certified_at: '2026-08-05T01:00:00.000Z',
      limitations: [],
    };

    expect(microMvpCatalogInputHash(reordered)).toBe(microMvpCatalogInputHash(pinned));
    expect(microMvpCatalogInputHash(decorated)).toBe(microMvpCatalogInputHash(pinned));
    expect(microMvpRawCatalogInputHash(reordered)).toBe(microMvpRawCatalogInputHash(pinned));
    expect(microMvpRawCatalogInputHash(decorated)).not.toBe(microMvpRawCatalogInputHash(pinned));
  });

  it('rejects a changed executable primitive outside the materialization patch', async () => {
    const reviewed = reviewedCatalogs();
    const drifted = copy(reviewed);
    const tough = drifted.effects.find((entity) => entity.card_number === 'EFF-tough');
    if (!tough) throw new Error('missing reviewed Tough effect');
    const mechanics = tough.mechanics as {
      effects: Array<{ result: Array<{ kind: string; value?: string }> }>;
    };
    const modifier = mechanics.effects.flatMap((effect) => effect.result)
      .find((result) => result.kind === 'modifier');
    if (!modifier) throw new Error('missing reviewed Tough modifier');
    modifier.value = '3 * self_level';

    try {
      await compileLiveMicroMvpCertification({
        catalogs: drifted,
        certificationVersion: 'micro-mvp-l1-rules-core-v4',
      });
      throw new Error('expected compiled semantic drift');
    } catch (error) {
      expect(error).toBeInstanceOf(LiveMicroMvpCatalogDriftError);
      const drift = error as LiveMicroMvpCatalogDriftError;
      expect(drift.liveSemanticProjectionHash).not.toBe(drift.reviewedSemanticProjectionHash);
      expect(drift.collections).toEqual([expect.objectContaining({
        collection: 'effects',
        pinnedCount: reviewed.effects.length,
        liveCount: reviewed.effects.length,
        missingIdentities: [],
        extraIdentities: [],
        changedIdentities: ['EFF-tough'],
      })]);
      expect(drift.message).toContain('changed=1 [EFF-tough]');
    }
  }, 60_000);

  it('records source presentation drift without redefining compiler semantics', async () => {
    const reviewed = reviewedCatalogs();
    const live = copy(reviewed);
    const fighter = live.classes.find((entity) => entity.card_number === 'CLASS-warrior');
    if (!fighter) throw new Error('missing reviewed Fighter');
    fighter.description = `${fighter.description ?? ''} Presentation metadata drift.`;

    const result = await compileLiveMicroMvpCertification({
      catalogs: live,
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
    });
    expect(result.catalogInput.liveSemanticProjectionHash)
      .toBe(result.catalogInput.reviewedSemanticProjectionHash);
    expect(result.catalogInput.fullCatalog.normalizedMatchesReviewed).toBe(false);
    expect(result.catalogInput.fullCatalog.collections).toEqual([
      expect.objectContaining({
        collection: 'classes',
        changedIdentities: ['CLASS-warrior'],
      }),
    ]);
  }, 60_000);

  it('allows an unrelated global catalog extra while recording full-catalog drift', async () => {
    const reviewed = reviewedCatalogs();
    const live = copy(reviewed);
    const template = live.resources[0];
    if (!template) throw new Error('missing resource template');
    live.resources.push({
      ...template,
      id: '00000000-0000-4000-8000-000000000001',
      resource_id: 'unrelated_future_resource',
      name: 'Future resource outside micro-MVP',
    });

    const result = await compileLiveMicroMvpCertification({
      catalogs: live,
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
    });
    expect(result.catalogInput.liveSemanticProjectionHash)
      .toBe(result.catalogInput.reviewedSemanticProjectionHash);
    expect(result.catalogInput.fullCatalog.rawMatchesReviewed).toBe(false);
    expect(result.catalogInput.fullCatalog.normalizedMatchesReviewed).toBe(false);
    expect(result.catalogInput.fullCatalog.collections).toEqual([
      expect.objectContaining({
        collection: 'resources',
        missingCount: 0,
        extraCount: 1,
        extraIdentities: ['unrelated_future_resource'],
        changedCount: 0,
      }),
    ]);
  }, 60_000);

  it('treats backend-assigned UUIDs for declared creates as surrogate identities', async () => {
    const reviewed = reviewedCatalogs();
    const live = copy(reviewed);
    const declaredCreates = [
      ...MICRO_MVP_L1_CONTENT_PATCH.createEntities.map((item) => ({
        collection: item.collection,
        cardNumber: item.entity.card_number,
      })),
      ...MICRO_MVP_L1_CONTENT_PATCH.conditionPatches
        .filter((item) => item.entityId === null)
        .map((item) => ({ collection: 'effects' as const, cardNumber: item.cardNumber })),
    ];
    declaredCreates.forEach(({ collection, cardNumber }, index) => {
      const entity = live[collection].find((candidate) => candidate.card_number === cardNumber);
      if (!entity) throw new Error(`missing declared create ${collection}:${cardNumber}`);
      entity.id = `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`;
    });

    const result = await compileLiveMicroMvpCertification({
      catalogs: live,
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
    });
    expect(result.catalogInput.compilerRaw.contentHashMatchesReviewed).toBe(false);
    expect(result.catalogInput.compilerRaw.releaseHashMatchesReviewed).toBe(false);
    expect(result.catalogInput.liveSemanticProjectionHash)
      .toBe(result.catalogInput.reviewedSemanticProjectionHash);
    expect(result.catalogInput.fullCatalog.rawMatchesReviewed).toBe(false);
  }, 60_000);

  it('binds Goliath, repaired equipment and both split attacks outside compiler roots', async () => {
    const reviewed = reviewedCatalogs();
    const result = await compileLiveMicroMvpCertification({
      catalogs: copy(reviewed),
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
    });
    const baseline = result.catalogInput.reviewedSemanticProjectionHash;

    const goliathDrift = copy(reviewed);
    const fire = goliathDrift.actions.find((action) => action.card_number === 'ACT-goliath-fire');
    if (!fire) throw new Error('missing Goliath Fire action');
    const firePayload = (fire.mechanics as {
      effects: Array<{ result: Array<{ kind: string; dice?: string }> }>;
    }).effects.flatMap((effect) => effect.result).find((payload) => payload.kind === 'damage');
    if (!firePayload) throw new Error('missing Goliath Fire damage');
    firePayload.dice = '1d12';

    const equipmentDrift = copy(reviewed);
    const paladin = equipmentDrift.classes.find((item) => item.card_number === 'CLASS-paladin');
    if (!paladin?.equipment_options?.option_b) throw new Error('missing Paladin option B');
    paladin.equipment_options.option_b.gold = 151;

    const splitActionDrift = copy(reviewed);
    const offhand = splitActionDrift.actions.find((action) => (
      action.card_number === 'action_basic_offhand'
    ));
    if (!offhand?.mechanics) throw new Error('missing offhand action mechanics');
    offhand.mechanics.activation = {
      ...(offhand.mechanics.activation ?? {}),
      mode: 'reaction',
    };

    for (const drifted of [goliathDrift, equipmentDrift]) {
      expect(microMvpCompiledSemanticProjectionHash(result.provider, drifted)).not.toBe(baseline);
    }
    expect(() => microMvpCompiledSemanticProjectionHash(result.provider, splitActionDrift))
      .toThrow(/action_basic_offhand/);
  }, 60_000);

  it('refuses the unmaterialized legacy snapshot on the production verification path', async () => {
    await expect(compileLiveMicroMvpCertification({
      catalogs: copy(readProdSnapshotCatalogs()),
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
    })).rejects.toThrow();
  }, 60_000);

  it('binds fetched catalog bytes, compiled release, denominator and evidence protocol', async () => {
    const materialized = reviewedCatalogs();
    const result = await compileLiveMicroMvpCertification({
      catalogs: copy(materialized),
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
    });

    expect(result.catalogInput).toMatchObject({
      schemaVersion: 3,
      postMigrationBoundary: POST_MIGRATION_CATALOG_BOUNDARY,
      compilerRaw: {
        contentHashMatchesReviewed: true,
        releaseHashMatchesReviewed: true,
      },
      fullCatalog: {
        rawMatchesReviewed: true,
        normalizedMatchesReviewed: true,
      },
    });
    expect(result.catalogInput.liveSemanticProjectionHash)
      .toBe(result.catalogInput.reviewedSemanticProjectionHash);
    expect(result.provider.roots).toHaveLength(448);
    expect(result.provider.release).toMatchObject({
      overlayHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
      contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
      releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
    });
    expect(result.semanticEvidenceProfile).toEqual({
      schemaVersion: 1,
      id: MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID,
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
      release: {
        releaseId: result.provider.release.id,
        rulesHash: result.provider.release.overlayHash,
        contentHash: result.provider.release.contentHash,
        releaseHash: result.provider.release.releaseHash,
      },
      denominator: {
        matrixId: 'micro-mvp-2024-semantic-denominator-v1',
        matrixSchemaVersion: 1,
        entityCount: 49,
        obligationCount: 128,
        coverageCellCount: 136,
      },
      evidence: {
        manifestSchemaVersion: 2,
        aspectId: 'semantic.acceptance',
        requiredTypes: ['compiled_release_scenario', 'scenario', 'unit'],
        requiredSlotCount: 408,
      },
    });
  }, 60_000);
});
