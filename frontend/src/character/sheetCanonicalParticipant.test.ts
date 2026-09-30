import {describe, expect, it} from 'vitest';
import type {Action, Card, Spell} from '../types';
import type {AssembledCharacter} from './assemble';
import type {ForgeCharacter} from './types';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
import {actorPassiveToggles} from './actorPassiveToggles';

function fixture() {
  const parents = [0, 1].map(index => ({
    id: `spell-parent-${index}`, card_number: `SPELL-PARENT-${index}`, name: `Parent ${index}`, level: 1,
    mechanics: {
      spell_class_list_ids: ['CLASS-wizard'],
      activation: {mode: 'active', cast_time: {unit: 'action', amount: 1},
        cost: [{resource: 'action', amount: 1}, {resource: 'spell_slot', level: 1, amount: 1}]},
      targeting: {target: 'self', range: {distance: 0, unit: 'ft'}},
      spell_variant_ids: [`spell-child-${index}`],
      effects: [{resolution: 'auto', result: [{kind: 'healing', amount: index + 1}]}],
    },
  })) as unknown as Spell[];
  const children = parents.map((parent, index) => ({
    ...parent, id: `spell-child-${index}`, card_number: `SPELL-CHILD-${index}`, name: `Choice ${index}`,
    mechanics: {...parent.mechanics, spell_variant_ids: undefined, variant_of_spell_id: parent.id,
      effects: [{resolution: 'auto', result: [{kind: 'healing', amount: index + 3}]}]},
  })) as Spell[];
  const basic = {id: 'basic-parent', card_number: 'ACTION-PARENT', name: 'Basic choice', type: 'basic',
    mechanics: {activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
      targeting: {target: 'self', range: {distance: 0, unit: 'ft'}},
      effects: [{resolution: 'auto', result: [{kind: 'healing', amount: 1}]}],
      action_variant_ids: ['basic-child']}} as unknown as Action;
  const basicChild = {...basic, id: 'basic-child', card_number: 'ACTION-CHILD', name: 'Basic chosen effect',
    mechanics: {...basic.mechanics, action_variant_ids: undefined, variant_of_action_id: basic.id,
      effects: [{resolution: 'auto', result: [{kind: 'healing', amount: 4}]}]}} as Action;
  const items = parents.map((parent, index) => ({
    id: `item-${index}`, card_number: `ITEM-${index}`, name: `Item ${index}`, type: 'ring',
    mechanics: {activation: {mode: 'passive', while: 'equipped'}, effects: [{resolution: 'auto', result: [{
      kind: 'grant_spell', value: parent.id, ability: index ? 'wis' : 'cha',
      freeuse: {count: index + 1, recharge: 'long_rest'},
    }]}]},
  })) as unknown as Card[];
  const assembled = {race: {id: 'race', name: 'Race', speed: 30}, klass: null, background: null,
    feats: [], effects: [], actions: [], spells: [], resources: [], pendingChoices: [],
    featAbilityIncreases: [], derived: {}} as unknown as AssembledCharacter;
  const character = {
    id: 'hero', name: 'Presentation', user_id: 'owner', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 4, level: 1,
    abilities: {str: 12, dex: 12, con: 12, int: 12, wis: 16, cha: 14},
    current_hp: 8, max_hp: 10, resources: {action: 1, bonus_action: 1, reaction: 1},
    max_resources: {action: 1, bonus_action: 1, reaction: 1},
    equipment: {ring_left: items[0].id, ring_right: items[1].id},
    inventory_items: [], active_effects: [], resolved_choices: {}, turn_state: {},
  } as unknown as ForgeCharacter;
  const factory = createSheetCombatRuntime({
    loadAssembly: async () => assembled,
    cardsApi: {getCard: async id => items.find(item => item.id === id)!},
    spellsApi: {getSpell: async reference => {
      const spell = [...parents, ...children].find(row => row.id === reference || row.card_number === reference);
      if (!spell) throw new Error(`Missing spell ${reference}`);
      return spell;
    }},
    actionsApi: {getAction: async id => {
      if (id !== basicChild.id) throw new Error(`Unexpected action load ${id}`);
      return basicChild;
    }},
    effectsApi: {getEffect: async () => {throw new Error('Unexpected effect load');}},
    loadMasteryEffectsStrict: async () => [],
  });
  return {factory, character, children, basicActions: [basic], basicChild};
}

describe('complete canonical sheet presentation', () => {
  it('hydrates both distinct variant families and derives passives from the same world as combat', async () => {
    const {factory, character, children, basicActions, basicChild} = fixture();
    const before = structuredClone(character);
    const input = {character, cards: new Map<string, Card>(), basicActions};
    const displayed = await factory.loadSheetCanonicalParticipant(input);
    const combat = await factory.loadSheetCombatParticipant(input);
    expect(displayed.canonical.world).toEqual(combat.canonical.world);
    for (const child of children) {
      const action = displayed.canonical.actions.find(row => row.sourceEntityIds[0] === child.id);
      expect(action).toBeDefined();
      expect(displayed.actionPresentation?.[action!.id]?.spellRef?.id).toBe(child.id);
      expect(displayed.canonical.world.actors.hero.capabilities.actionIds).not.toContain(action!.id);
    }
    const actionVariant = displayed.canonical.actions.find(row => row.sourceEntityIds[0] === basicChild.id);
    expect(actionVariant).toBeDefined();
    expect(displayed.actionPresentation?.[actionVariant!.id]?.actionRef?.id).toBe(basicChild.id);
    expect(displayed.canonical.world.actors.hero.capabilities.actionIds).not.toContain(actionVariant!.id);
    expect(actorPassiveToggles(displayed.canonical.world.actors.hero, displayed.canonical.actions,
      displayed.actionPresentation).length).toBeGreaterThan(0);
    expect(character).toEqual(before);
  });

  it.each(['read-only', 'encounter-linked'])('allows %s presentation while preserving combat entry restrictions', async mode => {
    const {factory, character} = fixture();
    if (mode === 'read-only') character.access_mode = 'legacy_public_readonly';
    else character.current_encounter_id = 'existing-encounter';
    const before = structuredClone(character);
    const input = {character, cards: new Map<string, Card>()};
    await expect(factory.loadSheetCanonicalParticipant(input)).resolves.toHaveProperty('canonical.world.actors.hero');
    await expect(factory.loadSheetCombatParticipant(input)).rejects.toThrow(mode === 'read-only'
      ? 'только для чтения' : 'уже связан с онлайн-боем');
    expect(character).toEqual(before);
  });
});
