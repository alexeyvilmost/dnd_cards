import { describe, expect, it } from 'vitest';
import { buildResourceRuntimePatch, syncRuntimeResources } from './resourceInit';
import type { AssembledCharacter } from './assemble';
import type { CharacterContext } from '../mvp/contracts';
import type { ForgeCharacter } from './types';

const ctx: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 3 },
  profBonus: 2,
  level: 5,
};

const assembled = {
  klass: {
    name: 'Бард',
    resources: { inspiration: { count: 'max(cha, 1)', per: 'long_rest' } },
  },
  effects: [{
    effect: {
      id: 'feature',
      name: 'Особая способность',
      mechanics: {
        name: 'Особая способность',
        effects: [{ resolution: 'auto', result: [{ kind: 'resource', op: 'grant', id: 'heroic', amount: 2 }] }],
      },
    },
    origin: { kind: 'race', id: 'human', name: 'Человек' },
  }],
  actions: [],
  spells: [],
} as unknown as AssembledCharacter;

describe('MM4 — resource maximum sources', () => {
  it('returns base, class and granted pool sources', () => {
    const result = syncRuntimeResources(ctx, assembled);

    expect(result.maxResources.inspiration).toBe(3);
    expect(result.sources.inspiration).toEqual([
      { value: 3, source: 'Бард', reason: 'классовый максимум' },
    ]);
    expect(result.maxResources.heroic).toBe(2);
    expect(result.sources.heroic).toEqual([
      { value: 2, source: 'Особая способность', reason: 'грант ресурса' },
    ]);
    expect(result.sources.action).toEqual([
      { value: 1, source: 'Базовый ресурс хода', reason: 'один ресурс на ход' },
    ]);
  });

  it('does not write merely because jsonb returned resource keys in another order', () => {
    const maxResources = {
      heroic: 2,
      inspiration: 3,
      reaction: 1,
      bonus_action: 1,
      action: 1,
    };
    const character = {
      current_hp: 10,
      max_hp: 10,
      resources: { ...maxResources },
      max_resources: maxResources,
      turn_state: {},
      inventory_items: [],
      equipment: {},
      active_effects: [],
    } as unknown as ForgeCharacter;

    expect(buildResourceRuntimePatch(character, ctx, assembled, false, 10)).toBeNull();
  });
});
