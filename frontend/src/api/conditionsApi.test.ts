import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectsApi } from './client';
import {
  conditionEffectEntityRef,
  conditionRegistryAuthority,
  resetConditionsToOfflineFixture,
} from '../engine/conditions';
import {
  certifiedConditionEffectEntity,
  conditionRecordContentHash,
  loadConditions,
  materializeConditionRule,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type ConditionEffectRecord,
} from './conditionsApi';

const HASH = `sha256:${'a'.repeat(64)}`;
const OLD_HASH = `sha256:${'b'.repeat(64)}`;
const CURRENT_RELEASE_BINDING = {
  certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  rulesHash: HASH,
  releaseContentHash: HASH,
  releaseHash: HASH,
} as const;
const EVIDENCE_SUPPORT = {
  evidence_id: '00000000-0000-4000-8000-000000000001',
  evidence_hash: HASH,
  evidence_completed_at: '2026-08-05T00:00:00Z',
  gate_source_hash: HASH,
  source_content_hash: HASH,
  rules_hash: HASH,
  release_content_hash: HASH,
  release_hash: HASH,
  patch_hash: HASH,
  catalog_hash: HASH,
} as const;
const CONDITION_IDS = [
  'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened',
  'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified',
  'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
];

async function certifiedConditionRows(): Promise<ConditionEffectRecord[]> {
  return Promise.all(CONDITION_IDS.map(async (id) => {
    const row: ConditionEffectRecord = {
      id: `row:${id}`,
      card_number: `display:${id}`,
      name: id,
      description: id,
      effect_type: 'condition',
      mechanics: { condition: { id }, effects: [] },
    };
    return {
      ...row,
      support: {
        status: 'verified_mechanical',
        content_hash: await conditionRecordContentHash(row),
        dependency_hash: HASH,
        certification_version: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
        certified_at: '2026-08-05T00:00:00Z',
        ...EVIDENCE_SUPPORT,
      },
    };
  }));
}

