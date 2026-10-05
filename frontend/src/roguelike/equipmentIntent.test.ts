import {describe, expect, it} from 'vitest';
import fixtureJson from './testing/currentPinnedFixture';
import {executeEquipmentIntent} from './equipmentIntent';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';
import {createRoguelikeCombatRandom} from './combatWorker';
import {prepareSheetEquipmentCommand} from '../character/sheetEquipmentCommand';
import type {ForgeCharacter} from '../character/types';

const fixture = fixtureJson as unknown as {
  character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[];
};
describe('authoritative equipment preparation shares the sheet command', () => {
  it.each([{resource: 'first_intent_pool', amount: 3}, {resource: 'second_intent_pool', amount: 5}])(
    'has the same complete outcome for $resource without mutating the owned input', async ({resource, amount}) => {
      const input = structuredClone(fixture), card = structuredClone(input.catalog.entities.card[0]);
      card.id = 'ad930000-0000-4000-8000-000000000001'; card.card_number = 'QA-equipment-intent';
      card.type = 'ring'; card.slot = 'ring'; card.requires_attunement = false;
      card.mechanics = {activation: {mode: 'passive', while: 'equipped'}, effects: [
        {resolution: 'auto', result: [{kind: 'resource', op: 'grant', id: resource, amount}]},
      ]};
      input.catalog.entities.card.push(card);
      input.character.inventory_items = [...(input.character.inventory_items ?? []), {card_id: card.id, qty: 1}];
      const snapshot = structuredClone(input), commandId = 'ad930000-0000-4000-8000-000000000002';
      const operation = {equip: card.id}, seed = 'equipment-shared-canonical-proof';
      const direct = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
      if (direct.status !== 'ready') throw Error('Fixture missing content');
      const random = createRoguelikeCombatRandom(seed, 0);
      const expected = prepareSheetEquipmentCommand(direct.participant, commandId, operation, random.rng);
      const result = await executeEquipmentIntent({...input, commandId, operation, seed});
      expect(result.status).toBe('ready'); if (result.status !== 'ready') throw Error('Fixture missing content');
      expect(result.preparedCommand).toEqual(expected.request);
      expect(result.contentManifestHash).toBe(direct.contentManifestHash);
      expect(result.randomValues).toEqual(random.randomValues);
      expect(result.randomValues).toEqual([]);
      expect(result.preparedCommand.participants[0].patch.max_resources?.[resource]).toBe(amount);
      expect(await executeEquipmentIntent({...input, commandId, operation, seed})).toEqual(result);
      expect(input).toEqual(snapshot);
    },
  );

  it('returns missing canonical dependencies instead of preparing from an incomplete catalog', async () => {
    const input = structuredClone(fixture);
    input.catalog.entities.card = [];
    const result = await executeEquipmentIntent({...input, commandId: 'dependency-probe', seed: 'probe',
      operation: {unequip: 'body'}});
    expect(result.status).toBe('needs_content');
    expect('preparedCommand' in result).toBe(false);
  });

  it.each([3, 5])('consumes only current canonical inputs from a cache candidate (%i)', async amount => {
    const input = structuredClone(fixture), extra = structuredClone(input.catalog.entities.card[0]);
    extra.id = 'ad930000-0000-4000-8000-000000000003'; extra.card_number = 'QA-unowned-candidate';
    extra.type = 'ring'; extra.slot = 'ring'; extra.requires_attunement = false;
    extra.mechanics = {activation: {mode: 'passive', while: 'carried'}, effects: [
      {resolution: 'auto', result: [{kind: 'resource', op: 'grant', id: `unowned_capacity_${amount}`, amount}]},
    ]};
    const command = {commandId: 'ad930000-0000-4000-8000-000000000004', operation: {equip: input.catalog.entities.card[0].id}, seed: 'cache-parity'};
    const cold = await executeEquipmentIntent({...input, ...command, catalogProjectionVersion: 1});
    const old = await executeEquipmentIntent({...input, ...command});
    expect(cold.status).toBe('ready'); if (cold.status !== 'ready' || old.status !== 'ready') throw Error('Incomplete fixture');
    expect(cold.preparedCommand).toEqual(old.preparedCommand);
    expect(cold.randomValues).toEqual(old.randomValues);
    input.catalog.entities.card.push(extra);
    const before = structuredClone(input);
    expect(await executeEquipmentIntent({...input, ...command, catalogProjectionVersion: 1})).toEqual(cold);
    expect(input).toEqual(before);
    input.character.inventory_items = [...(input.character.inventory_items ?? []), {card_id: extra.id, qty: 1}];
    const gained = await executeEquipmentIntent({...input, ...command, catalogProjectionVersion: 1});
    if (gained.status !== 'ready') throw Error('Incomplete gained fixture');
    expect(gained.catalogSelection?.entities).toContainEqual({entityType: 'card', id: extra.id});
    expect(gained.contentManifestHash).not.toBe(cold.contentManifestHash);
    expect(gained.preparedCommand.participants[0].patch.max_resources?.[`unowned_capacity_${amount}`]).toBe(amount);
    input.character.inventory_items = input.character.inventory_items.filter(row => row.card_id !== extra.id);
    expect(await executeEquipmentIntent({...input, ...command, catalogProjectionVersion: 1})).toEqual(cold);
  });
});
