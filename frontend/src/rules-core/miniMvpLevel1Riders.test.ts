import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-level1-spell-primitives.v1.json';
import { collectModifiers } from '../engine/modifiers';
import { executeAction } from '../engine/execute';
import { validateMechanics } from '../engine/validateMechanics';
import {
  equippedFighterState,
  FIGHTER_CTX_EQUIPPED,
  freshFighterState,
} from '../mvp/fixtures';
import type { Spell } from '../types';
import { projectRuleAction } from '../canon/ruleActionProjection';

type Dict = Record<string, unknown>;

const face = (value: number, sides = 20) => (value - 0.5) / sides;

function spell(cardNumber: string) {
  const definition = definitions.find((candidate) => candidate.card_number === cardNumber);
  if (!definition) throw new Error(`Missing test spell ${cardNumber}`);
  return definition as { card_number: string; name: string; mechanics: Dict };
}

function casterState() {
  const state = equippedFighterState();
  state.resources.spell_slot_1 = 2;
  state.maxResources.spell_slot_1 = 2;
  return state;
}

const caster = { ...FIGHTER_CTX_EQUIPPED, spellcastingMod: 3 };

describe('mini-MVP: заклинания первого уровня с длительными райдерами', () => {
  it('проходят JSON Schema и строгую проекцию в rules-core', () => {
    for (const definition of definitions) {
      const mechanics = definition.mechanics as Dict;
      expect(validateMechanics(mechanics, {
        id: definition.card_number,
        name: definition.name,
        kind: 'spell',
      })).toEqual({ valid: true, errors: [] });

      const compiled = projectRuleAction({
        id: `id:${definition.card_number}`,
        card_number: definition.card_number,
        name: definition.name,
        level: 1,
        concentration: definition.card_number !== 'SPELL-0165',
        ritual: false,
        component_verbal: true,
        component_somatic: true,
        component_material: false,
        mechanics,
      } as unknown as Spell);
      expect(compiled.kind).toBe('spell');
      expect(compiled.targeting).toBeDefined();
    }
  });

  it('Порча после провала ХАР-спаса кладёт штрафную к4 на атаку и спасбросок', () => {
    const target = freshFighterState();
    const result = executeAction(casterState(), spell('SPELL-0267').mechanics, {
      character: caster,
      selfId: 'warlock',
      target: { id: 'target', saveMods: { cha: 0 }, runtimeState: target },
      rng: () => face(1),
    });
    expect(result.targetState?.activeEffects).toHaveLength(2);
    expect(collectModifiers(result.targetState!, [], { roll: 'attack' }).rules).toContainEqual(
      expect.objectContaining({ op: 'bonus_die', faces: 4, sign: -1 }),
    );
    expect(collectModifiers(result.targetState!, [], { roll: 'saving_throw' }).rules).toContainEqual(
      expect.objectContaining({ op: 'bonus_die', faces: 4, sign: -1 }),
    );
  });

  it('Луч болезни при попадании наносит 2к8 ядом и отравляет до конца следующего хода кастера', () => {
    const rolls = [face(15), face(4, 8), face(5, 8)];
    let rollIndex = 0;
    const target = freshFighterState();
    const result = executeAction(casterState(), spell('ray_of_sickness').mechanics, {
      character: caster,
      selfId: 'wizard',
      target: { id: 'target', ac: 10, runtimeState: target },
      rng: () => rolls[rollIndex++],
    });
    expect(result.targetState?.hp.current).toBe(target.hp.current - 9);
    expect(result.state.resources.action).toBe(0);
    expect(result.state.resources.spell_slot_1).toBe(1);
    expect(result.targetState?.activeEffects).toContainEqual(expect.objectContaining({
      ownerId: 'target',
      sourceId: 'wizard',
      expiry: 'source_turn',
      sourceTurnExpiry: {
        sourceActorId: 'wizard', ownerActorId: 'target', boundary: 'end',
      },
      mechanics: expect.objectContaining({ kind: 'condition', value: 'poisoned' }),
    }));
  });

  it('Сглаз сохраняет выбранную характеристику и source-bound некротический райдер', () => {
    const result = executeAction(casterState(), spell('SPELL-0287').mechanics, {
      character: caster,
      selfId: 'warlock',
      target: { id: 'target', ac: 10, runtimeState: freshFighterState() },
      choices: { hex_ability: 'dex' },
      rng: () => 0.5,
    });
    expect(result.targetState?.activeEffects).toHaveLength(2);
    expect(collectModifiers(result.targetState!, [], {
      roll: 'ability_check', filter: { ability: 'dex' },
    }).advantage).toBe('disadvantage');
    expect(result.targetState?.activeEffects).toContainEqual(expect.objectContaining({
      ownerId: 'target', sourceId: 'warlock',
      mechanics: expect.objectContaining({ kind: 'damage_rider', type: 'necrotic' }),
    }));
  });

  it('Божественное благоволение тратит бонусное действие и ячейку и хранит 10 раундов', () => {
    const result = executeAction(casterState(), spell('SPELL-0165').mechanics, {
      character: caster,
      selfId: 'paladin',
      rng: () => 0.5,
    });
    expect(result.state.resources.bonus_action).toBe(0);
    expect(result.state.resources.spell_slot_1).toBe(1);
    expect(result.state.activeEffects).toContainEqual(expect.objectContaining({
      roundsLeft: 10,
      mechanics: expect.objectContaining({ kind: 'damage_rider', type: 'radiant' }),
    }));
  });
});
