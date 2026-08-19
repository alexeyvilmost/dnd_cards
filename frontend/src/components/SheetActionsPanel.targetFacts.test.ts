import { describe, expect, it } from 'vitest';
import {
  explicitSheetTargetContext,
  explicitSheetTargetFactsIssue,
  sheetActionDisplayName,
} from './SheetActionsPanel';

const attack = {
  effects: [{ resolution: 'attack_roll', who: 'target' }],
};
const save = {
  effects: [{ resolution: 'save', ability: 'dex', dc: 13, who: 'target' }],
};

describe('explicit legacy sheet target facts', () => {
  it('never invents Armor Class for an attack', () => {
    expect(explicitSheetTargetFactsIssue(attack, {
      armorClass: null,
      savingThrowModifier: null,
    })).toMatch(/КЗ цели/);
    expect(() => explicitSheetTargetContext(attack, {
      armorClass: undefined,
      savingThrowModifier: undefined,
    })).toThrow(/КЗ цели/);
    expect(explicitSheetTargetContext(attack, {
      armorClass: 17,
      savingThrowModifier: null,
    })).toEqual({ ac: 17 });
  });

  it('distinguishes an explicit zero save modifier from an absent fact', () => {
    expect(explicitSheetTargetFactsIssue(save, {
      armorClass: null,
      savingThrowModifier: null,
    })).toMatch(/модификатор спасброска/);
    expect(explicitSheetTargetFactsIssue(save, {
      armorClass: null,
      savingThrowModifier: 0,
    })).toBeNull();
    expect(explicitSheetTargetContext(save, {
      armorClass: null,
      savingThrowModifier: 0,
    })).toEqual({
      saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    });
  });

  it('does not create a dummy target for a self-only action', () => {
    expect(explicitSheetTargetContext({
      effects: [{ resolution: 'apply', who: 'self' }],
    }, {
      armorClass: null,
      savingThrowModifier: null,
    })).toBeUndefined();
  });
});

describe('contextual weapon action presentation', () => {
  it('names a generic weapon primitive from its actor-materialized attack mode', () => {
    const action = (attackKind: string) => ({
      name: 'Атака оружием',
      mechanics: {
        primitive: { type: 'weapon_attack' },
        effects: [{ resolution: 'attack_roll', attack_kind: attackKind }],
      },
    });
    expect(sheetActionDisplayName(action('weapon_ranged'))).toBe('Дальнобойная атака оружием');
    expect(sheetActionDisplayName(action('weapon_melee'))).toBe('Рукопашная атака оружием');
  });

  it('preserves data-owned names for every other action primitive', () => {
    expect(sheetActionDisplayName({
      name: 'Особая атака',
      mechanics: { primitive: { type: 'custom_attack' } },
    })).toBe('Особая атака');
  });
});
