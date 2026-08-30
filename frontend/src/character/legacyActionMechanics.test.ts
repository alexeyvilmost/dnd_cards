import { describe, expect, it } from 'vitest';
import { upgradeLegacyActionMechanics } from './legacyActionMechanics';

describe('legacy action mechanics compatibility', () => {
  it('turns the exact narrative Bardic Inspiration row into a target-owned boon', () => {
    const mechanics = upgradeLegacyActionMechanics({
      card_number: 'ACT-bardic-inspiration',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
        effects: [{
          resolution: 'auto',
          result: [{
            kind: 'narrative',
            description: 'Союзник в 60 фт получает кость вдохновения (d6) для одного d20 броска.',
          }],
        }],
      },
    });
    expect(mechanics?.effects).toEqual([{
      resolution: 'auto',
      who: 'target',
      result: [{
        kind: 'boon',
        id: 'bardic_inspiration',
        die: '1d6',
        applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
        expires: '1 час',
      }],
    }]);
  });

  it('does not rewrite a repaired or unexpectedly different catalog row', () => {
    const mechanics = {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'boon', die: '1d8' }] }],
    };
    expect(upgradeLegacyActionMechanics({
      card_number: 'ACT-bardic-inspiration', mechanics,
    })).toBe(mechanics);
    expect(upgradeLegacyActionMechanics({
      card_number: 'ACT-something-else', mechanics,
    })).toBe(mechanics);
  });
});
