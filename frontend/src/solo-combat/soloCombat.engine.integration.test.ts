import { describe, expect, it } from 'vitest';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import fightingStyleDefinitions from '../../../scripts/content/data/mini-mvp-complex-fighting-styles.v1.json';
import { createWorld, type ActorState, type RuleActionDefinition, type RulesCatalog, type RulesetReference } from '../rules-core/domain';
import { CARD_LONGSWORD, CARD_SHIELD } from '../mvp/fixtures';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { Action } from '../types';
import type { Monster } from '../monsters/types';
import { addSoloCombatCharacter, addSoloCombatMonster, advanceTurn, autoResolveSystemDecisions, combatDetectMagicStatus, createSoloCombatState, executeCombatAction, moveActor, moveCombatDancingLights, refreshSoloCombatParticipants, refreshSoloCombatResources, revealCombatMagicAura, resolvePlayerReaction, resolveSoloCombatAlertSwap, resolveSoloCombatInterception, resolveSoloCombatTurnStart, resolveTriggeredCombatAction, runMonsterTurn, selectedTargetsForAction, setSoloCombatInitiativeTotals } from './engine';
import { readSoloCombatState, writeSoloCombatState } from './persistence';
import { gridDistanceFt } from './tacticalGrid';
import { SOLO_COMBAT_KEY } from './types';
import { UNARMED_STRIKE_CHOICE_ID } from './actionChoices';
import { STONEWORK_CONTACT_CHOICE_ID } from '../mechanics/collectChoices';

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

function prestidigitationWizardSeed(): SheetCombatParticipantSeed {
  const participant = wizardSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'd5000000-0000-4000-8000-000000000003',
    name: 'Фокусы',
    kind: 'spell',
    spell: { level: 0 },
    sourceEntityIds: ['SPELL-prestidigitation'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'world', actor_targets: false, range_ft: 10, allowed_relations: [],
        requires_line_of_sight: false, shape: 'single', min_targets: 0, max_targets: 1,
      },
      effects: [{ resolution: 'auto', result: [] }],
      primitive: {
        type: 'prestidigitation_world',
        policy: {
          max_volume_cubic_ft: 1,
          max_active_effects: 3,
          attachment_duration_rounds: 600,
          creation_source_turn_endings: 2,
        },
      },
    },
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 10,
      requiresLineOfSight: false, allowedRelations: [],
    },
  };
  const actions = [...participant.canonical.actions, action];
  actor.capabilities.actionIds.push(action.id);
  actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
  actor.spellcastingAccess.grants.push({
    grantId: 'grant:prestidigitation', actionId: action.id, sourceId: 'CLASS-wizard',
    access: 'cantrip', level: 0, spellcastingAbility: 'int',
  });
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  return {
    ...participant,
    canonical: {
      ...participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    },
  };
}

function lightWizardSeed(): SheetCombatParticipantSeed {
  const participant = wizardSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'd5000000-0000-4000-8000-000000000004',
    name: 'Свет',
    kind: 'spell',
    spell: { level: 0 },
    sourceEntityIds: ['SPELL-light'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: {
        domain: 'world', actor_targets: false, range_ft: 0, allowed_relations: [],
        requires_line_of_sight: false, requires_touch: true, shape: 'single',
        min_targets: 0, max_targets: 1,
      },
      effects: [{ resolution: 'auto', result: [] }],
      primitive: {
        type: 'light_world_object',
        policy: {
          max_object_size: 'large', exclude_carried_by_other: true,
          bright_radius_ft: 20, dim_additional_radius_ft: 20,
          duration_rounds: 600, max_active_per_source: 1,
        },
      },
    },
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: [],
    },
  };
  const actions = [...participant.canonical.actions, action];
  actor.capabilities.actionIds.push(action.id);
  actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
  actor.spellcastingAccess.grants.push({
    grantId: 'grant:light', actionId: action.id, sourceId: 'CLASS-wizard',
    access: 'cantrip', level: 0, spellcastingAbility: 'int',
  });
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  return {
    ...participant,
    canonical: {
      ...participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    },
  };
}

function dancingLightsWizardSeed(): SheetCombatParticipantSeed {
  const participant = wizardSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'd5000000-0000-4000-8000-000000000001',
    name: 'Пляшущие огоньки',
    kind: 'spell',
    spell: { level: 0 },
    concentration: true,
    sourceEntityIds: ['SPELL-dancing-lights'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'world', actor_targets: false, range_ft: 120, allowed_relations: [],
        requires_line_of_sight: false, shape: 'multiple', min_targets: 0, max_targets: 1,
      },
      effects: [{ resolution: 'auto', result: [] }],
      primitive: {
        type: 'dancing_lights_world',
        policy: {
          min_individual_lights: 1, max_individual_lights: 4,
          combined_form_object_count: 1, required_separation_ft: 20,
          max_move_ft: 60, dim_radius_ft: 10, duration_rounds: 10,
        },
      },
    },
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 120,
      requiresLineOfSight: false, allowedRelations: [],
    },
  };
  const actions = [...participant.canonical.actions, action];
  actor.capabilities.actionIds.push(action.id);
  actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
  actor.spellcastingAccess.grants.push({
    grantId: 'grant:dancing-lights', actionId: action.id, sourceId: 'CLASS-wizard',
    access: 'cantrip', level: 0, spellcastingAbility: 'int',
  });
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  return {
    ...participant,
    canonical: {
      ...participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    },
  };
}

