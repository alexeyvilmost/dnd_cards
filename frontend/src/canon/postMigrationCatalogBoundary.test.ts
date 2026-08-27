import { describe, expect, it } from 'vitest';
import { materializeMicroMvpL1ContentPatch } from './declarativeMechanicsPatch';
import { compileMicroMvpL1MaterializedCatalogs } from './microMvpL1Overlay';
import {
  materializeReviewedPostMigrationCatalogs,
  POST_MIGRATION_CATALOG_BOUNDARY,
  postMigrationCatalogSemanticProjection,
} from './postMigrationCatalogBoundary';
import { readProdSnapshotCatalogs } from './prodSnapshotL1Fixtures';

describe('reviewed post-migration catalog boundary', () => {
  it('versions declarative patch 1.8, structural 107-115 and patch-owned 116 together', () => {
    expect(POST_MIGRATION_CATALOG_BOUNDARY).toMatchObject({
      schemaVersion: 1,
      boundaryId: 'micro-mvp-postmigration-catalog-107-116-v1',
      contentPatch: { patchVersion: '1.8.0' },
      structuralProjection: {
        projectionId: 'prod-snapshot-structural-migrations-107-115-v2',
      },
      patchOwnedMigration: '116_repair_half_caster_spellcasting_contract',
      semanticScopes: ['goliath', 'split-weapon-actions', 'starting-equipment'],
    });
  });

  it('materializes one idempotent post-migration catalog without certifying its own support', () => {
    const projected = materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
    const repeated = materializeReviewedPostMigrationCatalogs(projected);
    expect(repeated).toEqual(projected);

    const stone = projected.races.find((race) => race.card_number === 'RACE-0011-stone');
    expect(stone?.support ?? null).toBeNull();
    expect(projected.races.every((race) => (
      race.support?.certification_version !== 'playwright-pinned-fixture-v1'
    ))).toBe(true);
    expect(postMigrationCatalogSemanticProjection(projected)).toMatchObject({
      boundary: POST_MIGRATION_CATALOG_BOUNDARY,
      goliath: { parent: 'RACE-0011', lineages: expect.any(Array) },
      splitWeaponActions: expect.any(Array),
      startingEquipment: expect.any(Array),
    });
  });

  it('keeps unrelated global spell identity drift outside the blocking projection', () => {
    const projected = materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
    const liveShaped = structuredClone(projected);
    liveShaped.spells = liveShaped.spells.filter((spell) => spell.card_number !== 'divination');
    const unrelated = liveShaped.spells.find((spell) => spell.card_number === 'SPELL-0253');
    if (!unrelated) throw new Error('missing unrelated spell identity subject');
    const mechanics = unrelated.mechanics as Record<string, unknown>;
    mechanics.spell_class_list_ids = [
      ...((mechanics.spell_class_list_ids as string[] | undefined) ?? []),
      'CLASS-bard',
    ];

    expect(postMigrationCatalogSemanticProjection(liveShaped))
      .toEqual(postMigrationCatalogSemanticProjection(projected));
  });

  it('extends audit semantics without changing the frozen compiled release', async () => {
    const patched = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const projected = materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
    const [patchProvider, projectedProvider] = await Promise.all([
      compileMicroMvpL1MaterializedCatalogs(patched),
      compileMicroMvpL1MaterializedCatalogs(projected),
    ]);
    expect(projectedProvider.release).toEqual(patchProvider.release);
  }, 60_000);
});
