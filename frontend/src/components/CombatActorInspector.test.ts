import { describe, expect, it } from 'vitest';
import { collectCombatDefenses } from './CombatActorInspector';

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
});
