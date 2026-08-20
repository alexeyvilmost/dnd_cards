import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-level1-ongoing-spells.v1.json';
import { executeAction, projectedAgainst } from '../engine/execute';
import { collectModifiers } from '../engine/modifiers';
import { startTurn } from '../engine/turn';
import { validateMechanics } from '../engine/validateMechanics';
import { projectRuleAction } from '../canon/ruleActionProjection';
import { FIGHTER_CTX_EQUIPPED, freshFighterState } from '../mvp/fixtures';
import type { RuntimeState } from '../mvp/contracts';
import type { Spell } from '../types';

type Dict = Record<string, unknown>;

const face = (value: number, sides = 20) => (value - 0.5) / sides;

function spell(cardNumber: string) {
  const definition = definitions.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing test spell ${cardNumber}`);
  return definition as { card_number: string; name: string; mechanics: Dict };
}

function casterState() {
  const state = freshFighterState();
  state.resources.spell_slot_1 = 2;
  state.maxResources.spell_slot_1 = 2;
  return state;
}

const caster = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3 };
const targetCharacter = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 0 };

function failedSave(cardNumber: string): RuntimeState {
  const result = executeAction(casterState(), spell(cardNumber).mechanics, {
    character: caster,
    selfId: 'caster',
    target: {
      id: 'target',
      saveMods: { wis: 0, dex: 0 },
      characterContext: targetCharacter,
      runtimeState: freshFighterState(),
    },
    rng: () => face(1),
  });
  if (!result.targetState) throw new Error(`${cardNumber} did not mutate its target`);
  return result.targetState;
}

describe('mini-MVP: ongoing source-bound spells', () => {
  it('validates every declaration and none is narrative-only', () => {
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'spell',
      })).toEqual({ valid: true, errors: [] });
      const kinds = [...JSON.stringify(definition.mechanics).matchAll(/"kind":"([^"]+)"/gu)]
        .map((match) => match[1]);
      expect(kinds.some((kind) => kind !== 'narrative')).toBe(true);
      const compiled = projectRuleAction({
        id: `id:${definition.card_number}`,
        card_number: definition.card_number,
        name: definition.name,
        level: 1,
        concentration: true,
        ritual: false,
        component_verbal: true,
        component_somatic: true,
        component_material: false,
        mechanics: definition.mechanics,
      } as unknown as Spell);
      expect(compiled.targeting).toBeDefined();
    }
  });

  it('Compelled Duel applies disadvantage only against creatures other than the caster', () => {
    const state = failedSave('SPELL-0179');
    const against = (targetId: string) => collectModifiers(state, [], {
      roll: 'attack',
      evalCtx: { rollerActorId: 'target', rollTargetActorId: targetId },
    }).advantage;
    expect(against('other-enemy')).toBe('disadvantage');
    expect(against('caster')).toBe('none');
  });

  it('Heroism snapshots caster spellcasting for target turn-start temp HP', () => {
    const state = failedSave('SPELL-0181');
    expect(state.activeEffects).toHaveLength(2);
    const turn = startTurn(state, targetCharacter, { advanceRoundDurations: false });
    expect(turn.state.hp.temp).toBe(3);
    expect(turn.events).toContainEqual(expect.objectContaining({ type: 'temp_hp', amount: 3 }));
  });

  it('triggered_effect rejects random snapshot bindings before paying activation costs', () => {
    const state = casterState();
    expect(() => executeAction(state, {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'triggered_effect',
          event: 'turn_start',
          formula_bindings: { unstable_value: '1d4' },
          effects: [{
            resolution: 'auto',
            result: [{ kind: 'temp_hp', amount: 'unstable_value' }],
          }],
          duration: { type: 'rounds', amount: 1 },
        }],
      }],
    }, { character: caster, selfId: 'caster', rng: () => 0.5 })).toThrow(/cannot contain a random die/);
    expect(state.resources.action).toBe(1);
  });

  it('Heroism immunity blocks Frightened from another action', () => {
    const protectedTarget = failedSave('SPELL-0181');
    const result = executeAction(casterState(), {
      activation: { mode: 'active' },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'condition', value: 'frightened', op: 'apply' }],
      }],
    }, {
      character: caster,
      selfId: 'enemy',
      target: {
        id: 'target',
        characterContext: targetCharacter,
        runtimeState: protectedTarget,
      },
      rng: () => 0.5,
    });
    expect(result.targetState?.activeEffects.some((effect) => (
      (effect.mechanics as Dict).kind === 'condition'
        && (effect.mechanics as Dict).value === 'frightened'
    ))).toBe(false);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'condition_immune', condition: 'frightened',
    }));
  });

  it('Faerie Fire grants visible attackers advantage but fails closed without visibility facts', () => {
    const target = failedSave('faerie_fire');
    const projection = (visible?: boolean) => projectedAgainst(
      { id: 'target', runtimeState: target },
      'attack',
      'ranged',
      visible === undefined ? { rollerActorId: 'attacker', rollTargetActorId: 'target' } : {
        rollerActorId: 'attacker',
        rollTargetActorId: 'target',
        visibility: { attacker: { target: visible } },
      },
    ).advantage;
    expect(projection(true)).toBe('advantage');
    expect(projection(false)).toBe('none');
    expect(projection()).toBe('none');
  });
});
