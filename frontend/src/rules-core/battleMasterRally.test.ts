import { selectedTargetsForAction } from '../solo-combat/engine';
import type { SoloCombatState } from '../solo-combat/types';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Action } from '../types';
import { createWorld, type ActorState, type SpatialFacts } from './domain';
import { InMemoryRulesSession } from './session';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { migrateWorldState } from './worldMigration';
import { planSheetActionDice } from '../character/sheetActionOrchestrator';

const mechanics = JSON.parse(readFileSync(new URL('../../../backend/migrations/battle_master_rally_217.go', import.meta.url), 'utf8').match(/const battleMasterRally217 = `([^`]+)`/)![1]);
const rally = projectRuleAction({ id: '21700000-0000-4000-8000-000000000001', name: 'Сплочение',
  type: 'class_feature', resource: 'bonus_action', mechanics } as unknown as Action);
const ruleset = { systemId: 'dnd5e-2024' as const, releaseId: 'rally', contentHash: 'sha256:rally', errataVersion: '2024' };
const facts: SpatialFacts = { factsSource: 'scenario', boardRevision: 1, distanceFt: 30,
  lineOfSight: false, cover: 'none', relation: 'ally', targetCanSeeSource: false, targetCanHearSource: true };
function actor(id: string, fighterLevel: number): ActorState {
  return { id, kind: 'playerCharacter', name: id, controllerId: id, ac: 12, capabilities: { actionIds: [rally.id] },
    character: { level: 10, classLevels: { warrior: fighterLevel, wizard: 10 - fighterLevel }, profBonus: 4,
      abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
      variables: { superiority_die: { count: 1, sides: 8 } } },
    runtime: { hp: { current: 10, max: 20, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, superiority_die: 4 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, superiority_die: 4 },
      equipment: {}, inventory: [], activeEffects: [] } };
}
function setup(level = 3, valid = true, options: { temp?: number; deaf?: boolean; blind?: boolean } = {}) {
  const source = actor('fighter', level), target = actor('ally', 1);
  delete target.character.variables;
  target.runtime.hp.temp = options.temp ?? 0;
  target.runtime.activeEffects = [options.deaf ? 'deafened' : '', options.blind ? 'blinded' : '']
    .filter(Boolean).map(value => ({ id: value, name: value, source: 'test', mechanics: { kind: 'condition', value } }));
  const tape = createStrictRngTape(valid ? [{ label: 'superiority', sides: 8, value: 5 }] : []);
  const initial = createWorld({ id: 'rally', ruleset, actors: [source, target] });
  const catalog = { getAction: (id: string) => id === rally.id ? rally : undefined };
  const session = new InMemoryRulesSession(initial, catalog, { rng: tape.rng,
    clock: createLogicalClock(), nextId: createSequentialIdFactory('rally') });
  const base = { schemaVersion: 1 as const, rulesetContentHash: ruleset.contentHash, actorId: source.id };
  expect(session.dispatch({ ...base, type: 'StartEncounter', commandId: 'start', expectedRevision: 0,
    initiative: [source.id, target.id] }).status).toBe('accepted');
  expect(session.dispatch({ ...base, type: 'StartTurn', commandId: 'turn', expectedRevision: 1 }).status).toBe('accepted');
  return { session, tape, use: (targetFacts = facts, targetId = target.id) => session.dispatch({ ...base,
    type: 'UseAction', commandId: 'rally', expectedRevision: session.getState().revision,
    actionId: rally.id, targetIds: [targetId], factsByTarget: { [targetId]: targetFacts } }) };
}

describe('Battle Master Rally', () => {
  it.each([3, 4, 5])('grants die plus half Fighter level %i, not total or target level', level => {
    const test = setup(level);
    expect(test.use().status).toBe('accepted');
    test.tape.assertExhausted();
    const restored = migrateWorldState(JSON.parse(JSON.stringify(test.session.getState())));
    expect(restored.actors.ally.runtime.hp).toEqual({ current: 10, max: 20, temp: 5 + Math.floor(level / 2) });
    expect(restored.actors.fighter.runtime.resources).toMatchObject({ action: 1, bonus_action: 0, superiority_die: 3 });
  });
  it('keeps a larger existing temporary HP pool', () => {
    const test = setup(3, true, { temp: 12 });
    expect(test.use().status).toBe('accepted');
    test.tape.assertExhausted();
    expect(test.session.getState().actors.ally.runtime.hp.temp).toBe(12);
  });
  it('allows a deafened ally who sees the source', () => {
    const test = setup(3, true, { deaf: true });
    expect(test.use({ ...facts, targetCanHearSource: false, targetCanSeeSource: true }).status).toBe('accepted');
    test.tape.assertExhausted();
  });
  it.each([
    { label: 'outside range', facts: { ...facts, distanceFt: 35 } },
    { label: 'enemy', facts: { ...facts, relation: 'enemy' as const } },
    { label: 'neither sight nor hearing', facts: { ...facts, targetCanHearSource: false } },
    { label: 'missing hearing evidence', facts: { ...facts, targetCanHearSource: undefined } },
  ])('rejects $label before resource or dice expenditure', scenario => {
    const test = setup(3, false);
    const before = test.session.getState();
    expect(test.use(scenario.facts).status).toBe('rejected');
    test.tape.assertExhausted();
    expect(test.session.getState()).toEqual(before);
  });
  it('rejects contradictory hearing/sight facts for a blinded, deafened target', () => {
    const test = setup(3, false, { deaf: true, blind: true });
    expect(test.use({ ...facts, targetCanSeeSource: true }).status).toBe('rejected');
    test.tape.assertExhausted();
  });
  it('cannot target the fighter even with forged ally facts', () => {
    const test = setup(3, false);
    expect(test.use(facts, 'fighter').status).toBe('rejected');
    test.tape.assertExhausted();
  });
});


it('sheet dice planning reads the Fighter variable, not the companion context', () => {
  const source = actor('fighter', 3), target = actor('ally', 1);
  delete target.character.variables;
  const plan = planSheetActionDice({ state: source.runtime, mechanics,
    context: { character: source.character, selfId: source.id, rng: () => 0.5,
      target: { id: target.id, ac: target.ac, characterContext: target.character, runtimeState: target.runtime } } });
  expect(plan).toHaveLength(1);
  expect(plan[0]).toMatchObject({ sides: 8 });
});


it('the existing board picker explains Rally target restrictions before sending a command', () => {
  const state = { characterId: 'fighter', catalogActions: [rally],
    sideByActorId: { fighter: 'heroes', ally: 'heroes', enemy: 'monsters' } } as unknown as SoloCombatState;
  const select = (clickedActorId: string) => selectedTargetsForAction({ state, actionId: rally.id,
    clickedActorId, clickedPosition: { x: 1, y: 1 } });
  expect(select('ally')).toEqual(['ally']);
  expect(() => select('fighter')).toThrow('Выберите союзника');
  expect(() => select('enemy')).toThrow('Выберите союзника');
});
