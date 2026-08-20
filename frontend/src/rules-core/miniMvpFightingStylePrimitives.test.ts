import { describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-fighting-style-primitives.v1.json';
import { validateMechanics } from '../engine/validateMechanics';
import { evaluateMiniMvpFightingStylePrimitiveScenarios } from '../testing/miniMvpFightingStylePrimitiveScenarios';

type Dict = Record<string, unknown>;

const definitions = new Map(
  reviewedDefinitions.map((definition) => [definition.card_number, definition.mechanics as Dict]),
);

describe('mini-MVP Fighting Style reusable primitives', () => {
  it('keeps every reviewed definition schema-valid and executable rather than narrative-only', () => {
    expect(reviewedDefinitions.map((definition) => definition.card_number)).toEqual([
      'fs_dueling',
      'fs_great_weapon',
      'fs_blind_fighting',
      'fs_thrown_weapon',
    ]);
    for (const definition of reviewedDefinitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'passive_effect',
      })).toMatchObject({ valid: true, errors: [] });
      expect(JSON.stringify(definition.mechanics)).not.toContain('"kind":"narrative"');
    }
  });

  it('executes the complete positive and negative scenario matrix, including every damage die', () => {
    const actual = evaluateMiniMvpFightingStylePrimitiveScenarios(definitions);
    expect(actual).toEqual({
      dueling: {
        oneHandedMeleeDelta: 2,
        otherWeaponDelta: 0,
        twoHandedDelta: 0,
        rangedDelta: 0,
      },
      greatWeapon: {
        baseDice: [3, 3],
        extraDice: [3],
        oneHandedDice: [1],
      },
      thrownWeapon: {
        rangedThrownDelta: 2,
        meleeThrownDelta: 0,
        rangedNotThrownDelta: 0,
      },
      blindFighting: {
        senses: [{ sense: 'blindsight', range: 10 }],
      },
    });
  });
});
