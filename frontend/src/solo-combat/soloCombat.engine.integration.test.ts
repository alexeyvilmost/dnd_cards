import { describe, expect, it } from 'vitest';
import {readFileSync} from 'node:fs';
import {projectRuleAction} from '../canon/ruleActionProjection';
import { stepRoguelikeCombat, type RoguelikeCombatEnvelope } from '../roguelike/combatWorker';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import fightingStyleDefinitions from '../../../scripts/content/data/mini-mvp-complex-fighting-styles.v1.json';
import { createWorld, type ActorState, type RuleActionDefinition, type RulesCatalog, type RulesetReference } from '../rules-core/domain';
import { CARD_LONGSWORD, CARD_SHIELD } from '../mvp/fixtures';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { Action } from '../types';
import type { Monster } from '../monsters/types';
import { resolvePlayerShoveOutcome, resumePendingMovement, addSoloCombatCharacter, addSoloCombatMonster, advanceTurn, canStandActor, standActor, autoResolveSystemDecisions, combatDetectMagicStatus, createSoloCombatState, executeCombatAction, moveActor, moveCombatDancingLights, refreshSoloCombatParticipants, refreshSoloCombatResources, revealCombatMagicAura, resolvePlayerReaction, resolveSoloCombatAlertSwap, resolveSoloCombatInterception, resolveSoloCombatTurnStart, resolveTriggeredCombatAction, runMonsterTurn, selectedTargetsForAction, setSoloCombatInitiativeTotals, setSoloCombatMount } from './engine';
import { readSoloCombatState, writeSoloCombatState } from './persistence';
import { actorMustCrawl, gridDistanceFt } from './tacticalGrid';
import { isPlayerControlledCombatActor, SOLO_COMBAT_KEY, type SoloCombatState } from './types';
import { UNARMED_STRIKE_CHOICE_ID } from './actionChoices';
import {monsterRouteOpportunityRisk, moveActorAlongRoute} from './engine';
import {planMonsterTurn} from './monsterAi';
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

function thunderclapWizardSeed(): SheetCombatParticipantSeed {
  const participant = wizardSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'd9000000-0000-4000-8000-000000000005',
    name: 'Раскат грома',
    kind: 'spell',
    spell: { level: 0 },
    sourceEntityIds: ['SPELL-thunderclap'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'area',
        area: { kind: 'emanation', size_ft: 5 },
        min_targets: 0, max_targets: 8, range_ft: 0,
        requires_line_of_sight: false, allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'save', who: 'target', ability: 'con', dc: 10,
        on_fail: [{ kind: 'damage', dice: '1d6', type: 'thunder' }],
        on_success: [],
      }],
    },
    targeting: {
      minTargets: 0, maxTargets: 8, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: ['enemy'],
    },
  };
  actor.capabilities.actionIds.push(action.id);
  actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
  actor.spellcastingAccess.grants.push({
    grantId: 'test-thunderclap-grant', actionId: action.id, sourceId: 'test-wizard',
    access: 'cantrip', level: 0, spellcastingAbility: 'int',
  });
  const actions = [...participant.canonical.actions, action];
  const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
  participant.canonical.actions = actions;
  participant.canonical.catalog = {
    getAction: (id) => byId.get(id),
    listActions: () => actions,
  };
  return participant;
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

