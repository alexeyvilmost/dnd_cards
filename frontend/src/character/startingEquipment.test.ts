import backgrounds from '../../../officials/canon/prod-snapshot/backgrounds.json';
import { describe, expect, it } from 'vitest';
import type { PatchCharacterRuntimeRequest } from './api';
import {
  projectStartingEquipmentPatch,
  type StartingEquipmentOption,
} from './startingEquipment';

const BACKGROUND_BRANCHES = [
  {
    name: 'Soldier',
    cardNumber: 'BG-0012',
    gold: 14,
    items: [
      ['12b175a4-cbc3-42bd-9d8d-50193a112389', 1],
      ['3d68bd64-50ca-4f7a-b5a9-c79a911b2475', 1],
      ['59b10a1e-8669-4bf6-88a5-69d0abfc76a6', 20],
      ['148bffd3-d797-47a5-b66c-c7d3d04e9c00', 1],
      ['c70618ac-be64-42fe-b338-b6669d1ecf2a', 1],
      ['6112aaef-39b3-4b91-a0fa-96f56987ebb2', 1],
      ['bbc804a1-3a7e-4b09-88c7-21d863ea2d85', 1],
    ],
  },
  {
    name: 'Sage',
    cardNumber: 'BG-0005',
    gold: 8,
    items: [
      ['416ce3b6-193e-4186-a481-09375444c090', 1],
      ['69e3364b-e5e9-4a28-92fe-f419d88648bd', 1],
      ['67a7e163-8723-4296-a8cd-67f3e7c4f852', 1],
      ['c10d9a5f-f5b3-44d3-9c62-6bdc4ef90dc4', 8],
      ['40fc2ff7-f2d9-424b-a2c6-7819ddd7b3a5', 1],
    ],
  },
  {
    name: 'Criminal',
    cardNumber: 'BG-0008',
    gold: 16,
    items: [
      ['db5d576b-3ae1-4402-b4dc-8f7ec7d88b29', 2],
      ['2be96522-100a-46f4-ba35-6e98cb10186c', 1],
      ['75873843-f449-4f2f-8237-3d8dac21ec85', 1],
      ['fdd3770f-0eda-446d-bd78-5944f4d95d9d', 2],
      ['bbc804a1-3a7e-4b09-88c7-21d863ea2d85', 1],
    ],
  },
  {
    name: 'Acolyte',
    cardNumber: 'BG-0009',
    gold: 8,
    items: [
      ['69e3364b-e5e9-4a28-92fe-f419d88648bd', 1],
      ['c569802e-b19b-4a50-be1d-63bc9718d95e', 1],
      ['dfca725c-d14b-4f6f-afa7-4d778e764aa0', 1],
      ['c10d9a5f-f5b3-44d3-9c62-6bdc4ef90dc4', 10],
      ['40fc2ff7-f2d9-424b-a2c6-7819ddd7b3a5', 1],
    ],
  },
] as const;

function optionA(cardNumber: string): StartingEquipmentOption {
  const background = backgrounds.find((candidate) => candidate.card_number === cardNumber);
  if (!background?.equipment_options?.option_a) {
    throw new Error(`Missing option A for ${cardNumber}`);
  }
  return background.equipment_options.option_a;
}

describe('starting equipment runtime projection', () => {
  for (const fixture of BACKGROUND_BRANCHES) {
    it(`projects the literal ${fixture.name} option-A branch`, () => {
      const option = optionA(fixture.cardNumber);
      const expectedItems = fixture.items.map(([card_id, quantity]) => ({ card_id, quantity }));
      expect(option).toEqual({ items: expectedItems, gold: fixture.gold });

      const patch: PatchCharacterRuntimeRequest = {
        current_hp: 11,
        resources: { action: 1 },
      };
      expect(projectStartingEquipmentPatch(patch, option)).toEqual({
        ...patch,
        inventory_items: expectedItems.map(({ card_id, quantity: qty }) => ({ card_id, qty })),
        currency: { gold: fixture.gold },
      });
    });
  }

  it('preserves unrelated runtime fields, inventory rows, and currency denominations', () => {
    const patch: PatchCharacterRuntimeRequest = {
      current_hp: 7,
      max_hp: 12,
      resources: { action: 1, reaction: 1 },
      max_resources: { action: 1, reaction: 1 },
      inventory_items: [
        { card_id: 'unrelated', qty: 4 },
        { card_id: 'shared-starting-card', qty: 99 },
      ],
      currency: { gold: 999, silver: 6 },
    };
    const original = structuredClone(patch);

    const projected = projectStartingEquipmentPatch(
      patch,
      { items: [{ card_id: 'shared-starting-card', quantity: 1 }], gold: 14 },
      {
        items: [
          { card_id: 'shared-starting-card', quantity: 2 },
          { card_id: 'class-only-card', quantity: 1 },
        ],
        gold: 5,
      },
    );

    expect(projected).toEqual({
      ...patch,
      inventory_items: [
        { card_id: 'unrelated', qty: 4 },
        { card_id: 'shared-starting-card', qty: 3 },
        { card_id: 'class-only-card', qty: 1 },
      ],
      currency: { gold: 19, silver: 6 },
    });
    expect(patch).toEqual(original);
  });

  it('is idempotent across creation retries and preserves inventory for a gold-only branch', () => {
    const patch: PatchCharacterRuntimeRequest = {
      inventory_items: [{ card_id: 'unrelated', qty: 2 }],
      currency: { copper: 9 },
    };
    const background = {
      items: [{ card_id: 'background-card', quantity: 2 }],
      gold: 8,
    };
    const klass = {
      items: [{ card_id: 'class-card', quantity: 1 }],
      gold: 7,
    };
    const once = projectStartingEquipmentPatch(patch, background, klass);
    const twice = projectStartingEquipmentPatch(once, background, klass);

    expect(twice).toEqual(once);
    expect(projectStartingEquipmentPatch(patch, { items: [], gold: 50 })).toEqual({
      ...patch,
      currency: { copper: 9, gold: 50 },
    });
  });
});
