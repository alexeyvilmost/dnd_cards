import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import { startTurn } from './turn';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

const character: CharacterContext = { level: 9, profBonus: 4, spellcastingMod: 4,
  abilityMods: { str: 0, dex: 0, con: 0, int: 4, wis: 0, cha: 0 } };
const state = (): RuntimeState => ({ hp: { current: 1, max: 200, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });

describe('spell audit shared primitives', () => {
  it.each([
    { max: 250, current: 10 }, { max: 37, current: 22 },
  ])('restores the actual recipient maximum $max without a magic numeric cap', ({ max, current }) => {
    const recipient = { ...state(), hp: { current, max, temp: 4 } };
    const mechanics = { activation: { mode: 'active', cost: [] }, effects: [{ who: 'target', resolution: 'auto', result: [{ kind: 'healing', restore_all: true }] }] };
    const result = executeAction(state(), mechanics, { character, rng: () => 0.5, target: { id: 'recipient', runtimeState: recipient } });
    expect(result.targetState?.hp).toEqual({ current: max, max, temp: 4 });
    expect(result.state.hp.current).toBe(1);
    const blocked = { ...recipient, activeEffects: [{ id: 'no-healing', name: 'Запрет', source: 'test', mechanics: { kind: 'modifier', op: 'deny', applies_to: { roll: 'healing' } } }] };
    expect(executeAction(state(), mechanics, { character, rng: () => 0.5, target: { id: 'recipient', runtimeState: blocked } }).targetState?.hp.current).toBe(current);
  });
  it.each([
    { baseLevel: 1, castLevel: 3, amount: '4 + 5 * spell_slot_above', expected: 14 },
    { baseLevel: 6, castLevel: 8, amount: '70 + 10 * spell_slot_above', expected: 90 },
  ])('evaluates canonical slot scaling for base $baseLevel at level $castLevel', ({ amount, expected, ...spell }) => {
    const mechanics = { activation: { mode: 'active', cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount }] }] };
    expect(executeAction(state(), mechanics, { character, spell, rng: () => 0.5 }).state.hp.current).toBe(expected + 1);
    expect(executeAction(state(), mechanics, { character, spell: { ...spell, castLevel: spell.baseLevel }, rng: () => 0.5 }).state.hp.current)
      .toBe((spell.baseLevel === 1 ? 4 : 70) + 1);
  });

  it.each([
    { ref: 'EFF-one', duration: { type: 'rounds', amount: 2 }, expected: 2 },
    { ref: 'EFF-two', duration: { type: 'minutes', amount: 1 }, expected: 10 },
  ])('honors explicit grant duration for $ref and preserves it after reload', ({ ref, duration, expected }) => {
    const mechanics = { activation: { mode: 'active', cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: ref, duration }] }] };
    const result = executeAction(state(), mechanics, { character, selfId: 'actor', rng: () => 0.5,
      grantedEffects: { [ref]: { id: ref, card_number: ref, mechanics: { duration: { type: 'hours', amount: 1 }, effects: [] } } } });
    const saved = JSON.parse(JSON.stringify(result.state)) as RuntimeState;
    expect(saved.activeEffects[0].roundsLeft).toBe(expected);
    let current = saved;
    for (let index = 0; index < expected; index++) current = startTurn(current).state;
    expect(current.activeEffects).toHaveLength(0);
  });
});
