import {describe, expect, it} from 'vitest';
import type {ExecuteContext, RuntimeState} from '../mvp/contracts';
import {applyIncomingDamage} from './execute';
import {startConcentration} from './concentration';

const trait = {kind: 'zero_hp_save', name: 'Стойкость нежити', ability: 'con',
  dc_base: 5, remaining_hp: 1, except_damage_types: ['radiant'], except_critical: true};
const state = (): RuntimeState => ({hp: {current: 4, max: 15, temp: 0},
  resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: []});
const context = (rng = () => 0.5): ExecuteContext => ({
  character: {abilityMods: {str: 1, dex: -2, con: 3, int: -4, wis: -2, cha: -3}, profBonus: 2, level: 1},
  passives: [trait], rng,
});

describe('data-owned zero HP survival save', () => {
  it('uses actual damage for the DC, retains one HP and is not healing', () => {
    const before = state();
    const result = applyIncomingDamage(before, 9, context(), {damageType: 'slashing'});
    expect(result.state.hp.current).toBe(1); // 11+3 = DC14
    expect(before.hp.current).toBe(4);
    expect(result.events.filter(event => event.type === 'roll')).toHaveLength(1);
    expect(result.events.some(event => event.type === 'healing')).toBe(false);
    expect(result.events.some(event => event.type === 'narrative' && event.text.includes('остаётся 1'))).toBe(true);
    const again = applyIncomingDamage(JSON.parse(JSON.stringify(result.state)), 10, context(), {damageType: 'slashing'});
    expect(again.state.hp.current).toBe(0); // same roll, DC15: no one-time resource
  });

  it.each([{damageType: 'radiant'}, {damageType: 'slashing', crit: true}])('does not roll for an excluded damage instance: %j', opts => {
    const result = applyIncomingDamage(state(), 4, context(() => {throw Error('Unexpected save');}), opts);
    expect(result.state.hp.current).toBe(0);
  });

  it('does not roll for nonlethal damage, temporary HP absorption, or an already fallen actor', () => {
    const ctx = context(() => {throw Error('Unexpected save');});
    expect(applyIncomingDamage(state(), 3, ctx).state.hp.current).toBe(1);
    expect(applyIncomingDamage({...state(), hp: {current: 4, max: 15, temp: 4}}, 4, ctx).state.hp.current).toBe(4);
    expect(applyIncomingDamage({...state(), hp: {current: 0, max: 15, temp: 0}}, 4, ctx).state.hp.current).toBe(0);
  });

  it('uses resisted damage and includes saving throw proficiency', () => {
    const ctx = context(() => 0.45); // 10+3+2 =15
    ctx.character.saveProficiencies = ['con'];
    ctx.passives = [trait, {kind: 'resistance', damage_type: 'slashing', value: 'resistance'}];
    const result = applyIncomingDamage(state(), 20, ctx, {damageType: 'slashing'});
    expect(result.state.hp.current).toBe(1); // DC15 after resistance
  });

  it('does not turn a critical hit into concentration disadvantage without an explicit rule', () => {
    const concentrating = startConcentration(state(), 'Test spell').state;
    let draws = 0;
    const ctx = context(() => {draws++; return 0.5;});
    applyIncomingDamage(concentrating, 1, ctx, {crit: true});
    expect(draws).toBe(1);
    draws = 0;
    applyIncomingDamage(concentrating, 1, ctx, {crit: true, imposeConcentrationDisadvantage: true});
    expect(draws).toBe(2);
  });

  it('rolls its own save even when the damaging spell save was already resolved', () => {
    const result = applyIncomingDamage(state(), 9, {...context(), forceSaveOutcome: 'fail'});
    expect(result.state.hp.current).toBe(1);
  });
});