function monsterUnarmedStrike(): Action {
  return {
    id: 'a1000000-0000-4000-8000-000000000098', name: 'Безоружный удар', description: '',
    rarity: 'common', card_number: 'action_basic_unarmed', resource: 'action',
    action_type: 'base_action', type: 'basic', created_at: '', updated_at: '',
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      effects: [{
        ability: 'str', attack_kind: 'unarmed', resolution: 'attack_roll', vs: 'ac',
        on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
      }],
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 5, requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
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
  const ids: Record<string, string> = {
    action_basic_dash: 'a1000000-0000-4000-8000-000000000001',
    action_basic_disengage: 'a1000000-0000-4000-8000-000000000002',
    action_help: 'a1000000-0000-4000-8000-000000000003',
  };
  return {
    id: ids[cardNumber] ?? 'a1000000-0000-4000-8000-000000000099',
    name, description: '', rarity: 'common', card_number: cardNumber,
    resource: 'action', action_type: 'base_action', type: 'basic',
    mechanics, created_at: '', updated_at: '',
  } as Action;
}

const dash = () => basicAction('action_basic_dash', 'Рывок', {
  activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
  effects: [{ resolution: 'auto', result: [{
    kind: 'modifier', op: 'add', value: 'character_speed',
    applies_to: { roll: 'speed' }, duration: { type: 'until_start_of_next_turn' },
  }] }],
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

const help = () => basicAction('action_help', 'Помощь', {
  activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
  effects: [{ resolution: 'auto', result: [{ kind: 'narrative' }] }],
  targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['ally'] },
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

function wildCompanionParticipant(): { participant: SheetCombatParticipantSeed; action: RuleActionDefinition } {
  const participant = fighterSeed();
  const actor = participant.canonical.world.actors[participant.character.id];
  const action: RuleActionDefinition = {
    id: 'a1000000-0000-4000-8000-000000000005',
    name: 'Дикий спутник',
    kind: 'nonSpell',
    sourceEntityIds: ['EFF-wild-companion'],
    targeting: {
      minTargets: 0, maxTargets: 0, rangeFt: 10,
      requiresLineOfSight: false, allowedRelations: [],
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'wild_shape' }] },
      targeting: {
        domain: 'world', actor_targets: false, shape: 'single', min_targets: 0,
        max_targets: 0, range_ft: 10, requires_line_of_sight: false, allowed_relations: [],
      },
      primitive: {
        type: 'wild_companion',
        policy: {
          connection_range_ft: 100,
          reappear_range_ft: 30,
          ritual_casting_added_seconds: 600,
        },
      },
      effects: [],
    },
  };
  actor.capabilities.actionIds.push(action.id);
  actor.capabilities.featureSources = {
    ...(actor.capabilities.featureSources ?? {}),
    [action.id]: ['EFF-wild-companion'],
  };
  actor.runtime.resources.action = 1;
  actor.runtime.maxResources.action = 1;
  actor.runtime.resources.wild_shape = 2;
  actor.runtime.maxResources.wild_shape = 2;
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
  it('offers additional movement only after its source action, persists the separate allowance and preserves normal movement/reactions', async () => {
    const participant = fighterSeed();
    const actorId = participant.character.id;
    const owner = participant.canonical.world.actors[actorId];
    const heal: RuleActionDefinition = {
      id: 'd2070000-0000-4000-8000-000000000001', name: 'Second Wind', kind: 'nonSpell', sourceEntityIds: ['test-second-wind'],
      mechanics: {activation: {mode: 'active', cost: [{resource: 'bonus_action'}]},
        effects: [{resolution: 'auto', result: [{kind: 'healing', amount: 1}]}]},
    };
    const shift = projectRuleAction({
      id: 'd2070000-0000-4000-8000-000000000002', name: 'Tactical Shift', resource: 'free_action', type: 'class_ability',
      mechanics: JSON.parse(readFileSync(new URL('../../../backend/migrations/fighter_tactical_shift_207.go', import.meta.url), 'utf8').match(/const tacticalShiftMechanics207 = `([^`]+)`/)![1]),
    } as Action);
    const actions = [...participant.canonical.actions, heal, shift];
    owner.capabilities.actionIds.push(heal.id, shift.id);
    participant.canonical = {...participant.canonical, actions, catalog: {getAction: id => actions.find(a => a.id === id), listActions: () => actions}};
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster: goblin(), quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const enemyId = Object.values(state.world.actors).find(actor => actor.kind === 'monster')!.id;
    state = placeAdjacent(state, actorId, enemyId);
    state.actionPresentation = {...state.actionPresentation, [heal.id]: {actionRef: {card_number: 'ACT-second-wind'} as Action}};
    const artifactHash = `sha256:${'a'.repeat(64)}`;
    const envelope = (value: SoloCombatState): RoguelikeCombatEnvelope => ({schemaVersion: 1, artifactHash, entropy: {seed: 'tactical-shift', cursor: 0}, state: value});
    expect(() => stepRoguelikeCombat(envelope(state), {type: 'action', actorId, actionId: shift.id, targetIds: []}, artifactHash)).toThrow('события');
    const used = executeCombatAction({state, actorId, actionId: heal.id, targetIds: [], rng: () => 0.5});
    expect(used.pendingTriggeredAction?.optionActionIds).toEqual([shift.id]);
    expect(used.world.actors[actorId].runtime.resources.bonus_action).toBe(0);
    const offered = resolveTriggeredCombatAction(clone(used), shift.id, () => {throw new Error('movement must not roll');});
    expect(offered.pendingAdditionalMovement?.remainingFt).toBeGreaterThanOrEqual(15);
    const normal = offered.movementRemainingFt[actorId];
    const origin = offered.tokens[actorId].position;
    expect(() => stepRoguelikeCombat(envelope(offered), {type: 'end_turn', actorId}, artifactHash)).toThrow();
    const moved = moveActorAlongRoute({state: clone(offered), actorId, destination: {x: origin.x - 3, y: origin.y}, rng: () => {throw new Error('no opportunity attack');}});
    expect(moved.tokens[actorId].position).toEqual({x: origin.x - 3, y: origin.y});
    expect(moved.pendingAdditionalMovement).toBeUndefined();
    expect(moved.playerMovement).toBeUndefined();
    expect(moved.movementRemainingFt[actorId]).toBe(normal);
    expect(moved.world.actors[enemyId].runtime.resources.reaction).toBe(1);
    const declined = stepRoguelikeCombat(envelope(clone(offered)), {type: 'decline_movement', actorId}, artifactHash).envelope.state;
    expect(declined.pendingAdditionalMovement).toBeUndefined();
    expect(declined.movementRemainingFt[actorId]).toBe(normal);
    expect(activeId(declined)).toBe(actorId);
    const ordinary = moveActorAlongRoute({state: declined, actorId, destination: {x: origin.x - 3, y: origin.y}, rng: () => 0});
    expect(ordinary.world.actors[enemyId].runtime.resources.reaction).toBe(0);
    expect(ordinary.movementRemainingFt[actorId]).toBe(normal - 15);
  });

  it('keeps a compiled undead monster alive after a lethal hit, then ends combat on a failed save after reload', async () => {
    const participant = fighterSeed();
    const actorId = participant.character.id;
    const incomingRow = clone(scimitar());
    incomingRow.id = 'b2050000-0000-4000-8000-000000000001';
    incomingRow.mechanics = {...incomingRow.mechanics, effects: [{resolution: 'attack_roll', ability: 'str',
      attack_kind: 'weapon_melee', attack_bonus_override: 10, vs: 'ac',
      on_hit: [{kind: 'damage', amount: 3, type: 'slashing'}]}]};
    const incoming = projectRuleAction(incomingRow);
    participant.canonical.world.actors[actorId].capabilities.actionIds.push(incoming.id);
    const actions = [...participant.canonical.actions, incoming];
    participant.canonical = {...participant.canonical, actions, catalog: {
      getAction: id => actions.find(action => action.id === id), listActions: () => actions,
    }};
    const monster = {...goblin(), max_hp: 3, armor_class: 8,
      abilities: {...goblin().abilities, con: 16}, ai: {undead_fortitude: true}};
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster, quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const monsterId = Object.values(state.world.actors).find(actor => actor.kind === 'monster')!.id;
    state = placeAdjacent(state, actorId, monsterId);
    let criticalDraws = 0;
    const critical = executeCombatAction({state: clone(state), actorId, actionId: incoming.id,
      targetIds: [monsterId], rng: () => {criticalDraws++; return 0.99;}});
    expect(criticalDraws).toBe(1);
    expect(critical.outcome).toBe('victory');
    const radiantState = clone(state);
    const radiantAction = radiantState.catalogActions.find(action => action.id === incoming.id)!;
    radiantAction.mechanics.effects = [{resolution: 'attack_roll', ability: 'str',
      attack_kind: 'weapon_melee', attack_bonus_override: 10, vs: 'ac',
      on_hit: [{kind: 'damage', amount: 3, type: 'radiant'}]}];
    let radiantDraws = 0;
    const radiant = executeCombatAction({state: radiantState, actorId, actionId: incoming.id,
      targetIds: [monsterId], rng: () => {radiantDraws++; return 0.2;}});
    expect(radiantDraws).toBe(1);
    expect(radiant.outcome).toBe('victory');
    let draws = 0;
    state = executeCombatAction({state, actorId, actionId: incoming.id, targetIds: [monsterId],
      rng: () => {draws++; return 0.2;}});
    expect(draws).toBe(2);
    expect(state.world.actors[monsterId].runtime.hp.current).toBe(1);
    expect(state.outcome).toBe('active');
    state = clone(state);
    state.world.actors[actorId].runtime.resources.action = 1;
    const dice = [0.5, 0];
    state = executeCombatAction({state, actorId, actionId: incoming.id, targetIds: [monsterId], rng: () => dice.shift()!});
    expect(dice).toHaveLength(0);
    expect(state.world.actors[monsterId].runtime.hp.current).toBe(0);
    expect(state.outcome).toBe('victory');
  });

  async function parryEncounter(attackKind = 'weapon_melee', held = true, monsterAttacks = 1, quantity = 1) {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    const incomingRow = clone(scimitar());
    incomingRow.id = 'b2040000-0000-4000-8000-000000000002';
    incomingRow.mechanics = {...incomingRow.mechanics, effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: attackKind,
      attack_bonus_override: 10, vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'slashing'}]}]};
    const incoming = projectRuleAction(incomingRow);
    actor.capabilities.actionIds.push(incoming.id);
    const actions = [...participant.canonical.actions, incoming];
    participant.canonical = {...participant.canonical, actions, catalog: {
      getAction: id => actions.find(action => action.id === id), listActions: () => actions,
    }};
    const parry = {...basicAction('parry-test', 'Парирование', {
      activation: {mode: 'reaction', trigger: {event: 'hit_by_attack', melee_attack_while_holding_weapon: true}, cost: [{resource: 'reaction', amount: 1}]},
      effects: [], attack_defense: {scope: 'triggering_attack', ac_bonus: 2},
      targeting: {domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1, range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self']},
    }), type: 'monster', action_type: 'base_action', resource: 'reaction'} as Action;
    const monster = {...goblin(), max_hp: 100, action_ids: [scimitar().id, parry.id],
      ai: {...goblin().ai, held_weapon_card: CARD_LONGSWORD}};
    const monsterAttack = scimitar();
    monsterAttack.mechanics = {...monsterAttack.mechanics, effects: Array.from({length: monsterAttacks}, () => ({
      resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', attack_bonus_override: 10,
      vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'slashing'}],
    }))};
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster, quantity}], actions: [monsterAttack, parry], effects: [], rng: () => 0.5});
    const monsterId = Object.values(state.world.actors).find(row => row.kind === 'monster')!.id;
    state = placeAdjacent(state, actor.id, monsterId);
    if (!held) state.world.actors[monsterId].runtime.equipment = {};
    return {state, actorId: actor.id, monsterId, actionId: incoming.id, parryId: parry.id};
  }

  it.each([true, false])('keeps the mover in place until a saved Parry decision settles (%s)', async parry => {
    const setup = await parryEncounter();
    let state = setup.state;
    const player = state.world.actors[setup.actorId];
    player.ac = 15;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    player.capabilities.actionIds.push(setup.parryId);
    player.runtime.equipment.main_hand = CARD_LONGSWORD.id;
    player.character.knownCards = [...(player.character.knownCards ?? []), CARD_LONGSWORD];
    state.tokens[setup.actorId].position = {x: 4, y: 4};
    state.tokens[setup.monsterId].position = {x: 5, y: 4};
    const feet = state.movementRemainingFt[setup.actorId];
    let draws = 0;
    state = moveActor({...setup, state, destination: {x: 3, y: 4}, rng: () => {draws++; return 0.2;}});
    expect(draws).toBe(1);
    expect(state.world.pendingResolution?.type).toBe('attack_reaction');
    expect(state.tokens[setup.actorId].position).toEqual({x: 4, y: 4});
    expect(state.movementRemainingFt[setup.actorId]).toBe(feet);
    expect(state.pendingMovementStep?.processedOpportunityActorIds).toEqual([setup.monsterId]);
    state = resolvePlayerReaction(clone(state), {kind: 'reaction', actionId: parry ? setup.parryId : null},
      () => {throw Error('The saved attack must not reroll');});
    state = resumePendingMovement(clone(state), () => {throw Error('The opportunity must not repeat');});
    expect(state.tokens[setup.actorId].position).toEqual({x: 3, y: 4});
    expect(state.movementRemainingFt[setup.actorId]).toBe(feet - 5);
    expect(state.world.actors[setup.actorId].runtime.hp.current).toBe(parry ? 100 : 97);
    expect(state.pendingMovementStep).toBeUndefined();
    expect(activeId(state)).toBe(setup.actorId);
    expect(resumePendingMovement(clone(state))).toEqual(state);
  });

  it.each([true, false])('resumes an entire player route after Parry without repeating its attack (%s)', async parry => {
    const setup = await parryEncounter();
    let state = setup.state;
    const player = state.world.actors[setup.actorId];
    player.ac = 15;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    player.capabilities.actionIds.push(setup.parryId);
    player.runtime.equipment.main_hand = CARD_LONGSWORD.id;
    player.character.knownCards = [...(player.character.knownCards ?? []), CARD_LONGSWORD];
    state.tokens[setup.actorId].position = {x: 4, y: 4};
    state.tokens[setup.monsterId].position = {x: 5, y: 4};
    const feet = state.movementRemainingFt[setup.actorId];
    let draws = 0;
    state = moveActorAlongRoute({state, actorId: setup.actorId, destination: {x: 0, y: 4}, rng: () => {draws++; return 0.2;}});
    expect(draws).toBe(1);
    expect(state.tokens[setup.actorId].position).toEqual({x: 4, y: 4});
    expect(state.playerMovement?.steps).toHaveLength(4);
    expect(() => moveActorAlongRoute({state, actorId: setup.actorId, destination: {x: 1, y: 4}})).toThrow();
    const noRoll = () => {throw Error('The saved reaction must not roll again');};
    state = resolvePlayerReaction(clone(state), {kind: 'reaction', actionId: parry ? setup.parryId : null}, noRoll);
    state = resumePendingMovement(clone(state), noRoll);
    expect(state.tokens[setup.actorId].position).toEqual({x: 0, y: 4});
    expect(state.world.actors[setup.actorId].runtime.hp.current).toBe(parry ? 100 : 97);
    expect(state.movementRemainingFt[setup.actorId]).toBe(feet - 20);
    expect(state.playerMovement).toBeUndefined();
    expect(state.pendingMovementStep).toBeUndefined();
    expect(resumePendingMovement(clone(state), noRoll)).toEqual(state);
  });

  it('preserves the remaining reactors across two saved decisions without moving or rerolling early', async () => {
    const setup = await parryEncounter('weapon_melee', true, 1, 2);
    let state = setup.state;
    const player = state.world.actors[setup.actorId];
    player.ac = 15;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    player.capabilities.actionIds.push(setup.parryId);
    player.runtime.equipment.main_hand = CARD_LONGSWORD.id;
    player.character.knownCards = [...(player.character.knownCards ?? []), CARD_LONGSWORD];
    const enemies = Object.values(state.world.actors).filter(row => row.kind === 'monster');
    state.tokens[setup.actorId].position = {x: 4, y: 4};
    enemies.forEach((enemy, index) => {state.tokens[enemy.id].position = {x: 5, y: 4 + index};});
    let draws = 0;
    const rng = () => {draws++; return 0.2;};
    const noReroll = () => {throw Error('Decision must not reroll');};
    state = moveActor({...setup, state, destination: {x: 3, y: 4}, rng});
    state = resolvePlayerReaction(clone(state), {kind: 'reaction', actionId: null}, noReroll);
    state = resumePendingMovement(clone(state), rng);
    expect(draws).toBe(2);
    expect(state.world.pendingResolution?.type).toBe('attack_reaction');
    expect(state.tokens[setup.actorId].position).toEqual({x: 4, y: 4});
    expect(state.pendingMovementStep?.processedOpportunityActorIds).toHaveLength(2);
    state = resolvePlayerReaction(clone(state), {kind: 'reaction', actionId: setup.parryId}, noReroll);
    state = resumePendingMovement(clone(state), noReroll);
    expect(state.world.actors[setup.actorId].runtime.hp.current).toBe(97);
    expect(state.tokens[setup.actorId].position).toEqual({x: 3, y: 4});
    expect(state.pendingMovementStep).toBeUndefined();
    enemies.forEach(enemy => expect(state.world.actors[enemy.id].runtime.resources.reaction).toBe(0));
  });

  it('offers ordinary and War Caster reactions before movement and does not reopen a declined choice', async () => {
    const participant = fighterSeed();
    const player = participant.canonical.world.actors[participant.character.id];
    player.passives = [...(player.passives ?? []), {kind: 'modifier', op: 'set', value: 1,
      applies_to: {roll: 'reaction'}, reason: 'war_caster_opportunity_spell'}];
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster: goblin(), quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    // This fixture has no weapon-attack primitive; install a normal melee
    // reaction to isolate movement continuation from weapon loadout assembly.
    const ordinary = projectRuleAction({...scimitar(), id: 'test-ordinary-opportunity',
      mechanics: {...scimitar().mechanics, activation: {mode: 'reaction',
        cost: [{resource: 'reaction', amount: 1}], trigger: {events: ['opportunity_attack']}}}});
    state.catalogActions.push(ordinary);
    state.world.actors[player.id].capabilities.actionIds.push(ordinary.id);
    state.opportunityActionIds[player.id] = ordinary.id;
    const monster = Object.values(state.world.actors).find(row => row.kind === 'monster')!;
    state.tokens[player.id].position = {x: 4, y: 4};
    state.tokens[monster.id].position = {x: 5, y: 4};
    const noRoll = () => {throw Error('Declining a reaction must not roll');};
    state = moveActor({state, actorId: monster.id, destination: {x: 6, y: 4}, rng: noRoll});
    expect(state.pendingTriggeredAction?.event).toBe('opportunity_attack');
    expect(state.pendingTriggeredAction?.optionActionIds).toContain(state.opportunityActionIds[player.id]);
    expect(state.pendingTriggeredAction?.optionActionIds.some(id => id.endsWith(':war-caster-opportunity'))).toBe(true);
    expect(state.tokens[monster.id].position).toEqual({x: 5, y: 4});
    state = resolveTriggeredCombatAction(clone(state), null, noRoll);
    state = resumePendingMovement(clone(state), noRoll);
    expect(state.tokens[monster.id].position).toEqual({x: 6, y: 4});
    expect(state.world.actors[player.id].runtime.resources.reaction).toBe(1);
    expect(state.pendingMovementStep).toBeUndefined();
    expect(state.pendingTriggeredAction).toBeUndefined();
  });

  it.each([0, 80, 160])('applies Sentinel after a saved hit decision with log cursor %i', async cursor => {
    const setup = await parryEncounter();
    let state = setup.state;
    if (cursor) state.log = Array.from({length: 80}, (_, index) => ({id: `old:${index}`,
      ...(cursor > 80 ? {sequence: cursor - 79 + index} : {}),
      actorId: setup.actorId, round: 1, text: 'Earlier unrelated event'}));
    const player = state.world.actors[setup.actorId];
    player.ac = 15;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    player.capabilities.actionIds.push(setup.parryId);
    player.runtime.equipment.main_hand = CARD_LONGSWORD.id;
    player.character.knownCards = [...(player.character.knownCards ?? []), CARD_LONGSWORD];
    const enemy = state.world.actors[setup.monsterId];
    const stop = projectRuleAction(basicAction('test-sentinel-stop', 'Stop', {
      activation: {mode: 'triggered', trigger: {event: 'hit', feat_sentinel_opportunity: true}, cost: []},
      targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
        range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy']},
      effects: [{resolution: 'auto', who: 'target', result: [{kind: 'modifier', op: 'set', value: 0,
        applies_to: {roll: 'speed'}, duration: {type: 'until_end_of_turn'}}]}],
    }));
    stop.id = 'test-sentinel-stop-action';
    state.catalogActions.push(stop);
    enemy.capabilities.actionIds.push(stop.id);
    enemy.capabilities.featureSources = {...enemy.capabilities.featureSources, 'general_feat.sentinel': ['FEAT-0045']};
    state.tokens[player.id].position = {x: 4, y: 4};
    state.tokens[enemy.id].position = {x: 5, y: 4};
    expect(state.movementRemainingFt[player.id]).toBeGreaterThan(0);
    state = moveActor({...setup, state, destination: {x: 3, y: 4}, rng: () => 0.2});
    expect(state.world.pendingResolution?.type).toBe('attack_reaction');
    state = resolvePlayerReaction(clone(state), {kind: 'reaction', actionId: null}, () => 0.2);
    state = resumePendingMovement(clone(state), () => {throw Error('No further roll expected');});
    expect(state.world.actors[player.id].runtime.hp.current).toBe(97);
    expect(state.tokens[player.id].position).toEqual({x: 4, y: 4});
    expect(state.movementRemainingFt[player.id]).toBe(0);
    expect(state.pendingMovementStep).toBeUndefined();
    expect(state.world.actors[player.id].runtime.activeEffects.some(row => row.mechanics.value === 0)).toBe(true);
  });

  it('uses the same Blindsight for sight targeting and an unpenalized attack after reload', async () => {
    const setup = await parryEncounter('weapon_melee', false);
    let state = setup.state;
    const player = state.world.actors[setup.actorId];
    player.passives = [...(player.passives ?? []), {kind: 'grant_sense', sense: 'blindsight', range: 10}];
    player.runtime.activeEffects = [{id: 'blind', name: 'Blind', source: 'test', ownerId: player.id,
      mechanics: {kind: 'condition', value: 'blinded'}}];
    state.world.actors[setup.monsterId].runtime.activeEffects = [{id: 'invisible', name: 'Invisible', source: 'test',
      mechanics: {kind: 'condition', value: 'invisible'}}];
    const action = state.catalogActions.find(row => row.id === setup.actionId)!;
    action.targeting = {...action.targeting!, requiresSight: true, rangeFt: 30};
    action.mechanics.targeting = {...action.mechanics.targeting as Record<string, unknown>, requires_sight: true, range_ft: 30};
    let rolls = 0;
    state = executeCombatAction({...setup, state: clone(state), targetIds: [setup.monsterId], rng: () => {rolls++; return 0.5;}});
    expect(rolls).toBe(1);
    expect(state.world.actors[setup.monsterId].runtime.hp.current).toBe(97);
    state.world.actors[setup.actorId].runtime.resources.action = 1;
    const position = state.tokens[setup.actorId].position;
    state.tokens[setup.monsterId].position = {x: position.x + 3, y: position.y};
    expect(() => executeCombatAction({...setup, state, targetIds: [setup.monsterId], rng: () => 0.5})).toThrow();
  });

  it('resumes the second monster strike after a saved player reaction with a new roll and one action payment', async () => {
    const setup = await parryEncounter('weapon_melee', true, 2);
    let state = setup.state;
    const player = state.world.actors[setup.actorId];
    player.ac = 15;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    player.capabilities.actionIds.push(setup.parryId);
    player.runtime.equipment.main_hand = CARD_LONGSWORD.id;
    player.character.knownCards = [...(player.character.knownCards ?? []), CARD_LONGSWORD];
    state = advanceTurn(state, () => 0.5);
    let rolls = 0;
    state = runMonsterTurn(state, () => {rolls++; return 0.2;});
    expect(rolls).toBe(1);
    expect(state.world.pendingResolution?.type).toBe('attack_reaction');
    expect(state.monsterAttackSequence?.actionIds).toHaveLength(1);
    expect(state.world.actors[setup.monsterId].runtime.resources.action).toBe(0);
    state = resolvePlayerReaction(clone(state), {kind: 'reaction', actionId: setup.parryId}, () => {throw Error('Attack roll must not repeat');});
    expect(state.world.actors[setup.actorId].runtime.hp.current).toBe(100);
    state = runMonsterTurn(clone(state), () => {rolls++; return 0.5;});
    expect(rolls).toBe(2);
    expect(state.world.actors[setup.actorId].runtime.hp.current).toBe(97);
    expect(state.world.actors[setup.monsterId].runtime.resources.action).toBe(0);
    expect(state.monsterAttackSequence).toBeUndefined();
    expect(activeId(state)).toBe(setup.actorId);
  });

  it.each(['weapon_melee', 'unarmed', 'spell_melee'])('parries one %s hit after reload without rerolling it or retaining the AC bonus', async kind => {
    const setup = await parryEncounter(kind);
    let state = executeCombatAction({...setup, targetIds: [setup.monsterId], rng: () => 0.2});
    expect(state.world.pendingResolution?.type).toBe('attack_reaction');
    expect(state.world.actors[setup.actorId].runtime.resources.action).toBe(0);
    state = autoResolveSystemDecisions(clone(state), () => {throw Error('Parry must reuse the attack roll');});
    expect(state.world.pendingResolution).toBeNull();
    expect(state.world.actors[setup.monsterId].runtime.hp.current).toBe(100);
    expect(state.world.actors[setup.monsterId].runtime.resources.reaction).toBe(0);
    expect(state.world.actors[setup.monsterId].ac).toBe(15);
    expect(state.world.actors[setup.monsterId].runtime.activeEffects).toHaveLength(0);
    state.world.actors[setup.actorId].runtime.resources.action = 1;
    state = autoResolveSystemDecisions(executeCombatAction({...setup, state, targetIds: [setup.monsterId], rng: () => 0.2}), () => 0.2);
    expect(state.world.actors[setup.monsterId].runtime.hp.current).toBe(97);
  });

  it.each([
    ['weapon_ranged', true, 0.5], ['weapon_melee', false, 0.2],
    ['weapon_melee', true, 0.5], ['weapon_melee', true, 0.99],
  ])('does not waste Parry on an ineligible or unstoppable hit (%s, held=%s, rng=%s)', async (kind, held, roll) => {
    const setup = await parryEncounter(kind, held);
    const state = autoResolveSystemDecisions(executeCombatAction({...setup, targetIds: [setup.monsterId], rng: () => roll}), () => roll);
    expect(state.world.actors[setup.monsterId].runtime.resources.reaction).toBe(1);
    expect(state.world.actors[setup.monsterId].runtime.hp.current).toBeLessThan(100);
  });

  it('persists War Caster reaction aliases without polluting the spellbook source', async () => {
    const participant = wizardSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    const spell = participant.canonical.actions.find((action) => action.id.startsWith('db6433bf-'))!;
    const prepared = actor.spellcastingAccess!.preparedSources['CLASS-wizard']!;
    prepared.preparedActionIds = [spell.id, ...prepared.preparedActionIds.slice(0, 3)].sort();
    actor.passives = [...(actor.passives ?? []), {
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{
        kind: 'modifier', op: 'set', value: 1,
        applies_to: { roll: 'reaction' }, reason: 'war_caster_opportunity_spell',
      }] }],
    }];

    const created = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const access = created.world.actors[participant.character.id].spellcastingAccess!;
    expect(access.preparedSources['CLASS-wizard']?.availableActionIds).toEqual(prepared.availableActionIds);
    expect(access.grants.find((grant) => grant.actionId === `${spell.id}:war-caster-opportunity`))
      .toMatchObject({ access: 'always_prepared' });
    expect(() => readSoloCombatState(
      writeSoloCombatState({}, created), participant.character.id, 1,
    )).not.toThrow();
  });

  it('projects a Wild Companion into the tactical map, initiative, allegiance, and player-controlled turn', async () => {
    const fixture = wildCompanionParticipant();
    const basicDash = dash();
    const basicDisengage = disengage();
    const basicHelp = help();
    let state = await createSoloCombatState({
      character: fixture.participant.character,
      participant: fixture.participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), basicDash, basicDisengage, basicHelp], effects: [], rng: () => 0.5,
    });
    const ownerActorId = fixture.participant.character.id;
    state = executeCombatAction({
      state,
      actorId: ownerActorId,
      actionId: fixture.action.id,
      targetIds: [],
      choices: { find_familiar_form: ['owl'] },
      rng: () => 0.65,
    });

    const familiar = Object.values(state.world.actors).find((actor) => actor.kind === 'summonedActor');
    expect(familiar?.familiarState).toMatchObject({
      ownerActorId, spiritType: 'fey', presence: 'present', form: { id: 'owl' },
    });
    expect(state.tokens[familiar!.id]).toMatchObject({ actorId: familiar!.id, color: '#6f8f5a' });
    expect(state.sideByActorId[familiar!.id]).toBe(state.sideByActorId[ownerActorId]);
    expect(state.initiative.find((entry) => entry.actorId === familiar!.id)).toMatchObject({
      die: 14, bonus: 1, total: 15,
    });
    expect(state.world.scene.mode === 'encounter' && state.world.scene.initiative)
      .toEqual(state.initiative.map((entry) => entry.actorId));
    expect(state.actorPresentation[familiar!.id]).toMatchObject({
      creatureType: 'Фея', size: 'Крошечный',
      actionIds: expect.arrayContaining([basicDash.id, basicDisengage.id, basicHelp.id]),
    });
    expect(state.actorPresentation[familiar!.id].description).toContain('полёт 60 фт.');
    expect(state.playerActionIdsByActor?.[familiar!.id]).toEqual(expect.arrayContaining([
      basicDash.id, basicDisengage.id, basicHelp.id,
    ]));
    expect(state.playerActionIdsByActor?.[familiar!.id]).not.toContain(scimitar().id);
    expect(isPlayerControlledCombatActor(state, familiar!.id)).toBe(true);
    expect(state.world.actors[ownerActorId].runtime.resources).toMatchObject({ action: 0, wild_shape: 1 });

    state = advanceTurn(state, () => 0.5);
    expect(activeId(state)).toBe(familiar!.id);
    state = executeCombatAction({
      state, actorId: familiar!.id, actionId: basicDash.id,
      targetIds: [familiar!.id], rng: () => 0.5,
    });
    expect(state.world.actors[familiar!.id].runtime.resources.action).toBe(0);
    expect(state.movementRemainingFt[familiar!.id]).toBe(10);
    const destination = { x: state.tokens[familiar!.id].position.x + 1, y: state.tokens[familiar!.id].position.y };
    state = moveActor({ state, actorId: familiar!.id, destination, voluntary: true, rng: () => 0.5 });
    expect(state.tokens[familiar!.id].position).toEqual(destination);

    const restored = readSoloCombatState(writeSoloCombatState({}, state), ownerActorId, 9)!;
    expect(restored.tokens[familiar!.id].position).toEqual(destination);
    expect(restored.initiative.some((entry) => entry.actorId === familiar!.id)).toBe(true);

    state = advanceTurn(state, () => 0.5);
    state = runMonsterTurn(state, () => 0.5);
    expect(activeId(state)).toBe(ownerActorId);
    state = refreshSoloCombatResources(state, ownerActorId);
    state = executeCombatAction({
      state,
      actorId: ownerActorId,
      actionId: fixture.action.id,
      targetIds: [],
      choices: { find_familiar_form: ['cat'] },
      rng: () => 0.95,
    });
    const familiars = Object.values(state.world.actors).filter((actor) => actor.kind === 'summonedActor');
    expect(familiars).toHaveLength(1);
    expect(familiars[0]).toMatchObject({ id: familiar!.id, name: 'Cat' });
    expect(state.initiative[0]).toMatchObject({ actorId: familiar!.id, die: 20, bonus: 2, total: 22 });
    expect(activeId(state)).toBe(ownerActorId);
    expect(state.log.find((entry) => entry.text.startsWith('Owl:'))?.actorNames?.[familiar!.id]).toBe('Owl');
    expect(state.world.scene.mode === 'encounter' && state.world.scene.initiative)
      .toEqual(state.initiative.map((entry) => entry.actorId));
  });

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
    expect(shoveState.world.pendingResolution?.request.type).toBe('shove_outcome');
    expect(shoveState.tokens[shoveTargetId].position).toEqual(shoveBefore);
    const savedShove = JSON.parse(JSON.stringify(shoveState));
    const proneState = resolvePlayerShoveOutcome(savedShove, 'prone', () => 0);
    expect(proneState.tokens[shoveTargetId].position).toEqual(shoveBefore);
    expect(actorMustCrawl(proneState.world.actors[shoveTargetId])).toBe(true);
    expect(proneState.world.pendingResolution).toBeNull();
    shoveState = resolvePlayerShoveOutcome(savedShove, 'push_5ft', () => 0);
    expect(() => resolvePlayerShoveOutcome(shoveState, 'prone', () => 0)).toThrow();
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

  it('reuses one paid Attack ledger for exactly two Unarmed Strikes and Action Surge opens one fresh ledger', async () => {
    const { participant, action } = unarmedParticipant();
    participant.canonical.world.actors[participant.character.id].attackProfile!.attacksPerAction = 2;
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const targetId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state = placeAdjacent(state, actorId, targetId);
    const strike = (current: typeof state) => executeCombatAction({
      state: current, actorId, actionId: action.id, targetIds: [targetId],
      choices: { [UNARMED_STRIKE_CHOICE_ID]: ['damage'] }, rng: () => 0,
    });

    state = strike(state);
    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(Object.values(state.world.attackActions)).toMatchObject([{
      status: 'open', sequence: { totalAttacks: 2, attacksRemaining: 1 },
    }]);
    // Action Surge may be activated between the two entries. The remaining
    // entry belongs to the already-paid ledger and must not consume the token.
    state.world.actors[actorId].runtime.resources.action_surge_action = 1;
    state.world.actors[actorId].runtime.maxResources.action_surge_action = 1;
    state = strike(state);
    expect(Object.values(state.world.attackActions)).toMatchObject([{
      status: 'completed', sequence: { totalAttacks: 2, attacksRemaining: 0 },
    }]);
    expect(state.world.actors[actorId].runtime.resources.action_surge_action).toBe(1);
    const withoutSurge = clone(state);
    withoutSurge.world.actors[actorId].runtime.resources.action_surge_action = 0;
    expect(() => strike(withoutSurge)).toThrow(/InsufficientResources/);

    state = strike(state);
    expect(state.world.actors[actorId].runtime.resources.action_surge_action).toBe(0);
    expect(Object.values(state.world.attackActions).filter((ledger) => ledger.status === 'open'))
      .toMatchObject([{ sequence: { totalAttacks: 2, attacksRemaining: 1 } }]);
    state = strike(state);
    expect(Object.values(state.world.attackActions)).toHaveLength(2);
    expect(Object.values(state.world.attackActions).every((ledger) => (
      ledger.status === 'completed'
      && ledger.sequence.totalAttacks === 2
      && ledger.sequence.attacksRemaining === 0
    ))).toBe(true);
    expect(() => strike(state)).toThrow(/InsufficientResources/);
  });

  it('reuses the same paid Attack ledger for two equipped-weapon attacks', async () => {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    const action: RuleActionDefinition = {
      id: 'ae7b59a2-2eee-412f-aee6-6323b4c1fb4d',
      name: 'Атака оружием', kind: 'nonSpell',
      sourceEntityIds: ['ae7b59a2-2eee-412f-aee6-6323b4c1fb4d'],
      mechanics: {
        primitive: { type: 'weapon_attack' },
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        name: 'Рукопашная атака оружием',
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
          max_targets: 1, range_ft: 5, requires_line_of_sight: true,
          allowed_relations: ['ally', 'enemy', 'neutral'],
        },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'auto', vs: 'ac',
          on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
        }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 5,
        requiresLineOfSight: true, allowedRelations: ['ally', 'enemy', 'neutral'],
      },
    };
    actor.attackProfile = {
      attacksPerAction: 2, size: 2, reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'], sourceEntityIds: ['class:fighter:extra-attack'],
    };
    actor.character.knownCards = [...(actor.character.knownCards ?? []), clone(CARD_LONGSWORD)];
    actor.character.equippedCards = [...(actor.character.equippedCards ?? []), clone(CARD_LONGSWORD)];
    actor.character.weaponProficiencies = [...new Set([
      ...(actor.character.weaponProficiencies ?? []), 'longsword', 'martial',
    ])];
    actor.runtime.equipment = { ...actor.runtime.equipment, main_hand: CARD_LONGSWORD.id };
    actor.runtime.inventory = [{ cardId: CARD_LONGSWORD.id, qty: 1 }];
    actor.runtime.resources.action = 1;
    actor.runtime.maxResources.action = 1;
    actor.capabilities.actionIds.push(action.id);
    const actions = [...participant.canonical.actions, action];
    const byId = new Map(actions.map((candidate) => [candidate.id, candidate]));
    participant.canonical = {
      ...participant.canonical,
      actions,
      cards: [...participant.canonical.cards, clone(CARD_LONGSWORD)],
      catalog: { getAction: (id) => byId.get(id), listActions: () => actions },
    };
    participant.character.resources = clone(actor.runtime.resources);
    participant.character.max_resources = clone(actor.runtime.maxResources);

    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const targetId = Object.values(state.world.actors).find((entry) => entry.kind === 'monster')!.id;
    state = placeAdjacent(state, actorId, targetId);
    const attack = (current: typeof state) => executeCombatAction({
      state: current, actorId, actionId: action.id, targetIds: [targetId], rng: () => 0,
    });
    state = attack(state);
    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(Object.values(state.world.attackActions).at(-1)).toMatchObject({
      status: 'open', sequence: { totalAttacks: 2, attacksRemaining: 1 },
    });
    state = attack(state);
    expect(Object.values(state.world.attackActions).at(-1)).toMatchObject({
      status: 'completed', sequence: { totalAttacks: 2, attacksRemaining: 0 },
    });
    expect(() => attack(state)).toThrow(/InsufficientResources/);
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

  it('resolves a level-one post-hit spell against the creature that was hit', async () => {
    let participant = wizardSeed();
    const attack: RuleActionDefinition = {
      id: 'd2000000-0000-4000-8000-000000000011', name: 'Проверочная атака', kind: 'nonSpell',
      sourceEntityIds: ['test:attack'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 600, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'int', vs: 'ac', on_hit: [{ kind: 'damage', dice: '1d4', type: 'piercing', ability: 'none' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 600, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const rider: RuleActionDefinition = {
      id: 'd2000000-0000-4000-8000-000000000012', name: 'Град шипов', kind: 'spell',
      spell: { level: 1, sourceClass: 'CLASS-ranger' }, sourceEntityIds: ['SPELL-0185'],
      mechanics: {
        activation: { mode: 'triggered', trigger: { event: 'hit' }, cost: [{ resource: 'bonus_action' }, { resource: 'spell_slot', level: 1, amount: 1 }] },
        targeting: { shape: 'single', filter: 'enemy', range: '600 feet' },
        effects: [{ resolution: 'save', who: 'target', ability: 'dex', dc: '8 + prof + spellcasting', on_fail: [{ kind: 'damage', dice: '1d10', type: 'piercing' }], on_success: [] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 600, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.capabilities.actionIds.push(attack.id, rider.id);
    actor.runtime.resources.action = 1;
    actor.runtime.maxResources.action = 1;
    actor.runtime.resources.bonus_action = 1;
    actor.runtime.maxResources.bonus_action = 1;
    actor.runtime.resources.spell_slot_1 = 2;
    actor.runtime.maxResources.spell_slot_1 = 2;
    actor.spellcastingAccess ??= { grants: [], preparedSources: {} };
    actor.spellcastingAccess.grants.push({
      grantId: 'test:hail-of-thorns', actionId: rider.id, sourceId: 'CLASS-ranger',
      access: 'known', level: 1, spellcastingAbility: 'int', slotResource: 'spell_slot_1',
    });
    participant.character.resources = clone(actor.runtime.resources);
    participant.character.max_resources = clone(actor.runtime.maxResources);
    const actions = [...participant.canonical.actions, attack, rider];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant = { ...participant, canonical: { ...participant.canonical, actions, catalog: {
      getAction: (id) => byId.get(id), listActions: () => [...actions],
    } } };

    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    state = autoResolveSystemDecisions(executeCombatAction({
      state, actorId: participant.character.id, actionId: attack.id,
      targetIds: [monsterId], rng: () => 0.99,
    }), () => 0.99);

    expect(state.pendingTriggeredAction?.optionActionIds).toContain(rider.id);
    state = autoResolveSystemDecisions(resolveTriggeredCombatAction(state, rider.id, () => 0.5), () => 0.5);
    expect(state.pendingTriggeredAction).toBeUndefined();
    expect(state.world.pendingResolution).toBeNull();
    expect(state.world.actors[participant.character.id].runtime.resources.bonus_action).toBe(0);
    expect(state.world.actors[participant.character.id].runtime.resources.spell_slot_1).toBe(1);
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

  it('selects and resolves adjacent enemies for a 5-foot emanation with a zero Constitution modifier', async () => {
    const participant = thunderclapWizardSeed();
    let state = await createSoloCombatState({
      character: participant.character,
      participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const actorId = participant.character.id;
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    const action = state.catalogActions.find((candidate) => candidate.name === 'Раскат грома')!;
    const sourcePosition = state.tokens[actorId].position;
    const targetPosition = { x: sourcePosition.x + 1, y: sourcePosition.y + 1 };
    state = {
      ...state,
      tokens: {
        ...state.tokens,
        [monsterId]: { ...state.tokens[monsterId], position: targetPosition },
      },
      boardRevision: state.boardRevision + 1,
    };

    const targetIds = selectedTargetsForAction({
      state, actorId, actionId: action.id,
      clickedActorId: monsterId, clickedPosition: targetPosition,
    });
    expect(targetIds).toEqual([monsterId]);

    const hpBefore = state.world.actors[monsterId].runtime.hp.current;
    state = autoResolveSystemDecisions(executeCombatAction({
      state, actorId, actionId: action.id, targetIds, rng: () => 0,
    }), () => 0);
    expect(state.world.actors[actorId].runtime.resources.action).toBe(0);
    expect(state.world.actors[monsterId].runtime.hp.current).toBeLessThan(hpBefore);
    expect(state.log.some((entry) => entry.text.includes(action.name))).toBe(true);
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

  it('provokes at the declared ten-foot reach boundary and only for a visible mover', async () => {
    const participant = fighterSeed();
    const actorId = participant.character.id;
    const longReach = scimitar();
    longReach.mechanics = {...longReach.mechanics, targeting: {
      ...(longReach.mechanics?.targeting as Record<string, unknown>), range_ft: 10,
    }};
    let state = await createSoloCombatState({
      character: participant.character, participant, selected: [{ monster: goblin(), quantity: 1 }],
      actions: [longReach], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find(actor => actor.kind === 'monster')!.id;
    state.tokens[monsterId].position = {x: 2, y: 2};
    state.tokens[actorId].position = {x: 3, y: 2};
    state = moveActor({state, actorId, destination: {x: 4, y: 2}, rng: () => 0});
    expect(state.world.actors[monsterId].runtime.resources.reaction).toBe(1);
    const obscured = clone(state);
    obscured.combatAreas = {fog: {heavilyObscured: true, cells: [{x: 4, y: 2}]}} as unknown as typeof state.combatAreas;
    const hiddenMove = moveActor({state: obscured, actorId, destination: {x: 5, y: 2}, rng: () => 0});
    expect(hiddenMove.world.actors[monsterId].runtime.resources.reaction).toBe(1);
    state = moveActor({state: clone(state), actorId, destination: {x: 5, y: 2}, rng: () => 0});
    expect(state.world.actors[monsterId].runtime.resources.reaction).toBe(0);
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

  it('lets Sentinel ignore Disengage and stop movement with an exact library effect', async () => {
    const participant = fighterSeed();
    const sentinelAttack: RuleActionDefinition = {
      id: '18200000-0000-4000-8000-000000000016',
      name: 'Страж: провоцированная атака', kind: 'nonSpell',
      sourceEntityIds: ['FEAT-0045', 'ACT-general-sentinel-test-opportunity'],
      mechanics: {
        activation: {
          mode: 'reaction', cost: [{ resource: 'reaction', amount: 1 }],
          trigger: { events: ['opportunity_attack'] },
        },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', range_ft: 5,
          min_targets: 1, max_targets: 1, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
        effects: [{
          resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', vs: 'ac',
          on_hit: [{ kind: 'damage', dice: '1d6', ability: 'str', type: 'slashing' }],
        }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 5,
        requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
    };
    const sentinelStop: RuleActionDefinition = {
      id: '18200000-0000-4000-8000-000000000015',
      name: 'Страж: остановить', kind: 'nonSpell',
      sourceEntityIds: ['FEAT-0045', 'ACT-general-sentinel-stop'],
      mechanics: {
        activation: {
          mode: 'triggered', cost: [],
          trigger: { event: 'hit', feat_sentinel_opportunity: true },
        },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', range_ft: 10,
          min_targets: 1, max_targets: 1, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
        effects: [{ resolution: 'auto', who: 'target', result: [{
          kind: 'grant_effect', value: 'EFF-general-sentinel-stop',
          duration: { type: 'until_end_of_turn' },
        }] }],
      },
      targeting: {
        minTargets: 1, maxTargets: 1, rangeFt: 10,
        requiresLineOfSight: true, allowedRelations: ['enemy'],
      },
    };
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), disengage()], effects: [], rng: () => 0.5,
    });
    const fighterId = participant.character.id;
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    const fighter = state.world.actors[fighterId];
    state = {
      ...state,
      catalogActions: [...state.catalogActions, sentinelAttack, sentinelStop],
      opportunityActionIds: { ...state.opportunityActionIds, [fighterId]: sentinelAttack.id },
      tokens: {
        ...state.tokens,
        [fighterId]: { ...state.tokens[fighterId], position: { x: 6, y: 7 } },
        [monsterId]: { ...state.tokens[monsterId], position: { x: 6, y: 8 } },
      },
      world: {
        ...state.world,
        actors: {
          ...state.world.actors,
          [fighterId]: {
            ...fighter,
            capabilities: {
              ...fighter.capabilities,
              actionIds: [...fighter.capabilities.actionIds, sentinelAttack.id, sentinelStop.id],
              featureSources: {
                ...(fighter.capabilities.featureSources ?? {}),
                'general_feat.sentinel': ['FEAT-0045'],
              },
            },
            grantedEffects: {
              ...(fighter.grantedEffects ?? {}),
              'EFF-general-sentinel-stop': {
                id: '18200000-0000-4000-8000-000000000020',
                card_number: 'EFF-general-sentinel-stop',
                name: 'Страж: скорость 0',
                mechanics: {
                  activation: { mode: 'passive' }, duration: { type: 'until_end_of_turn' },
                  effects: [{ resolution: 'auto', result: [{
                    kind: 'modifier', op: 'set', value: 0,
                    applies_to: { roll: 'speed' },
                  }] }],
                },
              },
            },
          },
          [monsterId]: {
            ...state.world.actors[monsterId],
            runtime: {
              ...state.world.actors[monsterId].runtime,
              activeEffects: [{
                id: 'disengage', name: 'Отход', source: 'Отход',
                mechanics: {
                  kind: 'modifier', op: 'deny',
                  applies_to: { interaction: 'opportunity_attack', trigger: 'self_movement' },
                  duration: { type: 'until_end_of_turn' },
                },
              }],
            },
          },
        },
      },
    };
    expect(state.world.actors[fighterId].capabilities.featureSources?.['general_feat.sentinel'])
      .toEqual(['FEAT-0045']);
    expect(state.opportunityActionIds[fighterId]).toBeTruthy();
    expect(gridDistanceFt(state.tokens[fighterId].position, state.tokens[monsterId].position)).toBe(5);
    const before = { ...state.tokens[monsterId].position };
    state = moveActor({
      state, actorId: monsterId, destination: { x: 6, y: 9 }, voluntary: true, rng: () => 0.75,
    });

    expect(state.pendingTriggeredAction?.optionActionIds).toContain(sentinelAttack.id);
    state = resolveTriggeredCombatAction(clone(state), sentinelAttack.id, () => 0.75);
    state = resumePendingMovement(clone(state), () => 0.75);
    expect(state.world.actors[fighterId].runtime.resources.reaction).toBe(0);
    expect(state.tokens[monsterId].position).toEqual(before);
    expect(state.world.actors[monsterId].runtime.activeEffects).toContainEqual(expect.objectContaining({
      entityRef: expect.objectContaining({ cardNumber: 'EFF-general-sentinel-stop' }),
    }));
    expect(state.log.at(-1)?.text).toContain('Стража');
  });

  it('spends the complete Dash allotment after reload even when its catalog row has no speed modifier', async () => {
    const participant = fighterSeed();
    const actorId = participant.character.id;
    const basicDash = dash();
    basicDash.mechanics = { ...basicDash.mechanics, effects: [] };
    let state = await createSoloCombatState({
      character: participant.character, participant, selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), basicDash], effects: [], dashAction: basicDash, rng: () => 0.5,
    });
    state.tokens[actorId].position = { x: 0, y: 9 };
    state = executeCombatAction({ state, actorId, actionId: basicDash.id, targetIds: [actorId], rng: () => 0 });
    expect(state.movementRemainingFt[actorId]).toBe(60);
    state = clone(state);
    state = moveActor({ state, actorId, destination: { x: 8, y: 9 }, rng: () => 0 });
    expect(state.movementRemainingFt[actorId]).toBe(20);
    expect(() => moveActor({ state, actorId, destination: { x: 3, y: 9 }, maxFeet: 999 })).toThrow();
    for (const x of [NaN, Infinity, 1.5]) {
      expect(() => moveActor({ state, actorId, destination: { x, y: 9 } })).toThrow();
    }
    state = moveActor({ state, actorId, destination: { x: 4, y: 9 }, rng: () => 0 });
    expect(state.movementRemainingFt[actorId]).toBe(0);
  });

  it('preserves voluntary movement when an external effect pushes an actor', async () => {
    const participant = fighterSeed();
    const actorId = participant.character.id;
    let state = await createSoloCombatState({
      character: participant.character, participant, selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    state.tokens[actorId].position = { x: 0, y: 9 };
    state.movementRemainingFt[actorId] = 5;
    state = moveActor({ state, actorId, destination: { x: 3, y: 9 }, voluntary: false, maxFeet: 15 });
    expect(state.movementRemainingFt[actorId]).toBe(5);
    state = moveActor({ state: clone(state), actorId, destination: { x: 4, y: 9 } });
    expect(state.movementRemainingFt[actorId]).toBe(0);
    state = moveActor({ state, actorId, destination: { x: 7, y: 9 }, voluntary: false, maxFeet: 15 });
    expect(state.tokens[actorId].position).toEqual({ x: 7, y: 9 });
    expect(state.movementRemainingFt[actorId]).toBe(0);
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

  it('ends a monster turn cleanly when a heavily obscured area blocks its attack', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state.tokens[participant.character.id].position = { x: 6, y: 6 };
    state.tokens[monsterId].position = { x: 6, y: 5 };
    state.combatAreas = {
      fog: {
        id: 'fog', name: 'Туманное облако', zoneType: 'fog_cloud',
        sourceActorId: participant.character.id, sourceActionId: 'fog', sourceEntityIds: ['SPELL-fog'],
        origin: { x: 0, y: 0 },
        cells: Array.from({ length: 120 }, (_, index) => ({ x: index % 12, y: Math.floor(index / 12) })),
        duration: { type: 'rounds', roundsLeft: 10 }, triggers: [], heavilyObscured: true,
      },
    };
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);

    expect(() => { state = runMonsterTurn(state, () => 0.5); }).not.toThrow();
    expect(activeId(state)).toBe(participant.character.id);
    expect(state.log.some((entry) => entry.text.includes('Цель не видна'))).toBe(true);
  });

  it('executes the AI movement plan in difficult terrain without exceeding its budget', async () => {
    const participant = fighterSeed();
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar(), dash()], effects: [], dashAction: dash(), rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state.tokens[participant.character.id].position = { x: 11, y: 9 };
    state.tokens[monsterId].position = { x: 0, y: 0 };
    state.combatAreas = {
      mud: {
        id: 'mud', name: 'Труднопроходимая местность', zoneType: 'test',
        sourceActorId: participant.character.id, sourceActionId: 'mud', sourceEntityIds: ['test:terrain'],
        origin: { x: 0, y: 0 },
        cells: Array.from({ length: 120 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12) })),
        duration: { type: 'rounds', roundsLeft: 10 }, triggers: [], difficultTerrain: true,
      },
    };
    state = advanceTurn(state);
    expect(activeId(state)).toBe(monsterId);
    expect(() => { state = runMonsterTurn(state, () => 0.5); }).not.toThrow();
    expect(activeId(state)).toBe(participant.character.id);
    const position = state.tokens[monsterId].position;
    expect(Math.max(position.x, position.y) * 5).toBeLessThanOrEqual(30);
    expect(position).not.toEqual({ x: 0, y: 0 });
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

  it('persists and resolves Stone Endurance before a monster Unarmed Strike mutates player HP', async () => {
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

    const unarmed = monsterUnarmedStrike();
    const unarmedMonster = goblin();
    unarmedMonster.abilities = { ...unarmedMonster.abilities, str: 10 };
    unarmedMonster.action_ids = [unarmed.id];
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: unarmedMonster, quantity: 1 }],
      actions: [unarmed, dash()], effects: [], dashAction: dash(), rng: () => 0.5,
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
    expect(state.world.actors[state.characterId].runtime.hp.current).toBe(hpBefore);
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

  it.each([0, 160])('offers Crusher only after qualifying damage and once per turn with log cursor %i', async cursor => {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.attackProfile = { ...(actor.attackProfile ?? {
      attacksPerAction: 1, reachFt: 5, graspingParts: ['main_hand'],
      sourceEntityIds: ['test:attack-profile'],
    }), size: 2 };
    const attack: RuleActionDefinition = {
      id: 'd7000000-0000-4000-8000-000000000001', name: 'Булава', kind: 'nonSpell',
      sourceEntityIds: ['test:crusher-attack'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target', on_hit: [{ kind: 'damage', amount: 2, type: 'bludgeoning' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const rider: RuleActionDefinition = {
      id: 'd7000000-0000-4000-8000-000000000002', name: 'Крушитель: оттолкнуть', kind: 'nonSpell',
      sourceEntityIds: ['FEAT-0026', 'EFF-general-FEAT-0026'],
      mechanics: {
        activation: { mode: 'triggered', cost: [], trigger: {
          event: 'hit', source_action_card_number: 'action_basic_weapon',
          feat_damage_type: 'bludgeoning', feat_once_per_turn: 'general_feat.crusher.push',
          feat_max_relative_size: 1,
        } },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 600, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'movement', value: 'push', distance: 5 }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 600, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const slashingAttack: RuleActionDefinition = {
      ...clone(attack), id: 'd7000000-0000-4000-8000-000000000003', name: 'Меч',
      mechanics: {
        ...clone(attack.mechanics),
        effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target', on_hit: [{ kind: 'damage', amount: 2, type: 'slashing' }] }],
      },
    };
    actor.capabilities.actionIds.push(attack.id, rider.id, slashingAttack.id);
    actor.runtime.resources.action = 1;
    actor.runtime.maxResources.action = 1;
    participant.character.resources = clone(actor.runtime.resources);
    participant.character.max_resources = clone(actor.runtime.maxResources);
    const actions = [...participant.canonical.actions, attack, rider, slashingAttack];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant.canonical = { ...participant.canonical, actions, catalog: {
      getAction: (id) => byId.get(id), listActions: () => actions,
    } };
    participant.actionPresentation = {
      ...(participant.actionPresentation ?? {}),
      [attack.id]: { entityType: 'action', entityId: attack.id, actionRef: {
        id: attack.id, name: attack.name, description: '', rarity: 'common',
        card_number: 'action_basic_weapon', resource: 'action', action_type: 'base_action',
        type: 'basic', mechanics: clone(attack.mechanics), created_at: '', updated_at: '',
      } as Action },
      [slashingAttack.id]: { entityType: 'action', entityId: slashingAttack.id, actionRef: {
        id: slashingAttack.id, name: slashingAttack.name, description: '', rarity: 'common',
        card_number: 'action_basic_weapon', resource: 'action', action_type: 'base_action',
        type: 'basic', mechanics: clone(slashingAttack.mechanics), created_at: '', updated_at: '',
      } as Action },
    };

    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    state = placeAdjacent(state, actor.id, monsterId);
    if (cursor) state.log = Array.from({length: 80}, (_, index) => ({id: `old:${index}`,
      sequence: cursor - 79 + index, actorId: actor.id, round: 1, text: 'Earlier unrelated event'}));
    state = clone(state);
    state = executeCombatAction({ state, actorId: actor.id, actionId: attack.id, targetIds: [monsterId], rng: () => 0.6 });
    expect(state.pendingTriggeredAction?.optionActionIds, JSON.stringify({
      presentation: state.actionPresentation?.[attack.id],
      owned: state.world.actors[actor.id].capabilities.actionIds,
      fired: state.world.actors[actor.id].runtime.firedThisTurn,
      log: state.log.at(-1),
      targetSize: state.world.actors[monsterId].attackProfile?.size,
      sourceSize: state.world.actors[actor.id].attackProfile?.size,
    })).toEqual([rider.id]);
    state = resolveTriggeredCombatAction(state, rider.id, () => 0.5);
    expect(state.pendingTriggeredAction).toBeUndefined();
    expect(state.world.actors[actor.id].runtime.firedThisTurn).toContain('general_feat.crusher.push');
    expect(state.log.flatMap((entry) => entry.records ?? []).some((record) => (
      record.event?.type === 'movement' && record.event.mode === 'push' && record.event.distanceFt === 5
    ))).toBe(true);

    state.world.actors[actor.id].runtime.resources.action = 1;
    state = placeAdjacent(state, actor.id, monsterId);
    state = executeCombatAction({ state, actorId: actor.id, actionId: attack.id, targetIds: [monsterId], rng: () => 0.6 });
    expect(state.pendingTriggeredAction).toBeUndefined();

    state.world.actors[actor.id].runtime.resources.action = 1;
    state.world.actors[actor.id].runtime.firedThisTurn = [];
    state = placeAdjacent(state, actor.id, monsterId);
    state = executeCombatAction({ state, actorId: actor.id, actionId: slashingAttack.id, targetIds: [monsterId], rng: () => 0.6 });
    expect(state.pendingTriggeredAction).toBeUndefined();

    state.world.actors[actor.id].runtime.resources.action = 1;
    state.world.actors[actor.id].capabilities.actionIds = state.world.actors[actor.id].capabilities.actionIds.filter((id) => id !== rider.id);
    state = placeAdjacent(state, actor.id, monsterId);
    state = executeCombatAction({ state, actorId: actor.id, actionId: attack.id, targetIds: [monsterId], rng: () => 0.6 });
    expect(state.pendingTriggeredAction).toBeUndefined();
  });

  it('offers a post-hit feat after a Protection pre-roll reaction continuation', async () => {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    const attack: RuleActionDefinition = {
      id: 'd8000000-0000-4000-8000-000000000001', name: 'Копьё', kind: 'nonSpell',
      sourceEntityIds: ['test:shield-master-attack'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target', on_hit: [{ kind: 'damage', amount: 1, type: 'piercing' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const bash: RuleActionDefinition = {
      id: 'd8000000-0000-4000-8000-000000000002', name: 'Мастер щитов: толкнуть', kind: 'nonSpell',
      sourceEntityIds: ['FEAT-0032', 'EFF-general-FEAT-0032'],
      mechanics: {
        activation: { mode: 'triggered', cost: [], trigger: {
          event: 'hit', source_action_card_number: 'action_basic_weapon',
          feat_once_per_turn: 'general_feat.shield_master.bash',
          feat_requires_shield: true, feat_requires_melee: true,
        } },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'movement', value: 'push', distance: 5 }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const canonicalShield = { ...CARD_SHIELD, properties: ['shield'] };
    actor.character.knownCards = [...(actor.character.knownCards ?? []), canonicalShield];
    actor.character.equippedCards = [...(actor.character.equippedCards ?? []), canonicalShield];
    actor.runtime.equipment.off_hand = canonicalShield.id;
    actor.capabilities.actionIds.push(attack.id, bash.id);
    actor.capabilities.featureSources = {
      ...(actor.capabilities.featureSources ?? {}),
      'fighting_style.protection.reaction': ['effect:test-protection'],
      'general_feat.shield_master': ['EFF-general-FEAT-0032'],
    };
    actor.runtime.resources.action = 1;
    actor.runtime.resources.reaction = 1;
    participant.character.resources = clone(actor.runtime.resources);
    const actions = [...participant.canonical.actions, attack, bash];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant.canonical = { ...participant.canonical, actions, catalog: {
      getAction: (id) => byId.get(id), listActions: () => actions,
    } };
    participant.actionPresentation = {
      ...(participant.actionPresentation ?? {}),
      [attack.id]: { entityType: 'action', entityId: attack.id, actionRef: {
        id: attack.id, name: attack.name, description: '', rarity: 'common',
        card_number: 'action_basic_weapon', resource: 'action', action_type: 'base_action',
        type: 'basic', mechanics: clone(attack.mechanics), created_at: '', updated_at: '',
      } as Action },
    };

    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.99,
    });
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    state = placeAdjacent(state, actor.id, monsterId);
    state = executeCombatAction({
      state, actorId: actor.id, actionId: attack.id, targetIds: [monsterId], rng: () => 0.99,
    });
    expect(state.world.pendingResolution?.type).toBe('protection_reaction');

    state = resolvePlayerReaction(state, { kind: 'reaction', actionId: null }, () => 0.99);
    expect(state.world.pendingResolution).toBeNull();
    expect(state.pendingTriggeredAction?.optionActionIds).toContain(bash.id);
  });

  it('offers Polearm Master butt strike only after the qualifying Attack closes, and on entry', async () => {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    const weaponAction: RuleActionDefinition = {
      id: 'd9000000-0000-4000-8000-000000000029', name: 'Атака боевым посохом', kind: 'nonSpell',
      sourceEntityIds: ['action_basic_weapon', 'test:quarterstaff'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target', vs: 'ac', on_hit: [{ kind: 'damage', amount: 1, type: 'bludgeoning' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    const qualifyCard = (card: NonNullable<ActorState['character']['equippedCards']>[number]) => {
      const mechanics = clone(card.mechanics ?? {}) as Record<string, unknown>;
      const profile = clone(mechanics.weapon_profile ?? {}) as Record<string, unknown>;
      delete profile.versatile_grip;
      delete profile.heavy;
      return {
        ...card,
        mechanics: {
          ...mechanics,
          weapon_profile: {
            ...profile,
            weapon_type: 'quarterstaff', proficiency_category: 'simple', attack_ability: 'str',
            damage_lines: [{ dice: '1d6', type: 'bludgeoning' }],
            default_attack_mode: 'melee', attack_modes: [{ kind: 'melee', reach_ft: 5 }],
            properties: [], ammo: null,
          },
        },
      };
    };
    const quarterstaff = qualifyCard({ ...clone(CARD_LONGSWORD), id: 'test:quarterstaff' });
    actor.character.equippedCards = [quarterstaff];
    actor.character.knownCards = [quarterstaff];
    actor.runtime.equipment.main_hand = quarterstaff.id;
    const butt: RuleActionDefinition = {
      id: 'd9000000-0000-4000-8000-000000000028', name: 'Мастер древкового оружия: удар древком', kind: 'nonSpell',
      sourceEntityIds: ['FEAT-0028', 'EFF-general-FEAT-0028'],
      mechanics: {
        activation: { mode: 'triggered', optional: true, cost: [{ resource: 'bonus_action' }], trigger: {
          events: ['hit', 'miss'], source_action_card_number: 'action_basic_weapon',
          feat_polearm_master_butt: true,
        } },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 10, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'auto', attack_kind: 'weapon_melee', who: 'target', on_hit: [{ kind: 'damage', dice: '1d4', type: 'bludgeoning', ability: 'auto' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 10, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    actor.capabilities.actionIds.push(weaponAction.id, butt.id);
    actor.capabilities.featureSources = {
      ...(actor.capabilities.featureSources ?? {}),
      'general_feat.polearm_master': ['EFF-general-FEAT-0028'],
    };
    actor.runtime.resources.action = 1;
    actor.runtime.resources.bonus_action = 1;
    actor.runtime.resources.reaction = 1;
    actor.runtime.maxResources = { ...actor.runtime.maxResources, action: 1, bonus_action: 1, reaction: 1 };
    participant.character.resources = clone(actor.runtime.resources);
    participant.character.max_resources = clone(actor.runtime.maxResources);
    const actions = [...participant.canonical.actions, weaponAction, butt];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant.canonical = { ...participant.canonical, actions, catalog: {
      getAction: (id) => byId.get(id), listActions: () => actions,
    } };
    participant.actionPresentation = {
      [weaponAction.id]: { entityType: 'action', entityId: weaponAction.id, actionRef: {
        id: weaponAction.id, name: weaponAction.name, description: '', rarity: 'common',
        card_number: 'action_basic_weapon', resource: 'action', action_type: 'base_action',
        type: 'basic', mechanics: clone(weaponAction.mechanics), created_at: '', updated_at: '',
      } as Action },
    };

    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const monsterId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    state = placeAdjacent(state, actor.id, monsterId);
    state.world.actors[monsterId].runtime.hp = { current: 40, max: 40, temp: 0 };
    const heldWeaponId = state.world.actors[actor.id].runtime.equipment.main_hand!;
    const currentTurnKey = state.world.scene.mode === 'encounter'
      ? `encounter:${state.world.scene.round}:${state.world.scene.activeIndex}:${actor.id}`
      : '';
    state.world.attackActions['test:polearm-attack'] = {
      id: 'test:polearm-attack', actorId: actor.id, startedAtRevision: state.world.revision,
      turnKey: currentTurnKey, status: 'completed',
      sequence: {
        id: 'test:polearm-attack', actorId: actor.id, totalAttacks: 1, attacksRemaining: 0,
        entries: [{ ordinal: 1, kind: 'weapon_attack', actionId: weaponAction.id,
          weaponCardId: heldWeaponId, sourceEntityIds: ['action_basic_weapon'] }],
        usedReplacementKeys: [],
      },
    };
    state = executeCombatAction({
      state, actorId: actor.id, actionId: weaponAction.id, targetIds: [monsterId], rng: () => 0.6,
    });
    expect(state.pendingTriggeredAction?.optionActionIds).toEqual([butt.id]);
    state = resolveTriggeredCombatAction(state, butt.id, () => 0.6);
    expect(state.world.actors[actor.id].runtime.resources.bonus_action).toBe(0);
    expect(state.log.flatMap((entry) => entry.records ?? []).some((record) => (
      record.event?.type === 'damage' && record.event.damageType === 'bludgeoning'
    ))).toBe(true);

    let entryState = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const enteringId = Object.values(entryState.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    const opportunity: RuleActionDefinition = {
      ...clone(weaponAction), id: `${weaponAction.id}:opportunity`, name: `${weaponAction.name} — превентивный удар`,
      mechanics: {
        ...clone(weaponAction.mechanics),
        activation: { mode: 'reaction', cost: [{ resource: 'reaction' }], trigger: { events: ['opportunity_attack'] } },
      },
    };
    entryState.catalogActions.push(opportunity);
    entryState.world.actors[actor.id].capabilities.actionIds.push(opportunity.id);
    entryState.opportunityActionIds[actor.id] = opportunity.id;
    entryState.tokens[actor.id].position = { x: 4, y: 4 };
    entryState.tokens[enteringId].position = { x: 4, y: 6 };
    const allyId = 'd9000000-0000-4000-8000-000000000098';
    const ally = {...clone(entryState.world.actors[actor.id]), id: allyId, name: 'Второй страж'};
    entryState.world.actors[allyId] = ally;
    entryState.controlledCharacterIds = [actor.id, allyId];
    entryState.tokens[allyId] = {...entryState.tokens[actor.id], actorId: allyId, position: {x: 5, y: 4}};
    entryState.sideByActorId[allyId] = 'heroes';
    entryState.opportunityActionIds[allyId] = opportunity.id;
    entryState.combatAreas = {entryNotice: {id: 'entryNotice', name: 'Сигнал', zoneType: 'alarm',
      sourceActorId: actor.id, sourceActionId: 'alarm', sourceEntityIds: ['SPELL-alarm'],
      origin: {x: 4, y: 5}, cells: [{x: 4, y: 5}], duration: {type: 'permanent'}, triggers: ['enter'],
      notice: 'Вход в сигнальную область'}};
    entryState.pendingAdditionalMovement = {actorId: enteringId, remainingFt: 15, provokeOpportunityAttacks: false};
    entryState.playerMovement = {actorId: enteringId, origin: {x: 4, y: 6}, steps: [{x: 4, y: 5}]};
    const normalEntryMovement = entryState.movementRemainingFt[enteringId];
    entryState = moveActor({
      state: entryState, actorId: enteringId, destination: { x: 4, y: 5 }, rng: () => 0.6,
    });
    expect(entryState.pendingTriggeredAction).toMatchObject({
      event: 'reach_entry', sourceActorId: actor.id, targetIds: [enteringId],
      optionActionIds: [`${entryState.opportunityActionIds[actor.id]}:polearm-master-entry`],
    });
    const entryAction = entryState.catalogActions.find((candidate) => (
      candidate.id === entryState.pendingTriggeredAction?.optionActionIds[0]
    ));
    expect(entryAction?.sourceEntityIds).toContain('EFF-general-FEAT-0028');
    expect(entryState.pendingReachEntry?.actorIds).toEqual([allyId]);
    expect(entryState.pendingAdditionalMovement?.remainingFt).toBe(10);
    expect(entryState.movementRemainingFt[enteringId]).toBe(normalEntryMovement);
    expect(entryState.log.some(row => row.text.includes('Вход в сигнальную область'))).toBe(false);
    const noRoll = () => {throw Error('Declining an entry reaction does not roll');};
    const declined = resolveTriggeredCombatAction(clone(entryState), null, noRoll);
    const unavailable = clone(declined);
    unavailable.world.actors[allyId].runtime.resources.reaction = 0;
    const skipped = resumePendingMovement(unavailable, noRoll);
    expect(skipped.pendingTriggeredAction).toBeUndefined();
    expect(skipped.pendingReachEntry).toBeUndefined();
    expect(skipped.log.some(row => row.text.includes('Вход в сигнальную область'))).toBe(true);
    entryState = resumePendingMovement(clone(declined), noRoll);
    expect(entryState.pendingTriggeredAction?.sourceActorId).toBe(allyId);
    expect(entryState.world.actors[actor.id].runtime.resources.reaction).toBe(1);
    expect(entryState.log.some(row => row.text.includes('Вход в сигнальную область'))).toBe(false);
    const beforeEntryAttack = entryState.world.actors[enteringId].runtime.hp.current;
    entryState = resolveTriggeredCombatAction(clone(entryState), entryState.pendingTriggeredAction!.optionActionIds[0], () => 0.6);
    entryState = resumePendingMovement(autoResolveSystemDecisions(clone(entryState), () => 0.6), noRoll);
    expect(entryState.world.actors[allyId].runtime.resources.reaction).toBe(0);
    expect(entryState.world.actors[enteringId].runtime.hp.current).toBeLessThan(beforeEntryAttack);
    expect(entryState.pendingReachEntry).toBeUndefined();
    expect(entryState.pendingTriggeredAction).toBeUndefined();
    expect(entryState.tokens[enteringId].position).toEqual({x: 4, y: 5});
    expect(entryState.log.some(row => row.text.includes('Вход в сигнальную область'))).toBe(true);
  });

  it('applies Mounted Strike advantage only while the explicit allied mount relation stays valid', async () => {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    const attack: RuleActionDefinition = {
      id: 'd9000000-0000-4000-8000-000000000017', name: 'Удар всадника', kind: 'nonSpell',
      sourceEntityIds: ['FEAT-0017', 'EFF-general-FEAT-0017'],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target', on_hit: [{ kind: 'damage', amount: 1, type: 'bludgeoning' }] }],
      },
      targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    };
    actor.attackProfile = { attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: ['main_hand'], sourceEntityIds: ['fighter'] };
    actor.capabilities.actionIds.push(attack.id);
    actor.capabilities.featureSources = {
      ...(actor.capabilities.featureSources ?? {}),
      'general_feat.mounted_combatant': ['EFF-general-FEAT-0017'],
    };
    actor.runtime.resources.action = 1;
    participant.character.resources = clone(actor.runtime.resources);
    const actions = [...participant.canonical.actions, attack];
    const byId = new Map(actions.map((action) => [action.id, action]));
    participant.canonical = { ...participant.canonical, actions, catalog: {
      getAction: (id) => byId.get(id), listActions: () => actions,
    } };
    let state = await createSoloCombatState({
      character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }],
      actions: [scimitar()], effects: [], rng: () => 0.5,
    });
    const targetId = Object.values(state.world.actors).find((candidate) => candidate.kind === 'monster')!.id;
    state.world.actors[targetId].runtime.hp = { current: 40, max: 40, temp: 0 };
    state.world.actors[targetId].attackProfile = {
      attacksPerAction: 1, size: 1, reachFt: 5, graspingParts: ['claw'], sourceEntityIds: ['target'],
    };
    const mountId = 'test:mount';
    state.world.actors[mountId] = {
      ...clone(state.world.actors[targetId]), id: mountId, name: 'Боевой конь', kind: 'summonedActor',
      attackProfile: { attacksPerAction: 1, size: 3, reachFt: 5, graspingParts: ['hooves'], sourceEntityIds: ['mount'] },
    } as ActorState;
    state.sideByActorId[mountId] = state.sideByActorId[actor.id];
    state.tokens[actor.id].position = { x: 4, y: 5 };
    state.tokens[mountId] = { actorId: mountId, color: '#986', position: { x: 5, y: 5 } };
    state.tokens[targetId].position = { x: 5, y: 4 };
    state = setSoloCombatMount(state, actor.id, mountId);
    state = executeCombatAction({
      state, actorId: actor.id, actionId: attack.id, targetIds: [targetId], rng: () => 0.6,
    });
    const attackRoll = state.log.flatMap((entry) => entry.records ?? []).flatMap((record) => (
      record.event?.type === 'roll' && record.event.roll.kind === 'd20' ? [record.event.roll] : []
    )).at(-1);
    expect(attackRoll?.advantage).toBe('advantage');
    expect(state.world.actors[actor.id].passives?.some((passive) => (
      (passive as Record<string, unknown>).id === 'runtime:general-feat:mounted-combatant-advantage'
    ))).toBe(false);
  });
});


describe('wolf Bite in the shared combat engine', () => {
  it.each([[2, 2, true], [2, 3, false], [3, 3, true], [3, 4, false]])(
    'prone size ceiling %i against %i survives reload (%s)', async (limit, size, expected) => {
      const participant = fighterSeed();
      const player = participant.canonical.world.actors[participant.character.id];
      player.attackProfile = { attacksPerAction: 1, size, reachFt: 5,
        graspingParts: ['main_hand'], sourceEntityIds: ['test:fighter'] };
      player.runtime.hp = { current: 100, max: 100, temp: 0 };
      player.runtime.resources.reaction = 0;
      participant.character.current_hp = 100;
      participant.character.max_hp = 100;
      const bite = scimitar();
      bite.mechanics = {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
          max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
        effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee',
          attack_bonus_override: 4, vs: 'ac', on_hit: [
            { kind: 'damage', amount: '1d6 + 2', type: 'piercing' },
            { kind: 'condition', value: 'prone', max_target_size: limit },
          ] }],
      };
      const wolf = { ...goblin(), size: limit === 2 ? 'medium' : 'large',
        ai: { strategy: 'tactical' as const, pack_tactics: true, preferred_range_ft: 5 } };
      let state = await createSoloCombatState({ character: participant.character, participant,
        selected: [{ monster: wolf, quantity: 1 }], actions: [bite], effects: [], rng: () => 0.5 });
      const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
      state.tokens[participant.character.id].position = { x: 4, y: 4 };
      state.tokens[monsterId].position = { x: 5, y: 4 };
      state = advanceTurn(state);
      state = runMonsterTurn(state, () => 0.99);
      const restored = readSoloCombatState(writeSoloCombatState({}, state), participant.character.id, state.runtimeRevision)!;
      expect(restored.world.actors[participant.character.id].runtime.activeEffects
        .some((effect) => effect.mechanics.value === 'prone')).toBe(expected);
      expect(restored.world.actors[participant.character.id].runtime.hp.current).toBeLessThan(100);
      expect(activeId(restored)).toBe(participant.character.id);
    },
  );
});


describe('Prone tactical movement', () => {
  async function scene() {
    const participant = fighterSeed();
    const state = await createSoloCombatState({ character: participant.character, participant,
      selected: [{ monster: goblin(), quantity: 1 }], actions: [scimitar(), dash()],
      effects: [], dashAction: dash(), rng: () => 0.5 });
    const actorId = participant.character.id;
    state.world.actors[actorId].runtime.activeEffects.push({ id: 'prone', name: 'Prone', source: 'test',
      mechanics: { kind: 'condition', value: 'prone' } });
    state.tokens[actorId].position = { x: 5, y: 5 };
    return { state, actorId };
  }
  it('stands for half speed without spending an action, provoking or repeating after reload', async () => {
    const { state, actorId } = await scene();
    const resources = clone(state.world.actors[actorId].runtime.resources);
    const stood = standActor(state, actorId);
    expect(stood.movementRemainingFt[actorId]).toBe(15);
    expect(stood.world.actors[actorId].runtime.resources).toEqual(resources);
    expect(stood.tokens).toEqual(state.tokens);
    expect(stood.world.actors[actorId].runtime.hp).toEqual(state.world.actors[actorId].runtime.hp);
    const restored = readSoloCombatState(writeSoloCombatState({}, stood), actorId, stood.runtimeRevision)!;
    expect(restored.world.actors[actorId].runtime.activeEffects.some((entry) => entry.mechanics.value === 'prone')).toBe(false);
    expect(canStandActor(restored, actorId)).toBe(false);
    expect(() => standActor(restored, actorId)).toThrow();
  });
  it('rounds half an odd speed down without losing a foot from an unmaterialized ledger', async () => {
    const { state, actorId } = await scene();
    state.world.actors[actorId].character.characterSpeed = 25;
    state.world.actors[actorId].character.baseSpeed = 25;
    delete state.movementRemainingFt[actorId];
    expect(standActor(state, actorId).movementRemainingFt[actorId]).toBe(13);
  });
  it('cannot stand with insufficient movement, zero speed, or a pending decision', async () => {
    const { state, actorId } = await scene();
    state.movementRemainingFt[actorId] = 14;
    expect(canStandActor(state, actorId)).toBe(false);
    state.movementRemainingFt[actorId] = 30;
    state.world.actors[actorId].runtime.activeEffects.push({ id: 'restrained', name: 'Restrained', source: 'test',
      mechanics: { kind: 'condition', value: 'restrained' } });
    expect(canStandActor(state, actorId)).toBe(false);
    state.world.actors[actorId].runtime.activeEffects.pop();
    state.pendingAlertSwapActorIds = [actorId];
    expect(canStandActor(state, actorId)).toBe(false);
  });
  it.each([false, true])('crawling charges extra distance, additive with difficult terrain (%s)', async (difficult) => {
    const { state, actorId } = await scene();
    if (difficult) state.combatAreas = { mud: { id: 'mud', name: 'Mud', zoneType: 'test',
      sourceActorId: actorId, sourceActionId: 'test', sourceEntityIds: ['test'],
      origin: { x: 5, y: 5 }, cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
      duration: { type: 'rounds', roundsLeft: 10 }, triggers: [], difficultTerrain: true } };
    const moved = moveActor({ state, actorId, destination: { x: 6, y: 5 }, rng: () => 0.5 });
    expect(moved.movementRemainingFt[actorId]).toBe(difficult ? 15 : 20);
  });
  it('the AI stands before attacking and spends movement only once', async () => {
    const { state: initial, actorId } = await scene();
    const monsterId = Object.values(initial.world.actors).find((actor) => actor.kind === 'monster')!.id;
    let state = advanceTurn(initial);
    state.world.actors[monsterId].runtime.activeEffects.push({ id: 'prone', name: 'Prone', source: 'test',
      mechanics: { kind: 'condition', value: 'prone' } });
    state.tokens[monsterId].position = { x: 6, y: 5 };
    state = runMonsterTurn(state, () => 0.5);
    expect(state.world.actors[monsterId].runtime.activeEffects.some((entry) => entry.mechanics.value === 'prone')).toBe(false);
    expect(state.log.filter((entry) => entry.text.includes('Встал:'))).toHaveLength(1);
    expect(activeId(state)).toBe(actorId);
  });
});


describe('stat-block poison damage and ranged distance', () => {
  it.each([
    ['hobgoblin', '1d8 + 1', '3d4', 0.5, false, 15],
    ['hobgoblin', '1d8 + 1', '3d4', 0.99, false, 41],
    ['hobgoblin', '1d8 + 1', '3d4', 0.5, true, 6],
    ['spider', '1d4 + 3', '2d4', 0.5, false, 12],
    ['spider', '1d4 + 3', '2d4', 0.99, false, 27],
    ['spider', '1d4 + 3', '2d4', 0.5, true, 6],
  ] as const)('%s applies both damage types: %s plus %s, rng=%s, immunity=%s', async (kind, physical, poison, roll, immune, damage) => {
    const participant = fighterSeed();
    const player = participant.canonical.world.actors[participant.character.id];
    player.runtime.hp = { current: 100, max: 100, temp: 0 };
    player.ac = 10;
    player.runtime.resources.reaction = 0;
    if (immune) (player.passives ??= []).push({kind: 'resistance', damage_type: 'poison', value: 'immunity'});
    participant.character.current_hp = 100;
    participant.character.max_hp = 100;
    const attack = scimitar();
    attack.mechanics = {
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: kind === 'hobgoblin' ? 600 : 5,
        requires_line_of_sight: true, allowed_relations: ['enemy'] },
      effects: [{ resolution: 'attack_roll', ability: 'dex',
        attack_kind: kind === 'hobgoblin' ? 'weapon_ranged' : 'weapon_melee',
        ...(kind === 'hobgoblin' ? {normal_range_ft: 150} : {}),
        attack_bonus_override: kind === 'hobgoblin' ? 3 : 5, vs: 'ac', on_hit: [
          { kind: 'damage', amount: physical, type: 'piercing' },
          { kind: 'damage', amount: poison, type: 'poison' },
        ] }],
    };
    const monster = {...goblin(), ai: {strategy: 'tactical' as const}};
    let state = await createSoloCombatState({ character: participant.character, participant,
      selected: [{monster, quantity: 1}], actions: [attack], effects: [], rng: () => 0.5 });
    const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
    state.tokens[participant.character.id].position = {x:4,y:4};
    state.tokens[monsterId].position = {x:5,y:4};
    state = runMonsterTurn(advanceTurn(state), () => roll);
    const restored = readSoloCombatState(writeSoloCombatState({}, state), participant.character.id, state.runtimeRevision)!;
    expect(restored.world.actors[participant.character.id].runtime.hp.current).toBe(100-damage);
    expect(restored.world.actors[participant.character.id].runtime.activeEffects).toEqual(player.runtime.activeEffects);
    expect(activeId(restored)).toBe(participant.character.id);
  });
});


it('grants monsters one melee opportunity attack even when a ranged mode is listed first', async () => {
  const participant = fighterSeed();
  const melee = scimitar();
  const ranged = clone(melee);
  ranged.id = 'b2010000-0000-4000-8000-000000000099';
  (ranged.mechanics!.effects as Record<string, unknown>[])[0].attack_kind = 'weapon_ranged';
  const effects = melee.mechanics!.effects as Record<string, unknown>[];
  effects.push(clone(effects[0]));
  const monster = {...goblin(), action_ids: [ranged.id, melee.id]};
  const state = await createSoloCombatState({character: participant.character, participant,
    selected: [{monster, quantity: 1}], actions: [ranged, melee], effects: [], rng: () => 0.5});
  const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
  const opportunity = state.catalogActions.find((action) => action.id === state.opportunityActionIds[monsterId]);
  expect(opportunity?.id).toBe(`${melee.id}:opportunity`);
  expect(opportunity?.mechanics.effects).toHaveLength(1);
});


it('replays setup and monster turns to an identical complete snapshot, including all identities', async () => {
  async function replay() {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.runtime.resources.reaction = 0;
    actor.runtime.hp = {current: 100, max: 100, temp: 0};
    participant.character.current_hp = 100;
    participant.character.max_hp = 100;
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster: goblin(), quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const monsterId = Object.values(state.world.actors).find((entry) => entry.kind === 'monster')!.id;
    state.tokens[participant.character.id].position = {x: 4, y: 4};
    state.tokens[monsterId].position = {x: 5, y: 4};
    state = runMonsterTurn(advanceTurn(state, () => 0.5), () => 0.5);
    return state;
  }
  expect(await replay()).toEqual(await replay());
});


describe('internal combat worker transition', () => {
  const artifactHash = `sha256:${'a'.repeat(64)}`;
  async function initial(): Promise<RoguelikeCombatEnvelope> {
    const participant = fighterSeed();
    const player = participant.canonical.world.actors[participant.character.id];
    player.runtime.resources.reaction = 0;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    participant.character.current_hp = 100;
    participant.character.max_hp = 100;
    const state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster: goblin(), quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const monsterId = Object.values(state.world.actors).find((entry) => entry.kind === 'monster')!.id;
    state.tokens[participant.character.id].position = {x: 4, y: 4};
    state.tokens[monsterId].position = {x: 5, y: 4};
    return {schemaVersion: 1, artifactHash, entropy: {seed: 'worker-test', cursor: 0}, state};
  }
  it('replays an intent and a reloaded continuation with identical world and entropy', async () => {
    const input = await initial();
    const untouched = structuredClone(input);
    const intent = {type: 'end_turn' as const, actorId: input.state.characterId};
    const first = stepRoguelikeCombat(input, intent, artifactHash);
    expect(first).toEqual(stepRoguelikeCombat(input, intent, artifactHash));
    expect(input).toEqual(untouched);
    expect(first.randomValues.length).toBeGreaterThan(0);
    expect(first.envelope.entropy.cursor).toBe(first.randomValues.length);
    const reloaded = JSON.parse(JSON.stringify(first.envelope)) as RoguelikeCombatEnvelope;
    expect(stepRoguelikeCombat(reloaded, intent, artifactHash))
      .toEqual(stepRoguelikeCombat(first.envelope, intent, artifactHash));
  });
  it('rejects an enemy command and a mismatched artifact without mutating state', async () => {
    const input = await initial();
    const before = structuredClone(input);
    const monsterId = Object.values(input.state.world.actors).find((entry) => entry.kind === 'monster')!.id;
    expect(() => stepRoguelikeCombat(input, {type: 'end_turn', actorId: monsterId}, artifactHash)).toThrow();
    expect(() => stepRoguelikeCombat(input, {type: 'resume'}, `sha256:${'b'.repeat(64)}`)).toThrow();
    expect(() => stepRoguelikeCombat(input, {type: 'action', actorId: input.state.characterId, actionId: 'any', targetIds: [], worldPosition: {x: 999, y: 0}}, artifactHash)).toThrow('Клетка вне поля боя');
    const enemyTurn = {...input, state: advanceTurn(input.state, () => 0.5)};
    expect(() => stepRoguelikeCombat(enemyTurn, {type: 'move', actorId: input.state.characterId, destination: {x: 3, y: 4}}, artifactHash)).toThrow('дождитесь своего хода');
    expect(input).toEqual(before);
  });
});


it('resumes a persisted monster route even after Dash has spent its action', async () => {
  const participant=fighterSeed();
  let state=await createSoloCombatState({character:participant.character,participant,
    selected:[{monster:goblin(),quantity:1}],actions:[scimitar(),dash()],effects:[],dashAction:dash(),rng:()=>0.5});
  const monsterId=Object.values(state.world.actors).find(actor=>actor.kind==='monster')!.id;
  state.tokens[participant.character.id].position={x:11,y:9};
  state.tokens[monsterId].position={x:0,y:0};
  state=advanceTurn(state,()=>0.5);
  state.world.actors[monsterId].runtime.resources.action=0;
  state.movementRemainingFt[monsterId]=15;
  state.monsterMovement={actorId:monsterId,steps:[{x:1,y:0},{x:2,y:0},{x:3,y:0}]};
  const loaded=JSON.parse(JSON.stringify(state)) as SoloCombatState;
  const result=runMonsterTurn(loaded,()=>0.5);
  expect(result.tokens[monsterId].position).toEqual({x:3,y:0});
  expect(result.movementRemainingFt[monsterId]).toBe(0);
  expect(result.monsterMovement).toBeUndefined();
  expect(activeId(result)).toBe(participant.character.id);
  expect(result).toEqual(runMonsterTurn(state,()=>0.5));
});


describe('Bloodied Frenzy uses shared saves and opportunity attacks', () => {
  async function setup(current: number) {
    const participant = fighterSeed();
    const actor = participant.canonical.world.actors[participant.character.id];
    actor.runtime.hp = {current: 100, max: 100, temp: 0};
    actor.runtime.resources.reaction = 0;
    participant.character.current_hp = 100;
    participant.character.max_hp = 100;
    const saveAction = projectRuleAction({...scimitar(), id: 'test-frenzy-save', name: 'Saving throw probe',
      mechanics: {activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
        targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
          range_ft: 30, requires_line_of_sight: true, allowed_relations: ['enemy']},
        effects: [{resolution: 'save', who: 'target', ability: 'con', dc: 15,
          on_fail: [{kind: 'damage', amount: 1, type: 'fire'}], on_success: []}]}}, {sourceEntityIds: ['test']});
    const actions = [...participant.canonical.actions, saveAction];
    participant.canonical.actions = actions;
    participant.canonical.catalog = {getAction: id => actions.find(row => row.id === id), listActions: () => actions};
    actor.capabilities.actionIds.push(saveAction.id);
    const monster = {...goblin(), max_hp: 67, ai: {bloodied_frenzy: true}};
    const state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster, quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const monsterId = Object.values(state.world.actors).find(row => row.kind === 'monster')!.id;
    state.world.actors[monsterId].runtime.hp.current = current;
    state.tokens[actor.id].position = {x: 4, y: 4};
    state.tokens[monsterId].position = {x: 5, y: 4};
    return {state: clone(state), actorId: actor.id, monsterId, actionId: saveAction.id};
  }
  it.each([34, 33])('rolls the actual target save with the correct dice at %i/67HP', async current => {
    const scene = await setup(current);
    let draws = 0;
    const rng = () => { draws++; return 0.5; };
    const state = autoResolveSystemDecisions(executeCombatAction({...scene, targetIds: [scene.monsterId], rng}), rng);
    expect(state.world.pendingResolution).toBeFalsy();
    expect(draws).toBe(current === 33 ? 2 : 1);
  });
  it.each([34, 33])('uses the same health rule during an opportunity attack at %i/67HP', async current => {
    const scene = await setup(current);
    scene.state.world.actors[scene.actorId].ac = 1;
    let draws = 0;
    const state = moveActor({...scene, destination: {x: 3, y: 4}, rng: () => {draws++; return 0.5;}});
    expect(state.world.actors[scene.monsterId].runtime.resources.reaction).toBe(0);
    expect(draws).toBe(current === 33 ? 3 : 2);
    expect(state.tokens[scene.actorId].position).toEqual({x: 3, y: 4});
  });
});


describe('Pack Tactics is a shared attack rule', () => {
  it.each(['near', 'far', 'dead', 'incapacitated', 'prone'])('uses board facts during opportunity attacks: ally %s', async status => {
    const participant = fighterSeed();
    const player = participant.canonical.world.actors[participant.character.id];
    player.ac = 1;
    player.runtime.hp = {current: 100, max: 100, temp: 0};
    player.runtime.resources.reaction = 0;
    participant.character.current_hp = 100;
    participant.character.max_hp = 100;
    const monster = {...goblin(), ai: {pack_tactics: true}};
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster, quantity: 2}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const [attacker, ally] = Object.values(state.world.actors).filter(row => row.kind === 'monster');
    ally.runtime.resources.reaction = 0;
    if (status === 'dead') ally.runtime.hp.current = 0;
    if (status === 'incapacitated' || status === 'prone') ally.runtime.activeEffects.push({id: 'condition',
      name: status, source: 'test', mechanics: {kind: 'condition', value: status}});
    state.tokens[player.id].position = {x: 4, y: 4};
    state.tokens[attacker.id].position = {x: 5, y: 4};
    state.tokens[ally.id].position = status === 'far' ? {x: 8, y: 8} : {x: 4, y: 5};
    let draws = 0;
    state = moveActor({state: clone(state), actorId: player.id, destination: {x: 3, y: 4},
      rng: () => {draws++; return 0.5;}});
    expect(draws).toBe(['near', 'prone'].includes(status) ? 3 : 2);
    expect(state.world.actors[attacker.id].runtime.resources.reaction).toBe(0);
    expect(state.world.actors[ally.id].runtime.resources.reaction).toBe(0);
    expect(state.tokens[player.id].position).toEqual({x: 3, y: 4});
  });
});


it.each([5, 15])('recomputes the step cost when an opportunity attack knocks the mover prone, budget %i', async budget => {
  const participant = fighterSeed();
  const player = participant.canonical.world.actors[participant.character.id];
  player.ac = 1;
  player.runtime.hp = {current: 100, max: 100, temp: 0};
  player.runtime.resources.reaction = 0;
  participant.character.current_hp = 100;
  participant.character.max_hp = 100;
  const state = await createSoloCombatState({character: participant.character, participant,
    selected: [{monster: goblin(), quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
  const enemy = Object.values(state.world.actors).find(row => row.kind === 'monster')!;
  const action = state.catalogActions.find(row => row.id === state.opportunityActionIds[enemy.id])!;
  const effects = action.mechanics.effects as Array<{on_hit: unknown[]}>;
  effects[0].on_hit.push({kind: 'condition', value: 'prone'});
  state.tokens[player.id].position = {x: 4, y: 4};
  state.tokens[enemy.id].position = {x: 5, y: 4};
  state.movementRemainingFt[player.id] = budget;
  const result = moveActor({state: clone(state), actorId: player.id, destination: {x: 3, y: 4}, rng: () => 0.5});
  expect(actorMustCrawl(result.world.actors[player.id])).toBe(true);
  expect(result.world.actors[enemy.id].runtime.resources.reaction).toBe(0);
  expect(result.pendingMovementStep).toBeUndefined();
  expect(result.tokens[player.id].position).toEqual({x: budget === 5 ? 4 : 3, y: 4});
  expect(result.movementRemainingFt[player.id]).toBe(5);
});


describe('canonical character opportunity attacks', () => {
  it('assesses retreat using actual available reactions without changing the saved world', async () => {
    const {participant} = unarmedParticipant();
    const state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster: goblin(), quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const monster = Object.values(state.world.actors).find(row => row.kind === 'monster')!;
    const player = state.world.actors[participant.character.id];
    state.tokens[player.id].position = {x: 4, y: 4};
    state.tokens[monster.id].position = {x: 5, y: 4};
    const origin = state.tokens[monster.id].position;
    const risk = (start: {x: number; y: number}, path: Array<{x: number; y: number}>) =>
      monsterRouteOpportunityRisk(state, monster.id, start, path);
    const before = clone(state);
    expect(risk(origin, [{x: 6, y: 4}, {x: 5, y: 4}, {x: 6, y: 4}])).toBe(1);
    expect(planMonsterTurn(state, monster, player.id, 60, 20, risk).firstMove).toEqual([]);
    expect(state).toEqual(before);
    player.runtime.resources.reaction = 0;
    const retreat = planMonsterTurn(state, monster, player.id, 60, 20, risk);
    expect(gridDistanceFt(retreat.firstMove.at(-1)!, state.tokens[player.id].position)).toBe(20);
    expect(retreat.attacks).toBe(true);
    player.runtime.resources.reaction = 1;
    player.runtime.activeEffects = [{id: 'stunned', name: 'Stunned', source: 'test', mechanics: {kind: 'condition', value: 'stunned'}}];
    expect(risk(origin, [{x: 6, y: 4}])).toBe(0);
    player.runtime.activeEffects = [];
    player.runtime.hp.current = 0;
    expect(risk(origin, [{x: 6, y: 4}])).toBe(0);
  });

  it.each([false, true])('offers an optional style-aware unarmed attack with held weapon %s', async held => {
    const setup = unarmedParticipant();
    const participant = setup.participant;
    const source = participant.canonical.world.actors[participant.character.id];
    source.runtime.equipment.main_hand = held ? CARD_LONGSWORD.id : null;
    source.runtime.equipment.off_hand = null;
    let state = await createSoloCombatState({character: participant.character, participant,
      selected: [{monster: {...goblin(), max_hp: 100}, quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
    const monster = Object.values(state.world.actors).find(row => row.kind === 'monster')!;
    monster.ac = 1;
    state.tokens[source.id].position = {x: 4, y: 4};
    state.tokens[monster.id].position = {x: 5, y: 4};
    state = advanceTurn(state, () => 0.5);
    const beforeReaction = state.world.actors[source.id].runtime.resources.reaction;
    const beforeAction = state.world.actors[source.id].runtime.resources.action;
    state = moveActor({state: clone(state), actorId: monster.id, destination: {x: 6, y: 4},
      rng: () => {throw Error('The player has not chosen to react');}});
    const options = state.pendingTriggeredAction!.optionActionIds;
    expect(options).toHaveLength(held ? 2 : 1);
    const unarmed = options.find(id => id.endsWith(':unarmed:opportunity'))!;
    expect(unarmed).toBeTruthy();
    expect(state.playerActionIds).not.toContain(unarmed);
    expect(state.tokens[monster.id].position).toEqual({x: 5, y: 4});
    if (held) {
      const weapon = options.find(id => id.endsWith(':main:opportunity'))!;
      const weaponHit = resolveTriggeredCombatAction(clone(state), weapon, () => 0.5);
      expect(weaponHit.world.actors[monster.id].runtime.hp.current)
        .toBe(100 - 5 - source.character.abilityMods.str);
      expect(weaponHit.world.actors[source.id].runtime.resources.reaction).toBe(beforeReaction - 1);
    }
    const declined = resumePendingMovement(resolveTriggeredCombatAction(clone(state), null), () => 0.5);
    expect(declined.world.actors[source.id].runtime.resources.reaction).toBe(beforeReaction);
    expect(declined.world.actors[monster.id].runtime.hp.current).toBe(100);
    let accepted = resolveTriggeredCombatAction(clone(state), unarmed, () => 0.5);
    accepted = resumePendingMovement(clone(accepted), () => 0.5);
    const damage = Math.floor(0.5 * (held ? 6 : 8)) + 1 + source.character.abilityMods.str;
    expect(accepted.world.actors[monster.id].runtime.hp.current).toBe(100 - damage);
    expect(accepted.world.actors[source.id].runtime.resources.reaction).toBe(beforeReaction - 1);
    expect(accepted.world.actors[source.id].runtime.resources.action).toBe(beforeAction);
    expect(accepted.tokens[monster.id].position).toEqual({x: 6, y: 4});
    expect(accepted.pendingTriggeredAction).toBeUndefined();
    expect(accepted.pendingMovementStep).toBeUndefined();
  });
});


it.each([false, true])('offers only the melee reaction whose reach was left, ranged-only %s', async ranged => {
  const setup = unarmedParticipant();
  const participant = setup.participant;
  const source = participant.canonical.world.actors[participant.character.id];
  const weapon = clone(CARD_LONGSWORD);
  const profile = weapon.mechanics!.weapon_profile as Record<string, unknown>;
  profile.default_attack_mode = ranged ? 'ranged' : 'melee';
  profile.attack_modes = ranged ? [{kind: 'ranged', normal_ft: 80, long_ft: 320}] : [{kind: 'melee', reach_ft: 10}];
  source.character.knownCards = [weapon];
  source.character.equippedCards = [weapon];
  let state = await createSoloCombatState({character: participant.character, participant,
    selected: [{monster: {...goblin(), max_hp: 100}, quantity: 1}], actions: [scimitar()], effects: [], rng: () => 0.5});
  const monster = Object.values(state.world.actors).find(row => row.kind === 'monster')!;
  state.tokens[source.id].position = {x: 4, y: 4};
  state.tokens[monster.id].position = {x: 5, y: 4};
  state = advanceTurn(state, () => 0.5);
  const noRoll = () => {throw Error('Choosing or declining has not rolled an attack');};
  state = moveActor({state, actorId: monster.id, destination: {x: 6, y: 4}, rng: noRoll});
  expect(state.pendingTriggeredAction?.optionActionIds).toEqual([`${source.id}:melee-reaction:unarmed:opportunity`]);
  state = resumePendingMovement(resolveTriggeredCombatAction(clone(state), null), noRoll);
  state = moveActor({state, actorId: monster.id, destination: {x: 7, y: 4}, rng: noRoll});
  if (ranged) expect(state.pendingTriggeredAction).toBeUndefined();
  else {
    expect(state.pendingTriggeredAction?.optionActionIds).toEqual([`${source.id}:melee-reaction:main:opportunity`]);
    state = resumePendingMovement(resolveTriggeredCombatAction(clone(state), null), noRoll);
  }
  expect(state.tokens[monster.id].position).toEqual({x: 7, y: 4});
  expect(state.world.actors[source.id].runtime.resources.reaction).toBe(1);
});
