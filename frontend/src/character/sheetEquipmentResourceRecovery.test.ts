import { describe, expect, it } from 'vitest';
import type { Card, CharacterClass, PassiveEffect } from '../types';
import type { AssembledCharacter } from './assemble';
import { createSheetCombatRuntime } from './sheetCombatRuntimeFactory';
import { prepareSheetEquipmentCommand } from './sheetEquipmentCommand';
import type { ForgeCharacter } from './types';
import { migrateWorldState } from '../rules-core/worldMigration';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const commandId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ring = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  card_number: 'CARD-TEST-RING', name: 'Test ring', type: 'ring', mechanics: {},
} as Card;
const recovery = {
  short_rest: { mode: 'fixed', amount: 1 }, long_rest: { mode: 'full' },
};

function fixture(input: {
  level: number;
  classNumber: string;
  resource: string;
  unlockLevel: number;
  savedCurrent?: number;
  savedMaximum?: number;
  extraClassResources?: Record<string, unknown>;
  extraSavedResources?: Record<string, number>;
  extraSavedMaximums?: Record<string, number>;
  extraResourceGrant?: string;
}) {
  const klass = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    card_number: input.classNumber, name: 'Test class', hit_die: 'd10',
    resources: {
      ...(input.classNumber === 'CLASS-paladin' ? {
        spell_slot_1: { by_level: { 1: 2, 3: 3 }, per: 'long_rest' },
      } : {}),
      ...input.extraClassResources,
      [input.resource]: {
        by_level: { [input.unlockLevel]: 2 },
        per: 'short_rest',
        recovery,
      },
    },
  } as unknown as CharacterClass;
  const assembled = {
    race: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Human', speed: 30 },
    klass, subclass: null, background: null, feats: [], effects: input.extraResourceGrant ? [{
      effect: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', card_number: 'EFF-RESOURCE-GRANT',
        name: 'Independent resource source',
        mechanics: { effects: [{ resolution: 'auto', result: [{
          kind: 'resource', op: 'grant', id: input.extraResourceGrant, amount: 1,
        }] }] },
      },
      origin: { kind: 'class', id: klass.id, name: klass.name },
    }] : [], actions: [],
    spells: [], resources: [], pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
  const resources = { action: 1, bonus_action: 1, reaction: 1, hit_dice_d10: input.level,
    ...(input.classNumber === 'CLASS-paladin' ? { spell_slot_1: input.level >= 3 ? 3 : 2 } : {}),
    ...input.extraSavedResources,
    ...(input.savedCurrent === undefined ? {} : { [input.resource]: input.savedCurrent }) };
  const maximums = { action: 1, bonus_action: 1, reaction: 1, hit_dice_d10: input.level,
    ...(input.classNumber === 'CLASS-paladin' ? { spell_slot_1: input.level >= 3 ? 3 : 2 } : {}),
    ...input.extraSavedMaximums,
    ...(input.savedMaximum === undefined ? {} : { [input.resource]: input.savedMaximum }) };
  const character = {
    id: actorId, name: 'Equipment regression', user_id: actorId, access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', level: input.level,
    class_id: klass.id, race_id: assembled.race!.id,
    abilities: { str: 15, dex: 12, con: 12, int: 10, wis: 12, cha: 14 },
    runtime_revision: 7, current_hp: 10, max_hp: 10,
    resources, max_resources: maximums, active_effects: [], resolved_choices: {},
    equipment: {}, inventory_items: [{ card_id: ring.id, qty: 1 }], turn_state: {},
  } as unknown as ForgeCharacter;
  const factory = createSheetCombatRuntime({
    loadAssembly: async () => assembled,
    cardsApi: { getCard: async () => ring },
    actionsApi: { getAction: async () => { throw new Error('Unexpected action load'); } },
    effectsApi: { getEffect: async () => { throw new Error('Unexpected effect load'); } },
    loadMasteryEffectsStrict: async () => [] as PassiveEffect[],
  });
  return { character, factory };
}