function detectMagicWizardSeed(): SheetCombatParticipantSeed {
  const participant = wizardSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'd5000000-0000-4000-8000-000000000002',
    name: 'Обнаружение магии',
    kind: 'spell',
    spell: { level: 1 },
    concentration: true,
    sourceEntityIds: ['SPELL-detect-magic'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }] },
      targeting: {
        domain: 'actor', actor_targets: false, range_ft: 0, allowed_relations: ['self'],
        requires_line_of_sight: false, shape: 'self', min_targets: 0, max_targets: 1,
        area: { kind: 'emanation', radius_ft: 30 },
      },
      effects: [{ resolution: 'auto', result: [] }],
      primitive: {
        type: 'detect_magic_world_sensing',
        policy: {
          blockers: {
            stone: { threshold_inches: 12, comparison: 'gte' },
            common_metal: { threshold_inches: 1, comparison: 'gte' },
            lead: { threshold_inches: 0, comparison: 'gt' },
            wood: { threshold_inches: 12, comparison: 'gte' },
            dirt: { threshold_inches: 12, comparison: 'gte' },
            other: null,
          },
          aura_requires_line_of_sight: true,
          reveal_spell_school_only: true,
        },
      },
    },
    targeting: { minTargets: 0, maxTargets: 1, rangeFt: 0, requiresLineOfSight: false, allowedRelations: ['self'] },
  };
  const actions = [...participant.canonical.actions, action];
  actor.capabilities.actionIds.push(action.id);
  actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
  actor.spellcastingAccess.grants.push({
    grantId: 'grant:detect-magic', actionId: action.id, sourceId: 'CLASS-wizard',
    access: 'always_prepared', level: 1, spellcastingAbility: 'int', slotResource: 'spell_slot_1',
  });
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  return {
    ...participant,
    canonical: {
      ...participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    },
  };
}

function mageArmorWizardSeed(): SheetCombatParticipantSeed {
  const participant = wizardSeed();
  const sourceAction = participant.canonical.actions.find((action) => (
    action.targeting?.requiresWilling && action.targeting?.requiresUnarmored
  ));
  if (!sourceAction) throw new Error('Wizard fixture should include Mage Armor');
  const action = { ...clone(sourceAction), id: 'd6000000-0000-4000-8000-000000000001' };
  const actions = [...participant.canonical.actions, action];
  const actor = participant.canonical.world.actors[participant.character.id];
  actor.capabilities.actionIds.push(action.id);
  actor.spellcastingAccess!.grants.push({
    grantId: 'grant:test-mage-armor',
    actionId: action.id,
    sourceId: 'test-feature:mage-armor',
    access: 'always_prepared',
    level: 1,
    spellcastingAbility: 'int',
    slotResource: 'spell_slot_1',
  });
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  return {
    ...participant,
    canonical: {
      ...participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    },
  };
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

const unarmedStyleMechanics = fightingStyleDefinitions.find(
  (definition) => definition.card_number === 'fs_unarmed',
)!.mechanics;

function unarmedParticipant(): { participant: SheetCombatParticipantSeed; action: RuleActionDefinition } {
  const participant = fighterSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'a1000000-0000-4000-8000-000000000003',
    name: 'Безоружный удар',
    kind: 'nonSpell',
    sourceEntityIds: ['action_basic_unarmed'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 5, requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
      effects: [{
        ability: 'str', attack_kind: 'unarmed', resolution: 'attack_roll', vs: 'ac',
        on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
      }],
    },
    targeting: {
      minTargets: 1, maxTargets: 1, rangeFt: 5,
      requiresLineOfSight: true, allowedRelations: ['enemy'],
    },
  };
  actor.passives = [...(actor.passives ?? []), clone(unarmedStyleMechanics)];
  actor.attackProfile = {
    attacksPerAction: 1, size: 2, reachFt: 5,
    graspingParts: ['main_hand', 'off_hand'],
    sourceEntityIds: ['class:test:attack-profile'],
  };
  actor.character.knownCards = [...(actor.character.knownCards ?? []), clone(CARD_LONGSWORD)];
  actor.character.equippedCards = [...(actor.character.equippedCards ?? []), clone(CARD_LONGSWORD)];
  actor.runtime.equipment = {
    ...actor.runtime.equipment,
    main_hand: CARD_LONGSWORD.id,
    off_hand: null,
  };
  actor.runtime.inventory = [{ cardId: CARD_LONGSWORD.id, qty: 1 }];
  actor.runtime.resources.action = 1;
  actor.runtime.maxResources.action = 1;
  actor.capabilities.actionIds.push(action.id);
  const actions = [...participant.canonical.actions, action];
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  participant.canonical = {
    ...participant.canonical,
    actions,
    catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
  };
  participant.character.resources = clone(actor.runtime.resources);
  participant.character.max_resources = clone(actor.runtime.maxResources);
  participant.actionPresentation = {
    [action.id]: {
      entityType: 'action', entityId: action.id,
      actionRef: {
        id: action.id, name: action.name, description: '', rarity: 'common',
        card_number: 'action_basic_unarmed', resource: 'action',
        action_type: 'base_action', type: 'basic', mechanics: clone(action.mechanics),
        created_at: '', updated_at: '',
      } as Action,
    },
  };
  return { participant, action };
}

