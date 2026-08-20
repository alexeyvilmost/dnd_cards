import { describe, expect, it } from 'vitest';
import {
  DeclarativeContentPatchError,
  materializeMicroMvpL1ContentPatch,
  MICRO_MVP_L1_CONTENT_PATCH,
} from './declarativeMechanicsPatch';
import { readProdSnapshotCatalogs } from './prodSnapshotL1Fixtures';

type EquipmentItem = { card_id: string; quantity: number };
type EquipmentOption = { items: EquipmentItem[]; gold: number };

const EXPECTED_ITEM_OPTIONS = {
  'CLASS-warrior': {
    option_a: [
      ['CARD-0283', 1],
      ['CARD-0317', 1],
      ['CARD-0309', 1],
      ['CARD-0301', 8],
      ['CARD-0805', 1],
    ],
    option_b: [
      ['CARD-0276', 1],
      ['CARD-0311', 1],
      ['CARD-0294', 1],
      ['CARD-0327', 1],
      ['CARD-0728', 20],
      ['CARD-0729', 1],
      ['CARD-0805', 1],
    ],
  },
  'CLASS-rogue': {
    option_a: [
      ['CARD-0275', 1],
      ['CARD-0297', 2],
      ['CARD-0316', 1],
      ['CARD-0306', 1],
      ['CARD-0728', 20],
      ['CARD-0729', 1],
      ['CARD-0702', 1],
      ['CARD-0803', 1],
    ],
  },
  'CLASS-cleric': {
    option_a: [
      ['CARD-0278', 1],
      ['CARD-0200', 1],
      ['CARD-0298', 1],
      ['CARD-0816', 1],
      ['CARD-0409', 1],
    ],
  },
  'CLASS-sorcerer': {
    option_a: [
      ['CARD-0304', 1],
      ['CARD-0297', 2],
      ['CARD-0826', 1],
      ['CARD-0805', 1],
    ],
  },
  'CLASS-druid': {
    option_a: [
      ['CARD-0275', 1],
      ['CARD-0200', 1],
      ['CARD-0299', 1],
      ['CARD-0827', 1],
      ['CARD-0806', 1],
      ['CARD-0712', 1],
    ],
  },
  'CLASS-wizard': {
    option_a: [
      ['CARD-0297', 2],
      ['CARD-0826', 1],
      ['CARD-0710', 1],
      ['CARD-0975', 1],
      ['CARD-0807', 1],
    ],
  },
  'CLASS-warlock': {
    option_a: [
      ['CARD-0275', 1],
      ['CARD-0299', 1],
      ['CARD-0297', 2],
      ['CARD-0826', 1],
      ['CARD-0976', 1],
      ['CARD-0807', 1],
    ],
  },
} as const;

function optionProjection(
  option: EquipmentOption,
  cards: ReturnType<typeof readProdSnapshotCatalogs>['cards'],
) {
  const byId = new Map(cards.map((card) => [card.id, card.card_number]));
  return option.items.map((item) => [byId.get(item.card_id), item.quantity]);
}

describe('micro-MVP PHB 2024 starting equipment production patch', () => {
  it('materializes every complete item kit by stable card identity', () => {
    const { catalogs } = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs());

    for (const [classCardNumber, expected] of Object.entries(EXPECTED_ITEM_OPTIONS)) {
      const characterClass = catalogs.classes.find((item) => (
        item.card_number === classCardNumber
      ));
      expect(characterClass, classCardNumber).toBeDefined();
      const options = characterClass!.equipment_options!;
      expect(optionProjection(options.option_a as EquipmentOption, catalogs.cards))
        .toEqual(expected.option_a);
      if ('option_b' in expected) {
        expect(optionProjection(options.option_b as EquipmentOption, catalogs.cards))
          .toEqual(expected.option_b);
      }
    }

    const fighter = catalogs.classes.find((item) => item.card_number === 'CLASS-warrior')!;
    expect(fighter.equipment_options).toMatchObject({
      option_a: { gold: 4 },
      option_b: { gold: 11 },
      option_c: { items: [], gold: 155 },
    });
    expect(catalogs.classes.find((item) => item.card_number === 'CLASS-rogue')!
      .equipment_options).toMatchObject({ option_a: { gold: 8 }, option_b: { gold: 100 } });
    expect(catalogs.classes.find((item) => item.card_number === 'CLASS-cleric')!
      .equipment_options).toMatchObject({ option_a: { gold: 7 }, option_b: { gold: 110 } });
    expect(catalogs.classes.find((item) => item.card_number === 'CLASS-sorcerer')!
      .equipment_options).toMatchObject({ option_a: { gold: 28 }, option_b: { gold: 50 } });
    expect(catalogs.classes.find((item) => item.card_number === 'CLASS-druid')!
      .equipment_options).toMatchObject({ option_a: { gold: 9 }, option_b: { gold: 50 } });
    expect(catalogs.classes.find((item) => item.card_number === 'CLASS-wizard')!
      .equipment_options).toMatchObject({ option_a: { gold: 5 }, option_b: { gold: 55 } });
    expect(catalogs.classes.find((item) => item.card_number === 'CLASS-warlock')!
      .equipment_options).toMatchObject({ option_a: { gold: 15 }, option_b: { gold: 100 } });
  });

  it('corrects the referenced mundane Javelin to the Slow mastery identity', () => {
    const { catalogs } = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs());
    const javelin = catalogs.cards.find((item) => item.card_number === 'CARD-0301');
    expect(javelin).toMatchObject({
      id: '3ea27d6c-5a12-48f2-953a-0b955de6e673',
      weapon_type: 'javelin',
      mastery: 'c7d07a67-374c-49f6-b34b-40e85c26674e',
      range: '30/120',
    });
    expect(catalogs.effects.find((item) => item.id === javelin!.mastery)).toMatchObject({
      card_number: 'EFFECT-0250',
      mechanics: { weapon_mastery: { type: 'slow' } },
    });
  });

  it('fails closed if a declared equipment card UUID/card_number pair is split', () => {
    const catalogs = readProdSnapshotCatalogs();
    catalogs.cards.find((item) => item.card_number === 'CARD-0283')!.card_number =
      'CARD-drifted-chain-mail';
    expect(() => materializeMicroMvpL1ContentPatch(catalogs)).toThrowError(
      DeclarativeContentPatchError,
    );
    expect(() => materializeMicroMvpL1ContentPatch(catalogs)).toThrow(
      /cards:CARD-0283.*identity is missing, duplicated, or split/,
    );
  });

  it('declares all seven class outcomes and never dispatches equipment by localized name', () => {
    const classPatches = MICRO_MVP_L1_CONTENT_PATCH.fieldPatches.filter((item) => (
      item.collection === 'classes' && item.fields.equipment_options
    ));
    expect(classPatches.map((item) => item.cardNumber).sort()).toEqual([
      'CLASS-cleric',
      'CLASS-druid',
      'CLASS-rogue',
      'CLASS-sorcerer',
      'CLASS-warlock',
      'CLASS-warrior',
      'CLASS-wizard',
    ]);
    expect(JSON.stringify(classPatches)).not.toMatch(/"name"\s*:/);
  });
});
