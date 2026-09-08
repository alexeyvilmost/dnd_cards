import type {ForgeCharacter} from './types';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import type {Action} from '../types';
import type {CharacterContext, RuntimeState} from '../mvp/contracts';
import {availableCheckManeuvers, checkManeuverChoice, prepareCheckManeuver, prepareSheetCheckCommit} from './checkManeuvers';
import {collectRollModifiers} from '../engine/modifiers';
import {plannedD20BonusDice, plannedValuesRng} from '../engine/dicePlan';
import {rollD20} from '../engine/roll';
import {finalizeSheetD20Roll} from './sheetD20Roll';
import {validateMechanics} from '../engine/validateMechanics';
const source = readFileSync(new URL('../../../backend/migrations/battle_master_checks_220.go', import.meta.url), 'utf8');
const actions = ['commandingPresence220', 'tacticalAssessment220'].map((name, index) => ({id: `action-${index}`, name,
  card_number: `ACT-check-${index}`, mechanics: JSON.parse(source.match(new RegExp('const '+name+' = `([^`]+)`'))![1])}) as Action);
const character: CharacterContext = {level: 3, classLevels: {warrior: 3}, profBonus: 2,
  abilityMods: {str: 3, dex: 2, con: 2, int: 0, wis: 0, cha: 0}};
const fresh = (): RuntimeState => ({hp: {current: 20, max: 20, temp: 0}, resources: {superiority_die: 4},
  maxResources: {superiority_die: 4}, equipment: {}, inventory: [], activeEffects: []});
describe('learned skill-check maneuvers', () => {
  it.each(actions)('uses shared valid modifier mechanics: $name', action => {
    const validation = validateMechanics(action.mechanics, {id: action.id, name: action.name, kind: 'action'});
    expect(validation.valid, validation.errors.join('; ')).toBe(true);
  });
  it.each([
    ['cha','intimidation',0],['cha','performance',0],['cha','persuasion',0],
    ['int','history',1],['int','investigation',1],['wis','insight',1],
  ])('offers only the learned maneuver for %s/%s', (ability, skill, index) => {
    expect(availableCheckManeuvers(actions, fresh(), 'ability_check', {ability, skill}).map(action => action.id)).toEqual([actions[Number(index)].id]);
    expect(availableCheckManeuvers([], fresh(), 'ability_check', {ability, skill})).toEqual([]);
  });
  it.each([
    ['str','intimidation','ability_check'],['int','insight','ability_check'],['wis','history','ability_check'],
    ['cha','persuasion','saving_throw'],['dex','stealth','ability_check'],
  ])('rejects another ability, skill or roll kind: %s/%s/%s', (ability,skill,kind) => {
    expect(availableCheckManeuvers(actions, fresh(), kind, {ability,skill})).toEqual([]);
  });
  it('does not offer an exhausted pool or unknown action, and cancellation can discard preparation', () => {
    const before = fresh();
    const prepared = prepareCheckManeuver(actions[1], actions, before, character, {ability: 'int', skill: 'history'}, 'hero');
    expect(before.resources.superiority_die).toBe(4);
    expect(before.activeEffects).toEqual([]);
    expect(prepared.state.resources.superiority_die).toBe(3);
    const empty = fresh(); empty.resources.superiority_die = 0;
    expect(availableCheckManeuvers(actions, empty, 'ability_check', {ability: 'int',skill: 'history'})).toEqual([]);
    expect(() => prepareCheckManeuver(actions[1], [], before, character, {ability: 'int',skill:'history'}, 'hero')).toThrow();
    expect(checkManeuverChoice(actions).items?.[1].grants).toEqual([{kind: 'grant_action', value: actions[0].card_number}]);
  });
  it('adds a visible d8 to the ordinary check plan, consumes it once and preserves the spent resource', () => {
    const prepared = prepareCheckManeuver(actions[1], actions, fresh(), character, {ability:'int', skill:'history'}, 'hero');
    const collected = collectRollModifiers(prepared.state, [], {roll: 'ability_check', filter: {ability:'int', skill:'history'}});
    const plan = [{sides:20,label:'История'}, ...plannedD20BonusDice(collected.rules,'История','check')];
    expect(plan.map(die => die.sides)).toEqual([20,8]);
    const roll = rollD20({advantage:'none', modifiers:[{value:2,source:'БМ'}], rules:collected.rules,
      rng:plannedValuesRng(plan,[10,5])});
    expect(roll.total).toBe(17);
    const finalized = finalizeSheetD20Roll(prepared.state,'ability_check',{ability:'int',skill:'history'});
    expect(finalized.state.activeEffects).toEqual([]);
    expect(finalized.state.resources.superiority_die).toBe(3);
    expect(collectRollModifiers(finalized.state,[],{roll:'ability_check'}).rules).toEqual([]);
  });
});

