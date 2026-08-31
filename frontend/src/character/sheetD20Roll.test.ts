import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { finalizeSheetD20Roll } from './sheetD20Roll';

describe('finalizeSheetD20Roll', () => {
  it('consumes Divine Inspiration after the first matching sheet d20', () => {
    const state: RuntimeState = {
      hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
      equipment: {}, inventory: [],
      activeEffects: [{
        id: 'divine', name: 'Божественное вдохновение', source: 'Божественное вдохновение',
        mechanics: {
          kind: 'modifier', applies_to: { roll: 'd20' },
          op: 'minimum_total', value: 20, consume: 'next',
        },
      }],
    };
    const finalized = finalizeSheetD20Roll(state, 'saving_throw', { ability: 'str' });
    expect(finalized.state.activeEffects).toEqual([]);
    expect(finalized.events).toContainEqual({
      type: 'effect_expired', name: 'Божественное вдохновение',
    });
  });

  it('does not consume an effect whose structured filter does not match', () => {
    const state: RuntimeState = {
      hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {},
      equipment: {}, inventory: [],
      activeEffects: [{
        id: 'dex-only', name: 'Ловкость', source: 'Тест',
        mechanics: {
          kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } },
          op: 'advantage', consume: 'next',
        },
      }],
    };
    expect(finalizeSheetD20Roll(state, 'saving_throw', { ability: 'str' }).state).toBe(state);
  });
});
