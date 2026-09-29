import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectsApi } from './client';
import { certifiedConditionEffectEntity, conditionRecordContentHash, loadConditions, MICRO_MVP_CONDITION_CERTIFICATION_VERSION, type ConditionEffectRecord } from './conditionsApi';
import { BUILTIN_CONDITION_RULES, resetConditionsToOfflineFixture } from '../engine/conditions';

const hash = `sha256:${'a'.repeat(64)}`;
const expectedRelease = { certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION, rulesHash: hash, releaseContentHash: hash, releaseHash: hash } as const;
function rows(): ConditionEffectRecord[] {
  return Object.keys(BUILTIN_CONDITION_RULES).map(id => ({
    id: `db:${id}`, name: id, effect_type: 'condition',
    mechanics: { condition: { id }, effects: [] }, support: { status: 'not_verified' },
  }));
}
function serve(effects: ConditionEffectRecord[]) {
  vi.spyOn(effectsApi, 'getEffects').mockResolvedValue({ effects, total: effects.length } as Awaited<ReturnType<typeof effectsApi.getEffects>>);
}
afterEach(() => { vi.restoreAllMocks(); resetConditionsToOfflineFixture('cleanup'); });

describe('manual review does not gate database conditions', () => {
  it('loads current declarations and multiple unverified entity references', async () => {
    serve(rows());
    expect(await loadConditions({ expectedRelease })).toMatchObject({ mode: 'database_release', count: 15 });
    expect(certifiedConditionEffectEntity('blinded')?.id).toBe('db:blinded');
    expect(certifiedConditionEffectEntity('prone')?.id).toBe('db:prone');
  });
  it('keeps the executable snapshot hash stable when only review status changes', async () => {
    const effects = rows(); serve(effects);
    const before = await loadConditions({ expectedRelease });
    effects[0].support = { status: 'verified' };
    expect(await loadConditions({ expectedRelease })).toEqual(before);
    effects[0].mechanics = { condition: { id: 'blinded' }, effects: [{ kind: 'modifier', op: 'add', value: '1', applies_to: { roll: 'attack' } }] };
    expect(await loadConditions({ expectedRelease })).not.toEqual(before);
  });
  it('keeps hashes and runtime snapshots independent of library cross-references', async () => {
    const effects = rows(); serve(effects);
    const before = await loadConditions({ expectedRelease });
    const blindedBefore = certifiedConditionEffectEntity('blinded');
    const proneBefore = certifiedConditionEffectEntity('prone');
    const enriched = effects.map((effect, index) => ({
      ...effect,
      references: [{ entity_type: 'action', entity_id: `action:${index}`, paths: ['mechanics.actions'] }],
      referenced_by: [{ entity_type: 'card', entity_id: `private-item:${index}`, paths: ['related_effects'] }],
    }));
    for (const index of [0, 1]) {
      expect(await conditionRecordContentHash(enriched[index])).toBe(await conditionRecordContentHash(effects[index]));
    }
    vi.mocked(effectsApi.getEffects).mockResolvedValue({ effects: enriched, total: enriched.length } as never);

    expect(await loadConditions({ expectedRelease })).toEqual(before);
    expect(certifiedConditionEffectEntity('blinded')).toEqual(blindedBefore);
    expect(certifiedConditionEffectEntity('prone')).toEqual(proneBefore);
    expect(enriched[0].referenced_by).toHaveLength(1);

    vi.mocked(effectsApi.getEffects).mockResolvedValue({
      effects: enriched.map(effect => ({ ...effect, references: [], referenced_by: [] })),
      total: effects.length,
    } as never);
    expect(await loadConditions({ expectedRelease })).toEqual(before);
  });
  it('still rejects duplicate and incomplete definitions', async () => {
    const effects = rows(); serve([...effects, effects[0]]);
    expect(await loadConditions({ expectedRelease })).toMatchObject({ mode: 'offline_fixture' });
    vi.mocked(effectsApi.getEffects).mockResolvedValue({ effects: effects.slice(1), total: 14 } as Awaited<ReturnType<typeof effectsApi.getEffects>>);
    expect(await loadConditions({ expectedRelease })).toMatchObject({ mode: 'offline_fixture' });
    expect(certifiedConditionEffectEntity('prone')).toBeNull();
  });
});
