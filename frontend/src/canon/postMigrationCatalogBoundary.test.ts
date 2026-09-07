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

  it('canonicalizes reviewed storage upgrades without dropping active Goliath actions', () => {
    const projected = materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
    const upgraded = structuredClone(projected);
    for (const lineage of upgraded.races.filter((race) => (
      race.card_number.startsWith('RACE-0011-')
    ))) {
      lineage.related_effects = [];
    }
    const cloud = upgraded.actions.find((action) => action.card_number === 'ACT-goliath-cloud');
    const payload = (cloud?.mechanics as {
      effects?: Array<{ result?: Array<Record<string, unknown>> }>;
    } | null)?.effects?.[0]?.result?.[0];
    if (!payload || payload.mode !== 'teleport') throw new Error('missing legacy cloud teleport');
    delete payload.mode;
    payload.value = 'teleport';
    expect(postMigrationCatalogSemanticProjection(upgraded))
      .toEqual(postMigrationCatalogSemanticProjection(projected));

    const lineage = upgraded.races.find((race) => race.card_number === 'RACE-0011-cloud');
    if (!lineage) throw new Error('missing cloud lineage');
    lineage.related_actions = [];
    expect(() => postMigrationCatalogSemanticProjection(upgraded))
      .toThrow(/action authority is not exact/);
  });

  it('ignores an unrelated cross-catalog UUID collision until the reference enters the projection', () => {
    const projected = materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
    const liveShaped = structuredClone(projected);
    const unrelatedEffect = liveShaped.effects[0];
    const unrelatedAction = liveShaped.actions[0];
    if (!unrelatedEffect || !unrelatedAction) throw new Error('missing collision subjects');
    liveShaped.actions.push({
      ...unrelatedAction,
      id: unrelatedEffect.id,
      card_number: 'ACT-test-unrelated-collision',
    });

    expect(postMigrationCatalogSemanticProjection(liveShaped))
      .toEqual(postMigrationCatalogSemanticProjection(projected));

    const weapon = liveShaped.cards.find((card) => card.card_number === 'CARD-0327');
    if (!weapon || typeof weapon.mastery !== 'string') throw new Error('missing projected weapon mastery');
    liveShaped.actions.push({
      ...unrelatedAction,
      id: weapon.mastery,
      card_number: 'ACT-test-ambiguous-mastery',
    });
    expect(() => postMigrationCatalogSemanticProjection(liveShaped))
      .toThrow(/CARD-[0-9]+\.mastery: reference .* is ambiguous/u);
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
