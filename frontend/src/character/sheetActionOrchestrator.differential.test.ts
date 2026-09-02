import { describe, expect, it } from 'vitest';
import { startConcentration } from '../engine/concentration';
import type {
  EngineEvent,
  ExecuteContext,
  ExecuteResult,
  RuntimeState,
} from '../mvp/contracts';
import {
  createLogicalClock,
  createSequentialIdFactory,
} from '../rules-core/determinism';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type UncommittedRuleEvent,
} from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import type { Card } from '../types';
import {
  assertSheetParityHasNoPendingResolution,
  PACT_BLADE_HAND_CHOICE,
  PACT_BLADE_WEAPON_CHOICE,
  collectSheetPrimitiveChoices,
  executeSheetAction,
  MalformedSheetPrimitiveError,
  planSheetActionDice,
  SheetCanonicalCommandRejectedError,
  SheetMechanicsPreflightError,
  sheetPrimitiveCommandId,
  UnsupportedSheetPendingResolutionError,
  UnsupportedSheetPrimitiveError,
  UnknownSheetPrimitiveError,
} from './sheetActionOrchestrator';
import {
  readSheetCanonicalWorld,
  writeSheetCanonicalWorld,
  type SheetCanonicalRuntime,
} from './sheetCanonicalWorld';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_MATERIAL_RESOURCE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
} from '../rules-core/familiarRuntime';
import {
  RULES_LAB_BLADE_ACTOR_IDS,
  RULES_LAB_BLADE_SESSION_CONFIG,
  RULES_LAB_CHAIN_ACTOR_IDS,
  RULES_LAB_CHAIN_SESSION_CONFIG,
  RULES_LAB_FAMILIAR_ACTOR_IDS,
  RULES_LAB_FAMILIAR_SESSION_CONFIG,
  RULES_LAB_PACT_EXECUTION,
} from '../pages/rulesLabFixture';
import { migrateWorldState } from '../rules-core/worldMigration';
import { SHEET_SPELL_CAST_CHOICE } from './sheetSpellCastingUi';
import { WEAPON_ATTACK_PRIMITIVE } from '../rules-core/weaponActionPolicies';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'real-sheet-parity@1',
  contentHash: 'sha256:real-sheet-parity',
  errataVersion: 'PHB-2024',
};
const SOURCE = 'pc:source';
const TARGET = 'pc:target';
const FACTS: SpatialFacts = {
  factsSource: 'scenario',
  boardRevision: 0,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

const SWORD = {
  id: 'card:longsword',
  card_number: 'TEST-LONGSWORD',
  name: 'Longsword',
  type: 'weapon',
  weapon_type: 'longsword',
  bonus_value: '1d8',
  damage_type: 'slashing',
  properties: [],
  mastery: 'effect:sap',
  mechanics: {
    weapon_profile: {
      weapon_type: 'longsword',
      proficiency_category: 'martial',
      attack_ability: 'str',
      damage_lines: [{ dice: '1d8', type: 'slashing' }],
      default_attack_mode: 'melee',
      attack_modes: [{ kind: 'melee', reach_ft: 5 }],
      properties: [],
      mastery_effect_id: 'effect:sap',
      ammo: null,
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
} as unknown as Card;

const SAP = {
  id: 'effect:sap',
  card_number: 'EFFECT-SAP',
  name: 'Sap',
  mechanics: {
    weapon_mastery: {
      type: 'sap',
      consume: 'next',
      expires: 'start_of_source_next_turn',
    },
    activation: { mode: 'triggered', trigger: { event: 'hit' } },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [{
        kind: 'modifier',
        applies_to: { roll: 'attack' },
        op: 'disadvantage',
        consume: 'next',
        duration: { type: 'until_start_of_source_next_turn' },
      }],
    }],
  },
  weaponTypes: ['longsword'] as const,
  sourceEntityIds: ['effect:sap'] as const,
};

const WEAPON_ATTACK: RuleActionDefinition = {
  id: 'action:weapon-attack',
  name: 'Weapon Attack',
  kind: 'nonSpell',
  sourceEntityIds: ['action:weapon-attack'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Weapon Attack',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll',
      ability: 'auto',
      attack_kind: 'weapon_melee',
      vs: 'ac',
      on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
    }],
  },
};

const SAVE_SPELL: RuleActionDefinition = {
  id: 'spell:binding-frost',
  name: 'Binding Frost',
  kind: 'spell',
  sourceEntityIds: ['spell:binding-frost'],
  spell: {
    level: 0,
    sourceClass: 'CLASS-wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Binding Frost',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'wis',
      dc: '12',
      on_fail: [{
        kind: 'condition', value: 'restrained',
        duration: { type: 'rounds', amount: 1 },
      }],
      on_success: [],
    }],
  },
};

