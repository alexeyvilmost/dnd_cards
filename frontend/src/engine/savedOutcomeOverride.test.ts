import {describe, expect, it} from 'vitest';
import {addBonusDieToD20Roll, retargetAttackRoll, rollD20} from './roll';
import {executeAction} from './execute';
import {equippedFighterState, FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext, RollLog} from '../mvp/contracts';

const face = (value: number) => () => (value - .5) / 20;
const reload = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const declarations = [
  {id: 'training-strike', source: 'Declared strike', kind: 'modifier', op: 'outcome', natural: {eq: 1}, value: 'hit', applies_to: {roll: 'attack'}},
  {id: 'other-ward', source: 'Declared ward', kind: 'modifier', op: 'outcome', natural: {min: 17, max: 19}, value: 'miss', applies_to: {roll: 'attack'}},
] as const;

describe('saved data-owned outcome overrides', () => {
  it.each(declarations)('keeps $id through unchanged and changed КД, reload and later bonus dice', declaration => {
    const rules = [reload(declaration)];
    const natural = declaration.value === 'hit' ? 1 : 19;
    const rolled = rollD20({rng: face(natural), rules, target: {type: 'ac', value: 12}});
    expect(rolled.outcome).toBe(declaration.value);
    expect(rolled.outcomeOverride).toEqual({outcome: declaration.value, rule: declaration});
    // Saved provenance must not alias a catalog entity that may later change.
    (rules[0] as {value: string}).value = 'crit_miss';
    const saved = reload(rolled), before = reload(saved);
    for (const ac of [12, 30, 2]) {
      const continued = retargetAttackRoll(saved, ac);
      expect(continued.outcome).toBe(declaration.value);
      expect(continued.target?.value).toBe(ac);
      expect(continued.dice).toEqual(saved.dice);
      expect(continued.total).toBe(saved.total);
      expect(continued.outcomeOverride?.rule).toEqual(declaration);
      const bonused = addBonusDieToD20Roll(continued, 8, 'Later boon', () => .99);
      expect(bonused.total).toBe(saved.total + 8);
      expect(bonused.outcome).toBe(declaration.value);
    }
    expect(saved).toEqual(before);
  });

  it.each(declarations)('resumes a real executor attack from $id without current passives or another roll', declaration => {
    const state = () => ({...equippedFighterState(), hp: {current: 30, max: 30, temp: 0}});
    const action = {effects: [{resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'str',
      on_hit: [{kind: 'damage', amount: 3, type: 'slashing'}]}]};
    const ctx: ExecuteContext = {character: FIGHTER_CTX_EQUIPPED, selfId: 'source', passives: [reload(declaration)],
      rng: face(declaration.value === 'hit' ? 1 : 19), pauseAfterAttackRoll: true,
      target: {id: 'target', ac: 12, runtimeState: state(), characterContext: FIGHTER_CTX_EQUIPPED}};
    const held = executeAction(state(), action, ctx).events.find(event => event.type === 'roll');
    if (held?.type !== 'roll') throw Error('Missing held roll');
    for (const ac of [12, 100]) {
      const resumed = executeAction(state(), action, {...ctx, passives: [], pauseAfterAttackRoll: false,
        forcedAttackRoll: reload(held.roll), rng: () => {throw Error('Continuation must not reroll');},
        target: {...ctx.target!, ac}});
      const roll = resumed.events.find(event => event.type === 'roll');
      expect(roll?.type === 'roll' && roll.roll.outcome).toBe(declaration.value);
      expect(resumed.targetState?.hp.current ?? 30).toBe(declaration.value === 'hit' ? 27 : 30);
    }
  });

  it('still compares ordinary and historical snapshotless attacks against the defended КД', () => {
    const ordinary = reload(rollD20({rng: face(15), target: {type: 'ac', value: 12}}));
    expect(ordinary.outcomeOverride).toBeUndefined();
    expect(retargetAttackRoll(ordinary, 12).outcome).toBe('hit');
    expect(retargetAttackRoll(ordinary, 18).outcome).toBe('miss');
    expect(addBonusDieToD20Roll(retargetAttackRoll(ordinary, 18), 6, 'Boon', () => .99).outcome).toBe('hit');
    const historical: RollLog = {...ordinary, outcome: 'hit', total: 1, dice: [{sides: 20, result: 1}]};
    expect(retargetAttackRoll(historical, 12).outcome).toBe('miss');
    for (const outcome of ['crit', 'crit_miss'] as const) expect(retargetAttackRoll({...ordinary, outcome}, 100).outcome).toBe(outcome);
  });

  it('retains a declared DC failure after an additive boon and honors later explicit redirection', () => {
    const failure = rollD20({rng: face(19), target: {type: 'dc', value: 2},
      rules: [{id: 'third-rule', op: 'outcome', natural: {eq: 19}, value: 'fail'}]});
    expect(addBonusDieToD20Roll(reload(failure), 6, 'Boon', () => .99).outcome).toBe('fail');
    const missed = rollD20({rng: face(19), target: {type: 'ac', value: 2}, rules: [reload(declarations[1])]});
    const redirected: RollLog = {...reload(missed), outcome: 'hit', automaticHit: {reason: 'Declared redirection', sourceEntityIds: ['other-item']}};
    expect(retargetAttackRoll(redirected, 100).outcome).toBe('hit');
    expect(addBonusDieToD20Roll(redirected, 6, 'Boon', () => .99).outcome).toBe('hit');
  });
});
