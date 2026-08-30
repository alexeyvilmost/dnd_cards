import { describe, expect, it } from 'vitest';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import { createWorld, type ActorState, type RuleActionDefinition, type RulesCatalog, type RulesetReference } from '../rules-core/domain';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { Action } from '../types';
import type { Monster } from '../monsters/types';
import { advanceTurn, autoResolveSystemDecisions, createSoloCombatState, executeCombatAction, moveActor, refreshSoloCombatResources, resolvePlayerReaction, resolveTriggeredCombatAction, runMonsterTurn, setSoloCombatInitiativeTotals } from './engine';
import { readSoloCombatState, writeSoloCombatState } from './persistence';
import { gridDistanceFt } from './tacticalGrid';
import { SOLO_COMBAT_KEY } from './types';

const fixture = compiledFixtureJson as unknown as {
  source: { ruleset: RulesetReference };
  roots: {
    magicInitiateFighter: { actor: ActorState; actions: RuleActionDefinition[] };
    wizard: { actor: ActorState; actions: RuleActionDefinition[] };
  };
};

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function primitive(action: RuleActionDefinition): string {
  return String((action.mechanics.primitive as Record<string, unknown> | undefined)?.type ?? '');
}

function activeId(state: { world: { scene: import('../rules-core/domain').SceneState } }): string {
  if (state.world.scene.mode !== 'encounter') throw new Error('expected encounter scene');
  return state.world.scene.initiative[state.world.scene.activeIndex];
}

function fighterSeed(): SheetCombatParticipantSeed {
  const actor = clone(fixture.roots.magicInitiateFighter.actor);
  const actions = clone(fixture.roots.magicInitiateFighter.actions);
  const cantrip: RuleActionDefinition = {
    id: 'd1000000-0000-4000-8000-000000000001',
    name: 'Волшебная рука',
    kind: 'spell',
    spell: { level: 0 },
    sourceEntityIds: ['test-feat', 'SPELL-0173'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 30, requires_line_of_sight: true, allowed_relations: ['enemy'] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Канонический data-driven заговор.' }] }],
    },
    targeting: { minTargets: 1, maxTargets: 1, rangeFt: 30, requiresLineOfSight: true, allowedRelations: ['enemy'] },
  };
  actions.push(cantrip);
  actor.capabilities.actionIds.push(cantrip.id);
  actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
  actor.spellcastingAccess.grants.push({
    grantId: 'test-cantrip-grant', actionId: cantrip.id, sourceId: 'test-feat',
    access: 'cantrip', level: 0, spellcastingAbility: 'int',
  });
  const byId = new Map(actions.map((action) => [action.id, action]));
  const catalog: RulesCatalog = { getAction: (id) => byId.get(id), listActions: () => actions };
  const canonical: SheetCanonicalRuntime = {
    actorId: actor.id,
    world: createWorld({ id: `solo-test:${actor.id}`, ruleset: fixture.source.ruleset, actors: [actor] }),
    actions,
    catalog,
    cards: [],
    resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
  const character = {
    id: actor.id, name: actor.name, user_id: 'solo-test-user', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 0,
    current_hp: actor.runtime.hp.current, max_hp: actor.runtime.hp.max,
    resources: clone(actor.runtime.resources), max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects), turn_state: {},
    initiative_bonus: 9, speed: actor.character.characterSpeed ?? 30,
  } as unknown as ForgeCharacter;
  return { character, canonical };
}

function wizardSeed(): SheetCombatParticipantSeed {
  const actor = clone(fixture.roots.wizard.actor);
  const actions = clone(fixture.roots.wizard.actions);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const canonical: SheetCanonicalRuntime = {
    actorId: actor.id,
    world: createWorld({ id: `solo-test:${actor.id}`, ruleset: fixture.source.ruleset, actors: [actor] }),
    actions,
    catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    cards: [], resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
  const character = {
    id: actor.id, name: actor.name, user_id: 'solo-test-user', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 0,
    current_hp: actor.runtime.hp.current, max_hp: actor.runtime.hp.max,
    resources: clone(actor.runtime.resources), max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects), turn_state: {},
    initiative_bonus: 9, speed: actor.character.characterSpeed ?? 30,
  } as unknown as ForgeCharacter;
  return { character, canonical };
}

