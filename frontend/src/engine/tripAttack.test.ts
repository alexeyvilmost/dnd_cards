import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';

const source = readFileSync(new URL('../../../backend/migrations/battle_master_trip_212.go', import.meta.url), 'utf8');
const mechanics = JSON.parse(source.match(/const battleMasterTrip212 = `([^`]+)`/)![1]);
const character: CharacterContext = { level: 3, classLevels: { warrior: 3 }, profBonus: 2,
  abilityMods: { str: 3, dex: 4, con: 2, int: 0, wis: 0, cha: 0 },
  variables: { superiority_die: { count: 1, sides: 8 } } };
const fresh = (): RuntimeState => ({ hp: { current: 50, max: 50, temp: 0 },
  resources: { superiority_die: 4 }, maxResources: { superiority_die: 4 }, equipment: {}, inventory: [], activeEffects: [] });
const context = (critical: boolean, rng = () => 0.5): ExecuteContext => ({ character, selfId: 'source', rng,
  target: { id: 'target', size: 3, saveMods: { str: 0 }, runtimeState: fresh() },
  triggeringAttack: { targetActorId: 'target', damageType: 'fire', critical } });

describe('catalog Trip Attack', () => {
  it.each([false, true])('adds original damage with critical=%s and knocks Large creatures prone', critical => {
    const result = executeAction(fresh(), mechanics, context(critical));
    expect(result.state.resources.superiority_die).toBe(3);
    expect(result.targetState?.hp.current).toBe(critical ? 40 : 45);
    expect(result.targetState?.activeEffects).toContainEqual(expect.objectContaining({
      mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }),
    }));
  });
  it.each([4, 5])('adds damage but skips the save for size %s', size => {
    let rolls = 0;
    const ctx = context(false, () => { rolls++; return 0.5; });
    ctx.target!.size = size;
    const result = executeAction(fresh(), mechanics, ctx);
    expect(result.targetState?.hp.current).toBe(45);
    expect(result.targetState?.activeEffects).toHaveLength(0);
    expect(rolls).toBe(1);
    expect(result.state.resources.superiority_die).toBe(3);
  });
  it('keeps damage after a successful Strength save', () => {
    let rolls = 0;
    const result = executeAction(fresh(), mechanics, context(false, () => rolls++ ? 0.99 : 0.5));
    expect(result.targetState?.hp.current).toBe(45);
    expect(result.targetState?.activeEffects).toHaveLength(0);
  });
  it('rejects an unknown target size before spending resources or dice', () => {
    let rolls = 0;
    const ctx = context(false, () => { rolls++; return 0; });
    delete ctx.target!.size;
    const state = fresh();
    expect(() => executeAction(state, mechanics, ctx)).toThrow('target size');
    expect(rolls).toBe(0);
    expect(state.resources.superiority_die).toBe(4);
  });
});
