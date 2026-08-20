import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import type { Action, Card, PassiveEffect } from '../types';
import type { Monster } from '../monsters/types';
import type { AssembledCharacter } from './assemble';
import { collectSheetCombatActionInventory } from './sheetCombatTargetRuntime';
import { projectRunnableSheetCanonicalActions } from './sheetCanonicalActionProjection';
import { buildSheetCanonicalRuntime } from './sheetCanonicalWorld';
import { createSoloCombatState, executeCombatAction } from '../solo-combat/engine';

const active = (cost = 'action', result: Record<string, unknown>[] = [{ kind: 'narrative' }]) => ({
  activation: { mode: 'active', cost: [{ resource: cost, amount: 1 }] },
  effects: [{ resolution: 'auto', result }],
});

describe('sheet -> combat action inventory adapter', () => {
  it('fails combat inventory construction when an owned mastery catalog cannot load', async () => {
    await expect(collectSheetCombatActionInventory({
      assembled: { effects: [] } as unknown as AssembledCharacter,
      character: { level: 1, turn_state: {} },
      runtime: {
        hp: { current: 10, max: 10, temp: 0 },
        resources: {}, maxResources: {}, activeEffects: [], equipment: {}, inventory: [],
      },
      cards: new Map(),
      requiresMasteryCatalog: true,
      loadMasteryCatalog: async () => { throw new Error('catalog offline'); },
    })).rejects.toThrow('catalog offline');
  });

  it('keeps item, container, species/class grants, granted effects, and mastery declarations', async () => {
    const item = {
      id: 'item:wand', card_number: 'ITEM-wand', name: 'Wand', type: 'item',
      mechanics: active('action', [{ kind: 'grant_effect', value: 'ward-effect' }]),
    } as unknown as Card;
    const content = {
      id: 'item:content', card_number: 'ITEM-content', name: 'Content', type: 'item',
    } as unknown as Card;
    const container = {
      id: 'item:container', card_number: 'ITEM-container', name: 'Container', type: 'item',
      container_mode: 'all', contents: [{ card_id: content.id, quantity: 1 }],
    } as unknown as Card;
    const species = {
      id: 'effect:species', card_number: 'EFFECT-species', name: 'Species feature',
      mechanics: active('bonus_action', [{ kind: 'grant_action', value: 'species-action' }]),
    } as unknown as PassiveEffect;
    const klass = {
      id: 'effect:class', card_number: 'EFFECT-class', name: 'Class feature',
      mechanics: active('reaction'),
    } as unknown as PassiveEffect;
    const granted = {
      id: 'action:species', card_number: 'ACTION-species', name: 'Granted species action',
      mechanics: active('bonus_action'),
    } as unknown as Action;
    const ward = {
      id: 'effect:ward', card_number: 'EFFECT-ward', name: 'Ward',
      mechanics: { activation: { mode: 'passive' } }, repeatable: false,
    } as unknown as PassiveEffect;
    const mastery = {
      id: 'effect:mastery', card_number: 'EFFECT-mastery', name: 'Mastery',
      type: 'Эффект мастерства',
      mechanics: { weapon_mastery: { type: 'sap', consume: 'next', expires: 'start_of_source_next_turn' } },
    } as unknown as PassiveEffect;
    const assembled = {
      actions: [], spells: [], pendingChoices: [], feats: [], resources: [], variables: {},
      effects: [
        { effect: species, origin: { kind: 'race', id: 'race:one', name: 'Species' } },
        { effect: klass, origin: { kind: 'class', id: 'class:one', name: 'Class' } },
      ],
    } as unknown as AssembledCharacter;
    const runtime = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      activeEffects: [], equipment: { main_hand: item.id },
      inventory: [{ cardId: container.id, qty: 1 }],
    } as RuntimeState;

    const inventory = await collectSheetCombatActionInventory({
      assembled,
      character: { level: 1, turn_state: {} },
      runtime,
      cards: new Map([item, container, content].map((card) => [card.id, card])),
      resolveAction: async (reference) => {
        expect(reference).toBe('species-action');
        return granted;
      },
      resolveEffect: async (reference) => {
        expect(reference).toBe('ward-effect');
        return ward;
      },
      masteryCatalog: [mastery],
    });

    expect(inventory.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `item-${item.id}`, group: 'item' }),
      expect.objectContaining({ id: `container-${container.id}`, group: 'item' }),
      expect.objectContaining({ id: species.id, group: 'race' }),
      expect.objectContaining({ id: klass.id, group: 'class' }),
      expect.objectContaining({ id: `granted-${granted.id}`, group: 'race' }),
    ]));
    expect(inventory.grantedEffects['ward-effect']).toMatchObject({
      name: ward.name, mechanics: ward.mechanics, repeatable: false,
    });
    expect(inventory.masteryEffects[mastery.id]?.mechanics).toEqual(mastery.mechanics);
    expect(inventory.masteryEffects[mastery.card_number]?.mechanics).toEqual(mastery.mechanics);

    const projected = projectRunnableSheetCanonicalActions({
      actions: inventory.actions,
      equipment: runtime.equipment,
      cards: new Map([item, container, content].map((card) => [card.id, card])),
    });
    expect(projected.issues.size).toBe(0);
    expect(projected.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `item-${item.id}` }),
      expect.objectContaining({ id: `container-${container.id}` }),
      expect.objectContaining({ id: species.id }),
      expect.objectContaining({ id: klass.id }),
      expect.objectContaining({ id: `granted-${granted.id}` }),
    ]));

    const character = {
      id: 'actor:inventory', name: 'Inventory hero', system_id: 'dnd5e-2024',
      ruleset_version: '2024', runtime_revision: 0, current_encounter_id: null,
      turn_state: {}, resolved_choices: {}, currency: { gold: 0, silver: 0, copper: 0 },
      resources: runtime.resources, max_resources: runtime.maxResources,
      initiative_bonus: 99,
    };
    const canonical = buildSheetCanonicalRuntime({
      character,
      assembled,
      ruleState: { appliedGrants: [] },
      sheetActions: projected.actions,
      runtime,
      characterContext: {
        level: 1, profBonus: 2,
        abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        skillProficiencies: [], skillExpertise: [], saveProficiencies: [],
        baseSpeed: 30, characterSpeed: 30,
      },
      grantedEffects: inventory.grantedEffects,
      masteryEffects: inventory.masteryEffects,
      cards: [item, container, content],
      ac: 10,
    });
    const canonicalIds = projected.actions.flatMap((action) => (
      canonical.actionsFor?.(action).map((candidate) => candidate.id) ?? []
    ));
    expect(canonical.actions.map(({ id }) => id)).toEqual(expect.arrayContaining(canonicalIds));
    expect(canonical.actions.find(({ id }) => id === `container-${container.id}`)?.targeting)
      .toMatchObject({ minTargets: 0, maxTargets: 0, allowedRelations: [] });

    const monsterAction = {
      id: 'action:test-monster', card_number: 'ACTION-test-monster', name: 'Claw',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        targeting: {
          shape: 'single', domain: 'actor', actor_targets: true,
          min_targets: 1, max_targets: 1, range_ft: 5,
          requires_line_of_sight: true, allowed_relations: ['enemy'],
        },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'str', vs: 'ac',
          on_hit: [{ kind: 'damage', dice: '1d4', ability: 'str', type: 'slashing' }],
        }],
      },
    } as unknown as Action;
    const monster = {
      id: 'monster:test', slug: 'test-monster', name: 'Test monster', description: '',
      size: 'medium', creature_type: 'beast', alignment: '', challenge_rating: '0',
      armor_class: 10, max_hp: 5, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      action_ids: [monsterAction.id], effect_ids: [], ai: { strategy: 'melee_chase' },
      token_url: '', source: 'test', created_at: '', updated_at: '',
    } as Monster;
    const combat = await createSoloCombatState({
      character: character as never,
      participant: { character: character as never, canonical },
      selected: [{ monster, quantity: 1 }],
      actions: [monsterAction], effects: [], rng: () => 0.5,
    });
    expect(combat.playerActionIds).toEqual(expect.arrayContaining(canonicalIds));
    const unpacked = executeCombatAction({
      state: combat,
      actorId: character.id,
      actionId: `container-${container.id}`,
      targetIds: [],
      rng: () => 0.5,
    });
    expect(unpacked.world.actors[character.id].runtime.inventory).not.toContainEqual(
      expect.objectContaining({ cardId: container.id }),
    );
    expect(unpacked.world.actors[character.id].runtime.inventory).toContainEqual(
      expect.objectContaining({ cardId: content.id, qty: 1 }),
    );
  });
});