function stonecunningParticipant(): { participant: SheetCombatParticipantSeed; action: RuleActionDefinition } {
  const participant = fighterSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'a1000000-0000-4000-8000-000000000004',
    name: 'Камнечувствие',
    kind: 'nonSpell',
    sourceEntityIds: ['04c2410f-8bc1-4490-bf54-0a8d21e066c9', 'RE-dwarf-4'],
    targeting: {
      minTargets: 0, maxTargets: 1, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: ['self'],
      requiresStoneworkContact: true,
    },
    mechanics: {
      activation: {
        mode: 'active',
        cost: [
          { resource: 'bonus_action', amount: 1 },
          { resource: 'uses_RE-dwarf-4', amount: 1 },
        ],
      },
      targeting: {
        domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0,
        max_targets: 1, range_ft: 0, requires_line_of_sight: false,
        allowed_relations: ['self'], requires_stonework_contact: true,
      },
      effects: [{ resolution: 'auto', result: [{
        kind: 'grant_sense', sense: 'tremorsense', range: 60,
        duration: { type: 'rounds', amount: 100 },
        senseScope: {
          kind: 'stonework', stoneForms: ['natural', 'worked'],
          ownerContact: ['on_surface', 'touching_surface'], sameSurfaceOnly: true,
          detectsAirborne: false, grantsSight: false,
        },
        sourceEntityIds: ['04c2410f-8bc1-4490-bf54-0a8d21e066c9', 'RE-dwarf-4'],
        stack_id: 'dnd5e-2024:stonecunning:tremorsense',
      }] }],
    },
  };
  actor.runtime.resources.bonus_action = 1;
  actor.runtime.maxResources.bonus_action = 1;
  actor.runtime.resources['uses_RE-dwarf-4'] = 1;
  actor.runtime.maxResources['uses_RE-dwarf-4'] = 1;
  actor.capabilities.actionIds.push(action.id);
  const actions = [...participant.canonical.actions, action];
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  participant.canonical = {
    ...participant.canonical,
    actions,
    catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
  };
  participant.character.resources = clone(actor.runtime.resources);
  participant.character.max_resources = clone(actor.runtime.maxResources);
  return { participant, action };
}

