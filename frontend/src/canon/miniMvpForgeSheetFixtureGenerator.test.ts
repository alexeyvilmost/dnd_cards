import { describe, expect, it } from 'vitest';
import type { Card, CharacterClass } from '../types';
import {
  assertClassEquipmentReferenceClosure,
  ClassEquipmentReferenceIntegrityError,
} from './miniMvpForgeSheetFixtureGenerator';

function card(id: string): Card {
  return { id, card_number: `CARD-${id}`, name: id } as Card;
}

function klass(
  cardNumber: string,
  equipmentOptions: CharacterClass['equipment_options'],
  isSubclass = false,
): CharacterClass {
  return {
    id: cardNumber,
    card_number: cardNumber,
    name: cardNumber,
    is_subclass: isSubclass,
    equipment_options: equipmentOptions,
  } as CharacterClass;
}

describe('mini-MVP Forge starting-equipment content lint', () => {
  it('scans every option of every base class instead of only the generated choice', () => {
    const classes = [
      klass('CLASS-ranger', {
        option_a: { items: [{ card_id: 'longbow', quantity: 1 }], gold: 7 },
        option_b: { items: [{ card_id: 'missing-ammo', quantity: 20 }], gold: 0 },
      }),
      klass('SUBCLASS-ignored', {
        option_a: { items: [{ card_id: 'also-missing', quantity: 1 }], gold: 0 },
      }, true),
    ];
    expect(() => assertClassEquipmentReferenceClosure(classes, [card('longbow')]))
      .toThrowError(ClassEquipmentReferenceIntegrityError);
    expect(() => assertClassEquipmentReferenceClosure(classes, [card('longbow')]))
      .toThrow(/CLASS-ranger\.option_b\.items\[0\].*resolves 0 times/);
    expect(() => assertClassEquipmentReferenceClosure(classes, [card('longbow')]))
      .not.toThrow(/SUBCLASS-ignored/);
  });

  it('accepts a closed equipment graph with stack quantities', () => {
    const classes = [klass('CLASS-ranger', {
      option_a: {
        items: [
          { card_id: 'longbow', quantity: 1 },
          { card_id: 'arrow', quantity: 20 },
        ],
        gold: 7,
      },
      option_b: { items: [], gold: 150 },
    })];
    expect(() => assertClassEquipmentReferenceClosure(classes, [card('longbow'), card('arrow')]))
      .not.toThrow();
  });

  it('rejects duplicate catalog rows and non-positive quantities', () => {
    const classes = [klass('CLASS-ranger', {
      option_a: { items: [{ card_id: 'arrow', quantity: 0 }], gold: 0 },
    })];
    expect(() => assertClassEquipmentReferenceClosure(classes, [card('arrow'), card('arrow')]))
      .toThrow(/quantity must be a positive integer[\s\S]*resolves 2 times/);
  });
});