const RESTORE: RuleActionDefinition = {
  id: 'action:restore',
  name: 'Restore',
  kind: 'nonSpell',
  sourceEntityIds: ['action:restore'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['ally'],
  },
  mechanics: {
    name: 'Restore',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto',
      who: 'target',
      result: [
        { kind: 'healing', amount: '3' },
        { kind: 'temp_hp', amount: '4' },
      ],
    }],
  },
};

const FOCUS: RuleActionDefinition = {
  id: 'spell:focus',
  name: 'Focused Ward',
  kind: 'spell',
  sourceEntityIds: ['spell:focus'],
  spell: {
    level: 0,
    sourceClass: 'CLASS-wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  concentration: true,
  targeting: {
    minTargets: 0,
    maxTargets: 0,
    rangeFt: 0,
    requiresLineOfSight: false,
    allowedRelations: ['self'],
  },
  mechanics: {
    name: 'Focused Ward',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto',
      who: 'self',
      result: [{
        kind: 'modifier',
        applies_to: { roll: 'ac' },
        op: 'add',
        value: '+1',
        duration: { type: 'rounds', amount: 10, concentration: true },
      }],
    }],
  },
};

const PARRY: RuleActionDefinition = {
  id: 'reaction:parry',
  name: 'Parry',
  kind: 'nonSpell',
  sourceEntityIds: ['reaction:parry'],
  targeting: {
    minTargets: 0,
    maxTargets: 0,
    rangeFt: 0,
    requiresLineOfSight: false,
    allowedRelations: ['self'],
  },
  mechanics: {
    name: 'Parry',
    activation: {
      mode: 'reaction',
      trigger: { event: 'hit_by_attack' },
      cost: [{ resource: 'reaction' }],
    },
    effects: [{
      resolution: 'auto',
      who: 'self',
      result: [{
        kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+5',
        duration: { type: 'until_start_of_next_turn' },
      }],
    }],
  },
};

type SpellAction = typeof SAVE_SPELL | typeof FOCUS;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0.5;
}

function actor(input: {
  id: string;
  actionIds: string[];
  hp?: number;
  weapon?: boolean;
  mastery?: boolean;
  spells?: SpellAction[];
}): ActorState {
  const spells = input.spells ?? [];
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: input.id === TARGET ? 10 : 12,
    capabilities: { actionIds: [...input.actionIds] },
    character: {
      abilityMods: { str: 3, dex: 1, con: 1, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      ...(input.weapon ? {
        knownCards: [clone(SWORD)],
        equippedCards: [clone(SWORD)],
        weaponProficiencies: ['longsword'],
        ...(input.mastery ? { weaponMasteries: ['longsword'] } : {}),
      } : {}),
    },
    runtime: {
      hp: { current: input.hp ?? 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: input.weapon ? { main_hand: SWORD.id } : {},
      inventory: input.weapon ? [{ cardId: SWORD.id, qty: 1 }] : [],
      activeEffects: [],
      firedThisTurn: [],
    },
    ...(input.mastery ? { masteryEffects: { 'effect:sap': clone(SAP) } } : {}),
    ...(spells.length ? {
      spellcastingAccess: {
        grants: spells.map((spell) => ({
          grantId: `grant:${spell.id}`,
          actionId: spell.id,
          sourceId: 'CLASS-wizard',
          access: 'cantrip' as const,
          level: 0,
          spellcastingAbility: 'int' as const,
        })),
        preparedSources: {},
      },
    } : {}),
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: [`${input.id}:attack-profile`],
    },
  };
}

function catalog(actions: readonly RuleActionDefinition[]): RulesCatalog {
  const byId = new Map(actions.map((action) => [action.id, action]));
  return { getAction: (id) => byId.get(id) };
}

function pactTestWeapon(card: Card): Card {
  return {
    ...clone(card),
    mechanics: {
      ...(card.mechanics ?? {}),
      weapon_profile: {
        weapon_type: 'longsword',
        proficiency_category: 'martial',
        attack_ability: 'str',
        damage_lines: [{ dice: '1d8', type: 'slashing' }],
        versatile_grip: { dice: '1d10', type: 'slashing' },
        default_attack_mode: 'melee',
        attack_modes: [{ kind: 'melee', reach_ft: 5 }],
        properties: ['versatile'],
        mastery_effect_id: 'effect:mastery:sap',
        ammo: null,
        enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
        attunement: { required: false },
      },
    },
  };
}

function catalogWithCard(base: RulesCatalog, card: Card): RulesCatalog {
  return {
    getAction: (id) => base.getAction(id),
    getCard: (id) => id === card.id ? card : base.getCard?.(id),
  };
}

function spellDeclaration(action: SpellAction) {
  return {
    baseLevel: 0,
    grantId: `grant:${action.id}`,
    mode: 'normal' as const,
  };
}

