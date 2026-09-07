import {describe, expect, it} from 'vitest';
import type {RuntimeState} from '../mvp/contracts';
import {perceivesWithoutSight, senseRangeFt} from './senses';
import {collectModifiers} from './modifiers';
import {projectedAgainst} from './execute';

const blind = {kind: 'grant_sense', sense: 'blindsight', range: 10};
const state = (): RuntimeState => ({hp: {current: 10, max: 10, temp: 0}, resources: {}, maxResources: {},
  inventory: [], equipment: {}, activeEffects: [{id: 'blind', name: 'Ослеплён', source: 'test', ownerId: 'owner',
    mechanics: {kind: 'condition', value: 'blinded'}}]});
const facts = (feet: number) => ({rollerActorId: 'owner', rollTargetActorId: 'other',
  distancesFt: {owner: {other: feet}, other: {owner: feet}}});

describe('shared nonvisual perception', () => {
  it('uses the longest active range, ignores expired and unactivated grants', () => {
    const runtime = state();
    runtime.activeEffects.push({id: 'expired', name: 'Expired', source: 'test', roundsLeft: 0,
      mechanics: {...blind, range: 60}});
    const passives = [blind, {...blind, range: 90, activation: {mode: 'active'}}];
    expect(senseRangeFt(runtime, passives, 'blindsight')).toBe(10);
    expect(perceivesWithoutSight(runtime, passives, 10)).toBe(true);
    for(const distance of [15, NaN, Infinity, -1, undefined]) expect(perceivesWithoutSight(runtime, passives, distance)).toBe(false);
    expect(perceivesWithoutSight(runtime, [{...blind, sense: 'tremorsense', range: 60}], 5)).toBe(false);
  });

  it('overrides only the carrier attack penalty within actual Blindsight range', () => {
    expect(collectModifiers(state(), [blind], {roll: 'attack', evalCtx: facts(10)}).advantage).toBe('none');
    expect(collectModifiers(state(), [blind], {roll: 'attack', evalCtx: facts(15)}).advantage).toBe('disadvantage');
    expect(collectModifiers(state(), [], {roll: 'attack', evalCtx: facts(5)}).advantage).toBe('disadvantage');
    expect(collectModifiers(state(), [blind], {roll: 'ability_check', filter: {sense: 'sight'}, evalCtx: facts(5)}).autoFail).toBe(true);
    const poisoned = state();
    poisoned.activeEffects.push({id: 'poison', name: 'Poisoned', source: 'test', mechanics: {kind: 'condition', value: 'poisoned'}});
    expect(collectModifiers(poisoned, [blind], {roll: 'attack', evalCtx: facts(5)}).advantage).toBe('disadvantage');
  });

  it('does not give an attacker advantage against a blinded defender who perceives it', () => {
    const target = {id: 'owner', ac: 15, runtimeState: state(), passives: [blind]};
    const context = {...facts(10), rollerActorId: 'other', rollTargetActorId: 'owner'};
    expect(projectedAgainst(target, 'attack', 'melee', context).advantage).toBe('none');
    expect(projectedAgainst(target, 'attack', 'melee', {...context, distancesFt: facts(15).distancesFt}).advantage).toBe('advantage');
  });
});
