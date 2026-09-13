import { describe, expect, it } from 'vitest';
import { attackHitProbability } from './attackProbability';
import type { RollD20Options } from '../mvp/contracts';

const profile: Omit<RollD20Options, 'rng'> = { target: {type: 'ac', value: 15}, modifiers: [{value: 5, source: 'Атака'}] };

describe('attack hit probability', () => {
  it('includes equality, advantage and disadvantage', () => {
    expect(attackHitProbability(profile)).toBeCloseTo(.55);
    expect(attackHitProbability({...profile, advantage: 'advantage'})).toBeCloseTo(.7975);
    expect(attackHitProbability({...profile, advantage: 'disadvantage'})).toBeCloseTo(.3025);
  });
  it('keeps natural one a miss and a critical hit possible against any AC', () => {
    expect(attackHitProbability({...profile, target: {type: 'ac', value: -10}})).toBeCloseTo(.95);
    expect(attackHitProbability({...profile, target: {type: 'ac', value: 100}})).toBeCloseTo(.05);
    expect(attackHitProbability({...profile, target: {type: 'ac', value: 100}, critRange: 19})).toBeCloseTo(.1);
  });
  it('integrates bonus dice, penalties and after-failure bonuses', () => {
    expect(attackHitProbability({...profile, rules: [{op: 'bonus_die', faces: 4}]})).toBeCloseTo(.675);
    expect(attackHitProbability({...profile, rules: [{op: 'bonus_die', faces: 4, sign: -1}]})).toBeCloseTo(.425);
    expect(attackHitProbability({...profile, rules: [{op: 'bonus_die_on_failure', faces: 4}]})).toBeCloseTo(.675);
  });
  it('uses one reroll, minimum totals and forced outcomes from the shared resolver', () => {
    expect(attackHitProbability({...profile, rules: [{op: 'reroll', natural: {eq: 1}}]})).toBeCloseTo(.5775);
    expect(attackHitProbability({...profile, rules: [{op: 'minimum_total', value: 15}]})).toBeCloseTo(.95);
    expect(attackHitProbability({...profile, rules: [{op: 'outcome', natural: {min: 11, max: 14}, value: 'crit_miss'}]})).toBeCloseTo(.35);
    expect(attackHitProbability({...profile, rules: [{op: 'die_bonus', applies_to: {die: 20}, value: 2}]})).toBeCloseTo(.65);
  });
});
