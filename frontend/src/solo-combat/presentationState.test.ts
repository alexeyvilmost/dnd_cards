import {describe, expect, it} from 'vitest';
import type {ActorState, UncommittedRuleEvent} from '../rules-core/domain';
import type {CombatLogEntry, SoloCombatState} from './types';
import type {EngineEvent} from '../mvp/contracts';
import {presentCombatEntries} from './presentation';
import {applyCombatPresentationPhase, combatPresentationView} from './presentationState';
import compiled from '../pages/rulesLabFixture.generated.json';
import {projectCombatLogRecords} from './combatLog';

const baseActor = compiled.roots.magicInitiateFighter.actor as unknown as ActorState;
const actor = (id: string, current: number, temp = 0): ActorState => ({...baseActor, id, name: id,
  runtime: {...baseActor.runtime, hp: {current, max: 20, temp}}});
const state = (log: CombatLogEntry[] = [], current = 20, temp = 3): SoloCombatState => ({
  world: {actors: {hero: actor('hero', current, temp), first: actor('first', 20), second: actor('second', 20)},
    scene: {mode: 'encounter', round: 1, initiative: ['hero', 'first', 'second'], activeIndex: 0, turnStarted: true}},
  characterId: 'hero', sideByActorId: {hero: 'party', first: 'enemy', second: 'enemy'},
  initiative: ['hero', 'first', 'second'].map(actorId => ({actorId, die: 10, bonus: 0, total: 10})),
  tokens: {hero: {actorId: 'hero', color: 'blue', position: {x: 1, y: 1}},
    first: {actorId: 'first', color: 'red', position: {x: 3, y: 1}},
    second: {actorId: 'second', color: 'red', position: {x: 5, y: 1}}},
  catalogActions: [], log, outcome: 'active',
} as unknown as SoloCombatState);
const event = (id: string, source: string, recipient: string, value: EngineEvent): CombatLogEntry => ({
  id, round: 1, actorId: source, text: id,
  records: [{kind: 'engine', ordinal: 0, sourceActorId: source, actorId: source, targetIds: [recipient], event: value}],
});