function placeAdjacent(
  state: Awaited<ReturnType<typeof createSoloCombatState>>,
  actorId: string,
  targetId: string,
) {
  const source = state.tokens[actorId].position;
  return {
    ...state,
    boardRevision: state.boardRevision + 1,
    tokens: {
      ...state.tokens,
      [targetId]: { ...state.tokens[targetId], position: { x: source.x, y: source.y - 1 } },
    },
  };
}

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
  it('requires and forwards explicit Stonecunning surface facts before spending resources', async () => {
    const fixture = stonecunningParticipant();
    let state = await createSoloCombatState({
      character: fixture.participant.character,
      participant: fixture.participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = fixture.participant.character.id;
    expect(() => executeCombatAction({
      state, actorId, actionId: fixture.action.id, targetIds: [actorId], rng: () => 0.5,
    })).toThrow('Укажите, как персонаж соприкасается с каменной поверхностью.');
    expect(state.world.actors[actorId].runtime.resources).toMatchObject({
      bonus_action: 1,
      'uses_RE-dwarf-4': 1,
    });

    state = executeCombatAction({
      state,
      actorId,
      actionId: fixture.action.id,
      targetIds: [actorId],
      choices: { [STONEWORK_CONTACT_CHOICE_ID]: ['worked_touching'] },
      rng: () => 0.5,
    });
    expect(state.world.actors[actorId].runtime.resources).toMatchObject({
      bonus_action: 0,
      'uses_RE-dwarf-4': 0,
    });
    expect(state.world.actors[actorId].runtime.activeEffects).toEqual([
      expect.objectContaining({
        name: 'Камнечувствие', roundsLeft: 100,
        mechanics: expect.objectContaining({
          kind: 'grant_sense', sense: 'tremorsense', range: 60,
        }),
      }),
    ]);
    const restored = readSoloCombatState(writeSoloCombatState({}, state), actorId, 9)!;
    expect(restored.world.actors[actorId].runtime.activeEffects[0]).toMatchObject({
      name: 'Камнечувствие', roundsLeft: 100,
    });
  });

  it('routes the exact basic Unarmed Strike through canonical damage, grapple, persistence, and turn-start damage', async () => {
    const damageFixture = unarmedParticipant();
    let damageState = await createSoloCombatState({
      character: damageFixture.participant.character,
      participant: damageFixture.participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const damageActorId = damageFixture.participant.character.id;
    const damageTargetId = Object.values(damageState.world.actors)
      .find((actor) => actor.kind === 'monster')!.id;
    damageState = placeAdjacent(damageState, damageActorId, damageTargetId);
    const hpBeforeDamage = damageState.world.actors[damageTargetId].runtime.hp.current;
    damageState = autoResolveSystemDecisions(executeCombatAction({
      state: damageState,
      actorId: damageActorId,
      actionId: damageFixture.action.id,
      targetIds: [damageTargetId],
      choices: { [UNARMED_STRIKE_CHOICE_ID]: ['damage'] },
      rng: () => 0.9,
    }), () => 0.9);
    const armedDamage = 6 + damageState.world.actors[damageActorId].character.abilityMods.str;
    expect(damageState.world.actors[damageTargetId].runtime.hp.current)
      .toBe(Math.max(0, hpBeforeDamage - armedDamage));
    expect(damageState.world.actors[damageActorId].runtime.resources.action).toBe(0);
    expect(Object.values(damageState.world.attackActions).at(-1)).toMatchObject({ status: 'completed' });

    const shoveFixture = unarmedParticipant();
    let shoveState = await createSoloCombatState({
      character: shoveFixture.participant.character,
      participant: shoveFixture.participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const shoveActorId = shoveFixture.participant.character.id;
    const shoveTargetId = Object.values(shoveState.world.actors)
      .find((actor) => actor.kind === 'monster')!.id;
    shoveState = placeAdjacent(shoveState, shoveActorId, shoveTargetId);
    const shoveSource = shoveState.tokens[shoveActorId].position;
    const shoveBefore = shoveState.tokens[shoveTargetId].position;
    shoveState = autoResolveSystemDecisions(executeCombatAction({
      state: shoveState,
      actorId: shoveActorId,
      actionId: shoveFixture.action.id,
      targetIds: [shoveTargetId],
      choices: { [UNARMED_STRIKE_CHOICE_ID]: ['shove'] },
      rng: () => 0,
    }), () => 0);
    expect(gridDistanceFt(shoveSource, shoveState.tokens[shoveTargetId].position))
      .toBe(gridDistanceFt(shoveSource, shoveBefore) + 5);
    expect(readSoloCombatState(
      writeSoloCombatState({}, shoveState),
      shoveActorId,
      shoveState.runtimeRevision,
    )?.tokens[shoveTargetId].position).toEqual(shoveState.tokens[shoveTargetId].position);

    const grappleFixture = unarmedParticipant();
    let grappleState = await createSoloCombatState({
      character: grappleFixture.participant.character,
      participant: grappleFixture.participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const grappleActorId = grappleFixture.participant.character.id;
    const grappleTargetId = Object.values(grappleState.world.actors)
      .find((actor) => actor.kind === 'monster')!.id;
    grappleState = placeAdjacent(grappleState, grappleActorId, grappleTargetId);
    grappleState = autoResolveSystemDecisions(executeCombatAction({
      state: grappleState,
      actorId: grappleActorId,
      actionId: grappleFixture.action.id,
      targetIds: [grappleTargetId],
      choices: { [UNARMED_STRIKE_CHOICE_ID]: ['grapple'] },
      rng: () => 0,
    }), () => 0);
    expect(Object.values(grappleState.world.grapples)).toEqual([
      expect.objectContaining({
        grapplerActorId: grappleActorId,
        targetActorId: grappleTargetId,
        sourcePart: 'off_hand',
      }),
    ]);
    expect(() => moveActor({
      state: grappleState,
      actorId: grappleTargetId,
      destination: { ...grappleState.tokens[grappleTargetId].position, x: 1 },
    })).toThrow(/доступно 0 фт/);
    const releasedByRange = moveActor({
      state: grappleState,
      actorId: grappleActorId,
      destination: {
        ...grappleState.tokens[grappleActorId].position,
        x: grappleState.tokens[grappleActorId].position.x + 2,
      },
      rng: () => 0.5,
    });
    expect(releasedByRange.world.grapples).toEqual({});
    expect(releasedByRange.log.some((entry) => entry.text.includes('цель вне досягаемости')))
      .toBe(true);

    grappleState = advanceTurn(grappleState);
    grappleState = advanceTurn(grappleState);
    expect(activeId(grappleState)).toBe(grappleActorId);
    expect(grappleState.world.scene.mode === 'encounter'
      && grappleState.world.scene.turnStarted).toBe(false);
    expect(grappleState.pendingTurnStartGrappleDamage).toEqual({
      actorId: grappleActorId,
      capabilityId: 'fighting_style.unarmed.turn_start_grapple_damage',
      targetActorIds: [grappleTargetId],
    });

    const restored = readSoloCombatState(
      writeSoloCombatState({}, grappleState),
      grappleActorId,
      grappleState.runtimeRevision,
    )!;
    expect(restored.pendingTurnStartGrappleDamage).toEqual(
      grappleState.pendingTurnStartGrappleDamage,
    );
    const hpBeforeTurnDamage = restored.world.actors[grappleTargetId].runtime.hp.current;
    const resolved = resolveSoloCombatTurnStart(restored, grappleTargetId, () => 0.999);
    expect(resolved.pendingTurnStartGrappleDamage).toBeUndefined();
    expect(resolved.world.actors[grappleTargetId].runtime.hp.current).toBe(hpBeforeTurnDamage - 4);
    expect(resolved.world.scene.mode === 'encounter' && resolved.world.scene.turnStarted).toBe(true);
    expect(resolved.movementRemainingFt[grappleActorId]).toBeGreaterThan(0);

    const skipped = resolveSoloCombatTurnStart(grappleState, null, () => 0.999);
    expect(skipped.pendingTurnStartGrappleDamage).toBeUndefined();
    expect(skipped.world.actors[grappleTargetId].runtime.hp.current)
      .toBe(grappleState.world.actors[grappleTargetId].runtime.hp.current);
  });

  it('adds another owned sheet as an independently controlled ally with its own initiative and actions', async () => {
    const participant = fighterSeed();
    const ally = wizardSeed();
    delete ally.canonical.world.actors[ally.character.id].capabilities.featureSources?.['alert.initiative_swap'];
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

  it('offers Alert initiative swap before turn one and starts only after the explicit decision', async () => {
    const participant = fighterSeed();
    const ally = wizardSeed();
    delete ally.canonical.world.actors[ally.character.id].capabilities.featureSources?.['alert.initiative_swap'];
    participant.canonical.world.actors[participant.character.id].capabilities.featureSources ??= {};
    participant.canonical.world.actors[participant.character.id].capabilities.featureSources!['alert.initiative_swap'] = ['FEAT-0001'];
    participant.character.initiative_bonus = 0;
    ally.character.initiative_bonus = 10;

    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      allies: [ally],
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    expect(state.pendingAlertSwapActorIds).toEqual([participant.character.id]);
    expect(state.world.scene).toMatchObject({ mode: 'encounter', round: 1, turnStarted: false });
    const before = state.world.scene.mode === 'encounter' ? [...state.world.scene.initiative] : [];

    state = resolveSoloCombatAlertSwap(state, participant.character.id, ally.character.id, () => 0.5);
    const after = state.world.scene.mode === 'encounter' ? state.world.scene.initiative : [];
    expect(after.indexOf(participant.character.id)).toBe(before.indexOf(ally.character.id));
    expect(after.indexOf(ally.character.id)).toBe(before.indexOf(participant.character.id));
    expect(state.initiative.map((entry) => entry.actorId)).toEqual(after);
    expect(state.pendingAlertSwapActorIds).toBeUndefined();
    expect(state.world.scene).toMatchObject({ mode: 'encounter', round: 1, turnStarted: true });
    expect(state.log.some((entry) => entry.text.includes('обмен инициативой'))).toBe(true);
  });

  it('offers Interception to an adjacent equipped ally and applies 1d10 + proficiency before the monster turn ends', async () => {
    const participant = fighterSeed();
    const interceptor = wizardSeed();
    const interceptorActor = interceptor.canonical.world.actors[interceptor.character.id];
    delete interceptorActor.capabilities.featureSources?.['alert.initiative_swap'];
    interceptorActor.capabilities.featureSources ??= {};
    interceptorActor.capabilities.featureSources['fighting_style.interception.reaction'] = ['FEAT-0057', 'fs_interception'];
    interceptorActor.character.knownCards = [...(interceptorActor.character.knownCards ?? []), CARD_SHIELD];
    interceptorActor.runtime.inventory.push({ cardId: CARD_SHIELD.id, qty: 1 });
    interceptorActor.runtime.equipment.off_hand = CARD_SHIELD.id;
    interceptorActor.runtime.resources.reaction = 1;
    interceptorActor.runtime.maxResources.reaction = 1;
    interceptor.character.resources = clone(interceptorActor.runtime.resources);
    interceptor.character.max_resources = clone(interceptorActor.runtime.maxResources);

    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      allies: [interceptor],
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const targetId = participant.character.id;
    const interceptorId = interceptor.character.id;
    state = {
      ...state,
      tokens: {
        ...state.tokens,
        [interceptorId]: {
          ...state.tokens[interceptorId],
          position: { x: state.tokens[targetId].position.x + 1, y: state.tokens[targetId].position.y },
        },
      },
    };
    while (state.world.actors[activeId(state)].kind !== 'monster') state = advanceTurn(state, () => 0.5);
    const hpBefore = state.world.actors[targetId].runtime.hp.current;
    state = runMonsterTurn(state, () => 0.95);
    expect(state.pendingInterception).toMatchObject({ targetActorId: targetId, interceptorActorIds: [interceptorId] });
    const hpAfterHit = state.world.actors[targetId].runtime.hp.current;
    expect(hpAfterHit).toBeLessThan(hpBefore);

    state = resolveSoloCombatInterception(state, interceptorId, () => 0);
    expect(state.world.actors[targetId].runtime.hp.current).toBeGreaterThan(hpAfterHit);
    expect(state.world.actors[interceptorId].runtime.resources.reaction).toBe(0);
    expect(state.log.some((entry) => entry.text.includes('Перехват: 1к10 (1) + БМ'))).toBe(true);
  });

  it('scene constructor adds fresh monsters and owned characters without replacing the retained fight', async () => {
    const participant = fighterSeed();
    const ally = wizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const activeBefore = activeId(state);
    const actorCountBefore = Object.keys(state.world.actors).length;
    const tokenPositionsBefore = new Set(Object.values(state.tokens).map(
      ({ position }) => `${position.x}:${position.y}`,
    ));

    state = addSoloCombatMonster({
      state,
      monster: goblin(),
      actions: [scimitar()],
      effects: [],
      rng: () => 0,
    });
    const addedMonster = Object.values(state.world.actors).find((actor) => (
      actor.kind === 'monster' && !tokenPositionsBefore.has(
        `${state.tokens[actor.id].position.x}:${state.tokens[actor.id].position.y}`,
      )
    ));
    expect(addedMonster).toBeDefined();
    expect(state.monsterActionIds[addedMonster!.id]).toHaveLength(1);
    expect(activeId(state)).toBe(activeBefore);
    expect(state.outcome).toBe('active');

    state = await addSoloCombatCharacter({ state, participant: ally, rng: () => 0 });
    expect(Object.keys(state.world.actors)).toHaveLength(actorCountBefore + 2);
    expect(state.controlledCharacterIds).toContain(ally.character.id);
    expect(state.sideByActorId[ally.character.id]).toBe('side:party');
    expect(state.playerActionIdsByActor?.[ally.character.id]).toEqual(expect.arrayContaining(
      ally.canonical.actions.map(({ id }) => id),
    ));
    expect(state.participantRuntimeRevisions?.[ally.character.id])
      .toBe(Number(ally.character.runtime_revision ?? 0));
    expect(activeId(state)).toBe(activeBefore);
    expect(new Set(Object.values(state.tokens).map(
      ({ position }) => `${position.x}:${position.y}`,
    )).size).toBe(Object.keys(state.tokens).length);
    expect(state.log.at(-1)?.text).toContain('Добавлен в бой');

    const restored = readSoloCombatState(
      writeSoloCombatState({}, state),
      participant.character.id,
      state.runtimeRevision,
    );
    expect(restored?.world.actors[addedMonster!.id]).toBeDefined();
    expect(restored?.world.actors[ally.character.id]).toBeDefined();
    expect(restored?.world.scene.mode).toBe('encounter');
    if (restored?.world.scene.mode !== 'encounter') throw new Error('expected encounter');
    expect(restored.world.scene.initiative).toEqual(restored.initiative.map(({ actorId }) => actorId));
  });

  it('refreshes retained participant actions, passives, runtime and revision from the current sheet', async () => {
    const original = fighterSeed();
    const ally = wizardSeed();
    const state = await createSoloCombatState({
      character: original.character,
      participant: original,
      allies: [ally],
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const activeBefore = activeId(state);
    const tokensBefore = clone(state.tokens);
    const logBefore = clone(state.log);
    const added: RuleActionDefinition = {
      id: 'd3000000-0000-4000-8000-000000000099',
      name: 'Добавлено с листа',
      kind: 'nonSpell',
      sourceEntityIds: ['manual-action'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        targeting: { domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1, range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'] },
        effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Ручное действие.' }] }],
      },
      targeting: { minTargets: 0, maxTargets: 1, rangeFt: 0, requiresLineOfSight: false, allowedRelations: ['self'] },
    };
    const refreshed = fighterSeed();
    const refreshedActor = refreshed.canonical.world.actors[refreshed.character.id];
    refreshedActor.capabilities.actionIds.push(added.id);
    refreshedActor.runtime.hp.current = 3;
    refreshedActor.passives = [{
      source: 'Новая черта',
      mechanics: { effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: 1 }] }] },
    }];
    const actions = [...refreshed.canonical.actions, added];
    const byId = new Map(actions.map((action) => [action.id, action]));
    refreshed.canonical = {
      ...refreshed.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    };
    refreshed.character.runtime_revision = 17;
    refreshed.actionPresentation = { [added.id]: { description: 'Ручное действие.' } };
    ally.character.runtime_revision = 8;

    const next = await refreshSoloCombatParticipants({
      state,
      participants: [refreshed, ally],
    });
    expect(next.playerActionIdsByActor?.[refreshed.character.id]).toContain(added.id);
    expect(next.world.actors[refreshed.character.id].capabilities.actionIds).toContain(added.id);
    expect(next.catalogActions.find(({ id }) => id === added.id)?.name).toBe('Добавлено с листа');
    expect(next.actionPresentation?.[added.id]?.description).toBe('Ручное действие.');
    expect(next.world.actors[refreshed.character.id].runtime.hp.current).toBe(3);
    expect(next.world.actors[refreshed.character.id].passives).toEqual(refreshedActor.passives);
    expect(next.participantRuntimeRevisions).toMatchObject({
      [refreshed.character.id]: 17,
      [ally.character.id]: 8,
    });
    expect(next.tokens).toEqual(tokensBefore);
    expect(next.log).toEqual(logBefore);
    expect(activeId(next)).toBe(activeBefore);
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

  it('offers a Monk Martial Arts bonus strike after a qualifying missed Unarmed Strike', async () => {
    const fixture = unarmedParticipant();
    const rider: RuleActionDefinition = {
      id: 'd2000000-0000-4000-8000-000000000003',
      name: 'Боевые искусства: безоружный удар', kind: 'nonSpell',
      sourceEntityIds: ['EFF-martial-arts'],
      mechanics: {
        activation: {
          mode: 'triggered', optional: true,
          trigger: {
            event: 'miss',
            source_action_card_numbers: ['action_basic_unarmed', 'action_basic_weapon'],
            source_weapon_qualifier: 'monk_weapon',
          },
          cost: [{ resource: 'bonus_action', amount: 1 }],
        },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
          max_targets: 1, range_ft: 5, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'unarmed', ability: 'dex', vs: 'ac',
          on_hit: [{ kind: 'damage', amount: '1d6 + dex', type: 'bludgeoning' }],
        }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 5,
        requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
    };
    const actor = fixture.participant.canonical.world.actors[fixture.participant.character.id];
    actor.capabilities.actionIds.push(rider.id);
    actor.runtime.resources.bonus_action = 1;
    actor.runtime.maxResources.bonus_action = 1;
    const actions = [...fixture.participant.canonical.actions, rider];
    const byId = new Map(actions.map((action) => [action.id, action]));
    fixture.participant.canonical = {
      ...fixture.participant.canonical,
      actions,
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    };
    fixture.participant.character.resources = clone(actor.runtime.resources);
    fixture.participant.character.max_resources = clone(actor.runtime.maxResources);

    let state = await createSoloCombatState({
      character: fixture.participant.character,
      participant: fixture.participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = fixture.participant.character.id;
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    state = placeAdjacent(state, actorId, monsterId);
    state = executeCombatAction({
      state, actorId, actionId: fixture.action.id, targetIds: [monsterId],
      choices: { [UNARMED_STRIKE_CHOICE_ID]: ['damage'] }, rng: () => 0,
    });

    expect(state.pendingTriggeredAction).toEqual(expect.objectContaining({
      event: 'miss', sourceActionId: fixture.action.id,
      optionActionIds: [rider.id], targetIds: [monsterId],
    }));
    state = resolveTriggeredCombatAction(state, rider.id, () => 0.99);
    expect(state.pendingTriggeredAction).toBeUndefined();
    expect(state.world.actors[actorId].runtime.resources.bonus_action).toBe(0);
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

  it('treats a controlled self-target click as explicit Mage Armor consent', async () => {
    const participant = mageArmorWizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const mageArmor = state.catalogActions.find((action) => (
      state.playerActionIds.includes(action.id)
      && action.targeting?.requiresWilling
      && action.targeting?.requiresUnarmored
    ));
    expect(mageArmor, 'Wizard should expose certified Mage Armor').toBeDefined();
    const slotBefore = state.world.actors[actorId].runtime.resources.spell_slot_1;

    state = executeCombatAction({
      state,
      actorId,
      actionId: mageArmor!.id,
      targetIds: [actorId],
      rng: () => 0,
    });

    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.world.actors[actorId].runtime.resources.spell_slot_1).toBe(slotBefore - 1);
    expect(state.world.actors[actorId].runtime.activeEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: mageArmor!.name, sourceId: actorId, roundsLeft: 4_800 }),
    ]));
    expect(state.log.at(-1)?.text).toContain(mageArmor!.name);
  });

  it('casts, displays, persists, and moves Dancing Lights from tactical map facts', async () => {
    const participant = dancingLightsWizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const dancingLights = state.catalogActions.find((action) => (
      state.playerActionIds.includes(action.id) && primitive(action) === 'dancing_lights_world'
    ));
    expect(dancingLights, 'Wizard should expose certified Dancing Lights').toBeDefined();
    const source = state.tokens[actorId].position;
    const castPosition = { x: source.x < 10 ? source.x + 2 : source.x - 2, y: source.y };
    const boardRevisionBeforeCast = state.boardRevision;

    state = executeCombatAction({
      state,
      actorId,
      actionId: dancingLights!.id,
      targetIds: [],
      worldPosition: castPosition,
      worldInput: {
        type: 'dancing_lights',
        form: 'individual',
        placements: Array.from({ length: 4 }, () => ({
          distanceFromCasterFt: gridDistanceFt(source, castPosition),
          withinRequiredSeparation: true,
        })),
        facts: {
          factsSource: 'board',
          boardRevision: state.boardRevision,
          distanceFt: gridDistanceFt(source, castPosition),
          lineOfSight: true,
        },
      },
      rng: () => 0,
    });

    const lights = Object.values(state.world.objects).filter((object) => (
      object.sourceActorId === actorId && object.sourceActionId === dancingLights!.id && object.dancingLight
    ));
    expect(lights).toHaveLength(4);
    const light = lights[0];
    expect(lights.map((candidate) => state.worldObjectPositions?.[candidate.id]))
      .toEqual(Array.from({ length: 4 }, () => castPosition));
    expect(lights.map((candidate) => candidate.distanceFromSourceFt)).toEqual([10, 10, 10, 10]);
    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.world.concentrations[actorId]?.actionId).toBe(dancingLights!.id);
    expect(state.boardRevision).toBe(boardRevisionBeforeCast + 1);

    const movePosition = { ...castPosition, y: castPosition.y < 9 ? castPosition.y + 1 : castPosition.y - 1 };
    const bonusBefore = state.world.actors[actorId].runtime.resources.bonus_action;
    state = moveCombatDancingLights({
      state,
      actorId,
      groupId: light!.dancingLight!.groupId,
      destination: movePosition,
      rng: () => 0,
    });
    expect(state.worldObjectPositions?.[light!.id]).toEqual(movePosition);
    expect(state.world.actors[actorId].runtime.resources.bonus_action).toBe(bonusBefore - 1);
    expect(state.log.at(-1)?.text).toContain('Танцующие огоньки: перемещение');

    const restored = readSoloCombatState(
      writeSoloCombatState({}, state),
      participant.character.id,
      state.runtimeRevision,
    );
    expect(restored?.worldObjectPositions?.[light!.id]).toEqual(movePosition);
  });

  it('shows Detect Magic concentration and reveals nearby board-owned auras with its Magic action', async () => {
    const participant = detectMagicWizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const detectMagic = state.catalogActions.find((action) => primitive(action) === 'detect_magic_world_sensing');
    expect(detectMagic).toBeDefined();
    const source = state.tokens[actorId].position;
    state = {
      ...state,
      world: {
        ...state.world,
        objects: {
          ...state.world.objects,
          rune: {
            id: 'rune', name: 'Руна защиты', kind: 'spell_effect', size: 'small',
            magicalAura: { school: 'abjuration', createdBySpell: true, visible: true },
          },
        },
      },
      worldObjectPositions: {
        ...state.worldObjectPositions,
        rune: { x: source.x < 10 ? source.x + 2 : source.x - 2, y: source.y },
      },
    };

    state = executeCombatAction({ state, actorId, actionId: detectMagic!.id, targetIds: [actorId], rng: () => 0 });
    expect(combatDetectMagicStatus(state, actorId)).toEqual(expect.objectContaining({
      actionName: 'Обнаружение магии', radiusFt: 30, sensedObjectNames: ['Руна защиты'],
    }));

    state = refreshSoloCombatResources(state, actorId);
    state = revealCombatMagicAura({ state, actorId, rng: () => 0 });
    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.log.at(-1)?.text).toContain('Руна защиты: видна магическая аура (ограждение)');

    state = refreshSoloCombatResources({
      ...state,
      world: { ...state.world, objects: {} },
      worldObjectPositions: {},
    }, actorId);
    state = revealCombatMagicAura({ state, actorId, rng: () => 0 });
    expect(state.log.at(-1)?.text).toContain('магических аур не обнаружено');
  });

  it('casts, describes, positions, and persists Minor Illusion from explicit board input', async () => {
    const participant = wizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const minorIllusion = state.catalogActions.find((action) => (
      state.playerActionIds.includes(action.id) && primitive(action) === 'minor_illusion_world_object'
    ));
    expect(minorIllusion, 'Wizard should expose certified Minor Illusion').toBeDefined();
    const source = state.tokens[actorId].position;
    const castPosition = { x: source.x < 9 ? source.x + 3 : source.x - 3, y: source.y };
    const distanceFt = gridDistanceFt(source, castPosition);
    const boardRevisionBeforeCast = state.boardRevision;

    state = executeCombatAction({
      state,
      actorId,
      actionId: minorIllusion!.id,
      targetIds: [],
      worldPosition: castPosition,
      worldInput: {
        type: 'minor_illusion',
        form: 'sound',
        description: 'Звон серебряного колокольчика',
        facts: {
          factsSource: 'board',
          boardRevision: state.boardRevision,
          distanceFt,
          lineOfSight: true,
        },
      },
      rng: () => 0,
    });

    const illusion = Object.values(state.world.objects).find((object) => (
      object.sourceActorId === actorId
      && object.sourceActionId === minorIllusion!.id
      && object.illusion
    ));
    expect(illusion?.illusion).toMatchObject({
      form: 'sound',
      description: 'Звон серебряного колокольчика',
      spellSaveDc: 12,
    });
    expect(state.worldObjectPositions?.[illusion!.id]).toEqual(castPosition);
    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.boardRevision).toBe(boardRevisionBeforeCast + 1);
    expect(state.log.at(-1)?.text).toContain('Звон серебряного колокольчика');
    expect(state.log.at(-1)?.text).toContain('Расследование');
    expect(state.log.at(-1)?.text).toContain('СЛ 12');

    const restored = readSoloCombatState(
      writeSoloCombatState({}, state),
      participant.character.id,
      state.runtimeRevision,
    );
    expect(restored?.world.objects[illusion!.id].illusion?.description)
      .toBe('Звон серебряного колокольчика');
    expect(restored?.worldObjectPositions?.[illusion!.id]).toEqual(castPosition);
  });

  it('keeps the selected Prestidigitation sensory effect visible in the combat journal', async () => {
    const participant = prestidigitationWizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const prestidigitation = state.catalogActions.find((action) => (
      state.playerActionIds.includes(action.id) && primitive(action) === 'prestidigitation_world'
    ));
    expect(prestidigitation, 'Wizard should expose certified Prestidigitation').toBeDefined();
    const source = state.tokens[actorId].position;
    const castPosition = { x: source.x < 10 ? source.x + 2 : source.x - 2, y: source.y };

    state = executeCombatAction({
      state,
      actorId,
      actionId: prestidigitation!.id,
      targetIds: [],
      worldPosition: castPosition,
      worldInput: {
        type: 'prestidigitation',
        option: {
          kind: 'sensory_effect',
          description: 'Запах хвои и искры',
          facts: {
            factsSource: 'board',
            boardRevision: state.boardRevision,
            distanceFt: gridDistanceFt(source, castPosition),
            lineOfSight: true,
          },
        },
      },
      rng: () => 0,
    });

    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.log.at(-1)?.text).toContain('сенсорный эффект «Запах хвои и искры»');
    expect(Object.values(state.world.objects).some((object) => (
      object.tags?.includes('instantaneous_sensory_effect')
    ))).toBe(false);
  });

  it('casts Light on a newly described object without inventing a self actor target', async () => {
    const participant = lightWizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const light = state.catalogActions.find((action) => primitive(action) === 'light_world_object');
    expect(light).toBeDefined();
    const castPosition = state.tokens[actorId].position;
    const targetIds = selectedTargetsForAction({
      state, actorId, actionId: light!.id,
      clickedActorId: actorId, clickedPosition: castPosition,
    });
    expect(targetIds).toEqual([]);
    const token = {
      id: 'object:copper-token', name: 'медный жетон', kind: 'item' as const,
      size: 'tiny' as const, unattended: true,
    };
    const boardRevisionBefore = state.boardRevision;

    state = executeCombatAction({
      state,
      actorId,
      actionId: light!.id,
      targetIds,
      worldPosition: castPosition,
      scenarioObjects: [token],
      worldInput: {
        type: 'target_object', objectId: token.id,
        facts: {
          factsSource: 'board', boardRevision: state.boardRevision,
          distanceFt: 0, lineOfSight: true, touched: true,
        },
      },
      rng: () => 0,
    });

    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.world.objects[token.id].illumination).toMatchObject({
      brightRadiusFt: 20, dimAdditionalRadiusFt: 20, roundsLeft: 600,
      sourceActorId: actorId, sourceActionId: light!.id,
    });
    expect(state.worldObjectPositions?.[token.id]).toEqual(castPosition);
    expect(state.boardRevision).toBe(boardRevisionBefore + 1);
    expect(state.log.at(-1)?.text).toContain('медный жетон: яркий свет 20 фт.');
    expect(state.log.at(-1)?.text).toContain('тусклый свет ещё 20 фт.');
    expect(state.log.at(-1)?.text).toContain('600 раундов');

    const restored = readSoloCombatState(
      writeSoloCombatState({}, state), participant.character.id, state.runtimeRevision,
    );
    expect(restored?.world.objects[token.id].illumination?.roundsLeft).toBe(600);
    expect(restored?.worldObjectPositions?.[token.id]).toEqual(castPosition);
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

  it('moves a caster token to the chosen legal destination for a teleport action', async () => {
    const participant = fighterSeed();
    const teleport: RuleActionDefinition = {
      id: 'd1000000-0000-4000-8000-000000000099',
      name: 'Тестовая телепортация',
      kind: 'spell',
      spell: { level: 0 },
      sourceEntityIds: ['test-feat', 'test-teleport'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'self', min_targets: 1, max_targets: 1, allowed_relations: ['self'] },
        effects: [{ resolution: 'auto', result: [{ kind: 'movement', value: 'teleport', distance: '15' }] }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 0,
        requiresLineOfSight: false, allowedRelations: ['self'],
      },
    };
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.capabilities.actionIds.push(teleport.id);
    actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
    actor.spellcastingAccess.grants.push({
      grantId: 'test-teleport-grant', actionId: teleport.id, sourceId: 'test-feat',
      access: 'cantrip', level: 0, spellcastingAbility: 'int',
    });
    const actions = [...participant.canonical.actions, teleport];
    const byId = new Map(actions.map((action) => [action.id, action]));
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
    const source = state.tokens[actorId].position;
    const destination = { x: source.x - 1, y: source.y };
    state = executeCombatAction({
      state, actorId, actionId: teleport.id, targetIds: [actorId], worldPosition: destination, rng: () => 0,
    });
    expect(state.tokens[actorId].position).toEqual(destination);
    expect(state.log.at(-1)?.text).toContain('телепортация 5 фт.');
    expect(state.log.at(-1)?.records?.find((record) => record.event?.type === 'movement')?.event)
      .toMatchObject({ type: 'movement', mode: 'teleport', distanceFt: 5 });
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

  it('ends a monster turn cleanly when Charmed forbids every living target', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state.world.actors[monsterId].runtime.activeEffects.push({
      id: 'friends:charmed', name: 'Очарованный', source: 'Дружба',
      ownerId: monsterId, sourceId: participant.character.id,
      mechanics: { kind: 'condition', value: 'charmed', op: 'apply' },
    });
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);

    expect(() => { state = runMonsterTurn(state, () => 0.5); }).not.toThrow();
    expect(activeId(state)).toBe(participant.character.id);
    expect(state.log.some((entry) => entry.text.includes('Нет допустимой цели'))).toBe(true);
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
