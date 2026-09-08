import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Action } from '../types';
import { collectVariablesFromEffects } from '../character/variables';
import { executeAction } from './execute';
import { collectModifiers } from './modifiers';
import { startTurn, endTurn } from './turn';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

const character: CharacterContext = { level: 3, profBonus: 2,
  abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 } };
const modifier = { kind: 'modifier', op: 'add', value: '1d8', value_timing: 'on_apply',
  applies_to: { roll: 'ac' }, duration: { type: 'until_start_of_next_turn' } };
const fresh = (): RuntimeState => ({ hp: { current: 10, max: 10, temp: 0 },
  resources: { bonus_action: 1, superiority_die: 4 }, maxResources: { bonus_action: 1, superiority_die: 4 },
  equipment: {}, inventory: [], activeEffects: [] });
const action = (payload = modifier) => ({ name: 'Защитный манёвр',
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'superiority_die' }] },
  effects: [{ resolution: 'auto', result: [payload] }] });

describe('persistent rolled numeric modifiers', () => {
  it('compiles the catalog maneuver and separates Disengage and AC expiry', () => {
    const source = readFileSync(new URL('../../../backend/migrations/battle_master_evasive_210.go', import.meta.url), 'utf8');
    const mechanics = JSON.parse(source.match(/const battleMasterEvasive210 = `([^`]+)`/)![1]);
    const compiled = projectRuleAction({ id: '21000000-0000-4000-8000-000000000001', name: 'Уклоняющийся шаг',
      type: 'class_feature', resource: 'bonus_action', mechanics } as Action);
    expect(compiled.id).toBe('21000000-0000-4000-8000-000000000001');
    const dieGrant = JSON.parse(source.match(/const battleMasterDie210 = `([^`]+)`/)![1]);
    const variables = collectVariablesFromEffects([{ effects: [{ resolution: 'auto', result: [dieGrant] }] }]);
    expect(variables).toEqual({ superiority_die: { count: 1, sides: 8 } });
    const context = { ...character, variables };
    const result = executeAction(fresh(), mechanics, { character: context, rng: () => 0.5 });
    expect(result.state.activeEffects).toHaveLength(2);
    expect(result.state.resources.superiority_die).toBe(3);
    const ended = endTurn(result.state, context).state;
    expect(ended.activeEffects).toHaveLength(1);
    expect(ended.activeEffects[0].mechanics.value).toBe(5);
    expect(startTurn(ended, context).state.activeEffects).toHaveLength(0);
  });

  it('rolls once, saves the bonus across reload and expires at the next turn', () => {
    let calls = 0;
    const result = executeAction(fresh(), action(), { character, rng: () => { calls++; return 0.5; } });
    expect(calls).toBe(1);
    expect(result.state.resources).toMatchObject({ bonus_action: 0, superiority_die: 3 });
    const restored = JSON.parse(JSON.stringify(result.state)) as RuntimeState;
    expect(restored.activeEffects[0].mechanics.value).toBe(5);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ total: 5 }) }));
    for (let read = 0; read < 3; read++) {
      expect(collectModifiers(restored, [], { roll: 'ac' }).modifiers).toEqual([{ value: 5, source: 'Защитный манёвр' }]);
    }
    expect(calls).toBe(1);
    expect(startTurn(restored, character).state.activeEffects).toHaveLength(0);
    expect(modifier.value).toBe('1d8');
  });

  it('rejects an invalid timing before paying or consuming entropy', () => {
    const state = fresh();
    const before = structuredClone(state);
    let calls = 0;
    expect(() => executeAction(state, action({ ...modifier, value_timing: 'on_query' }), {
      character, rng: () => { calls++; return 0; },
    })).toThrow('on_apply requires a numeric modifier');
    expect(state).toEqual(before);
    expect(calls).toBe(0);
  });
});