function sheetContext(input: {
  source: ActorState;
  target?: ActorState;
  rng: () => number;
  action: RuleActionDefinition;
}): ExecuteContext {
  const spell = input.action.kind === 'spell' ? {
    ...spellDeclaration(input.action as SpellAction),
    castLevel: 0,
    sourceId: 'CLASS-wizard',
    spellcastingAbility: 'int' as const,
    payment: { kind: 'none' as const },
  } : undefined;
  return {
    character: input.source.character,
    selfRuntime: input.source.runtime,
    selfId: input.source.id,
    passives: input.source.passives,
    grantedEffects: input.source.grantedEffects,
    masteryEffects: input.source.masteryEffects,
    rng: input.rng,
    nextId: createSequentialIdFactory('sheet-parity'),
    ...(spell ? { spell } : {}),
    ...(input.target ? {
      target: {
        id: input.target.id,
        size: input.target.attackProfile?.size,
        ac: input.target.ac,
        characterContext: input.target.character,
        passives: input.target.passives,
        runtimeState: clone(input.target.runtime),
      },
    } : {}),
  };
}

function runSheet(input: {
  action: RuleActionDefinition;
  source: ActorState;
  target?: ActorState;
  rng?: readonly number[];
}): ExecuteResult {
  return executeSheetAction({
    state: clone(input.source.runtime),
    mechanics: input.action.mechanics,
    context: sheetContext({
      source: input.source,
      target: input.target,
      rng: sequence(input.rng ?? []),
      action: input.action,
    }),
  });
}

function dispatchAction(input: {
  action: RuleActionDefinition;
  source: ActorState;
  target: ActorState;
  rng?: readonly number[];
  extraActions?: RuleActionDefinition[];
}): InMemoryRulesSession {
  const actions = [input.action, ...(input.extraActions ?? [])];
  const world = createWorld({
    id: `world:${input.action.id}`,
    ruleset: RULESET,
    actors: [clone(input.source), clone(input.target)],
  });
  const session = new InMemoryRulesSession(world, catalog(actions), {
    rng: sequence(input.rng ?? []),
    clock: createLogicalClock(),
    nextId: createSequentialIdFactory('canonical-parity'),
  });
  const targeting = input.action.targeting;
  const hasTargets = (targeting?.maxTargets ?? 0) > 0;
  const command: GameCommand = {
    schemaVersion: 1,
    type: 'UseAction',
    commandId: `command:${input.action.id}`,
    expectedRevision: 0,
    rulesetContentHash: RULESET.contentHash,
    actorId: input.source.id,
    actionId: input.action.id,
    targetIds: hasTargets ? [input.target.id] : [],
    factsByTarget: hasTargets
      ? { [input.target.id]: {
          ...FACTS,
          relation: targeting?.allowedRelations.includes('enemy') ? 'enemy' : 'ally',
        } }
      : undefined,
    ...(input.action.kind === 'spell'
      ? { spell: spellDeclaration(input.action as SpellAction) }
      : {}),
  };
  const result = session.dispatch(command);
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return session;
}

function resolveTargetSave(session: InMemoryRulesSession, value: number): void {
  const pending = session.getState().pendingResolution;
  if (!pending || pending.type !== 'target_save') {
    throw new Error('Expected a canonical target-save continuation');
  }
  const result = session.dispatch({
    schemaVersion: 1,
    type: 'ResolveDecision',
    commandId: 'command:resolve-target-save',
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: pending.targetActorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: {
      kind: 'roll',
      roll: { mode: 'manual', dice: [{ sides: 20, value }] },
    },
  });
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
}

function engineEvents(events: readonly UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap((entry) => entry.payload.type === 'EngineEventRecorded'
    ? [entry.payload.event]
    : []);
}

function normalizedEffect(effect: RuntimeState['activeEffects'][number]) {
  return {
    name: effect.name,
    mechanics: effect.mechanics,
    roundsLeft: effect.roundsLeft,
    expiry: effect.expiry,
    source: effect.source,
    sourceId: effect.sourceId,
    ownerId: effect.ownerId,
  };
}

function normalizedRuntime(runtime: RuntimeState) {
  return {
    hp: runtime.hp,
    resources: runtime.resources,
    maxResources: runtime.maxResources,
    equipment: runtime.equipment,
    inventory: runtime.inventory,
    activeEffects: runtime.activeEffects
      .filter((effect) => (effect.mechanics as Record<string, unknown>).kind !== 'concentration')
      .map(normalizedEffect),
    firedThisTurn: runtime.firedThisTurn ?? [],
  };
}

