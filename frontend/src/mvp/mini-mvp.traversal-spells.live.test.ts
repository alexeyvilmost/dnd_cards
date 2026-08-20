import { beforeAll, describe, expect, it } from 'vitest';
import reviewedDefinitions from '../../../scripts/content/data/mini-mvp-traversal-spells.v1.json';
import { API_BASE_URL } from '../api/client';
import {
  applyIncomingDamage,
  executeAction,
  executeMovementOption,
  fallDescentRateFt,
  resolveFallLanding,
} from '../engine/execute';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from './fixtures';
import type { RuntimeState } from './contracts';
import { readLiveJson } from './liveJsonRead';
import type { Spell } from '../types';

type Dict = Record<string, unknown>;

async function fetchReviewedSpells(): Promise<Map<string, Spell>> {
  const body = await readLiveJson<Record<string, unknown>>(
    `${API_BASE_URL}/api/spells?page=1&limit=1000`,
    { label: '/api/spells' },
  );
  if (!Array.isArray(body.spells)) throw new Error('/api/spells: required collection spells is missing');
  const catalog = body.spells as Spell[];
  return new Map(reviewedDefinitions.map((reviewed) => {
    const matches = catalog.filter((spell) => spell.card_number === reviewed.card_number);
    if (matches.length !== 1) {
      throw new Error(`Live DB must contain exactly one ${reviewed.card_number}; got ${matches.length}`);
    }
    return [reviewed.card_number, matches[0]];
  }));
}

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 2;
  state.maxResources.spell_slot_1 = 2;
  return state;
}

const caster = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3 };
const targetCharacter = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 0 };

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live DB: traversal spells', () => {
  let spells: Map<string, Spell>;

  beforeAll(async () => {
    spells = await fetchReviewedSpells();
  }, 180_000);

  function cast(cardNumber: string, choices?: Record<string, string>): RuntimeState {
    const spell = spells.get(cardNumber);
    if (!spell) throw new Error(`Live spell ${cardNumber} was not loaded`);
    const result = executeAction(casterState(), spell.mechanics as Dict, {
      character: caster,
      selfId: 'caster',
      target: {
        id: 'target',
        characterContext: targetCharacter,
        runtimeState: freshFighterState(),
      },
      choices,
      rng: () => 0,
    });
    if (!result.targetState) throw new Error(`${cardNumber} did not mutate target`);
    return result.targetState;
  }

  it('loads the exact reviewed mechanics from the current database', () => {
    for (const reviewed of reviewedDefinitions) {
      expect(spells.get(reviewed.card_number)?.mechanics).toEqual(reviewed.mechanics);
    }
  });

  it('executes Resistance from DB through incoming damage', () => {
    const target = cast('SPELL-0295', { resistance_damage_type: 'fire' });
    const result = applyIncomingDamage(target, 5, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0,
    }, { damageType: 'fire' });
    expect(result.state.hp.current).toBe(target.hp.current - 4);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage_reduction', amount: 1 }));
  });

  it('executes Feather Fall and Jump adapters from DB', () => {
    const featherFall = cast('SPELL-0253');
    expect(fallDescentRateFt(featherFall)).toBe(60);
    const landing = resolveFallLanding(featherFall, { distanceFt: 100, damage: 10 }, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0.5,
    });
    expect(landing.state.hp.current).toBe(featherFall.hp.current);

    const jump = executeMovementOption(cast('SPELL-0274'), 'jump', 25);
    expect(jump).toMatchObject({ distanceFt: 30, movementCostFt: 10, remainingMovementFt: 15 });
  });
});
