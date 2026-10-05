import { beforeAll, describe, expect, it } from 'vitest';
import { compileMicroMvpL1MaterializedCatalogs, type CompiledMicroMvpL1Provider } from './microMvpL1Overlay';
import {
  attestLiveMicroMvpCatalogInput,
  LiveMicroMvpCatalogDriftError,
  microMvpCatalogInputHash,
  microMvpRawCatalogInputHash,
} from './liveMicroMvpCompiledCertification';
import { materializeReviewedPostMigrationCatalogs } from './postMigrationCatalogBoundary';
import { DeclarativeContentPatchError } from './declarativeMechanicsPatch';
import { readProdSnapshotCatalogs, type SnapshotCatalogs } from './prodSnapshotL1Fixtures';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// These are current normalization/attestation contracts, independent of old
// entity certification pins and manual review status. Historical certification
// assertions remain unchanged in liveMicroMvpCompiledCertification.test.ts.
describe('catalog fingerprint and current compiler attestation', () => {
  let reviewed: SnapshotCatalogs;
  let provider: CompiledMicroMvpL1Provider;
  beforeAll(async () => {
    reviewed = materializeReviewedPostMigrationCatalogs(readProdSnapshotCatalogs());
    provider = await compileMicroMvpL1MaterializedCatalogs(reviewed);
  });

  it('ignores HTTP reference metadata but preserves identically named mechanical keys', () => {
    const live = copy(reviewed);
    live.effects[0].references = [{ entity_type: 'class', entity_id: live.classes[0].id, paths: ['mechanics.source'] }];
    live.classes[0].referenced_by = [{ entity_type: 'effect', entity_id: live.effects[0].id, paths: ['mechanics.source'] }];
    expect(microMvpCatalogInputHash(live)).toBe(microMvpCatalogInputHash(reviewed));
    expect(microMvpRawCatalogInputHash(live)).toBe(microMvpRawCatalogInputHash(reviewed));
    live.effects[0].mechanics = { ...live.effects[0].mechanics, references: ['new-mechanical-value'] };
    expect(microMvpCatalogInputHash(live)).not.toBe(microMvpCatalogInputHash(reviewed));
  });

  it('separates order-insensitive mechanical fingerprints from editorial and review metadata', () => {
    const reversed = Object.fromEntries(Object.entries(reviewed).map(([key, rows]) => [key, [...rows].reverse()])) as unknown as SnapshotCatalogs;
    const decorated = copy(reversed);
    Object.assign(decorated.spells[0], { created_at: '2026-08-05T00:00:00Z', updated_at: '2026-08-05T01:00:00Z',
      support: { status: 'not_tested', limitations: [] } });
    expect(microMvpCatalogInputHash(reversed)).toBe(microMvpCatalogInputHash(reviewed));
    expect(microMvpRawCatalogInputHash(reversed)).toBe(microMvpRawCatalogInputHash(reviewed));
    expect(microMvpCatalogInputHash(decorated)).toBe(microMvpCatalogInputHash(reviewed));
    expect(microMvpRawCatalogInputHash(decorated)).not.toBe(microMvpRawCatalogInputHash(reviewed));
  });

  it('attests identical current compiler outputs without changing input status or historical pins', async () => {
    const live = copy(reviewed);
    const before = JSON.stringify(live);
    const next = await compileMicroMvpL1MaterializedCatalogs(live);
    const result = attestLiveMicroMvpCatalogInput({ reviewedCatalogs: reviewed, liveCatalogs: live,
      reviewedProvider: provider, liveProvider: next });
    expect(result.liveSemanticProjectionHash).toBe(result.reviewedSemanticProjectionHash);
    expect(result.compilerRaw).toMatchObject({ contentHashMatchesReviewed: true, releaseHashMatchesReviewed: true });
    expect(JSON.stringify(live)).toBe(before);
  });

  it('rejects an invalid spell scope before attestation', async () => {
    const live = copy(reviewed);
    live.spells.find(row => row.card_number === 'SPELL-0171')!.level += 1;
    await expect(compileMicroMvpL1MaterializedCatalogs(live))
      .rejects.toThrow(/snapshot level must be 1/);
  });

  it.each([
    { classId: 'CLASS-paladin', rejection: LiveMicroMvpCatalogDriftError },
    { classId: 'CLASS-warrior', rejection: DeclarativeContentPatchError },
  ])('rejects unreviewed $classId equipment before granting attestation', async ({ classId, rejection }) => {
    const live = copy(reviewed);
    live.classes.find(row => row.card_number === classId)!.equipment_options!.option_b!.gold += 1;
    // A patch-owned preimage is rejected even earlier than a valid compilation
    // with changed semantics. Both paths must remain fail-closed.
    await expect((async () => {
      const next = await compileMicroMvpL1MaterializedCatalogs(live);
      return attestLiveMicroMvpCatalogInput({ reviewedCatalogs: reviewed, liveCatalogs: live,
        reviewedProvider: provider, liveProvider: next });
    })()).rejects.toThrow(rejection);
  });
});
