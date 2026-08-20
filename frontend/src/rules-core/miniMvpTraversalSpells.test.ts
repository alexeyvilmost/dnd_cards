import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-traversal-spells.v1.json';
import {
  applyIncomingDamage,
  executeAction,
  executeMovementOption,
  fallDescentRateFt,
  resolveFallLanding,
} from '../engine/execute';
import { startTurn } from '../engine/turn';
import { validateMechanics } from '../engine/validateMechanics';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from '../mvp/fixtures';
import type { RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

function spell(cardNumber: string) {
  const definition = definitions.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing traversal spell ${cardNumber}`);
  return definition as { card_number: string; name: string; mechanics: Dict };
}

function casterState(): RuntimeState {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 2;
  state.maxResources.spell_slot_1 = 2;
  return state;
}

const caster = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3 };
const targetCharacter = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 0 };

function castAtTarget(cardNumber: string, choices?: Record<string, string>): RuntimeState {
  const result = executeAction(casterState(), spell(cardNumber).mechanics, {
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

describe('mini-MVP: traversal and damage-protection spells', () => {
  it('validates every reviewed declaration as executable mechanics', () => {
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'spell',
      })).toEqual({ valid: true, errors: [] });
      const kinds = [...JSON.stringify(definition.mechanics).matchAll(/"kind":"([^"]+)"/gu)]
        .map((match) => match[1]);
      expect(kinds.some((kind) => kind !== 'narrative')).toBe(true);
    }
  });

  it('Resistance reduces only the selected damage type once per turn', () => {
    const protectedTarget = castAtTarget('SPELL-0295', { resistance_damage_type: 'fire' });
    const first = applyIncomingDamage(protectedTarget, 2, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0,
    }, { damageType: 'fire' });
    expect(first.state.hp.current).toBe(protectedTarget.hp.current - 1);
    expect(first.events).toContainEqual(expect.objectContaining({ type: 'damage_reduction', amount: 1 }));

    const sameTurn = applyIncomingDamage(first.state, 2, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0,
    }, { damageType: 'fire' });
    expect(sameTurn.state.hp.current).toBe(first.state.hp.current - 2);

    const newTurn = startTurn(sameTurn.state, targetCharacter, { advanceRoundDurations: false });
    const wrongType = applyIncomingDamage(newTurn.state, 2, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0,
    }, { damageType: 'cold' });
    expect(wrongType.state.hp.current).toBe(newTurn.state.hp.current - 2);
  });

  it('Feather Fall caps descent, prevents landing damage, and ends on landing', () => {
    const protectedTarget = castAtTarget('SPELL-0253');
    expect(fallDescentRateFt(protectedTarget)).toBe(60);
    const landing = resolveFallLanding(protectedTarget, { distanceFt: 120, damage: 12 }, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0.5,
    });
    expect(landing.state.hp.current).toBe(protectedTarget.hp.current);
    expect(fallDescentRateFt(landing.state)).toBe(500);
    expect(landing.events).toContainEqual({ type: 'damage_reduction', amount: 12 });

    const ordinary = resolveFallLanding(freshFighterState(), { distanceFt: 120, damage: 12 }, {
      character: targetCharacter,
      selfId: 'target',
      rng: () => 0.5,
    });
    expect(ordinary.state.hp.current).toBe(Math.max(0, freshFighterState().hp.current - 12));
  });

  it('Jump spends 10 feet for a 30-foot option exactly once per turn', () => {
    const target = castAtTarget('SPELL-0274');
    const jump = executeMovementOption(target, 'jump', 30);
    expect(jump).toMatchObject({ distanceFt: 30, movementCostFt: 10, remainingMovementFt: 20 });
    expect(jump.events).toContainEqual({ type: 'movement', mode: 'jump', distanceFt: 30 });
    expect(() => executeMovementOption(jump.state, 'jump', 20)).toThrow(/already used this turn/);

    const nextTurn = startTurn(jump.state, targetCharacter, { advanceRoundDurations: false });
    expect(executeMovementOption(nextTurn.state, 'jump', 10).remainingMovementFt).toBe(0);
    expect(() => executeMovementOption(nextTurn.state, 'jump', 9)).toThrow(/requires 10 ft/);
  });
});