function normalizedEvents(events: readonly EngineEvent[]): unknown[] {
  return events
    .filter((event) => !(
      event.type === 'effect_applied' && event.name.startsWith('Концентрация:')
    ))
    .map((event) => {
      if (event.type !== 'roll') return clone(event);
      return {
        type: event.type,
        roll: {
          kind: event.roll.kind,
          dice: event.roll.dice.map((die) => ({
            sides: die.sides,
            result: die.result,
            ...(die.sign === -1 ? { sign: die.sign } : {}),
          })),
          modifierTotal: event.roll.modifiers.reduce((sum, modifier) => (
            sum + modifier.value
          ), 0),
          total: event.roll.total,
          target: event.roll.target,
          outcome: event.roll.outcome,
          advantage: event.roll.advantage,
        },
      };
    });
}

function sheetSnapshot(input: {
  result: ExecuteResult;
  source: ActorState;
  target: ActorState;
  concentrationAction?: RuleActionDefinition;
}) {
  let sourceRuntime = input.result.state;
  let events = [...input.result.events];
  if (input.concentrationAction) {
    const previousIds = new Set(input.source.runtime.activeEffects.map((effect) => effect.id));
    const effectIds = sourceRuntime.activeEffects
      .filter((effect) => !previousIds.has(effect.id))
      .filter((effect) => (
        ((effect.mechanics as Record<string, unknown>).duration as Record<string, unknown> | undefined)
          ?.concentration === true
      ))
      .map((effect) => effect.id);
    const concentration = startConcentration(
      sourceRuntime,
      input.concentrationAction.name,
      effectIds,
    );
    sourceRuntime = concentration.state;
    events = [...events, ...concentration.events];
  }
  return {
    source: normalizedRuntime(sourceRuntime),
    target: normalizedRuntime(input.result.targetState ?? input.target.runtime),
    events: normalizedEvents(events),
    concentrationActionId: input.concentrationAction?.id ?? null,
  };
}

function canonicalSnapshot(
  session: InMemoryRulesSession,
  concentrationAction?: RuleActionDefinition,
) {
  const world = session.getState();
  assertSheetParityHasNoPendingResolution(world.pendingResolution);
  return {
    source: normalizedRuntime(world.actors[SOURCE].runtime),
    target: normalizedRuntime(world.actors[TARGET].runtime),
    events: normalizedEvents(engineEvents(session.getEvents())),
    concentrationActionId: concentrationAction
      ? world.concentrations[SOURCE]?.actionId ?? null
      : null,
  };
}

function primitiveRuntime(input: {
  actorId: string;
  world: ReturnType<typeof migrateWorldState>;
  action: RuleActionDefinition;
  catalog: RulesCatalog;
  cards?: Card[];
}): SheetCanonicalRuntime {
  return {
    actorId: input.actorId,
    world: input.world,
    actions: [input.action],
    catalog: input.catalog,
    cards: input.cards ?? [],
    resourceBindings: {},
    actionFor: () => input.action,
  };
}

function primitiveContext(
  actorState: ActorState,
  choices: Record<string, string[]>,
  nextId: () => string,
): ExecuteContext {
  return {
    character: actorState.character,
    selfRuntime: actorState.runtime,
    selfId: actorState.id,
    passives: actorState.passives,
    grantedEffects: actorState.grantedEffects,
    masteryEffects: actorState.masteryEffects,
    choices,
    rng: () => 0.5,
    nextId,
  };
}

function dispatchExpected(
  world: ReturnType<typeof migrateWorldState>,
  catalogValue: RulesCatalog,
  command: GameCommand,
  nextId: () => string,
): ReturnType<InMemoryRulesSession['getState']> {
  const session = new InMemoryRulesSession(clone(world), catalogValue, {
    rng: () => 0.5,
    clock: createLogicalClock(world.logicalClock),
    nextId,
  });
  const result = session.dispatch(command);
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return session.getState();
}

