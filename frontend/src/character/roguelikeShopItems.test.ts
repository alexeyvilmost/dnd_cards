import {describe, expect, it} from 'vitest';
import catalog from '../../../backend/roguelikecontent/shop_items.json';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
import type {AssembledCharacter} from './assemble';
import type {ForgeCharacter} from './types';
import type {Card} from '../types';
import {breakdownValue} from '../engine/breakdown';
import {collectModifiers} from '../engine/modifiers';
import {applyIncomingDamage, executeAction} from '../engine/execute';
import {bindSelfItemCost} from '../engine/cost';
import {weaponAttackPreview} from '../engine/weapon';
import {MECH_WEAPON_ATTACK} from '../mvp/fixtures';

type Entry = typeof catalog.entries[number];
const entries = catalog.entries;
const entry = (suffix: string) => entries.find(item => item.card_number === `RL-SHOP-${suffix}`)!;
async function load(item: Entry, enabled = true) {
  const card = {...item.source, ...item, mechanics: item.mechanics} as unknown as Card;
  const assembled = {race: {id: 'race', name: 'Human', speed: 30}, klass: null, subclass: null,
    background: null, feats: [], effects: [], actions: [], spells: [], pendingChoices: [],
    featAbilityIncreases: [], derived: {}} as unknown as AssembledCharacter;
  const slot = card.type === 'weapon' ? 'main_hand' : card.type === 'shield' || card.defense_type === 'shield' ? 'off_hand' : 'body';
  const character = {id: 'hero', name: 'Hero', user_id: 'qa', access_mode: 'owner', system_id: 'dnd5e-2024',
    ruleset_version: '2024', level: 4, race_id: 'race', abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10},
    runtime_revision: 0, current_hp: 1, max_hp: 100, resources: {action: 1, bonus_action: 1, reaction: 1},
    max_resources: {action: 1, bonus_action: 1, reaction: 1}, active_effects: [], resolved_choices: {},
    equipment: enabled ? {[slot]: card.id} : {}, inventory_items: [{card_id: card.id, qty: 2}],
    turn_state: enabled ? {attuned_ids: [card.id]} : {}} as unknown as ForgeCharacter;
  const factory = createSheetCombatRuntime({loadAssembly: async () => assembled,
    cardsApi: {getCard: async () => card}, actionsApi: {getAction: async () => {throw Error('unexpected action');}},
    effectsApi: {getEffect: async () => {throw Error('unexpected effect');}}, loadMasteryEffectsStrict: async () => []});
  const result = await factory.loadSheetCombatParticipant({character, cards: new Map([[card.id, card]])});
  const actor = result.canonical.world.actors.hero;
  return {card, ...actor, passives: actor.passives ?? []};
}