async function certifyConditionRow(
  row: ConditionEffectRecord,
): Promise<ConditionEffectRecord> {
  return {
    ...row,
    support: {
      status: 'verified_mechanical',
      content_hash: await conditionRecordContentHash(row),
      dependency_hash: HASH,
      certification_version: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
      certified_at: '2026-08-05T00:00:00Z',
      ...EVIDENCE_SUPPORT,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetConditionsToOfflineFixture('test_cleanup');
});

describe('condition DB mechanics materializer', () => {
  it('hashes executable condition bytes but not editable presentation metadata', async () => {
    const condition: ConditionEffectRecord & Record<string, unknown> = {
      id: 'row:blinded',
      card_number: 'COND-blinded',
      name: 'Ослеплённый',
      description: 'До',
      effect_type: 'condition',
      mechanics: { condition: { id: 'blinded' }, effects: [] },
      image_url: '/before.png',
      rarity: 'common',
      author: 'Before',
      source: 'Before',
    };
    const before = await conditionRecordContentHash(condition);
    expect(await conditionRecordContentHash({
      ...condition,
      name: 'Новое имя',
      description: 'После',
      image_url: 'data:image/png;base64,iVBORw0KGgo=',
      rarity: 'rare',
      author: 'After',
      source: 'After',
    })).toBe(before);
    expect(await conditionRecordContentHash({
      ...condition,
      mechanics: { condition: { id: 'blinded' }, effects: [], drift: true },
    })).not.toBe(before);
    expect(await conditionRecordContentHash({
      ...condition,
      effect_type: 'other',
    })).not.toBe(before);
  });

  it('preserves relational predicates, payload primitives, stacking, rest, and thresholds', () => {
    const rule = materializeConditionRule({
      card_number: 'COND-exhaustion',
      name: 'Истощение',
      mechanics: {
        condition: { id: 'exhaustion' },
        effects: [{
          resolution: 'auto',
          result: [
            {
              kind: 'modifier', applies_to: { roll: 'd20' }, op: 'add', value: '-2',
              when: [{ kind: 'condition_source_in_line_of_sight' }],
            },
            { kind: 'condition_immunity', condition: 'poisoned' },
          ],
        }],
        includes: ['incapacitated'],
        leaves: ['prone'],
        stacking: { mode: 'levels', max: 6 },
        long_rest: { remove_levels: 1 },
        thresholds: [{ at_level: 6, outcome: 'death' }],
        world_facts: { weight_multiplier: 10 },
      },
    });

    expect(rule).toMatchObject({
      id: 'exhaustion',
      modifiers: [{
        applies_to: { roll: 'd20' }, op: 'add', value: '-2',
        when: [{ kind: 'condition_source_in_line_of_sight' }],
      }],
      payloads: [{ kind: 'condition_immunity', condition: 'poisoned' }],
      includes: ['incapacitated'],
      leaves: ['prone'],
      stacking: { mode: 'levels', max: 6 },
      longRest: { removeLevels: 1 },
      thresholds: [{ atLevel: 6, outcome: 'death' }],
      worldFacts: { weight_multiplier: 10 },
    });
  });

  it('requires mechanics.condition.id and never derives behavior identity from card_number', () => {
    expect(materializeConditionRule({
      card_number: 'COND-blinded',
      name: 'Looks plausible but has no mechanics identity',
      mechanics: { effects: [] },
    })).toBeNull();
    expect(materializeConditionRule({
      card_number: 'unrelated-display-code',
      name: 'Explicit mechanics identity',
      mechanics: { condition: { id: 'blinded' }, effects: [] },
    })?.id).toBe('blinded');
  });

  it('activates only one complete, unique, certified 15-condition database release', async () => {
    const effects = await certifiedConditionRows();
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({
      effects,
      total: 15,
      page: 1,
      limit: 200,
    } as never);

    const result = await loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING });
    expect(result).toMatchObject({ mode: 'database_release', count: 15 });
    expect(result.mode === 'database_release' ? result.setHash : '').toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(conditionRegistryAuthority()).toMatchObject({
      mode: 'database_release',
      setHash: result.mode === 'database_release' ? result.setHash : '',
    });
    expect(certifiedConditionEffectEntity('blinded')).toMatchObject({
      id: 'row:blinded',
      effect_type: 'condition',
      mechanics: { condition: { id: 'blinded' } },
    });
    expect(conditionEffectEntityRef('blinded')).toEqual({
      kind: 'effect', id: 'row:blinded', cardNumber: 'display:blinded',
    });
  });

  it('ignores unverified and other-release conditions outside the certified PHB release', async () => {
    const effects = await certifiedConditionRows();
    effects.push(
      {
        id: 'row:homebrew',
        card_number: 'display:homebrew',
        name: 'Homebrew',
        effect_type: 'condition',
        mechanics: { condition: { id: 'homebrew' }, effects: [] },
      },
      {
        id: 'row:future',
        card_number: 'display:future',
        name: 'Future release',
        effect_type: 'condition',
        mechanics: { condition: { id: 'future_condition' }, effects: [] },
        support: {
          status: 'verified_mechanical',
          content_hash: HASH,
          dependency_hash: HASH,
          certification_version: 'future-release-v1',
          certified_at: '2026-08-05T00:00:00Z',
        },
      },
    );
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({
      effects,
      total: effects.length,
      page: 1,
      limit: 200,
    } as never);

    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({
      mode: 'database_release',
      count: 15,
    });
  });

  it('reads every advertised condition page before selecting the exact certified release', async () => {
    const certified = await certifiedConditionRows();
    const unrelated = Array.from({ length: 200 }, (_, index): ConditionEffectRecord => ({
      id: `row:unrelated:${index}`,
      card_number: `display:unrelated:${index}`,
      name: `Unrelated ${index}`,
      effect_type: 'condition',
      mechanics: { condition: { id: `unrelated_${index}` }, effects: [] },
    }));
    const request = vi.spyOn(effectsApi, 'getEffects')
      .mockResolvedValueOnce({
        effects: unrelated,
        total: 215,
        page: 1,
        limit: 200,
      } as never)
      .mockResolvedValueOnce({
        effects: certified,
        total: 215,
        page: 2,
        limit: 200,
      } as never);

    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({
      mode: 'database_release',
      count: 15,
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      effect_type: 'condition', page: 1, limit: 200,
    }, { timeoutMs: undefined });
    expect(request).toHaveBeenNthCalledWith(2, {
      effect_type: 'condition', page: 2, limit: 200,
    }, { timeoutMs: undefined });
  });

  it('fails closed for an extra or duplicate exact-release candidate', async () => {
    const withExtra = await certifiedConditionRows();
    withExtra.push(await certifyConditionRow({
      id: 'row:unexpected',
      card_number: 'display:unexpected',
      name: 'Unexpected exact-release condition',
      effect_type: 'condition',
      mechanics: { condition: { id: 'unexpected' }, effects: [] },
    }));
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValueOnce({
      effects: withExtra,
      total: withExtra.length,
      page: 1,
      limit: 200,
    } as never);
    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({ mode: 'offline_fixture' });

    const withDuplicate = await certifiedConditionRows();
    withDuplicate.push(await certifyConditionRow({
      ...withDuplicate[0],
      id: 'row:blinded-duplicate',
      support: undefined,
    }));
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValueOnce({
      effects: withDuplicate,
      total: withDuplicate.length,
      page: 1,
      limit: 200,
    } as never);
    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({ mode: 'offline_fixture' });
  });

  it('fails the whole release closed to the explicitly marked offline fixture', async () => {
    const effects = (await certifiedConditionRows()).slice(0, 14);
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({
      effects,
      total: 14,
      page: 1,
      limit: 200,
    } as never);

    const result = await loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING });
    expect(result).toMatchObject({ mode: 'offline_fixture' });
    expect(conditionRegistryAuthority()).toMatchObject({ mode: 'offline_fixture' });
    expect(certifiedConditionEffectEntity('blinded')).toBeNull();
  });

  it('rejects stale content and obsolete condition evidence before registry activation', async () => {
    const staleContent = await certifiedConditionRows();
    staleContent[0] = {
      ...staleContent[0],
      mechanics: { condition: { id: 'blinded' }, effects: [], drift: true },
    };
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValueOnce({
      effects: staleContent,
      total: 15,
      page: 1,
      limit: 200,
    } as never);
    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({ mode: 'offline_fixture' });

    const obsoleteEvidence = await certifiedConditionRows();
    obsoleteEvidence[0] = {
      ...obsoleteEvidence[0],
      support: {
        ...obsoleteEvidence[0].support!,
        certification_version: 'micro-mvp-l1-rules-core-v1',
      },
    };
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValueOnce({
      effects: obsoleteEvidence,
      total: 15,
      page: 1,
      limit: 200,
    } as never);
    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({ mode: 'offline_fixture' });
  });

  it('rejects a condition set assembled from different release evidence artifacts', async () => {
    const mixedEvidence = await certifiedConditionRows();
    mixedEvidence[0] = {
      ...mixedEvidence[0],
      support: {
        ...mixedEvidence[0].support!,
        evidence_id: '00000000-0000-4000-8000-000000000002',
      },
    };
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({
      effects: mixedEvidence,
      total: 15,
      page: 1,
      limit: 200,
    } as never);

    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({ mode: 'offline_fixture' });
    expect(conditionRegistryAuthority()).toMatchObject({ mode: 'offline_fixture' });
  });

  it('rejects a complete valid condition set certified for an older compiled release', async () => {
    const oldRelease = (await certifiedConditionRows()).map((row) => ({
      ...row,
      support: {
        ...row.support!,
        rules_hash: OLD_HASH,
        release_content_hash: OLD_HASH,
        release_hash: OLD_HASH,
      },
    }));
    vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({
      effects: oldRelease,
      total: 15,
      page: 1,
      limit: 200,
    } as never);

    await expect(loadConditions({ expectedRelease: CURRENT_RELEASE_BINDING })).resolves.toMatchObject({
      mode: 'offline_fixture',
    });
    expect(conditionRegistryAuthority()).toMatchObject({ mode: 'offline_fixture' });
    expect(certifiedConditionEffectEntity('blinded')).toBeNull();
  });
});
