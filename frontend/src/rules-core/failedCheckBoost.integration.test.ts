import {createMinorIllusion} from './worldObjects';
import {describe, expect, it} from 'vitest';
import {createWorld, type ActorState, type GameCommand, type RuleActionDefinition} from './domain';
import {createLogicalClock, createSequentialIdFactory, createStrictRngTape} from './determinism';
import {foldEvents} from './reducer';
import {InMemoryRulesSession} from './session';
import {migrateWorldState} from './worldMigration';

const ruleset = {systemId: 'dnd5e-2024' as const, releaseId: 'check-boost-test', contentHash: 'sha256:check-boost-test', errataVersion: 'test'};
const action: RuleActionDefinition = {id: 'tactical', name: 'Тактический ум', kind: 'nonSpell', sourceEntityIds: ['fighter'],
  mechanics: {activation: {mode: 'triggered', trigger: {events: ['ability_check_failed']}, cost: [{resource: 'second_wind'}]},
    effects: [{resolution: 'auto', result: [{kind: 'grant_effect', value: 'tactical-die'}]}]}};
const catalog = {getAction: (id: string) => id === action.id ? action : undefined};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function fighter(): ActorState {
  return {id: 'fighter', name: 'Воин', kind: 'playerCharacter', controllerId: 'owner', ac: 16,
    capabilities: {actionIds: [action.id]}, character: {abilityMods: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}, profBonus: 2, level: 2},
    runtime: {hp: {current: 20, max: 20, temp: 0}, resources: {action: 1, reaction: 1, second_wind: 2},
      maxResources: {action: 1, reaction: 1, second_wind: 2}, equipment: {}, inventory: [], activeEffects: []},
    grantedEffects: {'tactical-die': {id: 'die', name: 'Кость', mechanics: {kind: 'boon', die: '1d10', applies_to: ['ability_check'],
      timing: ['after_failure'], refund_on_failure: {resource: 'second_wind', amount: 1}}}},
    attackProfile: {attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: ['main_hand'], sourceEntityIds: ['test']},
  };
}

