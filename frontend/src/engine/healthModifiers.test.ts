import {describe, expect, it} from 'vitest';
import {collectModifiers} from './modifiers';
import type {RuntimeState} from '../mvp/contracts';

const runtime = (current: number, max = 67): RuntimeState => ({hp: {current, max, temp: 99},
  resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: []});
const frenzy = ['attack', 'saving_throw'].map(roll => ({kind: 'modifier', applies_to: {roll},
  op: 'advantage', hp_fraction_at_most: 0.5}));

describe('carrier health-gated modifiers', () => {
  it('uses current real HP for every attack/save and stops immediately after healing', () => {
    for (const current of [67, 34, 33, 1, 0, 40]) {
      const restored = JSON.parse(JSON.stringify(runtime(current)));
      for (const roll of ['attack', 'saving_throw']) {
        expect(collectModifiers(restored, frenzy, {roll}).advantage).toBe(current <= 33 ? 'advantage' : 'none');
      }
      expect(collectModifiers(restored, frenzy, {roll: 'ability_check'}).advantage).toBe('none');
    }
    expect(collectModifiers(runtime(10, 20), frenzy, {roll: 'saving_throw'}).advantage).toBe('advantage');
  });
  it('cancels disadvantage normally and rejects malformed thresholds or HP', () => {
    const dis = {kind: 'modifier', applies_to: {roll: 'saving_throw'}, op: 'disadvantage'};
    expect(collectModifiers(runtime(1), [...frenzy, dis], {roll: 'saving_throw'}).advantage).toBe('none');
    for (const threshold of [-1, 2, NaN, Infinity, '0.5']) {
      expect(collectModifiers(runtime(1), [{...frenzy[0], hp_fraction_at_most: threshold}], {roll: 'attack'}).advantage).toBe('none');
    }
    for (const state of [runtime(1, 0), runtime(-1), runtime(NaN), runtime(1, Infinity)]) {
      expect(collectModifiers(state, frenzy, {roll: 'attack'}).advantage).toBe('none');
    }
  });
});
