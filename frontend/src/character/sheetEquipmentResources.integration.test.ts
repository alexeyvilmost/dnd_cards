import {describe, expect, it} from 'vitest';
import fixtureJson from '../roguelike/testing/currentPinnedFixture';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from '../roguelike/combatCatalog';
import type {ForgeCharacter} from './types';
import {prepareSheetEquipmentCommand} from './sheetEquipmentCommand';
import {handleCommand} from '../rules-core/handler';
import {foldEvents} from '../rules-core/reducer';

const fixture = fixtureJson as unknown as {
  character: ForgeCharacter; catalog: FrozenCombatCatalog; basicActionIds: string[];
};

describe('equipment resource projection in the accepted atomic command', () => {
  it.each([
    {key: 'equipment_capacity_alpha', amount: 3, attuned: false},
    {key: 'equipment_capacity_beta', amount: 5, attuned: true},
  ])('commits $key capacity with placement and does not refill on re-equip', async ({key, amount, attuned}) => {
    const input = structuredClone(fixture);
    const card = structuredClone(input.catalog.entities.card[0]);
    card.id = 'ad920000-0000-4000-8000-000000000001';
    card.card_number = 'QA-equipment-capacity'; card.name = key;
    card.type = 'ring'; card.slot = 'ring'; card.requires_attunement = attuned;
    card.mechanics = {activation: {mode: 'passive', while: 'equipped'}, effects: [
      {resolution: 'auto', result: [{kind: 'resource', op: 'grant', id: key, amount}]},
    ]};
    input.catalog.entities.card.push(card);
    let character = {...input.character, turn_state: attuned ? {attuned_ids: [card.id]} : {},
      inventory_items: [...(input.character.inventory_items ?? []), {card_id: card.id, qty: 1}]};
    const initial = structuredClone(character);
    const noDice = () => {throw Error('This equipment declaration has no dice');};
    const apply = async (operation: {equip: string} | {unequip: string}, ordinal: number) => {
      const prepared = await prepareRoguelikeCombatParticipant(character, input.catalog, input.basicActionIds);
      expect(prepared.status).toBe('ready'); if (prepared.status !== 'ready') throw Error('Incomplete fixture');
      const before = structuredClone(prepared.participant.canonical.world);
      const command = prepareSheetEquipmentCommand(prepared.participant,
        `ad920000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`, operation, noDice);
      expect(prepared.participant.canonical.world).toEqual(before);
      const patch = command.request.participants[0].patch;
      character = {...character, ...patch, runtime_revision: Number(character.runtime_revision) + 1} as typeof character;
      return patch;
    };
    const equipped = await apply({equip: card.id}, 1);
    expect(equipped.max_resources?.[key]).toBe(amount);
    expect(equipped.resources?.[key]).toBe(amount);
    const slot = Object.keys(character.equipment ?? {}).find(key => character.equipment?.[key] === card.id)!;
    character.resources = {...character.resources, [key]: 0};
    const unequipped = await apply({unequip: slot}, 2);
    expect(unequipped.max_resources?.[key] ?? 0).toBe(0);
    expect(unequipped.resources?.[key] ?? 0).toBe(0);
    const reequipped = await apply({equip: card.id}, 3);
    expect(reequipped.max_resources?.[key]).toBe(amount);
    expect(reequipped.resources?.[key]).toBe(0);
    expect(initial.inventory_items.some(row => row.card_id === card.id)).toBe(true);
  });

  it.each([{key: 'draw_restore_alpha', amount: 3}, {key: 'draw_restore_beta', amount: 5}])(
    'makes $key capacity available before its declared draw restore and records a replayable transition', async ({key, amount}) => {
      const input = structuredClone(fixture), card = structuredClone(input.catalog.entities.card[0]);
      card.id = 'ad920000-0000-4000-8000-000000000010'; card.card_number = 'QA-draw-restore';
      card.type = 'ring'; card.slot = 'ring'; card.requires_attunement = false;
      card.mechanics = {activation: {mode: 'passive', while: 'equipped'}, effects: [{resolution: 'auto', result: [
        {kind: 'resource', op: 'grant', id: key, amount},
        {kind: 'triggered_effect', id: 'draw-restore', event: 'equipment_changed', subject: 'self',
          duration: {type: 'while_active'}, effects: [{resolution: 'auto', who: 'self', result: [
            {kind: 'resource', op: 'restore', id: key, restore_all: true},
          ]}]},
      ]}]};
      input.catalog.entities.card.push(card);
      input.character.turn_state = {};
      input.character.inventory_items = [...(input.character.inventory_items ?? []), {card_id: card.id, qty: 1}];
      input.character.resources = {...input.character.resources, [key]: 0};
      input.character.max_resources = {...input.character.max_resources, [key]: 0};
      const prepared = await prepareRoguelikeCombatParticipant(input.character, input.catalog, input.basicActionIds);
      expect(prepared.status).toBe('ready'); if (prepared.status !== 'ready') throw Error('Incomplete fixture');
      const {world, catalog} = prepared.participant.canonical;
      const command = {schemaVersion: 1 as const, type: 'ChangeEquipment' as const,
        commandId: 'draw-restore-once', expectedRevision: world.revision, rulesetContentHash: world.ruleset.contentHash,
        actorId: input.character.id, operation: {equip: card.id}};
      const env = {rng: () => {throw Error('No dice declared');}, nextId: () => 'draw-restore', clock: () => world.logicalClock + 1};
      const result = handleCommand(world, command, catalog, env);
      expect(result.status).toBe('accepted'); if (result.status !== 'accepted') throw Error('Equipment rejected');
      expect(result.nextState.actors[input.character.id].runtime.maxResources[key]).toBe(amount);
      expect(result.nextState.actors[input.character.id].runtime.resources[key]).toBe(amount);
      expect(foldEvents(world, result.events)).toEqual(result.nextState);
      const loaded = JSON.parse(JSON.stringify(result.nextState));
      expect(handleCommand(loaded, command, catalog, env).status).toBe('rejected');
      expect(loaded.actors[input.character.id].runtime.resources[key]).toBe(amount);
    },
  );
});
