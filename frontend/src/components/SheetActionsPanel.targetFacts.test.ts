import { describe, expect, it } from 'vitest';
import {
  explicitSheetTargetContext,
  explicitSheetTargetFactsIssue,
  mergeSelfTargetRuntime,
  persistPayload,
  sheetActionDisplayName,
  sheetMechanicsAllowsSelfTarget,
  sheetActionNeedsCanonicalAvailability,
  sheetSelectedTargetRelationIssue,
} from './SheetActionsPanel';
import type { RuntimeState } from '../mvp/contracts';

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

  it('derives self picker membership from targeting relations', () => {
    expect(sheetMechanicsAllowsSelfTarget({
      targeting: { allowed_relations: ['self', 'ally'] },
    })).toBe(true);
    expect(sheetMechanicsAllowsSelfTarget({
      targeting: { allowed_relations: ['enemy'] },
    })).toBe(false);
    expect(sheetSelectedTargetRelationIssue({
      actorId: 'hero', targetId: 'hero', allowsSelf: false,
    })).toMatch(/не разрешает/);
    expect(sheetSelectedTargetRelationIssue({
      actorId: 'hero', targetId: 'hero', allowsSelf: true,
    })).toBeNull();
  });

  it('routes non-primitive spell rows through canonical access checks', () => {
    expect(sheetActionNeedsCanonicalAvailability({
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        effects: [{ resolution: 'auto', result: [] }],
      },
      spellRef: { id: 'spell:legacy' } as never,
    })).toBe(true);
    expect(sheetActionNeedsCanonicalAvailability({
      mechanics: {
        primitive: { type: 'magic_missile' },
      },
    })).toBe(true);
    expect(sheetActionNeedsCanonicalAvailability({ mechanics: {} })).toBe(false);
  });

  it('merges a self-target effect with the source spell-slot payment', () => {
    const before: RuntimeState = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, spell_slot_1: 1 },
      maxResources: { action: 1, spell_slot_1: 2 },
      equipment: {}, inventory: [], activeEffects: [],
    };
    const source: RuntimeState = {
      ...before,
      resources: { ...before.resources, action: 0, spell_slot_1: 0 },
    };
    const target: RuntimeState = {
      ...before,
      activeEffects: [{
        id: 'mage-armor', name: 'Mage Armor', source: 'spell',
        mechanics: { effects: [{ result: [{ kind: 'set_value', target: 'ac_base' }] }] },
      }],
    };
    expect(mergeSelfTargetRuntime(before, source, target)).toMatchObject({
      resources: { action: 0, spell_slot_1: 0 },
      activeEffects: [{ id: 'mage-armor' }],
    });
  });

  it('persists resource grants and caps on a different character target', () => {
    const target: RuntimeState = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { heroic_inspiration: 1 },
      maxResources: { heroic_inspiration: 1 },
      equipment: {}, inventory: [{ cardId: 'untouched-item', qty: 1 }], activeEffects: [],
    };
    expect(persistPayload(target, {}, false)).toMatchObject({
      current_hp: 10,
      resources: { heroic_inspiration: 1 },
      max_resources: { heroic_inspiration: 1 },
      active_effects: [],
    });
    expect(persistPayload(target, {}, false)).not.toHaveProperty('inventory_items');
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