describe('real-sheet deterministic action orchestration parity', () => {
  it('plans dice without mutating either character', () => {
    const source = actor({
      id: SOURCE, actionIds: [WEAPON_ATTACK.id], weapon: true, mastery: true,
    });
    const target = actor({ id: TARGET, actionIds: [] });
    const before = clone({ source, target });
    const context = sheetContext({
      source, target, rng: () => 0.94, action: WEAPON_ATTACK,
    });
    expect(planSheetActionDice({
      state: source.runtime,
      mechanics: WEAPON_ATTACK.mechanics,
      context: { ...context, planning: true },
    }).map((die) => die.sides)).toEqual([20, 8]);
    expect({ source, target }).toEqual(before);
  });

  it('matches canonical two-character state/events for a weapon hit plus declarative Sap', () => {
    const source = actor({
      id: SOURCE, actionIds: [WEAPON_ATTACK.id], weapon: true, mastery: true,
    });
    const target = actor({ id: TARGET, actionIds: [] });
    const sheet = runSheet({ action: WEAPON_ATTACK, source, target, rng: [0.5, 0.4] });
    const canonical = dispatchAction({
      action: WEAPON_ATTACK, source, target, rng: [0.5, 0.4],
    });
    expect(sheetSnapshot({ result: sheet, source, target }))
      .toEqual(canonicalSnapshot(canonical));
    expect(sheet.targetState?.activeEffects).toHaveLength(1);
  });

  it('matches a failed target save and its condition after canonical continuation resolution', () => {
    const source = actor({
      id: SOURCE, actionIds: [SAVE_SPELL.id], spells: [SAVE_SPELL],
    });
    const target = actor({ id: TARGET, actionIds: [] });
    const manualFive = (5 - 0.5) / 20;
    const sheet = runSheet({ action: SAVE_SPELL, source, target, rng: [manualFive] });
    const canonical = dispatchAction({ action: SAVE_SPELL, source, target });
    expect(canonical.getState().pendingResolution?.type).toBe('target_save');
    resolveTargetSave(canonical, 5);
    expect(sheetSnapshot({ result: sheet, source, target }))
      .toEqual(canonicalSnapshot(canonical));
    expect(sheet.targetState?.activeEffects[0].mechanics).toMatchObject({
      kind: 'condition', value: 'restrained',
    });
  });

  it('matches target healing and Temporary HP replacement', () => {
    const source = actor({ id: SOURCE, actionIds: [RESTORE.id] });
    const target = actor({ id: TARGET, actionIds: [], hp: 4 });
    const sheet = runSheet({ action: RESTORE, source, target });
    const canonical = dispatchAction({ action: RESTORE, source, target });
    expect(sheetSnapshot({ result: sheet, source, target }))
      .toEqual(canonicalSnapshot(canonical));
    expect(sheet.targetState?.hp).toEqual({ current: 7, max: 10, temp: 4 });
  });

  it('matches a supported self-effect concentration start while retaining both actors', () => {
    const source = actor({ id: SOURCE, actionIds: [FOCUS.id], spells: [FOCUS] });
    const target = actor({ id: TARGET, actionIds: [] });
    const sheet = runSheet({ action: FOCUS, source, target });
    const canonical = dispatchAction({ action: FOCUS, source, target });
    expect(sheetSnapshot({ result: sheet, source, target, concentrationAction: FOCUS }))
      .toEqual(canonicalSnapshot(canonical, FOCUS));
    expect(canonical.getState().concentrations[SOURCE]?.effectLinks).toHaveLength(1);
  });

  it('fails closed instead of projecting a canonical reaction continuation as completed', () => {
    const source = actor({
      id: SOURCE, actionIds: [WEAPON_ATTACK.id], weapon: true, mastery: true,
    });
    const target = actor({ id: TARGET, actionIds: [PARRY.id] });
    const canonical = dispatchAction({
      action: WEAPON_ATTACK,
      source,
      target,
      rng: [0.5],
      extraActions: [PARRY],
    });
    expect(canonical.getState().pendingResolution?.type).toBe('attack_reaction');
    expect(() => canonicalSnapshot(canonical)).toThrowError(
      UnsupportedSheetPendingResolutionError,
    );
  });

  it.each([
    'target_save',
    'attack_reaction',
    'protection_reaction',
    'unarmed_save',
    'shove_outcome',
    'escape_grapple',
    'magic_missile_reaction',
    'concentration_save',
    'mastery_save',
    'hazard_save',
  ] as const)('fails closed for unsupported canonical pending type %s', (type) => {
    expect(() => assertSheetParityHasNoPendingResolution({ type } as never))
      .toThrowError(UnsupportedSheetPendingResolutionError);
  });
});