function scimitar(): Action {
  return {
    id: 'b1000000-0000-4000-8000-000000000001', name: 'Скимитар', description: '',
    rarity: 'common', card_number: 'MONSTER-ACTION-GOBLIN-SCIMITAR', resource: 'action',
    action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
    mechanics: {
      interaction: { intent: 'harmful' },
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
      effects: [{ resolution: 'attack_roll', ability: 'dex', attack_kind: 'weapon_melee', vs: 'ac', on_hit: [{ kind: 'damage', dice: '1d6', ability: 'dex', type: 'slashing' }] }],
    },
  } as Action;
}

function stoneEndurance(): RuleActionDefinition {
  return {
    id: 'd3000000-0000-4000-8000-000000000001',
    name: 'Каменная стойкость',
    kind: 'nonSpell',
    sourceEntityIds: ['ACT-goliath-stone', 'RACE-0011-stone'],
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: ['self'],
    },
    mechanics: {
      activation: {
        mode: 'reaction',
        trigger: { event: 'damage_taken', timing: 'before' },
        cost: [{ resource: 'reaction', amount: 1 }, { resource: 'giant_legacy', amount: 1 }],
      },
      effects: [{
        resolution: 'auto',
        result: [{ kind: 'reduce_damage', amount: '1d12+con' }],
      }],
    },
  };
}

function basicAction(cardNumber: string, name: string, mechanics: Record<string, unknown>): Action {
  return {
    id: cardNumber === 'action_basic_dash'
      ? 'a1000000-0000-4000-8000-000000000001'
      : 'a1000000-0000-4000-8000-000000000002',
    name, description: '', rarity: 'common', card_number: cardNumber,
    resource: 'action', action_type: 'base_action', type: 'basic',
    mechanics, created_at: '', updated_at: '',
  } as Action;
}

const dash = () => basicAction('action_basic_dash', 'Рывок', {
  activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
  effects: [{ resolution: 'auto', result: [{ kind: 'narrative' }] }],
  targeting: { domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1, range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'] },
});

const disengage = () => basicAction('action_basic_disengage', 'Отход', {
  activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
  effects: [{ resolution: 'auto', result: [{
    kind: 'modifier', op: 'deny',
    applies_to: { interaction: 'opportunity_attack', trigger: 'self_movement' },
    duration: { type: 'until_start_of_next_turn' }, stack_id: 'basic-action:disengage',
  }] }],
  targeting: { domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1, range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'] },
});

function speedModifierAction(value: number): RuleActionDefinition {
  return {
    id: 'd4000000-0000-4000-8000-000000000001',
    name: 'Большая форма',
    kind: 'nonSpell',
    sourceEntityIds: ['RE-goliath-2'],
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: ['self'],
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'bonus_action', amount: 1 }] },
      targeting: {
        domain: 'actor', actor_targets: false, shape: 'self',
        min_targets: 0, max_targets: 1, range_ft: 0,
        requires_line_of_sight: false, allowed_relations: ['self'],
      },
      effects: [{ resolution: 'auto', result: [{
        kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value,
        duration: { type: 'rounds', amount: 10 },
      }] }],
    },
  };
}

function goblin(): Monster {
  return {
    id: 'c1000000-0000-4000-8000-000000000001', slug: 'goblin-warrior', name: 'Гоблин-воин',
    description: '', size: 'small', creature_type: 'fey', alignment: '', challenge_rating: '1/4',
    armor_class: 15, max_hp: 10, speed: 30, initiative_bonus: 2, proficiency_bonus: 2,
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    action_ids: [scimitar().id], effect_ids: [], ai: { strategy: 'melee_chase' }, token_url: '',
    source: 'SRD 5.2.1', created_at: '', updated_at: '',
  };
}