describe('sheet equipment with level-gated resource recovery', () => {
  it.each([
    ['CLASS-paladin', 'channel_divinity', 3],
    ['CLASS-druid', 'wild_shape', 2],
  ])('equips at level 1 before %s unlocks %s', async (classNumber, resource, unlockLevel) => {
    const { character, factory } = fixture({ level: 1, classNumber, resource, unlockLevel });
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map([[ring.id, ring]]) });
    const actor = participant.canonical.world.actors[actorId];
    expect(actor.character.resourceRecovery?.[resource]).toBeUndefined();
    expect(actor.runtime.maxResources[resource]).toBeUndefined();
    if (classNumber === 'CLASS-paladin') expect(actor.runtime.maxResources.spell_slot_1).toBe(2);

    const prepared = prepareSheetEquipmentCommand(participant, commandId, { equip: ring.id }, () => 0.5);
    const patch = prepared.request.participants[0].patch;
    expect(Object.values(patch.equipment ?? {})).toContain(ring.id);
    expect(patch.inventory_items).toEqual([]);
    expect(patch.resources?.[resource]).toBeUndefined();
    expect(patch.max_resources?.[resource]).toBeUndefined();
    expect(patch.resources?.action).toBe(1);
  });

  it('keeps spent charges in the atomic equipment patch for an active resource', async () => {
    const { character, factory } = fixture({ level: 3, classNumber: 'CLASS-paladin',
      resource: 'channel_divinity', unlockLevel: 3, savedCurrent: 1, savedMaximum: 2 });
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map([[ring.id, ring]]) });
    expect(participant.canonical.world.actors[actorId].character.resourceRecovery?.channel_divinity).toEqual(recovery);
    const prepared = prepareSheetEquipmentCommand(participant, commandId, { equip: ring.id }, () => 0.5);
    expect(prepared.request.participants[0].patch.resources?.channel_divinity).toBe(1);
    expect(prepared.request.participants[0].patch.max_resources?.channel_divinity).toBe(2);
  });

  it('initializes an unlocked resource that was not yet stored in the saved runtime', async () => {
    const { character, factory } = fixture({ level: 3, classNumber: 'CLASS-druid',
      resource: 'wild_shape', unlockLevel: 2 });
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map([[ring.id, ring]]) });
    const prepared = prepareSheetEquipmentCommand(participant, commandId, { equip: ring.id }, () => 0.5);
    expect(prepared.request.participants[0].patch.resources?.wild_shape).toBe(2);
    expect(prepared.request.participants[0].patch.max_resources?.wild_shape).toBe(2);
  });

  it('retires saved charges from a class slot tier that vanished at level-up', async () => {
    const { character, factory } = fixture({ level: 3, classNumber: 'CLASS-warlock',
      resource: 'spell_slot_2', unlockLevel: 3,
      extraClassResources: { spell_slot_1: { by_level: { 1: 1, 2: 2, 3: 0 }, per: 'short_rest' } },
      extraSavedResources: { spell_slot_1: 1 }, extraSavedMaximums: { spell_slot_1: 2 },
    });
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map([[ring.id, ring]]) });
    const prepared = prepareSheetEquipmentCommand(participant, commandId, { equip: ring.id }, () => 0.5);
    expect(prepared.request.participants[0].patch.resources?.spell_slot_1).toBeUndefined();
    expect(prepared.request.participants[0].patch.max_resources?.spell_slot_1).toBeUndefined();
    expect(prepared.request.participants[0].patch.resources?.spell_slot_2).toBe(2);
    expect(participant.canonical.world.actors[actorId].character.resourceRecharge?.spell_slot_1).toBeUndefined();
  });

  it('keeps a retired class key when another declared source still grants that resource', async () => {
    const { character, factory } = fixture({ level: 3, classNumber: 'CLASS-warlock',
      resource: 'spell_slot_2', unlockLevel: 3,
      extraClassResources: { spell_slot_1: { by_level: { 1: 1, 2: 2, 3: 0 }, per: 'short_rest' } },
      extraSavedResources: { spell_slot_1: 1 }, extraSavedMaximums: { spell_slot_1: 2 },
      extraResourceGrant: 'spell_slot_1',
    });
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map([[ring.id, ring]]) });
    const prepared = prepareSheetEquipmentCommand(participant, commandId, { equip: ring.id }, () => 0.5);
    expect(prepared.request.participants[0].patch.resources?.spell_slot_1).toBe(1);
    expect(prepared.request.participants[0].patch.max_resources?.spell_slot_1).toBe(1);
    expect(participant.canonical.world.actors[actorId].character.resourceRecharge?.spell_slot_1).toBeUndefined();
  });

  it('still rejects recovery that has no matching pool and malformed active recovery', async () => {
    const { character, factory } = fixture({ level: 3, classNumber: 'CLASS-paladin',
      resource: 'channel_divinity', unlockLevel: 3, savedCurrent: 2, savedMaximum: 2 });
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map([[ring.id, ring]]) });
    const orphan = structuredClone(participant.canonical.world);
    delete orphan.actors[actorId].runtime.resources.channel_divinity;
    expect(() => migrateWorldState(orphan)).toThrow(/resourceRecovery\.channel_divinity.*resource and maximum/);
    const malformed = structuredClone(participant.canonical.world);
    (malformed.actors[actorId].character.resourceRecovery as Record<string, unknown>).channel_divinity =
      { short_rest: { mode: 'full' }, long_rest: { mode: 'full' } };
    expect(() => migrateWorldState(malformed)).toThrow(/resourceRecovery\.channel_divinity/);
  });
});
