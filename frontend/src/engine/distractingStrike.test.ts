import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Action } from '../types';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction, projectedAgainst } from './execute';

const source = readFileSync(new URL('../../../backend/migrations/battle_master_distracting_215.go', import.meta.url), 'utf8');
const mechanics = JSON.parse(source.match(/const battleMasterDistracting215 = `([^`]+)`/)![1]);
const character: CharacterContext = { level: 3, classLevels: { warrior: 3 }, profBonus: 2,
  abilityMods: { str: 3, dex: 4, con: 2, int: 0, wis: 0, cha: 0 },
  variables: { superiority_die: { count: 1, sides: 8 } } };
const fresh = (): RuntimeState => ({ hp: { current: 50, max: 50, temp: 0 },
  resources: { superiority_die: 4 }, maxResources: { superiority_die: 4 }, equipment: {}, inventory: [], activeEffects: [] });
const context = (critical: boolean, rng = () => 0.5): ExecuteContext => ({ character, selfId: 'source', rng,
  target: { id: 'target', saveMods: { wis: 0 }, runtimeState: fresh() },
  triggeringAttack: { targetActorId: 'target', damageType: 'fire', critical } });

describe('catalog Distracting Strike', () => {
  it.each([false, true])('adds damage with critical=%s and preserves the opening for another attacker', critical => {
    expect(projectRuleAction({ id: '21500000-0000-4000-8000-000000000001', name: 'Отвлекающий удар',
      type: 'class_feature', resource: 'free_action', mechanics } as Action).id).toBeTruthy();
    const result = executeAction(fresh(), mechanics, context(critical));
    expect(result.targetState?.hp.current).toBe(critical ? 40 : 45);
    expect(result.state.resources.superiority_die).toBe(3);
    let defender = structuredClone(result.targetState!);
    expect(defender.activeEffects[0]).toMatchObject({ sourceId: 'source', ownerId: 'target',
      sourceTurnExpiry: { boundary: 'start', sourceActorId: 'source' } });
    const attack = { activation: { mode: 'active', cost: [] }, effects: [{
      resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'str', who: 'target',
      on_hit: [{ kind: 'damage', amount: 1, type: 'bludgeoning' }],
    }] };
    const perform = (id: string) => {
      const target = { id: 'target', ac: 15, runtimeState: defender };
      const query = projectedAgainst(target, 'attack', 'melee',
        { rollerActorId: id, rollTargetActorId: 'target' });
      let rolls = 0;
      const outcome = executeAction(fresh(), attack, { character, selfId: id, target,
        rng: () => { rolls++; return 0.1; } });
      defender = outcome.targetState ?? defender;
      return { rolls, advantage: query.advantage };
    };
    expect(perform('source')).toEqual({ rolls: 1, advantage: 'none' });
    expect(defender.activeEffects).toHaveLength(1);
    expect(perform('ally')).toEqual({ rolls: 2, advantage: 'advantage' });
    expect(defender.activeEffects).toHaveLength(0);
    expect(perform('other')).toEqual({ rolls: 1, advantage: 'none' });
  });
});
