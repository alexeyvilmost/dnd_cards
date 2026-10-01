import {describe, expect, it} from 'vitest';
import definitions from '../../../scripts/content/data/combat-spell-repairs-20260930.json';
import {executeAction} from './execute';
import {endTurn, startTurn} from './turn';
import {evaluateCondition} from './circumstances';
import {validateMechanics} from './validateMechanics';
import {freshFighterState, FIGHTER_CTX_EQUIPPED} from '../mvp/fixtures';
import type {ExecuteContext} from '../mvp/contracts';

const caster = {...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3};
const face = (value: number, sides = 20) => (value - .5) / sides;
const mechanics = (number: string) => definitions.find(s => s.card_number === number)!.mechanics as Record<string, unknown>;
function cast(number: string, targetHp = 40, castLevel = 1) {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 4; state.maxResources.spell_slot_1 = 4;
  const target = freshFighterState(); target.hp = {current: targetHp, max: 40, temp: 0};
  const ctx: ExecuteContext = {character: caster, selfId: 'caster',
    spell: {spellId: number, baseLevel: number === 'SPELL-0260' ? 0 : 1, castLevel},
    target: {id: 'target', characterContext: {...FIGHTER_CTX_EQUIPPED, creatureType: 'humanoid'}, runtimeState: target, saveMods: {wis: 0}},
    rng: () => face(1)};
  return executeAction(state, mechanics(number), ctx);
}
describe('reviewed combat spell data', () => {
  it.each(definitions)('$card_number validates with the shared mechanics schema', (definition) => {
    const result = validateMechanics(definition.mechanics, {id: definition.id, name: definition.name, kind: 'spell'});
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
  it.each([{hp: 40, sides: 8}, {hp: 39, sides: 12}])('Toll chooses d$sides from target HP $hp without a manual choice', ({hp, sides}) => {
    const result = cast('SPELL-0260', hp, 0);
    const damage = result.events.filter(e => e.type === 'damage');
    expect(damage).toHaveLength(1);
    expect(damage[0]).toMatchObject({roll: {dice: [{sides}]}});
    expect(result.targetState?.hp.current).toBe(hp - 1);
  });
  it('the target-HP predicate also drives an unrelated action and fails closed without observations', () => {
    expect(evaluateCondition({kind: 'target_hp_fraction_below', value: .5}, {})).toBe(false);
    const state = freshFighterState(), target = freshFighterState();
    state.hp.current = 1; target.hp = {current: 8, max: 20, temp: 0};
    const result = executeAction(state, {effects: [{resolution: 'auto', who: 'target', result: [
      {kind: 'damage', amount: 3, type: 'force', when: [{kind: 'target_hp_fraction_below', value: .5}]},
    ]}]}, {character: caster, target: {id: 'other', runtimeState: target}, rng: () => .5});
    expect(result.targetState?.hp.current).toBe(5);
  });
  it('Searing applies initial damage without a save and burns before attempting to end at turn start', () => {
    const castResult = cast('SPELL-0254');
    expect(castResult.events.filter(e => e.type === 'roll' && e.roll.kind === 'save')).toHaveLength(0);
    expect(castResult.targetState?.hp.current).toBe(39);
    const burning = castResult.targetState!;
    const failedContext = {...FIGHTER_CTX_EQUIPPED, selfId: 'target', rng: () => face(1)};
    const failed = startTurn(burning, failedContext);
    expect(failed.state.hp.current).toBe(38);
    expect(failed.state.activeEffects).toHaveLength(1);
    const dice = [face(1, 6), face(20)];
    const successContext = {...FIGHTER_CTX_EQUIPPED, selfId: 'target', rng: () => dice.shift() ?? 0};
    const success = startTurn(failed.state, successContext);
    expect(success.state.hp.current).toBe(37);
    expect(success.state.activeEffects).toHaveLength(0);
    const damageIndex = success.events.findIndex(e => e.type === 'damage');
    const saveIndex = success.events.findIndex(e => e.type === 'roll' && e.roll.kind === 'save');
    expect(damageIndex).toBeLessThan(saveIndex);
    expect(startTurn(success.state, FIGHTER_CTX_EQUIPPED).state.hp.current).toBe(37);
  });
  it('Searing retains caster DC and upcast dice on a different creature', () => {
    const result = cast('SPELL-0254', 40, 3);
    expect(result.events.find(e => e.type === 'damage')).toMatchObject({roll: {dice: [{sides: 6}, {sides: 6}, {sides: 6}]}});
    const turnContext = {...FIGHTER_CTX_EQUIPPED, profBonus: 0, spellcastingMod: -5,
      selfId: 'target', rng: () => face(1)};
    const turn = startTurn(result.targetState!, turnContext);
    expect(turn.events.find(e => e.type === 'damage')).toMatchObject({roll: {dice: [{sides: 6}, {sides: 6}, {sides: 6}]}});
    expect(turn.events.find(e => e.type === 'roll' && e.roll.kind === 'save')).toMatchObject({roll: {target: {value: 13}}});
  });
  it('an unrelated self-save uses the owner rather than the other creature in the execution context', () => {
    const state = freshFighterState();
    const result = executeAction(state, {effects: [{resolution: 'save', who: 'self', ability: 'wis', dc: 10,
      on_fail: [{kind: 'set_value', target: 'temp_hp', value: 2}], on_success: []}]}, {
      character: {...caster, abilityMods: {...caster.abilityMods, wis: 0}}, selfId: 'owner',
      target: {id: 'unrelated', saveMods: {wis: 100}}, rng: () => face(2),
    });
    expect(result.state.hp.temp).toBe(2);
    expect(result.events.find(e => e.type === 'roll')).toMatchObject({roll: {total: 2, outcome: 'fail'}});
  });
  it('Searing burns on ten target turns and expires at the tenth end, including canonical no-default-advance ends', () => {
    let state = cast('SPELL-0254').targetState!;
    const context = {...FIGHTER_CTX_EQUIPPED, selfId: 'target', rng: () => face(1)};
    for (let turn = 1; turn <= 10; turn++) {
      const started = startTurn(JSON.parse(JSON.stringify(state)), context);
      expect(started.events.filter(e => e.type === 'damage')).toHaveLength(1);
      expect(started.state.hp.current).toBe(39 - turn);
      expect(started.state.activeEffects[0]?.roundsLeft).toBe(11 - turn);
      const ended = endTurn(started.state, context, {advanceRoundDurations: false});
      expect(ended.state.activeEffects[0]?.roundsLeft).toBe(turn === 10 ? undefined : 10 - turn);
      state = ended.state;
    }
    expect(startTurn(state, context).events.some(e => e.type === 'damage')).toBe(false);
  });
  it('another data-owned DoT uses its declared end boundary without altering legacy default durations', () => {
    const state = freshFighterState();
    const applied = executeAction(state, {effects: [{resolution: 'auto', who: 'self', result: [{
      kind: 'triggered_effect', event: 'turn_start', duration: {type: 'rounds', amount: 2, round_boundary: 'end'},
      effects: [{resolution: 'auto', who: 'self', result: [{kind: 'damage', amount: 2, type: 'cold'}]}],
    }]}]}, {character: caster, selfId: 'other', rng: () => .1});
    const context = {...FIGHTER_CTX_EQUIPPED, selfId: 'other', rng: () => .1};
    const first = startTurn(applied.state, context);
    expect(first.state.hp.current).toBe(state.hp.current - 2);
    expect(first.state.activeEffects[0].roundsLeft).toBe(2);
    const firstEnd = endTurn(first.state, context, {advanceRoundDurations: false});
    expect(firstEnd.state.activeEffects[0].roundsLeft).toBe(1);
    // The second interval starts before its explicit end boundary.
    const second = startTurn(firstEnd.state, context);
    expect(second.state.hp.current).toBe(state.hp.current - 4);
    const final = endTurn(second.state, context, {advanceRoundDurations: false});
    expect(final.state.activeEffects).toHaveLength(0);
    const legacy = startTurn({...state, activeEffects: [{id: 'legacy', name: 'Legacy', source: 'other',
      roundsLeft: 2, mechanics: {kind: 'modifier', duration: {type: 'rounds', amount: 2}}}]}, context);
    expect(legacy.state.activeEffects[0].roundsLeft).toBe(1);
  });
  it.each(['spell', 'ability'] as const)('a persisted %s DoT uses owner save modifiers and retains source classification', (kind) => {
    let state = cast('SPELL-0254').targetState!;
    state = JSON.parse(JSON.stringify(state));
    state.activeEffects[0].mechanics.damage_source_kind = kind;
    const context = {...FIGHTER_CTX_EQUIPPED, selfId: 'target', rng: () => face(1),
      passives: [{effects: [{resolution: 'auto', result: [{kind: 'modifier', op: 'advantage',
        applies_to: {roll: 'saving_throw', filter: {saveSource: 'spell'}}}]}]}]};
    const result = startTurn(state, context);
    expect(result.events.find(e => e.type === 'roll' && e.roll.kind === 'save'))
      .toMatchObject({roll: {advantage: kind === 'spell' ? 'advantage' : 'none',
        modifiers: [{value: 3, source: 'цель'}]}});
  });
});
