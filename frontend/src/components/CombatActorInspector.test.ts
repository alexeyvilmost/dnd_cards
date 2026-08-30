import { describe, expect, it } from 'vitest';
import { collectCombatDefenses } from './CombatActorInspector';
import { combatGrappleStatusRows } from '../solo-combat/grapplePresentation';

describe('combat actor inspector defenses', () => {
  it('derives defenses recursively from mechanics primitives and deduplicates them', () => {
    expect(collectCombatDefenses([{
      effects: [
        { kind: 'resistance', damage_type: 'fire', value: 'resistance' },
        { kind: 'resistance', damage_type: 'cold', value: 'immunity' },
        { kind: 'condition_immunity', condition: 'poisoned' },
        { nested: { kind: 'resistance', damage_type: 'fire', value: 'resistance' } },
      ],
    }])).toEqual([
      { kind: 'resistance', value: 'fire' },
      { kind: 'immunity', value: 'cold' },
      { kind: 'condition_immunity', value: 'poisoned' },
    ]);
  });

  it('does not infer defenses from descriptive prose', () => {
    expect(collectCombatDefenses([{ description: 'Иммунитет к огню' }])).toEqual([]);
  });

  it('explains a persisted grapple to both participants', () => {
    const world = {
      actors: {
        fighter: { name: 'Дворф' },
        goblin: { name: 'Гоблин' },
      },
      grapples: {
        hold: {
          id: 'hold', grapplerActorId: 'fighter', targetActorId: 'goblin',
          sourcePart: 'off_hand', escapeDc: 13, reachFt: 5,
          sourceEntityIds: ['system:unarmed'], startedAtRevision: 1,
        },
      },
    } as unknown as Parameters<typeof combatGrappleStatusRows>[0];
    expect(combatGrappleStatusRows(world, 'goblin')).toEqual([{
      key: 'grappled:hold', name: 'Схвачен',
      instructions: ['Захватил: Дворф.', 'Скорость — 0; освобождение — действием против Сл 13.'],
    }]);
    expect(combatGrappleStatusRows(world, 'fighter')).toEqual([{
      key: 'grappling:hold', name: 'Удерживает захват',
      instructions: ['Цель: Гоблин.', 'Занята: свободная рука.'],
    }]);
  });
});
