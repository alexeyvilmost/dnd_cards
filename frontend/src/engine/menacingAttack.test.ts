import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Action } from '../types';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';
import { describeMechanicsLine } from './describeMechanics';

const source = readFileSync(new URL('../../../backend/migrations/battle_master_menacing_211.go', import.meta.url), 'utf8');
const mechanics = JSON.parse(source.match(/const battleMasterMenacing211 = `([^`]+)`/)![1]);
const character: CharacterContext = { level: 3, classLevels: { warrior: 3 }, profBonus: 2,
  abilityMods: { str: 3, dex: 4, con: 2, int: 0, wis: 0, cha: 0 },
  variables: { superiority_die: { count: 1, sides: 8 } } };
const fresh = (): RuntimeState => ({ hp: { current: 50, max: 50, temp: 0 },
  resources: { superiority_die: 4 }, maxResources: { superiority_die: 4 }, equipment: {}, inventory: [], activeEffects: [] });
const context = (critical: boolean, rng = () => 0.5): ExecuteContext => ({ character, selfId: 'source', rng,
  target: { id: 'target', saveMods: { wis: 0 }, runtimeState: fresh() },
  triggeringAttack: { targetActorId: 'target', damageType: 'fire', critical } });

describe('catalog Menacing Attack', () => {
  it('describes inherited damage without exposing its internal marker', () => {
    const description = describeMechanicsLine(mechanics);
    expect(description).toContain('кость превосходства к урону исходной атаки');
    expect(description).not.toContain('triggering_attack');
  });
  it.each([false, true])('inherits damage and critical=%s, then applies source-owned fear', critical => {
    expect(projectRuleAction({ id: '21100000-0000-4000-8000-000000000001', name: 'Устрашающая атака',
      type: 'class_feature', resource: 'free_action', mechanics } as Action).id).toBeTruthy();
    const result = executeAction(fresh(), mechanics, context(critical));
    expect(result.state.resources.superiority_die).toBe(3);
    expect(result.targetState?.hp.current).toBe(critical ? 40 : 45);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage', damageType: 'fire', amount: critical ? 10 : 5 }));
    expect(result.targetState?.activeEffects).toEqual([expect.objectContaining({ sourceId: 'source', ownerId: 'target',
      mechanics: expect.objectContaining({ kind: 'condition', value: 'frightened' }),
      sourceTurnExpiry: expect.objectContaining({ boundary: 'end', sourceActorId: 'source', ownerActorId: 'target' }),
    })]);
  });

  it('keeps bonus damage on a successful Wisdom save', () => {
    let calls = 0;
    const result = executeAction(fresh(), mechanics, context(false, () => calls++ === 0 ? 0.5 : 0.99));
    expect(result.targetState?.hp.current).toBe(45);
    expect(result.targetState?.activeEffects).toHaveLength(0);
    expect(result.state.resources.superiority_die).toBe(3);
  });

  it('fails before cost or entropy if the original attack target is absent or mismatched', () => {
    for (const attack of [undefined, { targetActorId: 'another', damageType: 'fire', critical: true }]) {
      const state = fresh();
      const before = structuredClone(state);
      let calls = 0;
      expect(() => executeAction(state, mechanics, { ...context(false, () => { calls++; return 0; }), triggeringAttack: attack }))
        .toThrow('triggering attack damage requires its saved target');
      expect(calls).toBe(0);
      expect(state).toEqual(before);
    }
  });
});