function fixture(values: {sides: number; value: number; label: string}[], escape = false, configure?: (actor: ActorState) => void, illusion = false) {
  const hero = fighter();
  configure?.(hero);
  const enemy = {...fighter(), id: 'enemy', name: 'Enemy', controllerId: 'other'};
  let world = createWorld({id: 'check-boost', ruleset, actors: [hero, enemy]});
  if (escape) world = foldEvents(world, [{ordinal: 0, sourceActorId: enemy.id, obligationIds: ['system:grapple-lifecycle'], payload: {
    type: 'GrappleApplied', grapple: {id: 'grapple', grapplerActorId: enemy.id, targetActorId: hero.id, sourcePart: 'main_hand',
      escapeDc: 13, reachFt: 5, sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'], startedAtRevision: 0}}}]);
  if (illusion) world.objects = createMinorIllusion({objects: {}, id: 'illusion', sourceActorId: enemy.id, sourceActionId: 'minor-illusion',
    form: 'image', description: 'Door', spellSaveDc: 13, imageCubeSideFt: 5,
    policy: {imageMaxCubeSideFt: 5, durationRounds: 10, maxActivePerSource: 1, studyAbility: 'int', studySkill: 'investigation'}}).objects;
  const tape = createStrictRngTape(values);
  const env = {rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('check-boost')};
  const session = new InMemoryRulesSession(world, catalog, env);
  const base = (commandId: string) => ({schemaVersion: 1 as const, commandId, actorId: hero.id,
    expectedRevision: session.getState().revision, rulesetContentHash: ruleset.contentHash});
  return {session, tape, env, base};
}

function accepted(session: InMemoryRulesSession, command: GameCommand) {
  const result = session.dispatch(command);
  if (result.status !== 'accepted') throw Error(`${result.code}: ${result.message}`);
  return result;
}

describe('optional class boost after a committed failed ability check', () => {
  it.each([10, 1, null])('uses bonus %s only after the player chooses, retaining the original roll across reload', bonus => {
    const test = fixture([{label: 'initial check', sides: 20, value: 5}, ...(bonus == null ? [] : [{label: 'boost', sides: 10, value: bonus}])]);
    accepted(test.session, {...test.base('check'), type: 'AbilityCheck', ability: 'int', dc: 13});
    const checkpoint = copy(test.session.getState());
    expect(checkpoint.pendingResolution).toMatchObject({type: 'check_boost', roll: {total: 5, outcome: 'fail'}});
    expect(checkpoint.actors.fighter.runtime.resources.second_wind).toBe(2);
    const restored = new InMemoryRulesSession(migrateWorldState(checkpoint), catalog, test.env);
    const pending = restored.getState().pendingResolution!;
    const decision: GameCommand = {...test.base('choose'), expectedRevision: checkpoint.revision, type: 'ResolveDecision',
      resolutionId: pending.id, requestId: pending.request.id, response: {kind: 'reaction', actionId: bonus == null ? null : action.id}};
    expect(restored.dispatch({...decision, actorId: 'enemy'}).status).toBe('rejected');
    expect(restored.dispatch({...test.base('reroll'), type: 'AbilityCheck', ability: 'int', dc: 13}).status).toBe('rejected');
    expect(restored.getState()).toEqual(checkpoint);
    accepted(restored, decision);
    const final = restored.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors.fighter.runtime.resources).toMatchObject({action: 1, reaction: 1, second_wind: bonus === 10 ? 1 : 2});
    expect(final.actors.fighter.runtime.activeEffects).toEqual([]);
    expect(foldEvents(checkpoint, copy(restored.getEvents()))).toEqual(final);
    restored.dispatch(decision);
    expect(restored.getState()).toEqual(final);
    test.tape.assertExhausted();
  });

  it('does not offer or spend the ability on an ordinary successful check', () => {
    const test = fixture([{label: 'success', sides: 20, value: 20}]);
    accepted(test.session, {...test.base('check'), type: 'AbilityCheck', ability: 'int', dc: 13});
    expect(test.session.getState().pendingResolution).toBeNull();
    expect(test.session.getState().actors.fighter.runtime.resources.second_wind).toBe(2);
    test.tape.assertExhausted();
  });

  it.each(['action', 'action_surge_action'])('resumes escape after a successful boost without charging a second %s', resource => {
    const test = fixture([{label: 'escape failure', sides: 20, value: 5}, {label: 'recovered escape', sides: 10, value: 10}], true, hero => {
      hero.runtime.resources.action = 0;
      hero.runtime.resources[resource] = 1;
    });
    accepted(test.session, {...test.base('escape'), type: 'EscapeGrapple', grappleId: 'grapple', skill: 'athletics'});
    const check = test.session.getState().pendingResolution!;
    accepted(test.session, {...test.base('roll'), type: 'ResolveDecision', resolutionId: check.id, requestId: check.request.id,
      response: {kind: 'roll', roll: {mode: 'system'}}});
    const pending = test.session.getState().pendingResolution!;
    expect(pending).toMatchObject({type: 'check_boost', continuation: {type: 'escape_grapple', grappleId: 'grapple'}});
    expect(test.session.getState().grapples.grapple).toBeDefined();
    expect(test.session.getState().actors.fighter.runtime.resources).toMatchObject({action: 0, [resource]: 0, second_wind: 2, reaction: 1});
    accepted(test.session, {...test.base('boost'), type: 'ResolveDecision', resolutionId: pending.id, requestId: pending.request.id,
      response: {kind: 'reaction', actionId: action.id}});
    expect(test.session.getState().grapples).toEqual({});
    expect(test.session.getState().actors.fighter.runtime.resources).toMatchObject({action: 0, second_wind: 1, reaction: 1});
    test.tape.assertExhausted();
  });

  it.each(['unowned', 'exhausted'])('does not offer a %s ability', mode => {
    const test = fixture([{label: 'failed check', sides: 20, value: 5}], false, hero => {
      if (mode === 'unowned') hero.capabilities.actionIds = [];
      else hero.runtime.resources.second_wind = 0;
    });
    accepted(test.session, {...test.base('check'), type: 'AbilityCheck', ability: 'int', dc: 13});
    expect(test.session.getState().pendingResolution).toBeNull();
    test.tape.assertExhausted();
  });

  it.each(['hide', 'study'].flatMap(kind => ['action', 'action_surge_action'].map(resource => ({kind, resource}))))(
    'resumes $kind from the saved failure without repeating $resource or its original die', ({kind, resource}) => {
    const test = fixture([{label: 'failure', sides: 20, value: 5}, {label: 'boost', sides: 10, value: 10}], false, hero => {
      hero.runtime.resources.action = 0;
      hero.runtime.resources[resource] = 1;
    }, kind === 'study');
    if (kind === 'hide') accepted(test.session, {...test.base('hide'), type: 'AttemptHide', eligibility: {
      factsSource: 'board', boardRevision: 0, heavilyObscured: true, cover: 'none', visibleToAnyEnemy: false}});
    else accepted(test.session, {...test.base('study'), type: 'StudyWorldObject', objectId: 'illusion',
      facts: {factsSource: 'board', boardRevision: 0, distanceFt: 5, lineOfSight: true}});
    const checkpoint = migrateWorldState(copy(test.session.getState()));
    const restored = new InMemoryRulesSession(checkpoint, catalog, test.env);
    const pending = restored.getState().pendingResolution!;
    expect(pending).toMatchObject({type: 'check_boost', continuation: {type: kind}});
    expect(restored.getState().actors.fighter.runtime.resources).toMatchObject({action: 0, [resource]: 0, second_wind: 2});
    accepted(restored, {...test.base('boost'), expectedRevision: checkpoint.revision, type: 'ResolveDecision',
      resolutionId: pending.id, requestId: pending.request.id, response: {kind: 'reaction', actionId: action.id}});
    expect(restored.getState().actors.fighter.runtime.resources).toMatchObject({action: 0, reaction: 1, second_wind: 1});
    if (kind === 'hide') expect(restored.getState().actors.fighter.runtime.activeEffects).toContainEqual(expect.objectContaining({
      mechanics: expect.objectContaining({kind: 'condition', value: 'invisible'})}));
    else expect(restored.getState().objects.illusion.illusion?.discernedByActorIds).toEqual(['fighter']);
    expect(foldEvents(checkpoint, copy(restored.getEvents()))).toEqual(restored.getState());
    test.tape.assertExhausted();
  });});
