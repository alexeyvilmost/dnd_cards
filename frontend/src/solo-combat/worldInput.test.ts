import { describe, expect, it } from 'vitest';
import type { ActionWorldInput } from '../rules-core/domain';
import { bindCombatWorldInputFacts } from './worldInput';

const board = {
  factsSource: 'board' as const,
  boardRevision: 7,
  distanceFt: 5,
  lineOfSight: true,
};

describe('combat world-input spatial binding', () => {
  it('binds the clicked cell to Prestidigitation while preserving option facts', () => {
    const input: ActionWorldInput = {
      type: 'prestidigitation',
      option: {
        kind: 'sensory_effect',
        description: 'Запах корицы',
        facts: {
          factsSource: 'scenario', boardRevision: 0, distanceFt: 0, lineOfSight: false,
          touched: true, volumeCubicFt: 1,
        },
      },
    };

    expect(bindCombatWorldInputFacts(input, board)).toEqual({
      ...input,
      option: {
        ...input.option,
        facts: { ...input.option.facts, ...board },
      },
    });
  });

  it('retains the shared Minor Illusion form behavior', () => {
    const input: ActionWorldInput = {
      type: 'minor_illusion', form: 'sound', description: 'Колокольчик',
      facts: { factsSource: 'scenario', boardRevision: 0, distanceFt: 0, lineOfSight: false },
    };
    expect(bindCombatWorldInputFacts(input, board)).toEqual({
      ...input,
      facts: { ...input.facts, ...board },
    });
  });
});
