import { beforeAll, describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-fighting-style-primitives.v1.json';
import { API_BASE_URL } from '../api/client';
import { evaluateMiniMvpFightingStylePrimitiveScenarios } from '../testing/miniMvpFightingStylePrimitiveScenarios';
import type { PassiveEffect } from '../types';
import { readLiveJson } from './liveJsonRead';

type Dict = Record<string, unknown>;

async function fetchReviewedEffects(): Promise<Map<string, PassiveEffect>> {
  const body = await readLiveJson<Record<string, unknown>>(
    `${API_BASE_URL}/api/effects?page=1&limit=1000`,
    { label: '/api/effects' },
  );
  if (!Array.isArray(body.effects)) throw new Error('/api/effects: required collection effects is missing');
  const catalog = body.effects as PassiveEffect[];
  return new Map(reviewedDefinitions.map((reviewed) => {
    const matches = catalog.filter((effect) => effect.card_number === reviewed.card_number);
    if (matches.length !== 1) {
      throw new Error(`Live DB must contain exactly one ${reviewed.card_number}; got ${matches.length}`);
    }
    return [reviewed.card_number, matches[0]];
  }));
}

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live DB: Fighting Style primitives', () => {
  let effects: Map<string, PassiveEffect>;

  beforeAll(async () => {
    effects = await fetchReviewedEffects();
  }, 180_000);

  it('loads byte-exact reviewed mechanics and executes the full behavior matrix', () => {
    for (const reviewed of reviewedDefinitions) {
      expect(effects.get(reviewed.card_number)?.mechanics).toEqual(reviewed.mechanics);
    }

    const actual = evaluateMiniMvpFightingStylePrimitiveScenarios(new Map(
      [...effects].map(([cardNumber, effect]) => [cardNumber, effect.mechanics as Dict]),
    ));
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