describe('solo combat engine vertical integration', () => {
  it('adds another owned sheet as an independently controlled ally with its own initiative and actions', async () => {
    const participant = fighterSeed();
    const ally = wizardSeed();
    const inspiration: RuleActionDefinition = {
      id: 'd2000000-0000-4000-8000-000000000001',
      name: 'Вдохновение барда',
      kind: 'nonSpell',
      sourceEntityIds: ['ACT-bardic-inspiration'],
      mechanics: {
        activation: { mode: 'active', cost: [
          { resource: 'bonus_action', amount: 1 },
          { resource: 'bardic_inspiration', amount: 1 },
        ] },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single',
          min_targets: 1, max_targets: 1, range_ft: 60,
          requires_line_of_sight: true, allowed_relations: ['ally'],
        },
        effects: [{ resolution: 'auto', who: 'target', result: [{
          kind: 'boon', id: 'bardic_inspiration', die: '1d6',
          applies_to: ['ability_check', 'attack_roll', 'saving_throw'],
          expires: '1 час',
        }] }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 60,
        requiresLineOfSight: true, allowedRelations: ['ally'],
      },
    };
    const allyActor = ally.canonical.world.actors[ally.character.id];
    const allyActions = [...ally.canonical.actions, inspiration];
    const allyActionsById = new Map(allyActions.map((action) => [action.id, action]));
    ally.canonical = {
      ...ally.canonical,
      actions: allyActions,
      catalog: {
        getAction: (actionId) => allyActionsById.get(actionId),
        listActions: () => allyActions,
      },
    };
    allyActor.capabilities.actionIds.push(inspiration.id);
    allyActor.runtime.resources.bardic_inspiration = 2;
    allyActor.runtime.maxResources.bardic_inspiration = 2;
    ally.character.resources = clone(allyActor.runtime.resources);
    ally.character.max_resources = clone(allyActor.runtime.maxResources);
    participant.character.initiative_bonus = 0;
    ally.character.initiative_bonus = 20;
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      allies: [ally],
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const allyId = ally.character.id;
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    expect(state.controlledCharacterIds).toEqual([participant.character.id, allyId]);
    expect(state.sideByActorId[allyId]).toBe(state.sideByActorId[participant.character.id]);
    expect(state.tokens[allyId].position).not.toEqual(state.tokens[participant.character.id].position);
    expect(state.initiative.find((entry) => entry.actorId === allyId)?.bonus).toBe(20);
    expect(activeId(state)).toBe(allyId);

    const inspirationBefore = state.world.actors[allyId].runtime.resources.bardic_inspiration;
    state = executeCombatAction({
      state,
      actorId: allyId,
      actionId: inspiration.id,
      targetIds: [participant.character.id],
      rng: () => 0.5,
    });
    expect(state.world.actors[allyId].runtime.resources.bardic_inspiration)
      .toBe(inspirationBefore - 1);
    expect(state.world.actors[participant.character.id].runtime.activeEffects.some(
      (effect) => effect.name.includes('Талон 1к6'),
    )).toBe(true);
    expect(state.log.at(-1)?.text).toContain('Вдохновение барда');

    const magicMissile = state.catalogActions.find((action) => (
      state.playerActionIdsByActor?.[allyId]?.includes(action.id)
      && primitive(action) === 'magic_missile'
    ));
    expect(magicMissile, 'the invited Wizard should keep its own certified action catalog').toBeDefined();
    const hpBefore = state.world.actors[monsterId].runtime.hp.current;
    state = autoResolveSystemDecisions(executeCombatAction({
      state,
      actorId: allyId,
      actionId: magicMissile!.id,
      targetIds: [monsterId],
      rng: () => 0.5,
    }), () => 0.5);
    expect(state.world.actors[monsterId].runtime.hp.current).toBeLessThan(hpBefore);
    expect(state.log.some((entry) => entry.actorId === allyId && entry.text.includes(ally.character.name))).toBe(true);
  });

  it('scene constructor reorders initiative without stealing the turn and refreshes exact resources', async () => {
    const participant = fighterSeed();
    const ally = wizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      allies: [ally],
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const activeBefore = activeId(state);
    const totals = Object.fromEntries(state.initiative.map((entry, index) => [
      entry.actorId, index === 0 ? -5 : 30 - index,
    ]));
    state = setSoloCombatInitiativeTotals(state, totals);
    expect(activeId(state)).toBe(activeBefore);
    expect(state.world.scene.mode).toBe('encounter');
    if (state.world.scene.mode !== 'encounter') throw new Error('expected encounter');
    expect(state.world.scene.initiative).toEqual(state.initiative.map((entry) => entry.actorId));
    expect(state.initiative.map((entry) => entry.total)).toEqual(
      [...state.initiative.map((entry) => entry.total)].sort((a, b) => b - a),
    );

    const actorId = participant.character.id;
    const actor = state.world.actors[actorId];
    const spent = Object.fromEntries(Object.keys(actor.runtime.maxResources).map((key) => [key, 0]));
    state = {
      ...state,
      world: {
        ...state.world,
        actors: {
          ...state.world.actors,
          [actorId]: { ...actor, runtime: { ...actor.runtime, resources: spent } },
        },
      },
    };
    state = refreshSoloCombatResources(state, actorId);
    expect(state.world.actors[actorId].runtime.resources)
      .toEqual(state.world.actors[actorId].runtime.maxResources);
    expect(state.log.at(-1)?.text).toContain('Ресурсы восстановлены');
  });

  it('opens and resolves a generic owned post-hit rider instead of exposing it proactively', async () => {
    let participant = fighterSeed();
    const attack: RuleActionDefinition = {
      id: 'd2000000-0000-4000-8000-000000000001', name: 'Проверочная атака', kind: 'nonSpell',
      sourceEntityIds: ['test:attack'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 600, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'str', vs: 'ac', on_hit: [{ kind: 'damage', dice: '1d4', type: 'fire', ability: 'none' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 600, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const rider: RuleActionDefinition = {
      id: 'd2000000-0000-4000-8000-000000000002', name: 'Наследие великанов', kind: 'nonSpell',
      sourceEntityIds: ['test:goliath-ancestry'],
      mechanics: {
        activation: { mode: 'triggered', optional: true, trigger: { event: 'hit' }, cost: [{ resource: 'giant_legacy', amount: 1 }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 600, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', dice: '1d6', type: 'cold', ability: 'none' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 600, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.capabilities.actionIds.push(attack.id, rider.id);
    actor.runtime.resources.action = 1;
    actor.runtime.maxResources.action = 1;
    actor.runtime.resources.giant_legacy = 1;
    actor.runtime.maxResources.giant_legacy = 1;
    participant.character.resources = clone(actor.runtime.resources);
    participant.character.max_resources = clone(actor.runtime.maxResources);
    const actions = [...participant.canonical.actions, attack, rider];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant = { ...participant, canonical: { ...participant.canonical, actions, catalog: {
      getAction: (id) => byId.get(id),
      listActions: () => [...actions],
    } } };

    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    const hpBefore = state.world.actors[monsterId].runtime.hp.current;
    state = autoResolveSystemDecisions(executeCombatAction({
      state, actorId: participant.character.id, actionId: attack.id,
      targetIds: [monsterId], rng: () => 0.99,
    }), () => 0.99);

    expect(state.pendingTriggeredAction).toEqual(expect.objectContaining({
      event: 'hit', sourceActionId: attack.id,
      optionActionIds: [rider.id], targetIds: [monsterId],
    }));
    expect(state.world.actors[participant.character.id].runtime.resources.giant_legacy).toBe(1);
    const hpAfterAttack = state.world.actors[monsterId].runtime.hp.current;
    expect(hpAfterAttack).toBeLessThan(hpBefore);

    state = resolveTriggeredCombatAction(state, rider.id, () => 0.5);
    expect(state.pendingTriggeredAction).toBeUndefined();
    expect(state.world.actors[participant.character.id].runtime.resources.giant_legacy).toBe(0);
    expect(state.world.actors[monsterId].runtime.hp.current).toBeLessThan(hpAfterAttack);
  });

  it('restores sheet previews in fights persisted before scoped presentation keys', async () => {
    const participant = fighterSeed();
    const state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const legacyEntityId = 'legacy-spell-id';
    const scopedActionId = `${legacyEntityId}@magic-initiate-grant`;
    const legacyState = {
      ...state,
      playerActionIds: [...state.playerActionIds, scopedActionId],
      actionPresentation: {
        ...state.actionPresentation,
        [legacyEntityId]: {
          imageUrl: '/legacy-thunderwave.png',
          entityType: 'spell' as const,
          entityId: legacyEntityId,
        },
      },
    };

    const legacyTurnState = writeSoloCombatState({}, legacyState);
    const legacySnapshot = legacyTurnState[SOLO_COMBAT_KEY] as Record<string, unknown>;
    delete legacySnapshot.sideByActorId;
    delete legacySnapshot.actorPresentation;
    legacySnapshot.log = [{
      id: 'legacy-log', round: 1, actorId: participant.character.id, text: 'Старый журнал',
      events: [{ type: 'healing', amount: 2 }],
    }];
    const restored = readSoloCombatState(
      legacyTurnState,
      participant.character.id,
      7,
    );

    expect(restored?.runtimeRevision).toBe(7);
    expect(restored?.actionPresentation?.[scopedActionId]).toEqual(
      legacyState.actionPresentation[legacyEntityId],
    );
    const monsterId = Object.keys(restored!.world.actors).find((actorId) => actorId !== participant.character.id)!;
    expect(restored?.sideByActorId[participant.character.id]).toBe('side:party');
    expect(restored?.sideByActorId[monsterId]).toBe('side:opposition');
    expect(restored?.actorPresentation[monsterId].templateId).toBe(goblin().id);
    expect(restored?.log[0].records?.[0].event).toEqual({ type: 'healing', amount: 2 });
  });

  it('starts certified sheet + data-driven monster in initiative and resolves the real sheet Thunderwave pipeline', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    expect(state.initiative.find((entry) => entry.actorId === participant.character.id)?.bonus).toBe(9);
    expect(state.initiative.find((entry) => entry.actorId === monsterId)?.bonus).toBe(2);
    expect(state.world.scene.mode).toBe('encounter');
    expect(activeId(state)).toBe(participant.character.id);
    expect(state.log.at(-1)?.text).toContain(participant.character.name);
    expect(state.playerActionIds).toContain('d1000000-0000-4000-8000-000000000001');

    state = {
      ...state,
      tokens: {
        ...state.tokens,
        [monsterId]: { ...state.tokens[monsterId], position: { x: 6, y: 7 } },
      },
      boardRevision: state.boardRevision + 1,
    };
    const thunderwave = state.catalogActions.find((action) => (
      state.playerActionIds.includes(action.id) && primitive(action) === 'area_object_push'
    ));
    expect(thunderwave, 'Magic Initiate fighter should expose certified Thunderwave').toBeDefined();
    const hpBefore = state.world.actors[monsterId].runtime.hp.current;
    state = autoResolveSystemDecisions(executeCombatAction({
      state, actorId: participant.character.id, actionId: thunderwave!.id, targetIds: [monsterId], rng: () => 0,
    }), () => 0);
    expect(state.world.actors[monsterId].runtime.hp.current).toBeLessThan(hpBefore);
    expect(state.tokens[monsterId].position.y).toBeLessThan(7);
    expect(state.log.some((entry) => entry.text.includes(thunderwave!.name))).toBe(true);
  });

  it('starts combat with SPELL-0173 and executes it outside the strict combat slice', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const cantripId = 'd1000000-0000-4000-8000-000000000001';
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state = {
      ...state,
      tokens: { ...state.tokens, [monsterId]: { ...state.tokens[monsterId], position: { x: 6, y: 6 } } },
      boardRevision: state.boardRevision + 1,
    };
    state = executeCombatAction({
      state, actorId: participant.character.id, actionId: cantripId, targetIds: [monsterId], rng: () => 0,
    });
    expect(state.log.at(-1)?.text).toContain('Волшебная рука');
    expect(state.world.actors[participant.character.id].runtime.resources.action).toBe(0);
  });

  it('starts a Wizard fight and resolves prepared Magic Missile through the real combat pipeline', async () => {
    const participant = wizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const missile = state.catalogActions.find((action) => (
      state.playerActionIds.includes(action.id) && primitive(action) === 'magic_missile'
    ));
    expect(missile, 'Wizard should expose certified Magic Missile').toBeDefined();
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    const hpBefore = state.world.actors[monsterId].runtime.hp.current;
    state = autoResolveSystemDecisions(executeCombatAction({
      state,
      actorId: participant.character.id,
      actionId: missile!.id,
      targetIds: [monsterId],
      rng: () => 0,
    }), () => 0);
    expect(state.world.actors[monsterId].runtime.hp.current).toBeLessThan(hpBefore);
    expect(state.log.at(-1)?.text).toContain(missile!.name);
  });

  it('runs a catalog-gated off-turn opportunity attack and spends exactly the reactor resource', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state = {
      ...state,
      tokens: {
        ...state.tokens,
        [monsterId]: { ...state.tokens[monsterId], position: { x: 6, y: 7 } },
      },
    };
    const hpBefore = state.world.actors[participant.character.id].runtime.hp.current;
    state = moveActor({
      state, actorId: participant.character.id, destination: { x: 6, y: 9 }, voluntary: true, rng: () => 0.99,
    });
    expect(state.world.actors[participant.character.id].runtime.hp.current).toBeLessThan(hpBefore);
    expect(state.world.actors[monsterId].runtime.resources.reaction).toBe(0);
    expect(state.tokens[participant.character.id].position).toEqual({ x: 6, y: 9 });
  });

  it('connects the reusable Dash and Disengage data rows to tactical movement', async () => {
    const participant = fighterSeed();
    const selected = [{ monster: goblin(), quantity: 1 }];
    let state = await createSoloCombatState({
      character: participant.character, participant, selected,
      actions: [scimitar(), dash(), disengage()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const dashId = state.playerActionIds.find((id) => id === dash().id)!;
    state = executeCombatAction({ state, actorId: participant.character.id, actionId: dashId, targetIds: [participant.character.id], rng: () => 0 });
    expect(state.movementRemainingFt[participant.character.id]).toBe(
      Number(state.world.actors[participant.character.id].character.characterSpeed) * 2,
    );
    expect(state.world.actors[participant.character.id].runtime.resources.action).toBe(0);

    state = await createSoloCombatState({
      character: participant.character, participant, selected,
      actions: [scimitar(), dash(), disengage()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state = {
      ...state,
      tokens: { ...state.tokens, [monsterId]: { ...state.tokens[monsterId], position: { x: 6, y: 7 } } },
    };
    state = executeCombatAction({
      state, actorId: participant.character.id, actionId: disengage().id,
      targetIds: [participant.character.id], rng: () => 0,
    });
    const hpBefore = state.world.actors[participant.character.id].runtime.hp.current;
    state = moveActor({ state, actorId: participant.character.id, destination: { x: 6, y: 9 }, rng: () => 0.99 });
    expect(state.world.actors[participant.character.id].runtime.hp.current).toBe(hpBefore);
    expect(state.world.actors[monsterId].runtime.resources.reaction).toBe(1);
  });

  it('reconciles remaining movement when an active effect changes speed mid-turn', async () => {
    const participant = fighterSeed();
    const largeForm = speedModifierAction(10);
    const actor = participant.canonical.world.actors[participant.character.id];
    const actions = [...participant.canonical.actions, largeForm];
    const byId = new Map(actions.map((action) => [action.id, action]));
    actor.capabilities.actionIds.push(largeForm.id);
    participant.canonical = {
      ...participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    };
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const baseSpeed = Number(state.world.actors[actorId].character.characterSpeed);
    state = moveActor({
      state, actorId,
      destination: { ...state.tokens[actorId].position, y: state.tokens[actorId].position.y - 2 },
    });
    expect(state.movementRemainingFt[actorId]).toBe(baseSpeed - 10);

    state = executeCombatAction({
      state, actorId, actionId: largeForm.id, targetIds: [actorId], rng: () => 0,
    });

    expect(state.movementRemainingFt[actorId]).toBe(baseSpeed);
    expect(state.world.actors[actorId].runtime.resources.bonus_action).toBe(0);
    expect(() => moveActor({
      state, actorId,
      destination: { ...state.tokens[actorId].position, y: state.tokens[actorId].position.y - 6 },
    })).not.toThrow();
  });

  it('lets the separate monster controller move, attack, resolve, and hand back the turn', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    const hpBefore = state.world.actors[participant.character.id].runtime.hp.current;
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);
    state = runMonsterTurn(state, () => 0.99);
    expect(state.world.actors[participant.character.id].runtime.hp.current).toBeLessThan(hpBefore);
    expect(gridDistanceFt(state.tokens[monsterId].position, state.tokens[participant.character.id].position)).toBe(5);
    expect(activeId(state)).toBe(participant.character.id);
  });

  it.each([true, false])('finishes a paused monster turn exactly once after a Shield decision (%s)', async (useShield) => {
    const participant = wizardSeed();
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);

    state = runMonsterTurn(state, () => 0.5);
    const pending = state.world.pendingResolution;
    expect(pending?.request.type).toBe('reaction');
    if (!pending || pending.request.type !== 'reaction') throw new Error('expected Shield reaction');
    const shield = pending.request.options.find((option) => option.spellSources?.length);
    expect(shield).toBeDefined();
    const source = shield?.spellSources?.[0];
    const response = useShield && shield
      ? {
        kind: 'reaction' as const,
        actionId: shield.actionId,
        spell: source ? {
          grantId: source.grantId,
          mode: 'normal' as const,
          ...(source.payment.kind === 'free_use' ? { preferFreeUse: true } : {}),
          ...(source.payment.kind === 'slot' ? { preferFreeUse: false } : {}),
        } : undefined,
      }
      : { kind: 'reaction' as const, actionId: null };

    state = resolvePlayerReaction(state, response, () => 0.5);
    expect(state.world.pendingResolution).toBeNull();
    expect(activeId(state)).toBe(participant.character.id);
    expect(state.world.actors[monsterId].runtime.resources.action).toBe(0);
    expect(() => runMonsterTurn(state, () => 0.5)).not.toThrow();
  });

  it('persists and resolves Stone Endurance before a monster attack mutates player HP', async () => {
    let participant = fighterSeed();
    const stone = stoneEndurance();
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.capabilities.actionIds.push(stone.id);
    actor.runtime.resources.reaction = 1;
    actor.runtime.maxResources.reaction = 1;
    actor.runtime.resources.giant_legacy = 1;
    actor.runtime.maxResources.giant_legacy = 1;
    participant.character.resources = clone(actor.runtime.resources);
    participant.character.max_resources = clone(actor.runtime.maxResources);
    const actions = [...participant.canonical.actions, stone];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant = {
      ...participant,
      canonical: {
        ...participant.canonical,
        actions,
        catalog: { getAction: (id) => byId.get(id), listActions: () => [...actions] },
      },
    };

    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    const hpBefore = state.world.actors[state.characterId].runtime.hp.current;
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);

    state = runMonsterTurn(state, () => 0.99);
    expect(state.world.pendingResolution).toMatchObject({
      type: 'damage_reaction',
      request: {
        actorId: state.characterId,
        trigger: { type: 'damage_taken' },
        options: [{ actionId: stone.id }],
      },
    });
    expect(state.world.actors[state.characterId].runtime.hp.current).toBe(hpBefore);

    const restored = readSoloCombatState(
      writeSoloCombatState({}, state),
      state.characterId,
      state.runtimeRevision,
    );
    expect(restored?.world.pendingResolution).toEqual(state.world.pendingResolution);
    state = resolvePlayerReaction(
      restored!,
      { kind: 'reaction', actionId: stone.id },
      () => 0,
    );

    expect(state.world.pendingResolution).toBeNull();
    expect(activeId(state)).toBe(state.characterId);
    expect(state.world.actors[state.characterId].runtime.resources).toMatchObject({
      // The reaction was paid inside the monster turn, then restored exactly
      // once when resolving the interruption advanced to the player's turn.
      reaction: 1,
      giant_legacy: 0,
    });
    expect(state.world.actors[state.characterId].runtime.hp.current).toBeLessThan(hpBefore);
  });

  it('recovers a persisted monster turn whose interrupted action was already spent', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);
    state = {
      ...state,
      world: {
        ...state.world,
        actors: {
          ...state.world.actors,
          [monsterId]: {
            ...state.world.actors[monsterId],
            runtime: {
              ...state.world.actors[monsterId].runtime,
              resources: { ...state.world.actors[monsterId].runtime.resources, action: 0 },
            },
          },
        },
      },
    };

    expect(() => { state = runMonsterTurn(state, () => 0.5); }).not.toThrow();
    expect(activeId(state)).toBe(participant.character.id);
  });
});
