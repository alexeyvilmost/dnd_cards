import {describe, expect, it} from 'vitest';
import {createSheetCombatRuntime} from './sheetCombatRuntimeFactory';
import type {AssembledCharacter} from './assemble';
import type {ForgeCharacter} from './types';
import type {Card} from '../types';
import {InMemoryRulesSession} from '../rules-core/session';
import {createLogicalClock, createSequentialIdFactory, createStrictRngTape} from '../rules-core/determinism';

const armor = {id: 'test-armor', card_number: 'TEST-armor', name: 'Armor', type: 'armor',
  mechanics: {armor_profile: {category: 'heavy', ac_formula: '16', training_required: true,
    stealth_disadvantage: true, strength_requirement: 13}, activation: {mode: 'passive', while: 'equipped'},
    effects: [{resolution: 'auto', result: [{kind: 'modifier', op: 'disadvantage',
      applies_to: {roll: 'ability_check', filter: {skill: 'stealth'}}}]}]}} as unknown as Card;

describe('sheet item passives survive combat initialization', () => {
  it.each(['equipped', 'carried', 'unattuned', 'attuned', 'active'] as const)('respects the %s item gate without duplicating inventory and equipment', async mode => {
    const card = structuredClone(armor);
    card.requires_attunement = mode === 'unattuned' || mode === 'attuned';
    if (mode === 'active') (card.mechanics!.activation as Record<string, unknown>).mode = 'active';
    const assembled = {race: {id: 'race', name: 'Human', speed: 30}, klass: null, subclass: null,
      background: null, feats: [], effects: [], actions: [], spells: [], pendingChoices: [],
      featAbilityIncreases: [], derived: {}} as unknown as AssembledCharacter;
    const character = {id: 'hero', name: 'Hero', user_id: 'qa', access_mode: 'owner', system_id: 'dnd5e-2024',
      ruleset_version: '2024', level: 1, race_id: 'race', abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10},
      runtime_revision: 0, current_hp: 10, max_hp: 10, resources: {action: 1, bonus_action: 1, reaction: 1},
      max_resources: {action: 1, bonus_action: 1, reaction: 1}, active_effects: [], resolved_choices: {},
      equipment: mode === 'carried' ? {} : {body: card.id}, inventory_items: [{card_id: card.id, qty: 1}],
      turn_state: mode === 'attuned' ? {attuned_ids: [card.id]} : {}} as unknown as ForgeCharacter;
    const factory = createSheetCombatRuntime({loadAssembly: async () => assembled,
      cardsApi: {getCard: async () => card}, actionsApi: {getAction: async () => {throw Error('unexpected action');}},
      effectsApi: {getEffect: async () => {throw Error('unexpected effect');}}, loadMasteryEffectsStrict: async () => []});
    const participant = await factory.loadSheetCombatParticipant({character, cards: new Map([[card.id, card]])});
    const canonical = participant.canonical;
    const enabled = mode === 'equipped' || mode === 'attuned';
    const tape = createStrictRngTape(enabled ? [{label: 'first d20', sides: 20, value: 18}, {label: 'disadvantage d20', sides: 20, value: 3}]
      : [{label: 'first d20', sides: 20, value: 18}]);
    const world = structuredClone(canonical.world);
    // Armor training is irrelevant to this item-specific test: isolate its
    // Stealth modifier from the separate untrained-armor penalty.
    world.actors.hero.passives = (world.actors.hero.passives ?? []).filter(mechanics => mechanics.id === card.id);
    expect(world.actors.hero.passives).toHaveLength(mode === 'carried' || mode === 'unattuned' || mode === 'active' ? 0 : 1);
    const session = new InMemoryRulesSession(world, canonical.catalog, {rng: tape.rng,
      clock: createLogicalClock(), nextId: createSequentialIdFactory('item-hide')});
    const result = session.dispatch({schemaVersion: 1, type: 'AttemptHide', commandId: 'hide', expectedRevision: world.revision,
      rulesetContentHash: world.ruleset.contentHash, actorId: 'hero',
      eligibility: {factsSource: 'scenario', boardRevision: 0, heavilyObscured: true, cover: 'none', visibleToAnyEnemy: false}});
    expect(result.status).toBe('accepted'); tape.assertExhausted();
    const rolls = result.status === 'accepted' ? result.events.flatMap(event => event.payload.type === 'EngineEventRecorded'
      && event.payload.event.type === 'roll' ? [event.payload.event.roll] : []) : [];
    expect(rolls).toEqual([expect.objectContaining({advantage: enabled ? 'disadvantage' : 'none',
      outcome: enabled ? 'fail' : 'success'})]);
  });
});