describe('committed combat view checkpoints', () => {
  it('shows two enemy turns and their damage in order, including temporary HP and movement', () => {
    const before = state();
    const entries = [event('first-turn', 'first', 'first', {type: 'turn_started'}),
      {id: 'move', round: 1, actorId: 'first', text: 'move', records: [{kind: 'movement' as const, ordinal: 0,
        sourceActorId: 'first', actorId: 'first', targetIds: ['first'], movement: {from: {x: 3, y: 1}, to: {x: 2, y: 1}}}]},
      event('first-hit', 'first', 'hero', {type: 'damage', amount: 4, damageType: 'slashing'}),
      event('second-turn', 'second', 'second', {type: 'turn_started'}),
      event('second-hit', 'second', 'hero', {type: 'damage', amount: 7, damageType: 'fire'}),
      event('heal', 'hero', 'hero', {type: 'healing', amount: 3}),
      event('temporary', 'hero', 'hero', {type: 'temp_hp', amount: 5}),
      {...event('hero-turn', 'hero', 'hero', {type: 'turn_started'}), round: 2}];
    const committed = state(entries, 15, 5);
    committed.tokens.first = {...committed.tokens.first, position: {x: 2, y: 1}};
    const saved = JSON.stringify({before, committed});
    const beats = presentCombatEntries(committed, entries);
    let visible = combatPresentationView(committed, before);
    const hp = () => visible.world.actors.hero.runtime.hp;
    expect(hp()).toEqual({current: 20, max: 20, temp: 3});
    expect(visible.log).toEqual([]);
    expect(beats.slice(0, 5).every(beat => beat.blocksInput !== false)).toBe(true);
    visible = applyCombatPresentationPhase(visible, beats[0], 'start');
    expect(visible.world.scene).toMatchObject({activeIndex: 1, round: 1});
    visible = applyCombatPresentationPhase(visible, beats[1], 'start');
    expect(visible.tokens.first.position).toEqual({x: 2, y: 1});
    visible = applyCombatPresentationPhase(visible, beats[2], 'start');
    expect(hp().current).toBe(20);
    visible = applyCombatPresentationPhase(visible, beats[2], 'impact');
    expect(hp()).toEqual({current: 19, max: 20, temp: 0});
    expect(visible.log).toEqual([]);
    visible = applyCombatPresentationPhase(visible, beats[2], 'end');
    expect(visible.log.map(row => row.id)).toEqual(['first-hit']);
    visible = applyCombatPresentationPhase(visible, beats[3], 'start');
    expect(visible.world.scene).toMatchObject({activeIndex: 2, round: 1});
    visible = applyCombatPresentationPhase(visible, beats[4], 'start');
    expect(hp().current).toBe(19);
    visible = applyCombatPresentationPhase(visible, beats[4], 'impact');
    expect(hp().current).toBe(12);
    visible = applyCombatPresentationPhase(visible, beats[5], 'impact');
    expect(hp().current).toBe(15);
    visible = applyCombatPresentationPhase(visible, beats[6], 'impact');
    expect(hp()).toEqual({current: 15, max: 20, temp: 5});
    visible = applyCombatPresentationPhase(visible, beats[7], 'start');
    expect(visible.world.scene).toMatchObject({activeIndex: 0, round: 2});
    expect(JSON.stringify({before, committed})).toBe(saved);
  });

  it.each([{source: 'first', target: 'hero', remaining: 1}, {source: 'second', target: 'first', remaining: 0}])(
    'uses the exact last committed $target vitality checkpoint instead of re-executing survival rules', ({source, target, remaining}) => {
      const before = state();
      const hit = event('hit', source, target, {type: 'damage', amount: 40, damageType: 'force'});
      const committed = state([hit]);
      committed.world.actors[target] = {...committed.world.actors[target],
        runtime: {...committed.world.actors[target].runtime, hp: {current: remaining, max: 18, temp: 0}}};
      const beat = presentCombatEntries(committed, [hit])[0];
      const visible = applyCombatPresentationPhase(before, beat, 'impact');
      expect(visible.world.actors[target]).toEqual(committed.world.actors[target]);
      expect(before.world.actors[target].runtime.hp.current).toBe(20);
    });

  it('does not replace a held roll with damage before its confirmed continuation', () => {
    const before = state();
    const provisional = event('pending', 'first', 'hero', {type: 'roll', label: 'Атака — до реакции', roll: {
      kind: 'd20', dice: [{sides: 20, result: 12}], modifiers: [], total: 12, advantage: 'none',
      target: {type: 'ac', value: 10}, outcome: 'hit', text: '12'}});
    const committed = state([provisional]);
    const beat = presentCombatEntries(committed, [provisional])[0];
    expect(beat.rollPhase).toBe('before-reaction');
    expect(beat.presentationChanges?.some(change => change.kind === 'health')).toBe(false);
    expect(applyCombatPresentationPhase(before, beat, 'impact').world.actors.hero.runtime.hp.current).toBe(20);
  });

  it.each(['spawn', 'remove'] as const)('holds a consistent initiative/actor/token roster during %s feedback', mode => {
    const before = state();
    const committed = state();
    if (mode === 'spawn') {
      committed.world.actors.newcomer = actor('newcomer', 15);
      committed.tokens.newcomer = {actorId: 'newcomer', color: 'green', position: {x: 4, y: 2}};
      committed.initiative = [...committed.initiative, {actorId: 'newcomer', die: 9, bonus: 0, total: 9}];
      committed.sideByActorId.newcomer = 'party';
    } else {
      delete committed.world.actors.first; delete committed.tokens.first; delete committed.sideByActorId.first;
      committed.initiative = committed.initiative.filter(entry => entry.actorId !== 'first');
    }
    const visible = combatPresentationView(committed, before);
    expect(visible.initiative).toBe(before.initiative);
    expect(visible.sideByActorId).toBe(before.sideByActorId);
    for (const entry of visible.initiative) {
      expect(visible.world.actors[entry.actorId]).toBeDefined();
      expect(visible.tokens[entry.actorId]).toBeDefined();
    }
    expect(visible.world.actors.newcomer).toBeUndefined();
    expect(visible.world.actors.first).toBeDefined();
  });

  it.each(['hero', 'first'].flatMap(target => ['before', 'after'].map(order => ({target, order}))))(
    'preserves exact survival after the first of two attacks against $target, patch $order its trace', ({target, order}) => {
    const before = state();
    const first = event('first', 'second', target, {type: 'damage', amount: 40, damageType: 'force'});
    first.records!.push(...projectCombatLogRecords([{ordinal: 1, sourceActorId: 'second', obligationIds: [], payload: {
      type: 'ActorRuntimePatched', actorId: target, reason: 'action', patch: {
        hp: {current: 1, max: 20, temp: 0}, activeEffects: [],
        deathSaves: {successes: 0, failures: 0, stable: false, dead: false},
      },
    }}] as UncommittedRuleEvent[]));
    if (order === 'before') {
      first.records = [first.records![1], first.records![0]].map((record, ordinal) => ({...record, ordinal}));
    }
    const second = event('second', 'second', target, {type: 'damage', amount: 4, damageType: 'slashing'});
    second.records!.push(...projectCombatLogRecords([{ordinal: 1, sourceActorId: 'second', obligationIds: [], payload: {
      type: 'ActorRuntimePatched', actorId: target, reason: 'action', patch: {hp: {current: 0, max: 20, temp: 0}},
    }}] as UncommittedRuleEvent[]));
    const committed = state([first, second]);
    committed.world.actors[target] = {...committed.world.actors[target],
      runtime: {...committed.world.actors[target].runtime, hp: {current: 0, max: 20, temp: 0}}};
    const beats = presentCombatEntries(committed, committed.log);
    let visible = applyCombatPresentationPhase(before, beats[0], 'impact');
    expect(visible.world.actors[target].runtime.hp.current).toBe(1);
    expect(visible.world.actors[target].runtime.deathSaves?.dead).toBe(false);
    visible = applyCombatPresentationPhase(visible, beats[1], 'start');
    expect(visible.world.actors[target].runtime.hp.current).toBe(1);
    visible = applyCombatPresentationPhase(visible, beats[1], 'impact');
    expect(visible.world.actors[target].runtime.hp.current).toBe(0);
  });
});
