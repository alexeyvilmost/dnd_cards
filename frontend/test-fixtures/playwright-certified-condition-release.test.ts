import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectsApi } from '../src/api/client';
import {
  conditionRecordContentHash,
  loadConditions,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type ConditionEffectRecord,
} from '../src/api/conditionsApi';
import { MICRO_MVP_L1_CONTENT_PATCH } from '../src/canon/declarativeMechanicsPatch';
import {
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from '../src/canon/microMvpL1ReleaseIdentity';
import { resetConditionsToOfflineFixture } from '../src/engine/conditions';
import { materializePlaywrightCertifiedConditionRelease } from './playwright-certified-condition-release';

type JsonRecord = Record<string, unknown>;

const CURRENT_RELEASE = {
  certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  rulesHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
  releaseContentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
} as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sourceCatalogs(): Record<string, JsonRecord[]> {
  return {
    cards: [],
    races: [],
    classes: [],
    backgrounds: [],
    feats: [],
    spells: [],
    effects: [
      ...MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.map((declaration) => ({
        id: declaration.entityId ?? declaration.fixtureEntityId,
        ...cloneJson(declaration.createFields),
      })),
      {
        id: '00000000-0000-4000-8000-000000000099',
        card_number: 'HOME-condition-probe',
        name: 'Homebrew probe',
        effect_type: 'condition',
        mechanics: { condition: { id: 'homebrew_probe' }, effects: [] },
      },
    ],
    actions: [],
    resources: [],
    variables: [],
  };
}

function serveConditions(rows: JsonRecord[]): void {
  vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({
    effects: rows,
    total: rows.length,
    page: 1,
    limit: 200,
  } as never);
}

function certifiedRows(rows: JsonRecord[]): JsonRecord[] {
  return rows.filter((row) => (
    (row.support as JsonRecord | undefined)?.certification_version
      === MICRO_MVP_CONDITION_CERTIFICATION_VERSION
  ));
}

afterEach(() => {
  vi.restoreAllMocks();
  resetConditionsToOfflineFixture('playwright_condition_release_test_cleanup');
});

describe('Playwright certified condition database release', () => {
  it('activates the exact current database release without certifying unrelated effects', async () => {
    const release = materializePlaywrightCertifiedConditionRelease(sourceCatalogs());
    const conditions = certifiedRows(release.catalogs.effects);
    const unrelated = release.catalogs.effects.find((row) => row.card_number === 'HOME-condition-probe');

    expect(release.identity.conditionCount).toBe(15);
    expect(conditions).toHaveLength(15);
    expect(unrelated?.support).toBeUndefined();
    expect(new Set(conditions.map((row) => (row.support as JsonRecord).evidence_id)).size).toBe(1);
    await Promise.all(conditions.map(async (row) => {
      expect((row.support as JsonRecord).content_hash).toBe(
        await conditionRecordContentHash(row as ConditionEffectRecord),
      );
    }));

    serveConditions(release.catalogs.effects);
    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE })).resolves.toMatchObject({
      mode: 'database_release',
      count: 15,
    });
  });

  it('fails closed before certification when a stable condition row is missing', () => {
    const catalogs = sourceCatalogs();
    catalogs.effects = catalogs.effects.filter((row) => row.card_number !== 'COND-blinded');
    expect(() => materializePlaywrightCertifiedConditionRelease(catalogs)).toThrow(
      /COND-blinded must resolve to exactly one database effect/,
    );
  });

  it.each([
    {
      name: 'row set',
      mutate: (rows: JsonRecord[]) => rows.filter((row) => row.card_number !== 'COND-blinded'),
    },
    {
      name: 'release pin',
      mutate: (rows: JsonRecord[]) => {
        const next = cloneJson(rows);
        const support = next.find((row) => row.card_number === 'COND-blinded')!.support as JsonRecord;
        support.rules_hash = `sha256:${'f'.repeat(64)}`;
        return next;
      },
    },
    {
      name: 'executable projection',
      mutate: (rows: JsonRecord[]) => {
        const next = cloneJson(rows);
        const condition = next.find((row) => row.card_number === 'COND-blinded')!;
        condition.mechanics = { ...(condition.mechanics as JsonRecord), drift: true };
        return next;
      },
    },
  ])('keeps the runtime offline when the certified $name drifts', async ({ mutate }) => {
    const release = materializePlaywrightCertifiedConditionRelease(sourceCatalogs());
    serveConditions(mutate(release.catalogs.effects));
    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE })).resolves.toMatchObject({
      mode: 'offline_fixture',
    });
  });
});
