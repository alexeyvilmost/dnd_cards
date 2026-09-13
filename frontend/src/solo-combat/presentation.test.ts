import { describe, expect, it } from 'vitest';
import { presentCombatEntries } from './presentation';
import type { CombatLogEntry, SoloCombatState } from './types';
import type { EngineEvent, RollLog } from '../mvp/contracts';
import compiled from '../pages/rulesLabFixture.generated.json';

const roll: RollLog = {kind: 'd20', dice: [{sides: 20, result: 15}], total: 20,
  modifiers: [{source: 'Атака', value: 5}], advantage: 'none', outcome: 'hit', target: {type: 'ac', value: 14}, text: 'к20: 15 +5 = 20'};
const actor = compiled.roots.magicInitiateFighter.actor;
const state = {world: {actors: {hero: {...actor, id: 'hero', name: 'Герой'}, enemy: {...actor, id: 'enemy', name: 'Враг'}}},
  tokens: {hero: {position: {x: 2, y: 2}}, enemy: {position: {x: 3, y: 2}}},
  catalogActions: [{id: 'sword', name: 'Удар', mechanics: {effects: [{resolution: 'attack_roll', on_hit: [{kind: 'damage', type: 'slashing'}]}]}},
    {id: 'dash', name: 'Рывок', mechanics: {activation: {counts_as: 'dash'}}}], dashActionId: 'dash'} as unknown as SoloCombatState;
const entry = (events: EngineEvent[], text = 'Герой: Удар: выполнено'): CombatLogEntry => ({id: 'entry', round: 1, actorId: 'hero', text,
  records: events.map((event, ordinal) => ({kind: 'engine', ordinal, sourceActorId: 'hero', actorId: 'hero', targetIds: ['enemy'], event}))});

describe('combat presentation from committed events', () => {
  it.each(['Атака — после реакции', 'Атака'])('waits for a defensive reaction or its decline before impact (%s)', (label) => {
    const before = entry([{type: 'roll', label: 'Атака — до реакции', roll}]);
    const after = {...entry([{type: 'roll', label, roll: {...roll, target: {type: 'ac', value: 21}, outcome: 'miss'}}], 'Герой: Разрешение реакции/спасброска: выполнено'), id: 'after'};
    const beats = presentCombatEntries({...state, log: [before, after]}, [before, after]);
    expect(beats[0]).toMatchObject({rollPhase: 'before-reaction', cues: []});
    expect(beats[0].visual).toBeUndefined();
    expect(beats[1]).toMatchObject({actionName: 'Удар', rollPhase: 'after-reaction', visual: 'slashing', cues: [{actorId: 'enemy', kind: 'miss', text: 'Промах'}]});
    expect(beats[1].roll?.dice).toEqual(beats[0].roll?.dice);
  });
  it('retains equal damage packets and associates statuses with the correct target', () => {
    const beats = presentCombatEntries(state, [entry([
      {type: 'roll', label: 'Атака', roll},
      {type: 'damage', amount: 3, damageType: 'slashing'}, {type: 'damage', amount: 3, damageType: 'slashing'},
      {type: 'effect_applied', name: 'Скорость снижена', sourceAction: 'Луч холода', ownerActorId: 'enemy'},
      {type: 'effect_applied', name: 'Уклонение', ownerActorId: 'hero'},
    ])]);
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({sourceId: 'hero', targetId: 'enemy', visual: 'slashing'});
    expect(beats[0].cues.filter(cue => cue.kind === 'damage')).toHaveLength(2);
    expect(beats[0].cues).toContainEqual({actorId: 'enemy', text: 'Скорость снижена (Луч холода)', kind: 'effect'});
    expect(beats[0].cues).toContainEqual({actorId: 'hero', text: 'Уклонение', kind: 'effect'});
  });
  it('keeps multiattack rolls separate and displays misses', () => {
    const beats = presentCombatEntries(state, [entry([{type: 'roll', label: 'Атака', roll}, {type: 'damage', amount: 6, damageType: 'piercing'},
      {type: 'roll', label: 'Атака', roll: {...roll, outcome: 'miss', total: 8}}])]);
    expect(beats).toHaveLength(2);
    expect(beats[0].visual).toBe('piercing');
    expect(beats[1].cues).toEqual([{actorId: 'enemy', kind: 'miss', text: 'Промах'}]);
  });
  it('displays Dash without inventing an attack roll', () => {
    const beats = presentCombatEntries(state, [entry([], 'Герой: Рывок: выполнено')]);
    expect(beats[0].roll).toBeUndefined();
    expect(beats[0].cues).toEqual([{actorId: 'hero', kind: 'effect', text: 'Рывок'}]);
  });
});