describe('merchant catalog through the real sheet/combat loader', () => {
  it.each(entries)('$card_number loads and round-trips without losing mechanics', async item => {
    const actor = await load(item);
    expect(JSON.parse(JSON.stringify(actor))).toEqual(actor);
    if ('effects' in item.mechanics && item.kind !== 'consumable') {
      expect(actor.passives.filter(p => p.id === item.id)).toHaveLength(1);
      const inactive = await load(item, false);
      expect(inactive.passives.filter(p => p.id === item.id)).toHaveLength(0);
    }
  });

  it.each([
    ['0106', 'save:con', 4], ['0106', 'skill:athletics', 4], ['0609', 'speed', 35],
    ['0357', 'save:dex', 5], ['0357', 'save:wis', -3], ['0358', 'save:wis', 3], ['0358', 'save:dex', -1],
    ['0650', 'skill:performance', 1], ['0650', 'skill:persuasion', 1],
    ['0347', 'ac', 15], ['0348', 'ac', 16], ['0349', 'ac', 17],
    ['0548', 'ac', 13], ['0548', 'save:con', 3], ['0624', 'ac', 13], ['0624', 'save:int', 1],
    ['0370', 'skill:arcana', 1], ['0112', 'save:str', 4], ['0112', 'skill:persuasion', 2],
    ['0112', 'skill:deception', 0], ['0764', 'save:wis', 2],
  ] as const)('%s %s = %i, once only', async (number, stat, value) => {
    const actor = await load(entry(number));
    expect(breakdownValue(stat, actor.character, actor.runtime, actor.passives).value).toBe(value);
  });

  it.each([
    ['0476', 'saving_throw', 'dex', 'advantage'], ['0476', 'saving_throw', 'str', 'none'],
    ['0633', 'initiative', 'dex', 'advantage'], ['0633', 'saving_throw', 'dex', 'none'],
    ['0668', 'saving_throw', 'int', 'advantage'], ['0668', 'saving_throw', 'wis', 'advantage'],
    ['0668', 'saving_throw', 'cha', 'advantage'], ['0668', 'saving_throw', 'con', 'none'],
  ])('%s advantage applies only to %s/%s', async (number, roll, ability, advantage) => {
    const actor = await load(entry(number));
    expect(collectModifiers(actor.runtime, actor.passives, {roll, filter: {ability}}).advantage).toBe(advantage);
  });

  it('shadow ring halves necrotic damage, not other damage', async () => {
    const actor = await load(entry('0370'));
    for (const [damageType, damage] of [['necrotic', 5], ['fire', 11]] as const) {
      const result = applyIncomingDamage({...actor.runtime, hp: {current: 100, max: 100, temp: 0}}, 11,
        {character: actor.character, passives: actor.passives, rng: () => .5}, {damageType});
      expect(result.state.hp.current).toBe(100 - damage);
    }
  });

  it.each([['0840', 16], ['0841', 32], ['0842', 50]] as const)('%s heals and spends one bottle and bonus action', async (number, healing) => {
    const actor = await load(entry(number));
    const mech = bindSelfItemCost(actor.card.mechanics!, actor.card.id);
    const result = executeAction(actor.runtime, mech, {character: actor.character, passives: actor.passives, rng: () => .5});
    expect(result.state.hp.current).toBe(1 + healing);
    expect(result.state.resources.bonus_action).toBe(0);
    expect(result.state.inventory.find(row => row.cardId === actor.card.id)?.qty).toBe(1);
    expect(() => executeAction({...actor.runtime, inventory: [], equipment: {}}, mech,
      {character: actor.character, rng: () => .5})).toThrow();
  });

  it.each(['0851', '0182'])('%s enchantment affects both actual weapon attack and preview', async number => {
    const actor = await load(entry(number));
    const context = {...actor.character, weaponProficiencies: ['martial']};
    const preview = weaponAttackPreview(MECH_WEAPON_ATTACK, context, actor.runtime.equipment, actor.runtime, actor.passives)!;
    const result = executeAction(actor.runtime, MECH_WEAPON_ATTACK,
      {character: context, passives: actor.passives, target: {ac: 1}, rng: () => .5});
    expect(preview.damages[0].bonus).toBe(4);
    expect(result.events).toContainEqual(expect.objectContaining({type: 'roll', roll: expect.objectContaining({total: 11 + preview.attack})}));
    // A free off hand automatically uses the longsword's versatile d10 grip.
    expect(result.events).toContainEqual(expect.objectContaining({type: 'damage', amount: number === '0851' ? 10 : 12}));
  });

  it('wraps add +1 to real unarmed attack/damage and their preview, not weapon attacks', async () => {
    const actor = await load(entry('0134'));
    const unarmed = {activation: {cost: [{resource: 'action'}]}, effects: [{resolution: 'attack_roll',
      attack_kind: 'unarmed', ability: 'str', vs: 'ac', on_hit: [{kind: 'damage', amount: '1 + str', type: 'bludgeoning'}]}]};
    const preview = weaponAttackPreview(unarmed, actor.character, actor.runtime.equipment, actor.runtime, actor.passives)!;
    expect(preview.attack).toBe(6); expect(preview.damages[0].bonus).toBe(4);
    const result = executeAction(actor.runtime, unarmed, {character: actor.character, passives: actor.passives, target: {ac: 1}, rng: () => .5});
    expect(result.events).toContainEqual(expect.objectContaining({type: 'roll', roll: expect.objectContaining({total: 17})}));
    expect(result.events).toContainEqual(expect.objectContaining({type: 'damage', amount: 5}));
    expect(collectModifiers(actor.runtime, actor.passives, {roll: 'attack', filter: {attackKind: 'weapon'}}).modifiers).toHaveLength(0);
  });
});
