import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Action } from '../types';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';
import { collectModifiers } from './modifiers';

const source = readFileSync(new URL('../../../backend/migrations/battle_master_goading_213.go', import.meta.url), 'utf8');
const mechanics = JSON.parse(source.match(/const battleMasterGoading213 = `([^`]+)`/)![1]);
const character: CharacterContext = { level: 3, classLevels: { warrior: 3 }, profBonus: 2,
  abilityMods: { str: 3, dex: 4, con: 2, int: 0, wis: 0, cha: 0 },
  variables: { superiority_die: { count: 1, sides: 8 } } };
const fresh = (): RuntimeState => ({ hp: { current: 50, max: 50, temp: 0 },
  resources: { superiority_die: 4 }, maxResources: { superiority_die: 4 }, equipment: {}, inventory: [], activeEffects: [] });
const context = (critical: boolean, rng = () => 0.5): ExecuteContext => ({ character, selfId: 'source', rng,
  target: { id: 'target', saveMods: { wis: 0 }, runtimeState: fresh() },
  triggeringAttack: { targetActorId: 'target', damageType: 'fire', critical } });

describe('catalog Goading Attack', () => {
  it.each([false, true])('adds original damage with critical=%s and source-specific disadvantage', critical => {
    expect(projectRuleAction({ id: '21300000-0000-4000-8000-000000000001', name: 'Провоцирующая атака',
      type: 'class_feature', resource: 'free_action', mechanics } as Action).id).toBeTruthy();
    const result = executeAction(fresh(), mechanics, context(critical));
    expect(result.targetState?.hp.current).toBe(critical ? 40 : 45);
    expect(result.state.resources.superiority_die).toBe(3);
    const affected = structuredClone(result.targetState!);
    expect(affected.activeEffects).toHaveLength(1);
    expect(affected.activeEffects[0]).toMatchObject({ sourceId: 'source', ownerId: 'target',
      sourceTurnExpiry: { boundary: 'end', sourceActorId: 'source' } });
    const advantage = (rollTargetActorId: string, roll = 'attack') => collectModifiers(affected, [], {
      roll, evalCtx: { rollerActorId: 'target', rollTargetActorId },
    }).advantage;
    expect(advantage('source')).toBe('none');
    expect(advantage('ally')).toBe('disadvantage');
    expect(advantage('ally', 'saving_throw')).toBe('none');
    expect(advantage('ally', 'ability_check')).toBe('none');
  });
  it('keeps bonus damage after a successful save without applying the penalty', () => {
    let rolls = 0;
    const result = executeAction(fresh(), mechanics, context(false, () => rolls++ ? 0.99 : 0.5));
    expect(result.targetState?.hp.current).toBe(45);
    expect(result.targetState?.activeEffects).toHaveLength(0);
  });
});