describe('real-sheet canonical primitive bridge', () => {
  it('accepts a pending weapon primitive through the shared sheet registry', () => {
    const actorId = RULES_LAB_BLADE_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_BLADE_SESSION_CONFIG.createWorld());
    const action: RuleActionDefinition = {
      ...WEAPON_ATTACK,
      mechanics: {
        ...WEAPON_ATTACK.mechanics,
        primitive: { type: WEAPON_ATTACK_PRIMITIVE },
      },
    };
    const runtime = primitiveRuntime({
      actorId,
      world,
      action,
      catalog: RULES_LAB_BLADE_SESSION_CONFIG.catalog,
    });

    expect(collectSheetPrimitiveChoices({ runtime, action }, 'encounter')).toEqual([]);
  });

  it('offers only Cards accepted by the authoritative Pact Blade conjure validator', () => {
    const actorId = RULES_LAB_BLADE_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_BLADE_SESSION_CONFIG.createWorld());
    const action = RULES_LAB_BLADE_SESSION_CONFIG.catalog.getAction(
      RULES_LAB_PACT_EXECUTION.blade.bondActionId,
    )!;
    const sourceCard = RULES_LAB_BLADE_SESSION_CONFIG.catalog.getCard?.(
      RULES_LAB_PACT_EXECUTION.blade.weaponCardId,
    );
    if (!sourceCard) throw new Error('Generated Pact Blade fixture has no weapon Card');
    const valid = pactTestWeapon(sourceCard);
    const ranged = {
      ...clone(valid),
      id: 'card:ranged-rejected-by-pact-blade',
      card_number: 'TEST-RANGED-PACT-BLADE',
      name: 'Ranged weapon',
      mechanics: {
        weapon_profile: {
          weapon_type: 'dart',
          proficiency_category: 'simple',
          attack_ability: 'dex',
          damage_lines: [{ dice: '1d4', type: 'piercing' }],
          default_attack_mode: 'ranged',
          attack_modes: [{ kind: 'ranged', normal_ft: 20, long_ft: 60 }],
          properties: ['thrown'],
          mastery_effect_id: 'effect:mastery:vex',
          ammo: null,
          enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
          attunement: { required: false },
        },
      },
    } as Card;
    const incomplete = {
      ...clone(valid),
      id: 'card:incomplete-rejected-by-pact-blade',
      card_number: '',
      name: 'Incomplete weapon',
      mechanics: {},
    } as Card;
    const runtime = primitiveRuntime({
      actorId,
      world,
      action,
      catalog: RULES_LAB_BLADE_SESSION_CONFIG.catalog,
      cards: [ranged, incomplete, valid],
    });

    const choices = collectSheetPrimitiveChoices({ runtime, action });
    expect(choices.find((candidate) => candidate.id === PACT_BLADE_WEAPON_CHOICE)?.items)
      .toEqual([{ id: valid.id, name: valid.name }]);
  });

  it('executes compiled Pact Blade through the same command and preserves it across JSON persistence', () => {
    const actorId = RULES_LAB_BLADE_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_BLADE_SESSION_CONFIG.createWorld());
    const actionId = RULES_LAB_PACT_EXECUTION.blade.bondActionId;
    const action = RULES_LAB_BLADE_SESSION_CONFIG.catalog.getAction(actionId)!;
    const sourceCard = RULES_LAB_BLADE_SESSION_CONFIG.catalog.getCard?.(
      RULES_LAB_PACT_EXECUTION.blade.weaponCardId,
    );
    expect(sourceCard).toBeDefined();
    if (!sourceCard) throw new Error('Generated Pact Blade fixture has no weapon Card');
    const card = pactTestWeapon(sourceCard);
    const runtimeCatalog = catalogWithCard(RULES_LAB_BLADE_SESSION_CONFIG.catalog, card);
    const choices = {
      [PACT_BLADE_WEAPON_CHOICE]: [RULES_LAB_PACT_EXECUTION.blade.weaponCardId],
      [PACT_BLADE_HAND_CHOICE]: ['main_hand'],
    };
    const result = executeSheetAction({
      state: clone(world.actors[actorId].runtime),
      mechanics: action.mechanics,
      context: primitiveContext(
        world.actors[actorId],
        choices,
        createSequentialIdFactory('primitive'),
      ),
      canonical: {
        runtime: primitiveRuntime({
          actorId,
          world,
          action,
          catalog: runtimeCatalog,
          cards: [card],
        }),
        action,
      },
    });
    const command: GameCommand = {
      schemaVersion: 1,
      type: 'BondPactBlade',
      commandId: sheetPrimitiveCommandId(actorId, action.id, 0),
      expectedRevision: 0,
      rulesetContentHash: world.ruleset.contentHash,
      actorId,
      mode: 'conjure',
      weaponCardId: RULES_LAB_PACT_EXECUTION.blade.weaponCardId,
      hand: 'main_hand',
    };
    const expected = dispatchExpected(
      world,
      runtimeCatalog,
      command,
      createSequentialIdFactory('primitive'),
    );
    expect(result.canonicalWorld).toEqual(expected);
    expect(result.state.resources.bonus_action).toBe(0);
    expect(expected.actors[actorId].warlockPacts?.blade?.activeBond?.weaponCardId)
      .toBe(RULES_LAB_PACT_EXECUTION.blade.weaponCardId);

    const turnState = writeSheetCanonicalWorld({}, actorId, expected);
    const restored = readSheetCanonicalWorld(
      JSON.parse(JSON.stringify(turnState)) as Record<string, unknown>,
      actorId,
      expected.ruleset.contentHash,
    );
    expect(restored).toEqual(expected);
  });

  it('executes compiled Pact Chain Find Familiar at will while spending Action and incense, not a slot', () => {
    const actorId = RULES_LAB_CHAIN_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_CHAIN_SESSION_CONFIG.createWorld());
    const actionId = RULES_LAB_PACT_EXECUTION.chain.findFamiliarActionId;
    const action = RULES_LAB_CHAIN_SESSION_CONFIG.catalog.getAction(actionId)!;
    const grant = world.actors[actorId].spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === action.id && candidate.access === 'innate'
    ));
    expect(grant).toBeDefined();
    const choices = {
      [FIND_FAMILIAR_FORM_CHOICE]: ['imp'],
      [FIND_FAMILIAR_SPIRIT_CHOICE]: ['fiend'],
      [FIND_FAMILIAR_CAST_PATH_CHOICE]: ['pact_chain_magic_action'],
    };
    const encounterChoices = collectSheetPrimitiveChoices({
      runtime: primitiveRuntime({
        actorId,
        world,
        action,
        catalog: RULES_LAB_CHAIN_SESSION_CONFIG.catalog,
      }),
      action,
    }, 'encounter');
    expect(encounterChoices.find((candidate) => (
      candidate.id === SHEET_SPELL_CAST_CHOICE
    ))?.items).toEqual([
      expect.objectContaining({ id: expect.stringContaining(grant!.grantId) }),
    ]);
    const result = executeSheetAction({
      state: clone(world.actors[actorId].runtime),
      mechanics: action.mechanics,
      context: primitiveContext(
        world.actors[actorId],
        choices,
        createSequentialIdFactory('chain-familiar'),
      ),
      canonical: {
        runtime: primitiveRuntime({
          actorId,
          world,
          action,
          catalog: RULES_LAB_CHAIN_SESSION_CONFIG.catalog,
        }),
        action,
      },
    });
    const expected = dispatchExpected(
      world,
      RULES_LAB_CHAIN_SESSION_CONFIG.catalog,
      {
        schemaVersion: 1,
        type: 'UseAction',
        commandId: sheetPrimitiveCommandId(actorId, action.id, 0),
        expectedRevision: 0,
        rulesetContentHash: world.ruleset.contentHash,
        actorId,
        actionId: action.id,
        targetIds: [],
        choices: Object.fromEntries(Object.entries(choices).map(([key, value]) => [key, value[0]])),
        spell: {
          baseLevel: 1,
          grantId: grant!.grantId,
          mode: 'normal',
          preferFreeUse: false,
        },
      },
      createSequentialIdFactory('chain-familiar'),
    );
    expect(result.canonicalWorld).toEqual(expected);
    expect(result.state.resources.action).toBe(0);
    expect(result.state.resources.spell_slot_1).toBe(world.actors[actorId].runtime.resources.spell_slot_1);
    expect(result.state.resources[FIND_FAMILIAR_MATERIAL_RESOURCE]).toBe(10);
    expect(result.events.filter((event) => (
      event.type === 'resource_spent'
      && event.resource === FIND_FAMILIAR_MATERIAL_RESOURCE
    ))).toEqual([{
      type: 'resource_spent',
      resource: FIND_FAMILIAR_MATERIAL_RESOURCE,
      amount: 10,
      remaining: 10,
    }]);
    const familiar = Object.values(expected.actors).find((candidate) => (
      candidate.familiarState?.ownerActorId === actorId
    ));
    expect(familiar?.familiarState).toMatchObject({
      extension: 'pact_chain',
      spiritType: 'fiend',
      form: { id: 'imp' },
    });
  });

  it('executes base compiled Find Familiar with exact slot/material payment', () => {
    const actorId = RULES_LAB_FAMILIAR_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_FAMILIAR_SESSION_CONFIG.createWorld());
    const actionId = RULES_LAB_PACT_EXECUTION.familiar.findFamiliarActionId;
    const action = RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog.getAction(actionId)!;
    const grant = world.actors[actorId].spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === action.id && candidate.slotResource === 'spell_slot_1'
    ));
    expect(grant).toBeDefined();
    expect(() => collectSheetPrimitiveChoices({
      runtime: primitiveRuntime({
        actorId,
        world,
        action,
        catalog: RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog,
      }),
      action,
    }, 'encounter')).toThrowError(SheetMechanicsPreflightError);
    const choices = {
      [FIND_FAMILIAR_FORM_CHOICE]: ['owl'],
      [FIND_FAMILIAR_SPIRIT_CHOICE]: ['fey'],
      [FIND_FAMILIAR_CAST_PATH_CHOICE]: ['spell_slot'],
    };
    const result = executeSheetAction({
      state: clone(world.actors[actorId].runtime),
      mechanics: action.mechanics,
      context: primitiveContext(
        world.actors[actorId],
        choices,
        createSequentialIdFactory('base-familiar'),
      ),
      canonical: {
        runtime: primitiveRuntime({
          actorId,
          world,
          action,
          catalog: RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog,
        }),
        action,
      },
    });
    expect(result.state.resources.action).toBe(0);
    expect(result.state.resources.spell_slot_1).toBe(1);
    expect(result.state.resources[FIND_FAMILIAR_MATERIAL_RESOURCE]).toBe(10);
    expect(Object.values(result.canonicalWorld!.actors).find((candidate) => (
      candidate.familiarState?.ownerActorId === actorId
    ))?.familiarState).toMatchObject({
      extension: 'base',
      spiritType: 'fey',
      form: { id: 'owl' },
    });
  });

  it('executes Wild Companion from the sheet as a canonical material-free Fey familiar', () => {
    const actorId = RULES_LAB_FAMILIAR_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_FAMILIAR_SESSION_CONFIG.createWorld());
    const action: RuleActionDefinition = {
      id: 'test.action.sheet-wild-companion',
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
    world.actors[actorId].capabilities.actionIds.push(action.id);
    world.actors[actorId].capabilities.featureSources = {
      ...(world.actors[actorId].capabilities.featureSources ?? {}),
      [action.id]: ['EFF-wild-companion'],
    };
    world.actors[actorId].runtime.resources.wild_shape = 2;
    world.actors[actorId].runtime.maxResources.wild_shape = 2;
    const catalog: RulesCatalog = {
      ...RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog,
      getAction: (id) => id === action.id
        ? action
        : RULES_LAB_FAMILIAR_SESSION_CONFIG.catalog.getAction(id),
    };
    const runtime = primitiveRuntime({ actorId, world, action, catalog });
    expect(collectSheetPrimitiveChoices({ runtime, action })).toEqual([
      expect.objectContaining({ id: FIND_FAMILIAR_FORM_CHOICE, prompt: 'Форма дикого спутника' }),
    ]);
    const result = executeSheetAction({
      state: clone(world.actors[actorId].runtime),
      mechanics: action.mechanics,
      context: primitiveContext(
        world.actors[actorId],
        { [FIND_FAMILIAR_FORM_CHOICE]: ['owl'] },
        createSequentialIdFactory('sheet-wild-companion'),
      ),
      canonical: { runtime, action },
    });
    expect(result.state.resources).toMatchObject({ action: 0, wild_shape: 1 });
    expect(Object.values(result.canonicalWorld!.actors).find((candidate) => (
      candidate.familiarState?.ownerActorId === actorId
    ))?.familiarState).toMatchObject({
      extension: 'base', spiritType: 'fey', form: { id: 'owl' },
    });
    expect(result.events.some((event) => (
      event.type === 'narrative' && event.text.includes('Дикий спутник')
    ))).toBe(true);
  });

  it.each([
    {
      label: 'unknown primitive',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        primitive: { type: 'future_unknown_primitive' },
        effects: [],
      },
      error: UnknownSheetPrimitiveError,
    },
    {
      label: 'malformed primitive',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        primitive: {},
        effects: [],
      },
      error: MalformedSheetPrimitiveError,
    },
    {
      label: 'known but unsupported primitive',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        primitive: { type: 'burning_hands_objects' },
        effects: [],
      },
      error: UnsupportedSheetPrimitiveError,
    },
    {
      label: 'missing grant_effect reference',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: 'missing' }] }],
      },
      error: SheetMechanicsPreflightError,
    },
    {
      label: 'invalid formula',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '1d' }] }],
      },
      error: SheetMechanicsPreflightError,
    },
  ])('fails closed before cost for $label', ({ mechanics, error }) => {
    const source = actor({ id: SOURCE, actionIds: [] });
    const before = clone(source.runtime);
    expect(() => executeSheetAction({
      state: source.runtime,
      mechanics,
      context: sheetContext({ source, rng: () => 0.5, action: RESTORE }),
    })).toThrowError(error);
    expect(source.runtime).toEqual(before);
    expect(source.runtime.resources.action).toBe(1);
  });

  it('does not pay Pact Blade when the canonical card reference is rejected', () => {
    const actorId = RULES_LAB_BLADE_ACTOR_IDS[0];
    const world = migrateWorldState(RULES_LAB_BLADE_SESSION_CONFIG.createWorld());
    const action = RULES_LAB_BLADE_SESSION_CONFIG.catalog.getAction(
      RULES_LAB_PACT_EXECUTION.blade.bondActionId,
    )!;
    const before = clone(world.actors[actorId].runtime);
    expect(() => executeSheetAction({
      state: before,
      mechanics: action.mechanics,
      context: primitiveContext(world.actors[actorId], {
        [PACT_BLADE_WEAPON_CHOICE]: ['missing-card'],
        [PACT_BLADE_HAND_CHOICE]: ['main_hand'],
      }, createSequentialIdFactory('rejected')),
      canonical: {
        runtime: primitiveRuntime({
          actorId,
          world,
          action,
          catalog: RULES_LAB_BLADE_SESSION_CONFIG.catalog,
        }),
        action,
      },
    })).toThrowError(SheetCanonicalCommandRejectedError);
    expect(world.actors[actorId].runtime).toEqual(before);
    expect(before.resources.bonus_action).toBe(1);
  });
});
