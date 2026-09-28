import { describe, expect, it } from 'vitest';
import { equipmentWeaponMasterySeed, weaponTypesFromEquipmentOption } from './equipmentWeaponMastery';

describe('weaponTypesFromEquipmentOption', () => {
  it('collects distinct weapon types in package order', () => {
    const cards = new Map([
      ['sword', { weapon_type: 'longsword' }],
      ['javelin', { weapon_type: 'spear' }],
      ['mail', { weapon_type: null }],
      ['shield', {}],
    ]);
    expect(weaponTypesFromEquipmentOption({
      items: [
        { card_id: 'mail', quantity: 1 },
        { card_id: 'sword', quantity: 1 },
        { card_id: 'javelin', quantity: 6 },
        { card_id: 'javelin', quantity: 1 },
        { card_id: 'shield', quantity: 1 },
      ],
    }, cards)).toEqual(['longsword', 'spear']);
  });
});

describe('equipmentWeaponMasterySeed', () => {
  it('auto-fills when the package supplies enough weapons', () => {
    expect(equipmentWeaponMasterySeed({
      choiceId: 'weapon-mastery',
      count: 2,
      optionKey: 'a',
      weaponTypes: ['longsword', 'spear', 'mace'],
      autoFillEnabled: true,
      resolved: {},
      previousAutoKey: null,
    })).toEqual({
      next: { 'weapon-mastery': ['longsword', 'spear'] },
      autoKey: 'a:longsword,spear',
    });
  });

  it('clears a previous auto-fill for gold-only package B', () => {
    expect(equipmentWeaponMasterySeed({
      choiceId: 'weapon-mastery',
      count: 2,
      optionKey: 'b',
      weaponTypes: [],
      autoFillEnabled: true,
      resolved: { 'weapon-mastery': ['longsword', 'spear'] },
      previousAutoKey: 'a:longsword,spear',
    })).toEqual({
      next: null,
      autoKey: null,
      clearChoiceId: 'weapon-mastery',
    });
  });

  it('does not overwrite a manual mastery choice', () => {
    expect(equipmentWeaponMasterySeed({
      choiceId: 'weapon-mastery',
      count: 2,
      optionKey: 'a',
      weaponTypes: ['longsword', 'spear'],
      autoFillEnabled: true,
      resolved: { 'weapon-mastery': ['greataxe', 'battleaxe'] },
      previousAutoKey: null,
    })).toEqual({ next: null, autoKey: null });
  });

  it('leaves package B for manual choice even when it contains enough weapon types', () => {
    expect(equipmentWeaponMasterySeed({
      choiceId: 'weapon-mastery',
      count: 2,
      optionKey: 'b',
      weaponTypes: ['longsword', 'spear'],
      autoFillEnabled: false,
      resolved: {},
      previousAutoKey: null,
    })).toEqual({ next: null, autoKey: null });
  });

  it('clears a package-A auto-fill when switching to a manual package', () => {
    expect(equipmentWeaponMasterySeed({
      choiceId: 'weapon-mastery',
      count: 2,
      optionKey: 'b',
      weaponTypes: ['longsword', 'spear'],
      autoFillEnabled: false,
      resolved: { 'weapon-mastery': ['longsword', 'spear'] },
      previousAutoKey: 'a:longsword,spear',
    })).toEqual({ next: null, autoKey: null, clearChoiceId: 'weapon-mastery' });
  });
});