it('prepares one exact command for both the consumed pool and persisted check events', () => {
  const state = fresh(); state.resources.superiority_die = 3;
  const character = {id: 'hero', system_id: 'dnd5e-2024', runtime_revision: 12, turn_state: {}} as ForgeCharacter;
  const prepared = prepareSheetCheckCommit({character, state, commandId: 'fixed-command', runId: 'own-run',
    rulesContent: {version: 1}, events: [{type: 'resource_spent', resource: 'superiority_die', amount: 1, remaining: 3}]});
  expect(prepared.request).toMatchObject({command_id: 'fixed-command',roguelike_run_id:'own-run',roguelike_intent:'camp',
    participants:[{character_id:'hero',expected_runtime_revision:12,patch:{resources:{superiority_die:3}}}],
    events:[{character_id:'hero',type:'resource_spent'}]});
  expect(prepared.request.ruleset_ref.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(JSON.parse(JSON.stringify(prepared)).request).toEqual(prepared.request);
});

const ambushSource = readFileSync(new URL('../../../backend/migrations/battle_master_ambush_221.go', import.meta.url), 'utf8');
const ambush = {id:'ambush', name:'Ambush', card_number:'ACT-bm-ambush',
  mechanics:JSON.parse(ambushSource.match(/const battleMasterAmbush221 = `([^`]+)`/)![1])} as Action;
describe('Ambush checks and initiative', () => {
  it('validates shared mechanics', () => {
    const result = validateMechanics(ambush.mechanics, {id:ambush.id,name:ambush.name,kind:'action'});
    expect(result.valid,result.errors.join('; ')).toBe(true);
  });
  it.each(['initiative','ability_check'])('adds and consumes exactly one d8 for %s', kind => {
    const before = fresh();
    const facts = {ability:'dex',skill:'stealth'};
    const prepared = prepareCheckManeuver(ambush,[ambush],before,character,facts,'hero',kind);
    const collected = collectRollModifiers(prepared.state,[],{roll:kind,filter:facts});
    const plan = [{sides:20,label:'Ambush'},...plannedD20BonusDice(collected.rules,'Ambush','check')];
    expect(plan.map(die=>die.sides)).toEqual([20,8]);
    const roll = rollD20({advantage:'none',modifiers:[{value:2,source:'DEX'}],rules:collected.rules,rng:plannedValuesRng(plan,[10,5])});
    expect(roll.total).toBe(17);
    const final = finalizeSheetD20Roll(prepared.state,kind as 'initiative'|'ability_check',facts);
    expect(final.state.activeEffects).toEqual([]);
    expect(final.state.resources.superiority_die).toBe(3);
    expect(before.resources.superiority_die).toBe(4);
  });
  it.each(['incapacitated','unconscious','stunned','paralyzed'])('rejects %s before preparation', condition => {
    const state = fresh();
    state.activeEffects.push({id:'condition',name:'condition',source:'test',mechanics:{kind:'condition',value:condition}} as RuntimeState['activeEffects'][number]);
    expect(availableCheckManeuvers([ambush],state,'initiative',{})).toEqual([]);
    expect(availableCheckManeuvers([ambush],state,'ability_check',{ability:'dex',skill:'stealth'})).toEqual([]);
    expect(()=>prepareCheckManeuver(ambush,[ambush],state,character,{},'hero','initiative')).toThrow();
    expect(state.resources.superiority_die).toBe(4);
  });
  it('rejects exhausted, unlearned and unrelated checks', () => {
    const state = fresh(); state.resources.superiority_die=0;
    expect(availableCheckManeuvers([ambush],state,'initiative',{})).toEqual([]);
    expect(availableCheckManeuvers([],fresh(),'initiative',{})).toEqual([]);
    expect(availableCheckManeuvers([ambush],fresh(),'ability_check',{ability:'dex',skill:'acrobatics'})).toEqual([]);
    expect(availableCheckManeuvers([ambush],fresh(),'saving_throw',{ability:'dex'})).toEqual([]);
  });
});
