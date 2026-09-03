import type { Action, PassiveEffect } from '../types';
import type { ForgeCharacter } from '../character/types';
import {
  createSheetCombatSession,
  executeSheetCombatAction,
  newSheetRuntimeCommandId,
  type SheetCombatSession,
  type SheetCombatParticipantSeed,
  type SheetCombatTransition,
} from '../character/sheetCombatSession';
import type { SheetCanonicalCommandInput } from '../character/sheetCanonicalCommand';
import {
  createLogicalClock,
  createSequentialIdFactory,
} from '../rules-core/determinism';
import type {
  ActorState,
  ActionWorldInput,
  DecisionResponse,
  GameCommand,
  RuleActionDefinition,
  RuleHazardDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import { canFamiliarUseOrdinaryAction } from '../rules-core/findFamiliar';
import { turnStartGrappleDamageOpportunity } from '../rules-core/fightingStyleComplexPrimitives';
import { conditionInteractionDenied } from '../rules-core/conditionsRuntime';
import { parseWeaponProfile } from '../rules-core/weaponProfile';
import type { WorldObjectState } from '../rules-core/worldObjects';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Monster } from '../monsters/types';
import { canPay, pay } from '../engine/cost';
import { payloadsOf } from '../engine/mechanicsView';
import { deniedCapabilities } from '../engine/modifiers';
import {
  executeRemoteManipulator as executeEngineRemoteManipulator,
  type RemoteManipulatorCommand,
} from '../engine/execute';
import { describeEngineEvent, describeMovement, describeResource } from '../engine/events';
import { stoneworkContactFactsFromChoices } from '../mechanics/collectChoices';
import { runtimeBoons } from '../engine/boons';
import { compileMonsterInstance } from './monsterCompiler';
import { planMonsterTurn } from './monsterAi';
import { projectCombatLogRecords } from './combatLog';
import {
  areaActorIds,
  effectiveActorSize,
  effectiveActorSpeedFt,
  effectiveCombatActorSpeedFt,
  gridDistanceFt,
  occupiedPositions,
  pullToward,
  pushAway,
} from './tacticalGrid';
import {
  createCombatArea,
  areaContains,
  decrementSourceAreas,
  enteredAndExitedAreas,
  hazardCatalog,
  movementCostThroughAreas,
  pendingTriggerForArea,
  queueCombatAreaEvent,
  reconcileInsideAreaConditions,
  removeInactiveCombatAreas,
} from './combatAreas';
import {
  SOLO_COMBAT_SCHEMA_VERSION,
  TACTICAL_HEIGHT,
  TACTICAL_WIDTH,
  combatRelation,
  controlledCharacterIds,
  isControlledCharacter,
  spatialFacts,
  type CombatLogEntry,
  type CombatLogEventRecord,
  type GridPosition,
  type PendingD20Interrupt,
  type PendingTriggeredAction,
  type SoloCombatState,
} from './types';
import { warCasterOpportunitySpellVersion } from '../rules-core/generalSpellFeatRuntime';
import { generalFeatTriggeredUseKey } from '../rules-core/generalFeatDamageRuntime';
import {
  actorOwnsCharger,
  actorOwnsMountedCombatant,
  actorOwnsPolearmMaster,
  actorOwnsSentinel,
  chargerApproachEligible,
  MOUNTED_COMBATANT_ADVANTAGE_PASSIVE_ID,
  mountedCombatantAttackAdvantage,
  polearmMasterButtEligible,
  polearmMasterEntryEligible,
  shieldMasterBashEligible,
} from '../rules-core/generalFeatReactionRuntime';
import { projectSoloCombatActionChoices, UNARMED_STRIKE_CHOICE_ID } from './actionChoices';

type Rng = () => number;
type CombatActionInput = {
  state: SoloCombatState;
  actorId: string;
  actionId: string;
  targetIds: string[];
  worldPosition?: GridPosition;
  worldInput?: ActionWorldInput;
  scenarioObjects?: readonly WorldObjectState[];
  choices?: Readonly<Record<string, readonly string[]>>;
  rng?: Rng;
};
const ALERT_INITIATIVE_SWAP_CAPABILITY = 'alert.initiative_swap';
const PROTECTION_REACTION_CAPABILITY = 'fighting_style.protection.reaction';
const INTERCEPTION_REACTION_CAPABILITY = 'fighting_style.interception.reaction';
const COMBAT_AREA_EVENT_LABELS = {
  created: 'создание области',
  enter: 'вход в область',
  exit: 'выход из области',
  move: 'движение внутри области',
  start_turn: 'начало хода в области',
  end_turn: 'конец хода в области',
} as const;

export interface SelectedMonster {
  monster: Monster;
  quantity: number;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function buildCatalog(
  actions: readonly RuleActionDefinition[],
  hazards: readonly RuleHazardDefinition[] = [],
): RulesCatalog {
  const byId = new Map(actions.map((action) => [action.id, clone(action)]));
  const hazardsById = new Map(hazards.map((hazard) => [hazard.id, clone(hazard)]));
  return {
    getAction: (id) => byId.get(id),
    listActions: () => [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    getHazard: (id) => hazardsById.get(id),
  };
}

function primitiveType(action: RuleActionDefinition): string | null {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  return typeof primitive?.type === 'string' ? primitive.type : null;
}

const SHEET_PRIMITIVES = new Set([
  'burning_hands_objects', 'area_object_push', 'magic_missile',
  'weapon_attack', 'light_weapon_extra_attack',
]);

const TACTICAL_BASIC_ACTIONS = new Set([
  'action_basic_dash',
  'action_basic_disengage',
  'action_basic_dodge',
]);
const FAMILIAR_BASIC_ACTIONS = new Set([
  ...TACTICAL_BASIC_ACTIONS,
  'action_basic_help',
  'action_help',
]);
const FAMILIAR_SIZE_LABELS: Record<string, string> = {
  tiny: 'Крошечный', small: 'Маленький', medium: 'Средний',
};
const FAMILIAR_SPIRIT_LABELS: Record<string, string> = {
  celestial: 'Небожитель', fey: 'Фея', fiend: 'Исчадие',
};
const FAMILIAR_SPEED_LABELS: Record<string, string> = {
  walk: 'ходьба', climb: 'лазание', fly: 'полёт', swim: 'плавание', burrow: 'копание',
};
const FAMILIAR_TRAIT_LABELS: Record<string, string> = {
  agile: 'Проворство', amphibious: 'Амфибия', compression: 'Сжатие', flyby: 'Облёт',
  jumper: 'Прыгун', mimicry: 'Подражание', spider_climb: 'Паучье лазание',
  standing_leap: 'Прыжок с места', water_breathing: 'Дыхание под водой', web_walker: 'Хождение по паутине',
};

function opportunityVersion(action: RuleActionDefinition): RuleActionDefinition {
  const mechanics = clone(action.mechanics);
  delete mechanics.primitive;
  mechanics.activation = {
    mode: 'reaction',
    cost: [{ resource: 'reaction', amount: 1 }],
    trigger: { events: ['opportunity_attack'] },
  };
  mechanics.targeting = {
    domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
    range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'],
  };
  return {
    ...clone(action),
    id: `${action.id}:opportunity`,
    name: `${action.name} — провоцированная атака`,
    kind: 'nonSpell',
    mechanics,
    targeting: {
      minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
  } as RuleActionDefinition;
}

function installWarCasterOpportunitySpells(input: {
  actor: ActorState;
  sourceActions: readonly RuleActionDefinition[];
  catalogActions: RuleActionDefinition[];
}): string[] {
  const installed: string[] = [];
  for (const source of input.sourceActions) {
    const reaction = warCasterOpportunitySpellVersion(source, input.actor.passives ?? []);
    if (!reaction) continue;
    if (!input.catalogActions.some((candidate) => candidate.id === reaction.id)) {
      input.catalogActions.push(reaction);
    }
    if (!input.actor.capabilities.actionIds.includes(reaction.id)) {
      input.actor.capabilities.actionIds.push(reaction.id);
    }
    const access = input.actor.spellcastingAccess;
    if (access) {
      const reactionGrants = access.grants.filter((grant) => grant.actionId === source.id).map((grant) => ({
        ...grant,
        grantId: `${grant.grantId}:war-caster-opportunity`,
        actionId: reaction.id,
        // This is a derived cast mode of an already prepared spell, not a new
        // entry in the spellbook. Keeping `spellbook` here makes the persisted
        // prepared-source invariant demand that the reaction alias itself be
        // present in availableActionIds and bricks the next combat reload.
        access: grant.access === 'spellbook' ? 'always_prepared' as const : grant.access,
      }));
      for (const grant of reactionGrants) {
        if (!access.grants.some((candidate) => candidate.grantId === grant.grantId)) {
          access.grants.push(grant);
        }
      }
    }
    installed.push(reaction.id);
  }
  return installed;
}

function isAttackAction(action: RuleActionDefinition): boolean {
  return Array.isArray(action.mechanics.effects)
    && action.mechanics.effects.some((effect) => (
      effect && typeof effect === 'object'
        && (effect as Record<string, unknown>).resolution === 'attack_roll'
    ));
}

function activeActorId(state: SoloCombatState): string {
  if (state.world.scene.mode !== 'encounter') throw new Error('Бой ещё не начат');
  return state.world.scene.initiative[state.world.scene.activeIndex];
}

function appendLog(
  state: SoloCombatState,
  actorId: string,
  text: string,
  records: readonly CombatLogEventRecord[] = [],
): SoloCombatState {
  const round = state.world.scene.mode === 'encounter' ? state.world.scene.round : 1;
  const actorName = state.world.actors[actorId]?.name ?? 'Неизвестный участник';
  const loggedActorIds = new Set([
    actorId,
    ...records.flatMap((record) => [record.sourceActorId, record.actorId, ...record.targetIds]),
  ]);
  const entry: CombatLogEntry = {
    id: newSheetRuntimeCommandId(), round, actorId, text: `${actorName}: ${text}`,
    actorNames: Object.fromEntries([...loggedActorIds].map((loggedActorId) => [
      loggedActorId,
      state.world.actors[loggedActorId]?.name ?? loggedActorId,
    ])),
    ...(records.length ? { records: clone([...records]) } : {}),
  };
  return { ...state, log: [...state.log.slice(-79), entry] };
}

export function eventSummary(records: readonly CombatLogEventRecord[]): string {
  const fragments = records.flatMap((record) => {
    const event = record.event;
    if (!event) return [];
    switch (event.type) {
      case 'damage': return [describeEngineEvent(event).replace(/^Урон/u, 'урон')];
      case 'healing': return [`восстановлено HP: ${event.amount}`];
      case 'movement': return [describeMovement(event.mode, event.distanceFt)];
      case 'condition_applied': return [describeEngineEvent(event).replace(/^Состояние/u, 'состояние')];
      case 'resource_spent': return [`потрачено: ${describeResource(event.resource)}`];
      case 'roll': return [event.roll.text];
      default: return [];
    }
  });
  return fragments.length ? fragments.join('; ') : 'действие выполнено';
}

function teleportRangeFt(action: RuleActionDefinition): number | null {
  const visit = (value: unknown): number | null => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = visit(entry);
        if (found !== null) return found;
      }
      return null;
    }
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (row.kind === 'movement' && (row.mode === 'teleport' || row.value === 'teleport')) {
      const distance = Number(row.distance ?? row.distance_ft ?? row.distanceFt);
      return Number.isFinite(distance) && distance > 0 ? distance : null;
    }
    for (const nested of Object.values(row)) {
      const found = visit(nested);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(action.mechanics.effects);
}

function applyActionTeleport(
  before: SoloCombatState,
  after: SoloCombatState,
  actorId: string,
  destination: GridPosition | undefined,
  maxDistanceFt: number | null,
): SoloCombatState {
  if (!destination || maxDistanceFt === null) return after;
  const source = before.tokens[actorId]?.position;
  if (!source) throw new Error('Персонаж отсутствует на поле боя.');
  const distanceFt = gridDistanceFt(source, destination);
  if (distanceFt > maxDistanceFt) {
    throw new Error(`Телепортация ограничена ${maxDistanceFt} фт.`);
  }
  if (occupiedPositions(before, actorId).has(`${destination.x}:${destination.y}`)) {
    throw new Error('Для телепортации выберите свободную клетку.');
  }
  const log = [...after.log];
  const last = log[log.length - 1];
  if (last) {
    log[log.length - 1] = {
      ...last,
      text: last.text.replace(`телепортация ${maxDistanceFt} фт.`, `телепортация ${distanceFt} фт.`),
      records: last.records?.map((record) => (
        record.event?.type === 'movement' && record.event.mode === 'teleport'
          ? { ...record, event: { ...record.event, distanceFt } }
          : record
      )),
    };
  }
  return {
    ...after,
    tokens: {
      ...after.tokens,
      [actorId]: { ...after.tokens[actorId], position: { ...destination } },
    },
    boardRevision: after.boardRevision + 1,
    log,
  };
}

function actorHoldsWeaponOrShield(actor: ActorState): boolean {
  const cards = [...(actor.character.equippedCards ?? []), ...(actor.character.knownCards ?? [])];
  return (['main_hand', 'off_hand'] as const).some((slot) => {
    const cardId = actor.runtime.equipment[slot];
    if (!cardId) return false;
    const card = cards.find((candidate) => candidate.id === cardId);
    return card?.type === 'weapon' || card?.type === 'shield';
  });
}

function interceptionCandidates(
  state: SoloCombatState,
  sourceActorId: string,
  targetActorId: string,
): string[] {
  const targetSide = state.sideByActorId[targetActorId];
  const targetPosition = state.tokens[targetActorId]?.position;
  if (!targetSide || !targetPosition) return [];
  return Object.values(state.world.actors)
    .filter((candidate) => candidate.id !== targetActorId
      && candidate.id !== sourceActorId
      && state.sideByActorId[candidate.id] === targetSide
      && Boolean(candidate.capabilities.featureSources?.[INTERCEPTION_REACTION_CAPABILITY])
      && (candidate.runtime.resources.reaction ?? 0) >= 1
      && actorHoldsWeaponOrShield(candidate)
      && Boolean(state.tokens[candidate.id]?.position)
      && gridDistanceFt(state.tokens[candidate.id].position, targetPosition) <= 5)
    .map((candidate) => candidate.id)
    .sort();
}

function hpPool(hp: { current: number; temp: number }): number { return hp.current + hp.temp; }

function offerInterception(input: {
  before: SoloCombatState;
  after: SoloCombatState;
  sourceActorId: string;
  sourceActionId: string;
  targetIds: readonly string[];
  isAttack: boolean;
}): SoloCombatState {
  if (!input.isAttack || input.targetIds.length !== 1) return input.after;
  const targetActorId = input.targetIds[0];
  const existing = input.before.pendingInterceptionTrigger;
  const trigger = existing?.sourceActorId === input.sourceActorId
    && existing.sourceActionId === input.sourceActionId
    && existing.targetActorId === targetActorId
    ? existing
    : {
      sourceActorId: input.sourceActorId,
      sourceActionId: input.sourceActionId,
      targetActorId,
      targetHpBefore: clone(input.before.world.actors[targetActorId].runtime.hp),
      logIndex: input.before.log.length,
    };
  if (input.after.world.pendingResolution) {
    return { ...input.after, pendingInterceptionTrigger: trigger };
  }
  const targetAfter = input.after.world.actors[targetActorId];
  const hit = hasHitRecord(input.after, trigger.logIndex, input.sourceActorId);
  const incomingDamage = hpPool(trigger.targetHpBefore) - hpPool(targetAfter.runtime.hp);
  const { pendingInterceptionTrigger: _cleared, ...cleared } = input.after;
  if (!hit || incomingDamage <= 0) return cleared as SoloCombatState;
  const candidates = interceptionCandidates(cleared as SoloCombatState, input.sourceActorId, targetActorId);
  if (!candidates.length) return cleared as SoloCombatState;
  return {
    ...(cleared as SoloCombatState),
    pendingInterception: {
      sourceActorId: input.sourceActorId,
      targetActorId,
      interceptorActorIds: candidates,
      incomingDamage,
      targetHpBefore: trigger.targetHpBefore,
    },
  };
}

const MAGIC_SCHOOL_RU: Record<string, string> = {
  abjuration: 'ограждение', conjuration: 'вызов', divination: 'прорицание',
  enchantment: 'очарование', evocation: 'воплощение', illusion: 'иллюзия',
  necromancy: 'некромантия', transmutation: 'преобразование',
};

function worldObjectSummary(
  events: readonly UncommittedRuleEvent[],
  world: WorldState,
): string[] {
  const summaries = events.flatMap(({ payload }) => {
    if (payload.type !== 'WorldObjectMutationRecorded') return [];
    const event = payload.event;
    if (event.type === 'WorldObjectCreated' && event.object.illusion) {
      const illusion = event.object.illusion;
      const form = illusion.form === 'sound' ? 'звук' : 'изображение';
      return [
        `иллюзия «${illusion.description}» (${form}, ${event.object.roundsLeft ?? 0} раундов; `
        + `изучение: Интеллект (Расследование) против СЛ ${illusion.spellSaveDc})`,
      ];
    }
    if (event.type === 'WorldObjectCreated'
      && event.object.tags?.includes('prestidigitation:minor_creation')) {
      return [`создана малая безделушка «${event.object.name}» до конца следующего хода`];
    }
    if (event.type === 'WorldObjectCreated'
      && event.object.tags?.includes('instantaneous_sensory_effect')) {
      return [`сенсорный эффект «${event.object.name}»`];
    }
    if (event.type !== 'WorldObjectPatched') return [];
    const objectName = world.objects[event.objectId]?.name ?? event.objectId;
    if (event.reason === 'prestidigitation_fire_play') {
      return [`${objectName}: огонь ${event.patch.flame?.lit ? 'зажжён' : 'погашен'}`];
    }
    if (event.reason === 'prestidigitation_clean_or_soil') {
      return [`${objectName}: ${event.patch.soiled ? 'испачкан' : 'очищен'}`];
    }
    if (event.reason === 'prestidigitation_minor_sensation'
      || event.reason === 'prestidigitation_magic_mark') {
      const effect = event.patch.prestidigitation?.at(-1);
      if (!effect) return [];
      const kind = effect.kind === 'magic_mark' ? 'магическая метка' : 'малое ощущение';
      return [`${objectName}: ${kind} «${effect.description}» (${effect.roundsLeft} раундов)`];
    }
    if (event.reason === 'light_attached' && event.patch.illumination) {
      const light = event.patch.illumination;
      const color = light.color ? `; цвет: ${light.color}` : '';
      return [
        `${objectName}: яркий свет ${light.brightRadiusFt} фт. + тусклый свет ещё `
        + `${light.dimAdditionalRadiusFt} фт. (${light.roundsLeft} раундов${color})`,
      ];
    }
    return [];
  });
  const magicObservations = events.flatMap(({ payload }) => (
    payload.type === 'WorldObjectMutationRecorded'
      && payload.event.type === 'WorldObjectObserved'
      && payload.event.observation === 'detect_magic_aura'
      ? [payload.event]
      : []
  ));
  if (!magicObservations.length) return summaries;
  const sensed = magicObservations.filter((event) => event.details?.sensed === true);
  if (!sensed.length) return [...summaries, 'магических аур не обнаружено'];
  return [
    ...summaries,
    ...sensed.map((event) => {
      const objectName = world.objects[event.objectId]?.name ?? event.objectId;
      if (event.details?.auraVisible !== true) {
        return `${objectName}: магия ощущается, но аура не видна`;
      }
      const school = typeof event.details?.school === 'string'
        ? MAGIC_SCHOOL_RU[event.details.school] ?? event.details.school
        : null;
      return `${objectName}: видна магическая аура${school ? ` (${school})` : ''}`;
    }),
  ];
}

function applyForcedMovement(
  state: SoloCombatState,
  events: readonly UncommittedRuleEvent[],
): SoloCombatState {
  let tokens = state.tokens;
  let changed = false;
  for (const envelope of events) {
    const forced = envelope.payload.type === 'EngineEventRecorded'
      && envelope.payload.event.type === 'movement'
      && (envelope.payload.event.mode === 'push' || envelope.payload.event.mode === 'pull')
      ? {
        sourceActorId: envelope.payload.actorId,
        targetIds: envelope.payload.targetIds,
        distanceFt: envelope.payload.event.distanceFt,
        mode: envelope.payload.event.mode,
      }
      : envelope.payload.type === 'ShoveApplied' && envelope.payload.outcome === 'push_5ft'
        ? {
          sourceActorId: envelope.payload.sourceActorId,
          targetIds: [envelope.payload.targetActorId],
          distanceFt: 5,
          mode: 'push' as const,
        }
        : null;
    if (!forced) continue;
    const source = tokens[forced.sourceActorId]?.position;
    for (const targetId of forced.targetIds) {
      const target = tokens[targetId]?.position;
      if (!source || !target) continue;
      const position = (forced.mode === 'pull' ? pullToward : pushAway)({
        source, target, distanceFt: forced.distanceFt,
        occupied: occupiedPositions({ ...state, tokens }, targetId),
      });
      if (position.x !== target.x || position.y !== target.y) {
        tokens = { ...tokens, [targetId]: { ...tokens[targetId], position } };
        changed = true;
      }
    }
  }
  return changed ? { ...state, tokens, boardRevision: state.boardRevision + 1 } : state;
}

function outcome(state: SoloCombatState): SoloCombatState {
  const partyIds = controlledCharacterIds(state);
  const livingPlayer = partyIds.some((actorId) => (
    (state.world.actors[actorId]?.runtime.hp.current ?? 0) > 0
  ));
  if (!livingPlayer) return { ...state, outcome: 'defeat' };
  const livingOpponent = Object.values(state.world.actors).some((actor) => (
    actor.runtime.hp.current > 0
      && combatRelation(state, state.characterId, actor.id) === 'enemy'
  ));
  return livingOpponent ? state : { ...state, outcome: 'victory' };
}

function isBasicUnarmedStrike(state: SoloCombatState, action: RuleActionDefinition): boolean {
  return state.actionPresentation?.[action.id]?.actionRef?.card_number === 'action_basic_unarmed';
}

/**
 * Keep the turn movement ledger aligned with runtime speed changes without
 * erasing distance already moved or extra allotments granted by Dash.
 */
function reconcileMovementForSpeedChanges(
  state: SoloCombatState,
  nextWorld: WorldState,
): SoloCombatState {
  let movementRemainingFt = state.movementRemainingFt;
  for (const [actorId, nextActor] of Object.entries(nextWorld.actors)) {
    const previousActor = state.world.actors[actorId];
    if (!previousActor) continue;
    const speedDelta = effectiveActorSpeedFt(nextActor) - effectiveActorSpeedFt(previousActor);
    if (speedDelta === 0) continue;
    if (movementRemainingFt === state.movementRemainingFt) {
      movementRemainingFt = { ...state.movementRemainingFt };
    }
    const previousRemaining = state.movementRemainingFt[actorId]
      ?? effectiveActorSpeedFt(previousActor);
    movementRemainingFt[actorId] = Math.max(0, previousRemaining + speedDelta);
  }
  return movementRemainingFt === state.movementRemainingFt
    ? state
    : { ...state, movementRemainingFt };
}

/** Keep the tactical projection in lockstep with canonical summoned actors.
 * Rules-core owns the familiar lifecycle and encounter order; solo combat owns
 * board tokens plus the denormalized initiative/presentation indexes. */
function reconcileSummonedActorProjection(
  state: SoloCombatState,
  nextWorld: WorldState,
): SoloCombatState {
  const nextActorIds = new Set(Object.keys(nextWorld.actors));
  const removedActorIds = Object.keys(state.world.actors).filter((actorId) => !nextActorIds.has(actorId));
  const summonedActors = Object.values(nextWorld.actors).filter((actor) => actor.kind === 'summonedActor');
  if (!removedActorIds.length && !summonedActors.length) return { ...state, world: nextWorld };

  const tokens = { ...state.tokens };
  const movementRemainingFt = { ...state.movementRemainingFt };
  const initiativeBonuses = { ...state.initiativeBonuses };
  const sideByActorId = { ...state.sideByActorId };
  const actorPresentation = { ...state.actorPresentation };
  const playerActionIdsByActor = { ...(state.playerActionIdsByActor ?? {}) };
  const certifiedPlayerActionIdsByActor = { ...(state.certifiedPlayerActionIdsByActor ?? {}) };
  const monsterActionIds = { ...state.monsterActionIds };
  const opportunityActionIds = { ...state.opportunityActionIds };

  for (const actorId of removedActorIds) {
    delete tokens[actorId];
    delete movementRemainingFt[actorId];
    delete initiativeBonuses[actorId];
    delete sideByActorId[actorId];
    delete actorPresentation[actorId];
    delete playerActionIdsByActor[actorId];
    delete certifiedPlayerActionIdsByActor[actorId];
    delete monsterActionIds[actorId];
    delete opportunityActionIds[actorId];
  }

  let projection: SoloCombatState = {
    ...state,
    world: nextWorld,
    tokens,
    movementRemainingFt,
    initiativeBonuses,
    sideByActorId,
    actorPresentation,
    playerActionIdsByActor,
    certifiedPlayerActionIdsByActor,
    monsterActionIds,
    opportunityActionIds,
  };
  let boardChanged = removedActorIds.length > 0;
  const initiativeByActor = new Map(
    state.initiative
      .filter((entry) => nextActorIds.has(entry.actorId))
      .map((entry) => [entry.actorId, entry]),
  );

  for (const actor of summonedActors) {
    const familiar = actor.familiarState;
    const metadata = actor.familiarMetadata;
    if (!familiar || !metadata || familiar.presence !== 'present') continue;
    const { d20Roll, modifier, total } = familiar.initiative;
    if (d20Roll === null || modifier === null || total === null) {
      throw new Error(`Present familiar ${actor.id} has no complete initiative roll`);
    }
    const isNewToken = !projection.tokens[actor.id];
    const basicActionIds = state.catalogActions.flatMap((action) => {
      const cardNumber = state.actionPresentation?.[action.id]?.actionRef?.card_number;
      return cardNumber && FAMILIAR_BASIC_ACTIONS.has(cardNumber) ? [action.id] : [];
    });
    projection.playerActionIdsByActor![actor.id] = [...basicActionIds];
    projection.certifiedPlayerActionIdsByActor![actor.id] = [];
    const position = projection.tokens[actor.id]?.position
      ?? availableScenePosition(projection, 'party');
    projection.tokens[actor.id] = {
      ...projection.tokens[actor.id],
      actorId: actor.id,
      templateId: metadata.statBlockId,
      color: '#6f8f5a',
      position,
    };
    projection.movementRemainingFt[actor.id] = isNewToken
      ? effectiveActorSpeedFt(actor)
      : Math.min(
        projection.movementRemainingFt[actor.id] ?? effectiveActorSpeedFt(actor),
        effectiveActorSpeedFt(actor),
      );
    projection.initiativeBonuses[actor.id] = modifier;
    projection.sideByActorId[actor.id] = projection.sideByActorId[familiar.ownerActorId] ?? 'side:party';
    const spiritLabel = FAMILIAR_SPIRIT_LABELS[familiar.spiritType] ?? familiar.spiritType;
    const speeds = Object.entries(metadata.speeds)
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
      .map(([mode, feet]) => `${FAMILIAR_SPEED_LABELS[mode] ?? mode} ${feet} фт.`)
      .join(', ');
    projection.actorPresentation[actor.id] = {
      templateId: metadata.statBlockId,
      description: `Фамильяр ${actor.name}. Тип духа: ${spiritLabel}. Скорости: ${speeds}. Действует в собственной инициативе и подчиняется командам владельца; обычные атаки запрещены.`,
      size: FAMILIAR_SIZE_LABELS[metadata.size] ?? metadata.size,
      creatureType: spiritLabel,
      source: 'D&D 2024 · Monster Manual 2025',
      actionIds: basicActionIds,
      traits: (actor.passives ?? []).map((passive, index) => {
        const row = passive as Record<string, unknown>;
        const id = String(row.id ?? `familiar-trait-${index + 1}`);
        return { id, name: FAMILIAR_TRAIT_LABELS[id] ?? id.replaceAll('_', ' '), mechanics: clone(row) };
      }),
    };
    initiativeByActor.set(actor.id, {
      actorId: actor.id,
      die: d20Roll,
      bonus: modifier,
      total,
    });
    boardChanged ||= isNewToken;
  }

  if (nextWorld.scene.mode === 'encounter') {
    const currentActorId = nextWorld.scene.initiative[nextWorld.scene.activeIndex] ?? null;
    const initiative = [...initiativeByActor.values()].sort((left, right) => (
      right.total - left.total || right.bonus - left.bonus || left.actorId.localeCompare(right.actorId)
    ));
    if (initiative.length !== nextWorld.scene.initiative.length
      || initiative.some((entry) => !nextWorld.actors[entry.actorId])) {
      throw new Error('Canonical encounter contains an actor without a tactical initiative entry');
    }
    const order = initiative.map((entry) => entry.actorId);
    const activeIndex = currentActorId === null ? nextWorld.scene.activeIndex : order.indexOf(currentActorId);
    if (activeIndex < 0) throw new Error('Active actor disappeared while reconciling a familiar');
    projection.initiative = initiative;
    projection.world = {
      ...projection.world,
      scene: { ...nextWorld.scene, initiative: order, activeIndex },
    };
  } else {
    projection.initiative = [...initiativeByActor.values()];
  }
  if (boardChanged) projection.boardRevision += 1;
  return projection;
}

function transitionState(
  state: SoloCombatState,
  actorId: string,
  label: string,
  nextWorld: WorldState,
  rawEvents: readonly UncommittedRuleEvent[],
  emptySummary?: string,
): SoloCombatState {
  const records = projectCombatLogRecords(rawEvents);
  let next = reconcileMovementForSpeedChanges(state, nextWorld);
  next = reconcileSummonedActorProjection(next, nextWorld);
  const positionedObjects = next.worldObjectPositions ?? {};
  const retainedPositions = Object.fromEntries(Object.entries(positionedObjects).filter(
    ([objectId]) => nextWorld.objects[objectId] !== undefined,
  ));
  if (Object.keys(retainedPositions).length !== Object.keys(positionedObjects).length) {
    next = { ...next, worldObjectPositions: retainedPositions };
  }
  next = applyForcedMovement(next, rawEvents);
  const summaries = worldObjectSummary(rawEvents, nextWorld);
  next = appendLog(
    next,
    actorId,
    `${label}: ${summaries.length ? summaries.join('; ') : emptySummary ?? eventSummary(records)}`,
    records,
  );
  return outcome(removeInactiveCombatAreas(next));
}

function dispatch(input: {
  state: SoloCombatState;
  command: GameCommand;
  rng: Rng;
  label: string;
  emptySummary?: string;
}): SoloCombatState {
  const session = new InMemoryRulesSession(
    input.state.world,
    buildCatalog(input.state.catalogActions, hazardCatalog(input.state)), {
    rng: input.rng,
    clock: createLogicalClock(input.state.world.logicalClock),
    nextId: createSequentialIdFactory(`solo:${input.command.commandId}`),
  });
  const result = session.dispatch(input.command);
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return transitionState(
    input.state, input.command.actorId, input.label,
    session.getState(), session.getEvents(), input.emptySummary,
  );
}

function commandBase(state: SoloCombatState, actorId: string) {
  return {
    schemaVersion: 1 as const,
    commandId: newSheetRuntimeCommandId(),
    expectedRevision: state.world.revision,
    rulesetContentHash: state.world.ruleset.contentHash,
    actorId,
  };
}

function selectedSpellDeclaration(world: WorldState, actorId: string, action: RuleActionDefinition) {
  if (action.kind !== 'spell') return undefined;
  const actor = world.actors[actorId];
  const access = actor.spellcastingAccess;
  const grants = access?.grants.filter((candidate) => candidate.actionId === action.id) ?? [];
  const options = grants.flatMap((grant) => {
    if (!access) return [];
    const resolved = resolveSpellAccess({
      state: access,
      actionId: action.id,
      grantId: grant.grantId,
      mode: 'normal',
      resources: actor.runtime.resources,
      preferFreeUse: true,
    });
    return resolved.status === 'allowed' ? [{ grant, payment: resolved.payment }] : [];
  }).sort((left, right) => {
    const rank = (kind: 'none' | 'free_use' | 'slot') => kind === 'none' ? 0 : kind === 'free_use' ? 1 : 2;
    return rank(left.payment.kind) - rank(right.payment.kind)
      || left.grant.grantId.localeCompare(right.grant.grantId);
    },
  );
  const selected = options[0];
  if (!selected) throw new Error(`Для «${action.name}» не найден доступный источник заклинания в листе`);
  const paidLevel = selected.payment.resource?.match(/_(\d+)$/)?.[1];
  return {
    grantId: selected.grant.grantId,
    mode: 'normal' as const,
    castLevel: paidLevel === undefined ? action.spell.level : Number(paidLevel),
    ...(selected.payment.kind === 'free_use' ? { preferFreeUse: true } : {}),
    ...(selected.payment.kind === 'slot' ? { preferFreeUse: false } : {}),
  };
}

function declarationFor(
  state: SoloCombatState,
  actorId: string,
  action: RuleActionDefinition,
  targetIds: string[],
  worldPosition?: GridPosition,
  suppliedChoices: Readonly<Record<string, readonly string[]>> = {},
  suppliedWorldInput?: ActionWorldInput,
): SheetCanonicalCommandInput {
  const primitive = primitiveType(action);
  const stonework = action.targeting?.requiresStoneworkContact
    ? stoneworkContactFactsFromChoices(suppliedChoices)
    : null;
  if (action.targeting?.requiresStoneworkContact && !stonework) {
    throw new Error('Укажите, как персонаж соприкасается с каменной поверхностью.');
  }
  const factsByTarget = Object.fromEntries(targetIds.map((targetId) => [
    targetId, {
      ...spatialFacts(state, actorId, targetId),
      ...(action.targeting?.requiresWilling
        && (actorId === targetId
          || (isControlledCharacter(state, actorId) && isControlledCharacter(state, targetId)))
        ? { willing: true }
        : {}),
      ...(stonework ? { stonework } : {}),
    },
  ]));
  const primaryTargetId = targetIds[0];
  const protectionCandidates = primaryTargetId
    ? Object.values(state.world.actors)
      .filter((candidate) => candidate.capabilities.featureSources?.[PROTECTION_REACTION_CAPABILITY])
      .map((candidate) => ({
        factsSource: 'board' as const,
        boardRevision: state.boardRevision,
        protectorActorId: candidate.id,
        protectorCanSeeAttacker: true,
        protectorDistanceToTargetFt: gridDistanceFt(
          state.tokens[candidate.id].position,
          state.tokens[primaryTargetId].position,
        ),
      }))
    : [];
  const choices = projectSoloCombatActionChoices(action, suppliedChoices);
  if (primitive === 'magic_missile' && targetIds.length) {
    const policy = (action.mechanics.primitive as Record<string, unknown>).policy as Record<string, unknown>;
    const count = Number(policy?.base_dart_count ?? 3);
    const choiceId = String(policy?.allocation_choice_id ?? 'magic_missile_dart_targets');
    if (!choices[choiceId]) choices[choiceId] = Array(count).fill(targetIds[0]);
  }
  let dancingLightsWorldInput: SheetCanonicalCommandInput['worldInput'];
  if (primitive === 'dancing_lights_world') {
    if (!worldPosition) throw new Error('Выберите клетку для Танцующих огоньков.');
    const sourcePosition = state.tokens[actorId]?.position;
    if (!sourcePosition) throw new Error('Персонаж отсутствует на поле боя.');
    const distanceFromCasterFt = gridDistanceFt(sourcePosition, worldPosition);
    const maxRangeFt = action.targeting?.rangeFt;
    if (maxRangeFt !== undefined && distanceFromCasterFt > maxRangeFt) {
      throw new Error(`Танцующие огоньки должны быть в пределах ${maxRangeFt} фт. от заклинателя.`);
    }
    dancingLightsWorldInput = suppliedWorldInput ?? {
      type: 'dancing_lights',
      form: 'individual',
      placements: [{ distanceFromCasterFt, withinRequiredSeparation: true }],
      facts: {
        factsSource: 'board',
        boardRevision: state.boardRevision,
        distanceFt: distanceFromCasterFt,
        lineOfSight: true,
      },
    };
  }
  return {
    sceneMode: 'encounter', targetIds, factsByTarget,
    ...(protectionCandidates.length ? { protectionCandidates } : {}),
    ...(action.kind === 'spell' ? { spell: selectedSpellDeclaration(state.world, actorId, action) } : {}),
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(primitive === 'burning_hands_objects' || primitive === 'area_object_push'
      ? { worldInput: { type: 'area_objects', factsByObject: {} } as const }
      : {}),
    ...(dancingLightsWorldInput ? { worldInput: dancingLightsWorldInput } : {}),
    ...(!dancingLightsWorldInput && suppliedWorldInput ? { worldInput: suppliedWorldInput } : {}),
  };
}

function sheetSession(state: SoloCombatState, actorId: string): SheetCombatSession {
  // The strict sheet bridge receives only the reviewed slice. Generic data-driven
  // actions use the ordinary rules-core UseAction pipeline below.
  const certifiedByActor = state.certifiedPlayerActionIdsByActor
    ?? { [state.characterId]: state.certifiedPlayerActionIds };
  const certifiedIds = new Set(certifiedByActor[actorId] ?? []);
  const catalogActions = state.catalogActions.filter((action) => certifiedIds.has(action.id));
  const catalog = buildCatalog(catalogActions);
  const participantRevisions = state.participantRuntimeRevisions
    ?? { [state.characterId]: state.runtimeRevision };
  const resourceBindingsByActor = state.resourceBindingsByActor
    ?? { [state.characterId]: state.resourceBindings };
  return {
    sourceCharacterId: state.characterId,
    participantRevisions,
    catalogActions,
    certifiedActionIdsByActor: {
      ...certifiedByActor,
      ...state.monsterActionIds,
    },
    resourceBindingsByActor,
    world: state.world,
    catalog,
  };
}

function applySheetTransition(
  state: SoloCombatState,
  actorId: string,
  action: RuleActionDefinition,
  transition: SheetCombatTransition,
): SoloCombatState {
  return transitionState(state, actorId, action.name, transition.nextWorld, transition.events);
}

type D20InterruptOperation = PendingD20Interrupt['operation'];
type D20InterruptRollKind = NonNullable<PendingD20Interrupt['preview']>['rollKind'];

interface D20InterruptCapability {
  actorId: string;
  effectId: string;
  effectName: string;
  operation: D20InterruptOperation;
  timing: PendingD20Interrupt['timing'];
  cost: Record<string, unknown>[];
  payload: Record<string, unknown>;
}

function d20InterruptCapabilities(
  state: SoloCombatState,
  sourceActorId: string,
  operation: D20InterruptOperation,
  rollKind: D20InterruptRollKind,
  outcome?: string,
): D20InterruptCapability[] {
  return Object.values(state.world.actors).flatMap((actor) => {
    if (actor.id === sourceActorId || !isControlledCharacter(state, actor.id)
      || actor.runtime.hp.current <= 0
      || deniedCapabilities(actor.runtime, actor.passives ?? []).has('reaction')) return [];
    return (actor.passives ?? []).flatMap((mechanics) => {
      const activation = mechanics.activation as Record<string, unknown> | undefined;
      const cost = Array.isArray(activation?.cost)
        ? activation.cost.filter((entry): entry is Record<string, unknown> => (
          Boolean(entry) && typeof entry === 'object'
        ))
        : [];
      const effectId = String(mechanics.id ?? '').trim();
      const effectName = String(mechanics.name ?? '').trim();
      if (!effectId || !effectName || activation?.mode !== 'triggered'
        || !cost.some((entry) => entry.resource === 'reaction')
        || !canPay(actor.runtime, cost).ok) return [];
      return payloadsOf(mechanics).flatMap((payload) => {
        if (payload.kind !== 'd20_interrupt' || payload.operation !== operation
          || payload.timing !== (operation === 'impose_disadvantage' ? 'before_roll' : 'after_outcome')) {
          return [];
        }
        const eligibleRolls = Array.isArray(payload.eligible_rolls)
          ? payload.eligible_rolls.map(String)
          : [];
        if (!eligibleRolls.includes(rollKind)) return [];
        const eligibleOutcomes = Array.isArray(payload.eligible_outcomes)
          ? payload.eligible_outcomes.map(String)
          : [];
        if (outcome && eligibleOutcomes.length && !eligibleOutcomes.includes(outcome)) return [];
        const allowedRelations = Array.isArray(payload.allowed_relations)
          ? payload.allowed_relations.map(String)
          : [];
        if (allowedRelations.length
          && !allowedRelations.includes(combatRelation(state, actor.id, sourceActorId))) return [];
        let facts;
        try {
          facts = spatialFacts(state, actor.id, sourceActorId);
        } catch {
          return [];
        }
        const rangeFt = Number(payload.range_ft);
        if (Number.isFinite(rangeFt) && facts.distanceFt > rangeFt) return [];
        if (payload.requires_line_of_sight === true && !facts.lineOfSight) return [];
        return [{
          actorId: actor.id, effectId, effectName, operation,
          timing: payload.timing as PendingD20Interrupt['timing'], cost, payload,
        }];
      });
    });
  }).sort((left, right) => (
    left.actorId.localeCompare(right.actorId) || left.effectId.localeCompare(right.effectId)
  ));
}

function serializableCombatCommand(input: CombatActionInput): PendingD20Interrupt['command'] {
  const choices = input.choices
    ? Object.fromEntries(Object.entries(input.choices).map(([key, values]) => [key, [...values]]))
    : undefined;
  return clone({
    actorId: input.actorId,
    actionId: input.actionId,
    targetIds: input.targetIds,
    ...(input.worldPosition ? { worldPosition: input.worldPosition } : {}),
    ...(input.worldInput ? { worldInput: input.worldInput } : {}),
    ...(input.scenarioObjects ? { scenarioObjects: [...input.scenarioObjects] } : {}),
    ...(choices ? { choices } : {}),
  });
}

function recordedRng(source: Rng): { rng: Rng; values: number[] } {
  const values: number[] = [];
  return { rng: () => { const value = source(); values.push(value); return value; }, values };
}

function transcriptRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error('Сохранённый бросок реакции не содержит достаточно случайных значений');
    }
    const value = values[index];
    index += 1;
    return value;
  };
}

function successfulD20Preview(
  state: SoloCombatState,
  fromLogIndex: number,
  sourceActorId: string,
  rollKind: D20InterruptRollKind,
): NonNullable<PendingD20Interrupt['preview']> | null {
  const acceptedOutcomes = rollKind === 'attack_roll' ? new Set(['hit']) : new Set(['success']);
  const rolls = state.log.slice(fromLogIndex).flatMap((entry) => entry.records ?? [])
    .filter((record) => record.sourceActorId === sourceActorId)
    .flatMap((record) => record.event?.type === 'roll' ? [record.event.roll] : [])
    .filter((roll) => (
      (rollKind === 'attack_roll' ? roll.kind === 'd20' : roll.kind === 'check')
        && roll.outcome && acceptedOutcomes.has(roll.outcome)
    ));
  const roll = rolls.at(-1);
  if (!roll || (roll.outcome !== 'hit' && roll.outcome !== 'success')) return null;
  return { rollKind, total: roll.total, outcome: roll.outcome };
}

function actionD20RollKind(
  state: SoloCombatState,
  action: RuleActionDefinition,
): D20InterruptRollKind | null {
  if (isAttackAction(action) || isBasicUnarmedStrike(state, action)) return 'attack_roll';
  const effects = Array.isArray(action.mechanics.effects) ? action.mechanics.effects : [];
  return effects.some((effect) => (
    Boolean(effect) && typeof effect === 'object'
      && (effect as Record<string, unknown>).resolution === 'ability_check'
  )) ? 'ability_check' : null;
}

function mountedCombatantAttackState(input: {
  state: SoloCombatState;
  actorId: string;
  targetIds: readonly string[];
  action: RuleActionDefinition;
}): { state: SoloCombatState; projected: boolean } {
  if (input.targetIds.length !== 1) return { state: input.state, projected: false };
  const mountId = input.state.mountByRiderId?.[input.actorId];
  if (!mountId) return { state: input.state, projected: false };
  const riderPosition = input.state.tokens[input.actorId]?.position;
  const mountPosition = input.state.tokens[mountId]?.position;
  const targetPosition = input.state.tokens[input.targetIds[0]]?.position;
  if (!riderPosition || !mountPosition || !targetPosition
    || combatRelation(input.state, input.actorId, mountId) !== 'ally'
    || gridDistanceFt(riderPosition, mountPosition) > 5) {
    return { state: input.state, projected: false };
  }
  const rider = input.state.world.actors[input.actorId];
  const mount = input.state.world.actors[mountId];
  const target = input.state.world.actors[input.targetIds[0]];
  const passive = rider ? mountedCombatantAttackAdvantage({
    rider,
    mount,
    target,
    mountSize: mount ? effectiveActorSize(mount) : undefined,
    targetSize: target ? effectiveActorSize(target) : undefined,
    targetDistanceFromMountFt: gridDistanceFt(mountPosition, targetPosition),
    sourceAction: input.action,
  }) : null;
  if (!rider || !passive) return { state: input.state, projected: false };
  return {
    projected: true,
    state: {
      ...input.state,
      world: {
        ...input.state.world,
        actors: {
          ...input.state.world.actors,
          [rider.id]: { ...rider, passives: [...(rider.passives ?? []), passive] },
        },
      },
    },
  };
}

function removeMountedCombatantAttackProjection(
  state: SoloCombatState,
  actorId: string,
  projected: boolean,
): SoloCombatState {
  if (!projected) return state;
  const actor = state.world.actors[actorId];
  if (!actor) return state;
  return {
    ...state,
    world: {
      ...state.world,
      actors: {
        ...state.world.actors,
        [actorId]: {
          ...actor,
          passives: (actor.passives ?? []).filter((passive) => (
            (passive as Record<string, unknown>).id !== MOUNTED_COMBATANT_ADVANTAGE_PASSIVE_ID
          )),
        },
      },
    },
  };
}

function executeCombatActionCore(input: CombatActionInput): SoloCombatState {
  if (input.state.outcome !== 'active') return input.state;
  if (activeActorId(input.state) !== input.actorId) throw new Error('Сейчас ход другого участника');
  const action = input.state.catalogActions.find((candidate) => candidate.id === input.actionId);
  if (!action) throw new Error('Действие отсутствует в снимке боя');
  const actorPosition = input.state.tokens[input.actorId]?.position;
  const verbalBlocked = action.kind === 'spell' && action.spell.components?.verbal === true
    && actorPosition != null
    && Object.values(input.state.combatAreas ?? {}).some((area) => (
      area.blocksVerbalComponents && areaContains(area, actorPosition)
    ));
  if (verbalBlocked) throw new Error('Тишина в этой области блокирует Вербальный компонент заклинания');
  const declaration = declarationFor(
    input.state,
    input.actorId,
    action,
    input.targetIds,
    input.worldPosition,
    input.choices,
    input.worldInput,
  );
  const mountedProjection = mountedCombatantAttackState({
    state: input.state, actorId: input.actorId, targetIds: input.targetIds, action,
  });
  if (mountedProjection.projected) input = { ...input, state: mountedProjection.state };
  const rng = input.rng ?? Math.random;
  const withTriggeredAttackOffer = (next: SoloCombatState) => {
    const intercepted = offerInterception({
      before: input.state,
      after: next,
      sourceActorId: input.actorId,
      sourceActionId: action.id,
      targetIds: input.targetIds,
      isAttack: isAttackAction(action) || isBasicUnarmedStrike(input.state, action),
    });
    const offered = offerTriggeredAttackActions({
      before: input.state,
      after: intercepted,
      sourceActorId: input.actorId,
      sourceActionId: action.id,
      targetIds: input.targetIds,
    });
    return removeMountedCombatantAttackProjection(
      offered, input.actorId, mountedProjection.projected,
    );
  };
  if (isBasicUnarmedStrike(input.state, action)) {
    if (input.targetIds.length !== 1) throw new Error('Безоружный удар требует одну цель');
    const option = input.choices?.[UNARMED_STRIKE_CHOICE_ID]?.[0] ?? 'damage';
    if (option !== 'damage' && option !== 'grapple' && option !== 'shove') {
      throw new Error('Неизвестный вариант безоружного удара');
    }
    const open = Object.values(input.state.world.attackActions).filter((candidate) => (
      candidate.actorId === input.actorId && candidate.status === 'open'
    ));
    if (open.length > 1) throw new Error('Найдено несколько открытых действий «Атака»');
    const begun = open.length ? input.state : dispatch({
      state: input.state,
      command: { ...commandBase(input.state, input.actorId), type: 'BeginAttackAction' },
      rng,
      label: 'Атака',
    });
    const attackAction = open[0] ?? Object.values(begun.world.attackActions).find((candidate) => (
      candidate.actorId === input.actorId && candidate.status === 'open'
    ));
    if (!attackAction) throw new Error('Не удалось открыть действие «Атака»');
    return withTriggeredAttackOffer(dispatch({
      state: begun,
      command: {
        ...commandBase(begun, input.actorId),
        type: 'PerformUnarmedStrike',
        attackActionId: attackAction.id,
        option,
        targetActorId: input.targetIds[0],
        facts: spatialFacts(begun, input.actorId, input.targetIds[0]),
        ...(declaration.protectionCandidates ? { protectionCandidates: declaration.protectionCandidates } : {}),
      },
      rng,
      label: action.name,
    }));
  }
  if (action.attackReplacement) {
    const command: GameCommand = {
      ...commandBase(input.state, input.actorId),
      type: 'UseAttackReplacement',
      actionId: action.id,
      targetIds: declaration.targetIds,
      ...(declaration.factsByTarget ? { factsByTarget: declaration.factsByTarget } : {}),
      ...(declaration.choices ? { choices: declaration.choices } : {}),
    };
    return withTriggeredAttackOffer(dispatch({ state: input.state, command, rng, label: action.name }));
  }
  if (isControlledCharacter(input.state, input.actorId)
    && SHEET_PRIMITIVES.has(primitiveType(action) ?? '')) {
    const transition = executeSheetCombatAction({
      session: sheetSession(input.state, input.actorId), actorId: input.actorId, actionId: action.id,
      declaration, commandId: newSheetRuntimeCommandId(), rng,
    });
    return withTriggeredAttackOffer(applySheetTransition(input.state, input.actorId, action, transition));
  }
  const command: GameCommand = {
    ...commandBase(input.state, input.actorId),
    type: 'UseAction', actionId: action.id,
    targetIds: declaration.targetIds,
    ...(declaration.factsByTarget ? { factsByTarget: declaration.factsByTarget } : {}),
    ...(declaration.protectionCandidates ? { protectionCandidates: declaration.protectionCandidates } : {}),
    ...(declaration.choices ? { choices: declaration.choices } : {}),
    ...(declaration.worldInput ? { worldInput: declaration.worldInput } : {}),
    ...(declaration.spell ? {
      spell: {
        baseLevel: action.kind === 'spell' ? action.spell.level : 0,
        castLevel: declaration.spell.castLevel,
        grantId: declaration.spell.grantId,
        mode: declaration.spell.mode,
        ...(declaration.spell.preferFreeUse === undefined
          ? {}
          : { preferFreeUse: declaration.spell.preferFreeUse }),
      },
    } : {}),
  };
  const scenarioObjects = input.scenarioObjects ?? [];
  for (const object of scenarioObjects) {
    if (input.state.world.objects[object.id]) {
      throw new Error(`Объект «${object.name}» уже существует в сцене.`);
    }
  }
  let dispatchState = scenarioObjects.length ? {
    ...input.state,
    world: {
      ...input.state.world,
      objects: {
        ...input.state.world.objects,
        ...Object.fromEntries(scenarioObjects.map((object) => [object.id, clone(object)])),
      },
    },
  } : input.state;
  let familiarCapabilities: ActorState['capabilities'] | null = null;
  const familiarActor = dispatchState.world.actors[input.actorId];
  const familiarActionCardNumber = dispatchState.actionPresentation?.[action.id]?.actionRef?.card_number;
  if (familiarActor?.kind === 'summonedActor'
    && familiarActor.familiarState
    && familiarActionCardNumber
    && FAMILIAR_BASIC_ACTIONS.has(familiarActionCardNumber)) {
    if (!canFamiliarUseOrdinaryAction({
      familiar: familiarActor.familiarState,
      actionKind: isAttackAction(action) ? 'attack' : 'ordinary_action',
    })) {
      throw new Error('Фамильяр не может выполнить это обычное действие');
    }
    // Familiar integrity intentionally keeps catalog capabilities empty. The
    // solo adapter grants exactly one allowlisted base action for this command,
    // then restores the canonical capability projection before persistence.
    familiarCapabilities = clone(familiarActor.capabilities);
    dispatchState = {
      ...dispatchState,
      world: {
        ...dispatchState.world,
        actors: {
          ...dispatchState.world.actors,
          [familiarActor.id]: {
            ...familiarActor,
            capabilities: {
              ...familiarActor.capabilities,
              actionIds: [...new Set([...familiarActor.capabilities.actionIds, action.id])],
              featureSources: {
                ...(familiarActor.capabilities.featureSources ?? {}),
                [action.id]: ['dnd2024.find-familiar.basic-actions'],
              },
            },
          },
        },
      },
    };
  }
  let next = dispatch({ state: dispatchState, command, rng, label: action.name });
  next = applyActionTeleport(
    dispatchState,
    next,
    input.actorId,
    input.worldPosition,
    teleportRangeFt(action),
  );
  if (scenarioObjects.length && input.worldPosition) {
    next = {
      ...next,
      worldObjectPositions: {
        ...(next.worldObjectPositions ?? {}),
        ...Object.fromEntries(scenarioObjects.map((object) => [
          object.id, { ...input.worldPosition! },
        ])),
      },
      boardRevision: next.boardRevision + 1,
    };
  }
  const worldPrimitive = primitiveType(action);
  if ((worldPrimitive === 'dancing_lights_world' || worldPrimitive === 'minor_illusion_world_object')
    && input.worldPosition) {
    const positions = { ...(next.worldObjectPositions ?? {}) };
    for (const object of Object.values(next.world.objects)) {
      if (object.sourceActorId === input.actorId
        && object.sourceActionId === action.id
        && (object.dancingLight || object.illusion)) {
        positions[object.id] = { ...input.worldPosition };
      }
    }
    next = {
      ...next,
      worldObjectPositions: positions,
      boardRevision: next.boardRevision + 1,
    };
  }
  if (input.worldPosition) {
    const area = createCombatArea({
      state: next,
      action,
      sourceActorId: input.actorId,
      origin: input.worldPosition,
      choices: input.choices,
    });
    if (area) {
      const source = next.world.actors[input.actorId];
      const removedZoneEffectIds = new Set(source.runtime.activeEffects.flatMap((effect) => (
        (effect.mechanics as Record<string, unknown>).kind === 'world_zone'
          && String((effect.mechanics as Record<string, unknown>).zone_type ?? '') === area.zoneType
          ? [effect.id] : []
      )));
      const concentration = next.world.concentrations[input.actorId];
      next = {
        ...next,
        world: {
          ...next.world,
          actors: {
            ...next.world.actors,
            [input.actorId]: {
              ...source,
              runtime: {
                ...source.runtime,
                activeEffects: source.runtime.activeEffects.filter((effect) => (
                  !removedZoneEffectIds.has(effect.id)
                )),
              },
            },
          },
          concentrations: concentration ? {
            ...next.world.concentrations,
            [input.actorId]: {
              ...concentration,
              effectLinks: concentration.effectLinks.filter((link) => (
                !removedZoneEffectIds.has(link.effectId)
              )),
            },
          } : next.world.concentrations,
        },
      };
      next = reconcileInsideAreaConditions({
        ...next,
        combatAreas: { ...(next.combatAreas ?? {}), [area.id]: area },
        boardRevision: next.boardRevision + 1,
      });
      next = queueCombatAreaEvent(next, 'created', Object.keys(next.world.actors), [area.id]);
      next = autoResolveSystemDecisions(next, rng);
    }
  }
  const restoreFamiliarCapabilities = (candidate: SoloCombatState): SoloCombatState => {
    if (!familiarCapabilities) return candidate;
    const current = candidate.world.actors[input.actorId];
    if (!current) return candidate;
    return {
      ...candidate,
      world: {
        ...candidate.world,
        actors: {
          ...candidate.world.actors,
          [input.actorId]: { ...current, capabilities: familiarCapabilities },
        },
      },
    };
  };
  next = restoreFamiliarCapabilities(next);
  if (action.id !== next.dashActionId) return withTriggeredAttackOffer(next);
  const movementBeforeDash = input.state.movementRemainingFt[input.actorId]
    ?? effectiveCombatActorSpeedFt(input.state, input.actorId);
  const dashAllotment = effectiveCombatActorSpeedFt(input.state, input.actorId)
    + (actorOwnsCharger(input.state.world.actors[input.actorId]) ? 10 : 0);
  return withTriggeredAttackOffer({
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      // Some catalog rows express Dash's visible speed boon as a modifier and
      // therefore reconcile the ledger during dispatch. Narrative-only rows
      // need the tactical fallback. Both paths converge on exactly one extra
      // pre-Dash Speed allotment instead of stacking the same grant twice.
      [input.actorId]: Math.max(
        next.movementRemainingFt[input.actorId] ?? 0,
        movementBeforeDash + dashAllotment,
      ),
    },
  });
}

function executeCombatActionWithD20Interrupts(
  input: CombatActionInput,
  options: { skipWardingFlare?: boolean; skipCuttingWords?: boolean } = {},
): SoloCombatState {
  if (input.state.pendingD20Interrupt) {
    throw new Error('Сначала завершите открытую реакцию на бросок к20');
  }
  const action = input.state.catalogActions.find((candidate) => candidate.id === input.actionId);
  if (!action) throw new Error('Действие отсутствует в снимке боя');
  const rollKind = actionD20RollKind(input.state, action);
  if (!rollKind) return executeCombatActionCore(input);

  if (!options.skipWardingFlare && rollKind === 'attack_roll') {
    const responders = d20InterruptCapabilities(
      input.state, input.actorId, 'impose_disadvantage', rollKind,
    );
    if (responders.length) {
      return {
        ...input.state,
        pendingD20Interrupt: {
          timing: 'before_roll',
          operation: 'impose_disadvantage',
          command: serializableCombatCommand(input),
          responders: responders.map(({ actorId, effectId, effectName }) => ({
            actorId, effectId, effectName,
          })),
        },
      };
    }
  }

  if (options.skipCuttingWords) return executeCombatActionCore(input);
  const recorded = recordedRng(input.rng ?? Math.random);
  const previewState = executeCombatActionCore({ ...input, rng: recorded.rng });
  const preview = successfulD20Preview(
    previewState, input.state.log.length, input.actorId, rollKind,
  );
  if (!preview) return previewState;
  const responders = d20InterruptCapabilities(
    input.state, input.actorId, 'subtract_die', rollKind, preview.outcome,
  );
  return responders.length ? {
    ...input.state,
    pendingD20Interrupt: {
      timing: 'after_outcome',
      operation: 'subtract_die',
      command: serializableCombatCommand(input),
      responders: responders.map(({ actorId, effectId, effectName }) => ({
        actorId, effectId, effectName,
      })),
      randomValues: recorded.values,
      preview,
    },
  } : previewState;
}

/**
 * Execute a tactical action, pausing at any data-driven cross-actor d20
 * interrupt. The held continuation is JSON-safe and therefore survives the
 * same combat persistence path as Shield, Interception, and saving throws.
 */
export function executeCombatAction(input: CombatActionInput): SoloCombatState {
  return executeCombatActionWithD20Interrupts(input);
}

function interruptDieFaces(
  payload: Record<string, unknown>,
  actor: ActorState,
): number | null {
  const die = payload.die;
  if (typeof die === 'string') {
    const match = /^1d(\d+)$/i.exec(die.trim());
    const faces = Number(match?.[1]);
    return Number.isSafeInteger(faces) && faces > 1 ? faces : null;
  }
  if (!die || typeof die !== 'object') return null;
  const row = die as Record<string, unknown>;
  const classId = String(row.class ?? '').trim();
  const classLevel = Number(actor.character.classLevels?.[classId] ?? 0);
  const byLevel = row.by_level;
  if (!classId || !Number.isSafeInteger(classLevel) || classLevel < 1
    || !byLevel || typeof byLevel !== 'object') return null;
  const selected = Object.entries(byLevel as Record<string, unknown>)
    .map(([level, faces]) => ({ level: Number(level), faces: Number(faces) }))
    .filter((entry) => Number.isSafeInteger(entry.level) && entry.level <= classLevel
      && Number.isSafeInteger(entry.faces) && entry.faces > 1)
    .sort((left, right) => right.level - left.level)[0];
  return selected?.faces ?? null;
}

function spendD20Interrupt(
  state: SoloCombatState,
  capability: D20InterruptCapability,
): SoloCombatState {
  const actor = state.world.actors[capability.actorId];
  if (!actor || !canPay(actor.runtime, capability.cost).ok) {
    throw new Error('Ресурсы для этой реакции больше недоступны');
  }
  const paid = pay(actor.runtime, capability.cost);
  const next = {
    ...state,
    world: {
      ...state.world,
      actors: {
        ...state.world.actors,
        [actor.id]: { ...actor, runtime: paid.state },
      },
    },
  };
  const records: CombatLogEventRecord[] = paid.events.map((event, ordinal) => ({
    kind: 'engine', ordinal, sourceActorId: actor.id, actorId: actor.id,
    targetIds: [], event,
  }));
  return appendLog(next, actor.id, `${capability.effectName}: реакция принята; ${eventSummary(records)}`, records);
}

function armD20InterruptModifier(input: {
  state: SoloCombatState;
  sourceActorId: string;
  ownerActorId: string;
  capability: D20InterruptCapability;
  rollKind: D20InterruptRollKind;
  value?: number;
}): SoloCombatState {
  const source = input.state.world.actors[input.sourceActorId];
  if (!source) throw new Error('Участник исходного броска больше не существует');
  const mechanics = input.capability.operation === 'impose_disadvantage'
    ? {
      kind: 'modifier', op: 'disadvantage', consume: 'next',
      applies_to: { roll: 'attack' },
    }
    : {
      kind: 'modifier', op: 'add', value: -Math.abs(input.value ?? 0), consume: 'next',
      applies_to: { roll: input.rollKind === 'attack_roll' ? 'attack' : 'ability_check' },
    };
  return {
    ...input.state,
    world: {
      ...input.state.world,
      actors: {
        ...input.state.world.actors,
        [source.id]: {
          ...source,
          runtime: {
            ...source.runtime,
            activeEffects: [...source.runtime.activeEffects, {
              id: `d20-interrupt:${input.capability.effectId}:${newSheetRuntimeCommandId()}`,
              name: input.capability.effectName,
              source: input.capability.effectName,
              sourceId: input.ownerActorId,
              ownerId: source.id,
              mechanics,
            }],
          },
        },
      },
    },
  };
}

/** Accept or decline the persisted cross-actor d20 reaction and resume exactly once. */
export function resolveD20Interrupt(
  state: SoloCombatState,
  responderActorId: string | null,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.pendingD20Interrupt;
  if (!pending) throw new Error('Нет ожидающей реакции на бросок к20');
  const chosen = responderActorId === null ? null : pending.responders.find((candidate) => (
    candidate.actorId === responderActorId
  ));
  if (responderActorId !== null && !chosen) {
    throw new Error('Этот участник не может ответить на текущий бросок');
  }
  const { pendingD20Interrupt: _cleared, ...withoutPending } = state;
  let prepared = withoutPending as SoloCombatState;
  const rollKind = pending.preview?.rollKind ?? 'attack_roll';
  if (chosen) {
    const capabilities = d20InterruptCapabilities(
      prepared,
      pending.command.actorId,
      pending.operation,
      rollKind,
      pending.preview?.outcome,
    );
    const capability = capabilities.find((candidate) => (
      candidate.actorId === chosen.actorId && candidate.effectId === chosen.effectId
    ));
    if (!capability) throw new Error('Эта реакция больше недоступна');
    prepared = spendD20Interrupt(prepared, capability);
    let value: number | undefined;
    if (pending.operation === 'subtract_die') {
      const owner = prepared.world.actors[capability.actorId];
      const faces = interruptDieFaces(capability.payload, owner);
      if (!faces) throw new Error('Способность не объявляет допустимую кость реакции');
      value = Math.floor(rng() * faces) + 1;
      prepared = appendLog(
        prepared,
        capability.actorId,
        `${capability.effectName}: 1к${faces} = ${value}; итог исходного броска уменьшается на ${value}.`,
      );
    }
    prepared = armD20InterruptModifier({
      state: prepared,
      sourceActorId: pending.command.actorId,
      ownerActorId: capability.actorId,
      capability,
      rollKind,
      value,
    });
  } else {
    prepared = appendLog(
      prepared,
      pending.command.actorId,
      `${pending.responders.map((candidate) => candidate.effectName).join(' / ')}: реакция пропущена.`,
    );
  }
  const actionRng = pending.randomValues ? transcriptRng(pending.randomValues) : rng;
  return executeCombatActionWithD20Interrupts(
    { ...pending.command, state: prepared, rng: actionRng },
    pending.operation === 'impose_disadvantage'
      ? { skipWardingFlare: true }
      : { skipWardingFlare: true, skipCuttingWords: true },
  );
}

/** Move the caster-owned Dancing Lights group on the tactical board. */
export function moveCombatDancingLights(input: {
  state: SoloCombatState;
  actorId: string;
  groupId: string;
  destination: GridPosition;
  rng?: Rng;
}): SoloCombatState {
  if (input.state.outcome !== 'active') throw new Error('Бой уже завершён');
  if (activeActorId(input.state) !== input.actorId) throw new Error('Сейчас ход другого участника');
  const actor = input.state.world.actors[input.actorId];
  if (!actor) throw new Error('Участник боя не найден');
  const concentration = input.state.world.concentrations[input.actorId];
  if (!concentration) throw new Error('Персонаж больше не поддерживает концентрацию на Танцующих огоньках.');
  const action = input.state.catalogActions.find((candidate) => candidate.id === concentration.actionId);
  if (!action || primitiveType(action) !== 'dancing_lights_world') {
    throw new Error('Активные Танцующие огоньки не найдены.');
  }
  const group = Object.values(input.state.world.objects).filter((object) => (
    object.sourceActorId === input.actorId
    && object.sourceActionId === action.id
    && object.dancingLight?.groupId === input.groupId
  )).sort((left, right) => left.id.localeCompare(right.id));
  if (!group.length) throw new Error('Активные Танцующие огоньки не найдены.');
  if ((actor.runtime.resources.bonus_action ?? 0) < 1) {
    throw new Error('Для перемещения Танцующих огоньков нужно бонусное действие.');
  }
  const sourcePosition = input.state.tokens[input.actorId]?.position;
  if (!sourcePosition) throw new Error('Персонаж отсутствует на поле боя.');
  const policy = (action.mechanics.primitive as Record<string, unknown>).policy as Record<string, unknown>;
  const maxMoveFt = Number(policy?.max_move_ft ?? 60);
  const maxRangeFt = action.targeting?.rangeFt ?? Number.POSITIVE_INFINITY;
  const distanceFromCasterFt = gridDistanceFt(sourcePosition, input.destination);
  if (distanceFromCasterFt > maxRangeFt) {
    throw new Error(`Танцующие огоньки должны оставаться в пределах ${maxRangeFt} фт. от заклинателя.`);
  }
  const positions = input.state.worldObjectPositions ?? {};
  const resultingFacts = group.map((object) => {
    const current = positions[object.id];
    if (!current) throw new Error('Положение Танцующего огонька на поле не найдено.');
    const movementFt = gridDistanceFt(current, input.destination);
    if (movementFt > maxMoveFt) {
      throw new Error(`Танцующие огоньки можно переместить не более чем на ${maxMoveFt} фт.`);
    }
    return {
      lightId: object.id,
      movementFt,
      distanceFromCasterFt,
      ...(group.length > 1 ? { withinRequiredSeparation: true } : {}),
    };
  });
  const next = dispatch({
    state: input.state,
    command: {
      ...commandBase(input.state, input.actorId),
      type: 'MoveDancingLights',
      concentrationId: concentration.id,
      groupId: input.groupId,
      factsSource: 'board',
      boardRevision: input.state.boardRevision,
      resultingFacts,
    },
    rng: input.rng ?? Math.random,
    label: 'Танцующие огоньки: перемещение',
  });
  const worldObjectPositions = { ...(next.worldObjectPositions ?? {}) };
  for (const object of group) {
    if (next.world.objects[object.id]) worldObjectPositions[object.id] = { ...input.destination };
  }
  return {
    ...next,
    worldObjectPositions,
    boardRevision: next.boardRevision + 1,
  };
}

function detectMagicRadiusFt(action: RuleActionDefinition): number {
  const targeting = action.mechanics.targeting as Record<string, unknown> | undefined;
  const area = targeting?.area as Record<string, unknown> | undefined;
  const radius = Number(area?.radius_ft ?? area?.radiusFt ?? 30);
  return Number.isFinite(radius) && radius >= 0 ? radius : 30;
}

function combatWorldObjectPosition(
  state: SoloCombatState,
  objectId: string,
): GridPosition | undefined {
  const object = state.world.objects[objectId];
  if (!object) return undefined;
  const positioned = state.worldObjectPositions?.[objectId];
  if (positioned) return positioned;
  const carrierId = object.carriedByActorId ?? object.heldByActorId;
  return carrierId ? state.tokens[carrierId]?.position : undefined;
}

function combatDetectMagicObservations(state: SoloCombatState, actorId: string) {
  const sourcePosition = state.tokens[actorId]?.position;
  if (!sourcePosition) throw new Error('Персонаж отсутствует на поле боя.');
  return Object.fromEntries(Object.keys(state.world.objects).sort().flatMap((objectId) => {
    const position = combatWorldObjectPosition(state, objectId);
    if (!position) return [];
    return [[objectId, {
      facts: {
        factsSource: 'board' as const,
        boardRevision: state.boardRevision,
        distanceFt: gridDistanceFt(sourcePosition, position),
        lineOfSight: true,
      },
      blockingLayers: [],
    }]];
  }));
}

export interface CombatDetectMagicStatus {
  concentrationId: string;
  actionName: string;
  radiusFt: number;
  sensedObjectNames: string[];
}

/** Project the spell's passive presence sense from authoritative tactical-board facts. */
export function combatDetectMagicStatus(
  state: SoloCombatState,
  actorId: string,
): CombatDetectMagicStatus | null {
  const concentration = state.world.concentrations[actorId];
  if (!concentration) return null;
  const action = state.catalogActions.find((candidate) => candidate.id === concentration.actionId);
  if (!action || primitiveType(action) !== 'detect_magic_world_sensing') return null;
  const radiusFt = detectMagicRadiusFt(action);
  const observations = combatDetectMagicObservations(state, actorId);
  const sensedObjectNames = Object.keys(observations).flatMap((objectId) => {
    const object = state.world.objects[objectId];
    return object.magicalAura && observations[objectId].facts.distanceFt <= radiusFt
      ? [object.name]
      : [];
  });
  return { concentrationId: concentration.id, actionName: action.name, radiusFt, sensedObjectNames };
}

/** Spend Detect Magic's follow-up Magic action using tactical-board observations. */
export function revealCombatMagicAura(input: {
  state: SoloCombatState;
  actorId: string;
  rng?: Rng;
}): SoloCombatState {
  if (input.state.outcome !== 'active') throw new Error('Бой уже завершён');
  if (activeActorId(input.state) !== input.actorId) throw new Error('Сейчас ход другого участника');
  const status = combatDetectMagicStatus(input.state, input.actorId);
  if (!status) throw new Error('Персонаж больше не поддерживает Обнаружение магии.');
  const observations = combatDetectMagicObservations(input.state, input.actorId);
  return dispatch({
    state: input.state,
    command: {
      ...commandBase(input.state, input.actorId),
      type: 'RevealMagicAura',
      concentrationId: status.concentrationId,
      observations,
    },
    rng: input.rng ?? Math.random,
    label: 'Обнаружение магии — действие «Магия»',
    ...(Object.keys(observations).length ? {} : { emptySummary: 'магических аур не обнаружено' }),
  });
}

/**
 * Control a persisted remote manipulator from the dedicated combat UI. The
 * generic engine owns validation/resource payment; this adapter commits the
 * resulting runtime and readable world-interaction events to the saved fight.
 */
export function executeCombatRemoteManipulator(input: {
  state: SoloCombatState;
  actorId: string;
  command: RemoteManipulatorCommand;
}): SoloCombatState {
  if (input.state.outcome !== 'active') throw new Error('Бой уже завершён');
  if (activeActorId(input.state) !== input.actorId) throw new Error('Сейчас ход другого участника');
  const actor = input.state.world.actors[input.actorId];
  if (!actor) throw new Error('Участник боя не найден');
  const result = executeEngineRemoteManipulator(actor.runtime, input.command);
  const commandId = newSheetRuntimeCommandId();
  const nextWorld: WorldState = {
    ...input.state.world,
    revision: input.state.world.revision + 1,
    logicalClock: input.state.world.logicalClock + 1,
    processedCommandIds: [...input.state.world.processedCommandIds.slice(-127), commandId],
    actors: {
      ...input.state.world.actors,
      [input.actorId]: { ...actor, runtime: result.state },
    },
  };
  const records: CombatLogEventRecord[] = result.events.map((event, ordinal) => ({
    kind: 'engine', ordinal, sourceActorId: input.actorId, actorId: input.actorId,
    targetIds: [], event,
  }));
  const summary = result.events.map(describeEngineEvent).join('; ');
  return appendLog({ ...input.state, world: nextWorld }, input.actorId, summary, records);
}

/** Resolve (or skip) a source-side optional action opened by an observed hit. */
export function resolveTriggeredCombatAction(
  state: SoloCombatState,
  actionId: string | null,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.pendingTriggeredAction;
  if (!pending) throw new Error('Нет ожидающей способности после попадания');
  const { pendingTriggeredAction: _cleared, ...cleared } = state;
  if (actionId === null) return cleared as SoloCombatState;
  if (!pending.optionActionIds.includes(actionId)) {
    throw new Error('Эта способность недоступна для текущего события');
  }
  if (pending.event === 'opportunity_attack') {
    const action = state.catalogActions.find((candidate) => candidate.id === actionId);
    if (!action) throw new Error('Заклинание Воинственной магии отсутствует в снимке боя');
    const declaration = declarationFor(
      cleared as SoloCombatState,
      pending.sourceActorId,
      action,
      pending.targetIds,
    );
    const command: GameCommand = {
      ...commandBase(cleared as SoloCombatState, pending.sourceActorId),
      type: 'UseReactionAction', trigger: 'opportunity_attack', actionId,
      targetIds: declaration.targetIds,
      ...(declaration.factsByTarget ? { factsByTarget: declaration.factsByTarget } : {}),
      ...(declaration.spell ? {
        spell: {
          baseLevel: action.kind === 'spell' ? action.spell.level : 0,
          castLevel: declaration.spell.castLevel,
          grantId: declaration.spell.grantId,
          mode: declaration.spell.mode,
          ...(declaration.spell.preferFreeUse === undefined
            ? {}
            : { preferFreeUse: declaration.spell.preferFreeUse }),
        },
      } : {}),
    };
    return dispatch({ state: cleared as SoloCombatState, command, rng, label: action.name });
  }
  const chosen = state.catalogActions.find((candidate) => candidate.id === actionId);
  if (!chosen) throw new Error('Способность отсутствует в снимке боя');
  const chosenTrigger = triggerEvents(chosen);
  let prepared = cleared as SoloCombatState;
  if (chosenTrigger.includes('sneak_attack_hit')) {
    const tradeoff = pending.sneakAttackTradeoff;
    if (!tradeoff) throw new Error('Цена Хитрого удара больше не подтверждена');
    const target = prepared.world.actors[tradeoff.targetActorId];
    if (!target
      || target.runtime.hp.current !== tradeoff.committedHp.current
      || target.runtime.hp.max !== tradeoff.committedHp.max
      || target.runtime.hp.temp !== tradeoff.committedHp.temp) {
      throw new Error('Урон Скрытой атаки изменился до выбора Хитрого удара');
    }
    prepared = appendLog({
      ...prepared,
      outcome: tradeoff.replacementHp.current > 0 ? 'active' : prepared.outcome,
      world: {
        ...prepared.world,
        actors: {
          ...prepared.world.actors,
          [target.id]: {
            ...target,
            runtime: { ...target.runtime, hp: { ...tradeoff.replacementHp } },
          },
        },
      },
    }, pending.sourceActorId,
    `Хитрый удар: отказ от 1к6 Скрытой атаки (из броска исключено: ${tradeoff.dieResults.join(' + ')}); `
      + `урон уменьшен на ${tradeoff.effectiveDamage}.`);
  }
  const targeting = chosen.mechanics.targeting as Record<string, unknown> | undefined;
  const chosenTargetIds = targeting?.actor_targets === false ? [] : pending.targetIds;
  const next = executeCombatAction({
    state: prepared,
    actorId: pending.sourceActorId,
    actionId,
    targetIds: chosenTargetIds,
    rng,
  });
  const useKey = chosen ? generalFeatTriggeredUseKey(chosen) : null;
  if (!useKey) return next;
  const owner = next.world.actors[pending.sourceActorId];
  return {
    ...next,
    world: {
      ...next.world,
      actors: {
        ...next.world.actors,
        [owner.id]: {
          ...owner,
          runtime: {
            ...owner.runtime,
            firedThisTurn: [...new Set([...(owner.runtime.firedThisTurn ?? []), useKey])],
          },
        },
      },
    },
  };
}

function resolveDecision(
  state: SoloCombatState,
  response: DecisionResponse,
  rng: Rng,
): SoloCombatState {
  const pending = state.world.pendingResolution;
  if (!pending) return state;
  const actorId = pending.request.actorId;
  const command: GameCommand = {
    ...commandBase(state, actorId), type: 'ResolveDecision',
    resolutionId: pending.id, requestId: pending.request.id, response,
  };
  return dispatch({ state, command, rng, label: 'Разрешение реакции/спасброска' });
}

function openNextCombatAreaTrigger(state: SoloCombatState, rng: Rng): SoloCombatState {
  if (state.world.pendingResolution) return state;
  let next = state;
  while (next.pendingCombatAreaTriggers?.length) {
    const pending = pendingTriggerForArea(next);
    const [, ...rest] = next.pendingCombatAreaTriggers;
    next = { ...next, pendingCombatAreaTriggers: rest };
    if (!pending || !next.world.actors[pending.trigger.actorId]) continue;
    if (!pending.hazard) {
      next = appendLog(
        next,
        pending.trigger.actorId,
        `${pending.area.name}: ${pending.area.notice ?? 'событие области'} (${COMBAT_AREA_EVENT_LABELS[pending.trigger.event]})`,
      );
      continue;
    }
    const triggered = dispatch({
      state: next,
      command: {
        ...commandBase(next, pending.trigger.actorId),
        type: 'TriggerHazard',
        hazardId: pending.hazard.id,
        targetActorId: pending.trigger.actorId,
      },
      rng,
      label: `${pending.hazard.name}: ${COMBAT_AREA_EVENT_LABELS[pending.trigger.event]}`,
    });
    if (triggered.world.pendingResolution) return triggered;
    next = triggered;
  }
  return next;
}

export function autoResolveSystemDecisions(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  let next = state;
  for (let guard = 0; guard < 48; guard += 1) {
    next = openNextCombatAreaTrigger(next, rng);
    if (!next.world.pendingResolution) {
      const continuation = next.pendingCombatAreaTurnContinuation;
      if (!continuation) break;
      const { pendingCombatAreaTurnContinuation: _cleared, ...ready } = next;
      next = startTurnOrRequestGrappleDamage(
        decrementSourceAreas(ready as SoloCombatState, continuation.endingActorId),
        continuation.startingActorId,
        rng,
      );
      continue;
    }
    const pending = next.world.pendingResolution;
    if (pending.request.type === 'reaction'
      && isControlledCharacter(next, pending.request.actorId)) break;
    if (pending.request.type === 'saving_throw'
      && isControlledCharacter(next, pending.request.actorId)
      && runtimeBoons(next.world.actors[pending.request.actorId].runtime).some((boon) => (
        boon.appliesTo.includes('saving_throw') && boon.timing.includes('after_failure')
      ))) break;
    const response: DecisionResponse = pending.request.type === 'reaction'
      ? { kind: 'reaction', actionId: null }
      : pending.request.type === 'shove_outcome'
        ? { kind: 'shove_outcome', outcome: 'push_5ft' }
        : pending.type === 'unarmed_save'
          ? {
            kind: 'roll', roll: { mode: 'system' },
            selectedAbility: [...(pending.request.abilityOptions ?? [pending.request.ability])]
              .sort((left, right) => (
              (next.world.actors[pending.request.actorId].character.abilityMods[right] ?? 0)
                - (next.world.actors[pending.request.actorId].character.abilityMods[left] ?? 0)
              ))[0],
          }
          : { kind: 'roll', roll: { mode: 'system' } };
    const beforeDecision = next;
    next = resolveDecision(next, response, rng);
    if (pending.request.type === 'reaction'
      && pending.request.trigger.type === 'hit_by_attack') {
      next = offerTriggeredAttackActions({
        before: beforeDecision,
        after: next,
        sourceActorId: pending.request.trigger.sourceActorId,
        sourceActionId: pending.request.trigger.actionId,
        targetIds: [pending.request.actorId],
      });
    } else if (pending.type === 'damage_reaction') {
      next = offerTriggeredAttackActions({
        before: beforeDecision,
        after: next,
        sourceActorId: pending.sourceActorId,
        sourceActionId: pending.actionId,
        targetIds: [pending.targetActorId],
      });
    } else if (pending.type === 'protection_reaction') {
      next = offerTriggeredAttackActions({
        before: beforeDecision,
        after: next,
        sourceActorId: pending.sourceActorId,
        sourceActionId: pending.actionId,
        targetIds: [pending.targetActorId],
      });
    }
  }
  const trigger = next.pendingInterceptionTrigger;
  if (trigger && !next.world.pendingResolution) {
    const action = next.catalogActions.find((candidate) => candidate.id === trigger.sourceActionId);
    next = offerInterception({
      before: next,
      after: next,
      sourceActorId: trigger.sourceActorId,
      sourceActionId: trigger.sourceActionId,
      targetIds: [trigger.targetActorId],
      isAttack: Boolean(action && isAttackAction(action)),
    });
  }
  return next;
}

export function resolvePlayerSavingThrow(
  state: SoloCombatState,
  response: Extract<DecisionResponse, { kind: 'roll' }>,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.world.pendingResolution;
  if (!pending || pending.request.type !== 'saving_throw'
    || !isControlledCharacter(state, pending.request.actorId)) return state;
  return autoResolveSystemDecisions(resolveDecision(state, response, rng), rng);
}

export function activateCombatBoon(
  state: SoloCombatState,
  actorId: string,
  effectId: string,
  rollKind: 'attack_roll' | 'saving_throw' | 'ability_check',
  timing: 'before_roll' | 'after_failure',
  rng: Rng = Math.random,
): SoloCombatState {
  const command: GameCommand = {
    ...commandBase(state, actorId),
    type: 'ArmBoon',
    effectId,
    rollKind,
    timing,
  };
  return dispatch({ state, command, rng, label: 'Подготовка милости' });
}

export function resolvePlayerReaction(
  state: SoloCombatState,
  response: Extract<DecisionResponse, { kind: 'reaction' }>,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.world.pendingResolution;
  if (!pending || pending.request.type !== 'reaction'
    || !isControlledCharacter(state, pending.request.actorId)) {
    throw new Error('Нет ожидающей реакции персонажа');
  }
  const actingActorId = activeActorId(state);
  const monsterWasActing = state.world.actors[actingActorId]?.kind === 'monster';
  let next = autoResolveSystemDecisions(resolveDecision(state, response, rng), rng);
  const interceptionTrigger = state.pendingInterceptionTrigger;
  if (interceptionTrigger && !next.world.pendingResolution && !next.pendingInterception) {
    const action = next.catalogActions.find((candidate) => candidate.id === interceptionTrigger.sourceActionId);
    next = offerInterception({
      before: state,
      after: next,
      sourceActorId: interceptionTrigger.sourceActorId,
      sourceActionId: interceptionTrigger.sourceActionId,
      targetIds: [interceptionTrigger.targetActorId],
      isAttack: Boolean(action && isAttackAction(action)),
    });
  }
  if (pending.request.trigger.type === 'hit_by_attack') {
    next = offerTriggeredAttackActions({
      before: state,
      after: next,
      sourceActorId: pending.request.trigger.sourceActorId,
      sourceActionId: pending.request.trigger.actionId,
      targetIds: [pending.request.actorId],
    });
  } else if (pending.type === 'damage_reaction') {
    next = offerTriggeredAttackActions({
      before: state,
      after: next,
      sourceActorId: pending.sourceActorId,
      sourceActionId: pending.actionId,
      targetIds: [pending.targetActorId],
    });
  } else if (pending.type === 'protection_reaction') {
    next = offerTriggeredAttackActions({
      before: state,
      after: next,
      sourceActorId: pending.sourceActorId,
      sourceActionId: pending.actionId,
      targetIds: [pending.targetActorId],
    });
  }

  // A monster turn pauses inside runMonsterTurn while the player answers a
  // reaction. Once the continuation is complete, that same controller call no
  // longer exists to hand initiative back. Advancing here closes that paused
  // turn exactly once. Reactions opened by opportunity attacks during the
  // player's own turn deliberately do not advance initiative.
  if (monsterWasActing
    && next.outcome === 'active'
    && !next.world.pendingResolution
    && !next.pendingTriggeredAction
    && !next.pendingInterception
    && activeActorId(next) === actingActorId) {
    return advanceTurn(next, rng);
  }
  return next;
}

/** Resolve Interception after a visible qualifying hit but before the held HP
 * result is accepted by the solo-combat controller. */
export function resolveSoloCombatInterception(
  state: SoloCombatState,
  interceptorActorId: string | null,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.pendingInterception;
  if (!pending) throw new Error('Нет ожидающей реакции «Перехват»');
  if (interceptorActorId !== null && !pending.interceptorActorIds.includes(interceptorActorId)) {
    throw new Error('Этот участник больше не может использовать «Перехват»');
  }
  const { pendingInterception: _cleared, ...cleared } = state;
  let next = cleared as SoloCombatState;
  if (interceptorActorId !== null) {
    const interceptor = next.world.actors[interceptorActorId];
    if (!interceptor || (interceptor.runtime.resources.reaction ?? 0) < 1) {
      throw new Error('У участника нет доступной реакции');
    }
    const die = Math.floor(rng() * 10) + 1;
    const reduction = Math.min(pending.incomingDamage, die + interceptor.character.profBonus);
    const remaining = pending.incomingDamage - reduction;
    const spentTemp = Math.min(pending.targetHpBefore.temp, remaining);
    const targetHp = {
      ...pending.targetHpBefore,
      temp: pending.targetHpBefore.temp - spentTemp,
      current: Math.max(0, pending.targetHpBefore.current - (remaining - spentTemp)),
    };
    next = {
      ...next,
      world: {
        ...next.world,
        actors: {
          ...next.world.actors,
          [interceptorActorId]: {
            ...interceptor,
            runtime: {
              ...interceptor.runtime,
              resources: {
                ...interceptor.runtime.resources,
                reaction: interceptor.runtime.resources.reaction - 1,
              },
            },
          },
          [pending.targetActorId]: {
            ...next.world.actors[pending.targetActorId],
            runtime: { ...next.world.actors[pending.targetActorId].runtime, hp: targetHp },
          },
        },
      },
    };
    next = appendLog(
      next,
      interceptorActorId,
      `Перехват: 1к10 (${die}) + БМ ${interceptor.character.profBonus} = ${die + interceptor.character.profBonus}; `
        + `урон ${pending.incomingDamage} → ${remaining} (−${reduction}).`,
    );
  } else {
    next = appendLog(next, pending.targetActorId, 'Перехват: реакция пропущена.');
  }
  const activeId = activeActorId(next);
  return next.world.actors[activeId]?.kind === 'monster'
    && next.outcome === 'active'
    && !next.world.pendingResolution
    ? advanceTurn(next, rng)
    : next;
}

function triggerEvents(action: RuleActionDefinition): string[] {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const trigger = activation?.trigger as Record<string, unknown> | undefined;
  if (!trigger) return [];
  if (typeof trigger.event === 'string') return [trigger.event];
  return Array.isArray(trigger.events)
    ? trigger.events.filter((event): event is string => typeof event === 'string')
    : [];
}

/** Triggered catalog actions are capabilities/listeners, not proactive buttons. */
export function isTriggeredCombatAction(action: RuleActionDefinition, event?: string): boolean {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  if (activation?.mode !== 'triggered') return false;
  const events = triggerEvents(action);
  return event === undefined ? events.length > 0 : events.includes(event);
}

function attackOutcomeEvent(
  state: SoloCombatState,
  fromLogIndex: number,
  sourceActorId: string,
): 'hit' | 'miss' | null {
  const outcomes = state.log.slice(fromLogIndex).flatMap((entry) => (
    entry.records ?? []
  )).flatMap((record) => {
    const roll = record.event?.type === 'roll' ? record.event.roll : undefined;
    if (record.sourceActorId !== sourceActorId || roll?.kind !== 'd20') return [];
    if (roll.outcome === 'hit' || roll.outcome === 'crit') return ['hit' as const];
    if (roll.outcome === 'miss') return ['miss' as const];
    return [];
  });
  return outcomes.at(-1) ?? null;
}

type AttackTriggerEvent = 'hit' | 'miss' | 'sneak_attack_hit';

const SNEAK_ATTACK_EFFECT_ID = 'EFF-sneak-attack';

function attackTriggerEvents(
  before: SoloCombatState,
  after: SoloCombatState,
  sourceActorId: string,
): AttackTriggerEvent[] {
  const outcomeEvent = attackOutcomeEvent(after, before.log.length, sourceActorId);
  if (!outcomeEvent) return [];
  if (outcomeEvent === 'miss') return ['miss'];
  const beforeFired = before.world.actors[sourceActorId]?.runtime.firedThisTurn ?? [];
  const afterFired = after.world.actors[sourceActorId]?.runtime.firedThisTurn ?? [];
  return !beforeFired.includes(SNEAK_ATTACK_EFFECT_ID)
    && afterFired.includes(SNEAK_ATTACK_EFFECT_ID)
    ? ['hit', 'sneak_attack_hit']
    : ['hit'];
}

function applyDamageToHp(
  hp: { current: number; max: number; temp: number },
  amount: number,
): { current: number; max: number; temp: number } {
  const damage = Math.max(0, Math.floor(amount));
  const absorbed = Math.min(hp.temp, damage);
  return {
    ...hp,
    temp: hp.temp - absorbed,
    current: Math.max(0, hp.current - (damage - absorbed)),
  };
}

function effectiveForegoneSneakDamage(total: number, applied: number, dieResult: number): number {
  const raw = Math.max(0, Math.floor(total));
  const actual = Math.max(0, Math.floor(applied));
  const die = Math.max(0, Math.floor(dieResult));
  if (actual === 0 || raw === 0 || die === 0) return 0;
  if (actual === raw) return Math.min(die, actual);
  if (actual === Math.floor(raw / 2)) {
    return actual - Math.floor(Math.max(0, raw - die) / 2);
  }
  if (actual === raw * 2) return Math.min(actual, die * 2);
  // Damage reductions can flatten part of a packet. Never refund more than
  // either the sacrificed die or the damage which actually reached the target.
  return Math.min(die, actual);
}

function sneakAttackTradeoff(input: {
  before: SoloCombatState;
  after: SoloCombatState;
  sourceActorId: string;
  targetIds: string[];
}): PendingTriggeredAction['sneakAttackTradeoff'] {
  if (input.targetIds.length !== 1) return undefined;
  const targetActorId = input.targetIds[0];
  const beforeTarget = input.before.world.actors[targetActorId];
  const afterTarget = input.after.world.actors[targetActorId];
  if (!beforeTarget || !afterTarget) return undefined;
  const packets = input.after.log.slice(input.before.log.length)
    .flatMap((entry) => entry.records ?? [])
    .filter((record) => (
      record.sourceActorId === input.sourceActorId
      && record.targetIds.includes(targetActorId)
      && record.event?.type === 'damage'
    ))
    .map((record) => record.event as Extract<NonNullable<typeof record.event>, { type: 'damage' }>);
  const sneakIndex = packets.findIndex((packet) => {
    const dice = packet.roll?.dice.filter((die) => !die.discarded) ?? [];
    // Cunning Strike is gained at Rogue 5, where Sneak Attack is 3d6 (6d6 on
    // a critical). Requiring that exact signature avoids mistaking a d6 weapon
    // or another on-hit rider for the sacrificed Sneak Attack die.
    return dice.length >= 3 && dice.every((die) => die.sides === 6);
  });
  if (sneakIndex < 0) return undefined;
  const sneak = packets[sneakIndex];
  const rolledDice = sneak.roll!.dice.filter((die) => !die.discarded && die.sides === 6);
  // Critical hits double the remaining Sneak Attack dice. Forgoing one base
  // die therefore removes two rolled d6 results from a level-5 critical.
  const dieResults = rolledDice.slice(rolledDice.length >= 6 ? -2 : -1).map((die) => die.result);
  if (!dieResults.length || dieResults.some((result) => !Number.isInteger(result) || result <= 0)) {
    return undefined;
  }
  const foregoneRoll = dieResults.reduce((sum, result) => sum + result, 0);
  const effectiveDamage = effectiveForegoneSneakDamage(
    sneak.roll!.total,
    sneak.amount,
    foregoneRoll,
  );
  if (effectiveDamage <= 0) return undefined;

  let committed = { ...beforeTarget.runtime.hp };
  let replacement = { ...beforeTarget.runtime.hp };
  packets.forEach((packet, index) => {
    committed = applyDamageToHp(committed, packet.amount);
    replacement = applyDamageToHp(
      replacement,
      index === sneakIndex ? packet.amount - effectiveDamage : packet.amount,
    );
  });
  const actual = afterTarget.runtime.hp;
  if (committed.current !== actual.current || committed.temp !== actual.temp) return undefined;
  return {
    targetActorId,
    committedHp: { ...actual },
    replacementHp: replacement,
    dieResults,
    effectiveDamage,
  };
}

function hasHitRecord(
  state: SoloCombatState,
  fromLogIndex: number,
  sourceActorId: string,
): boolean {
  return attackOutcomeEvent(state, fromLogIndex, sourceActorId) === 'hit';
}

function sourceQualifiesForTriggeredAction(input: {
  before: SoloCombatState;
  state: SoloCombatState;
  actor: ActorState;
  sourceActionId: string;
  targetIds: string[];
  trigger: Record<string, unknown> | undefined;
}): boolean {
  const { before, state, actor, sourceActionId, targetIds, trigger } = input;
  const sourceCardNumber = state.actionPresentation?.[sourceActionId]?.actionRef?.card_number;
  const requiredSources = [
    ...(typeof trigger?.source_action_card_number === 'string'
      ? [trigger.source_action_card_number]
      : []),
    ...(Array.isArray(trigger?.source_action_card_numbers)
      ? trigger.source_action_card_numbers.filter((value): value is string => typeof value === 'string')
      : []),
  ];
  if (requiredSources.length && (!sourceCardNumber || !requiredSources.includes(sourceCardNumber))) {
    return false;
  }
  const onceKey = typeof trigger?.feat_once_per_turn === 'string'
    ? trigger.feat_once_per_turn
    : null;
  if (onceKey && (actor.runtime.firedThisTurn ?? []).includes(onceKey)) return false;
  const recentEvents = state.log.slice(before.log.length).flatMap((entry) => entry.records ?? [])
    .filter((record) => record.sourceActorId === actor.id)
    .flatMap((record) => record.event ? [record.event] : []);
  if (typeof trigger?.feat_damage_type === 'string'
    && !recentEvents.some((event) => (
      event.type === 'damage' && event.amount > 0 && event.damageType === trigger.feat_damage_type
    ))) return false;
  if (Number.isFinite(Number(trigger?.feat_max_relative_size))) {
    const sourceSize = effectiveActorSize(actor);
    const relativeSizeTarget = targetIds.length === 1
      ? state.world.actors[targetIds[0]]
      : undefined;
    const targetSize = relativeSizeTarget
      ? effectiveActorSize(relativeSizeTarget)
      : undefined;
    if (!Number.isInteger(sourceSize) || !Number.isInteger(targetSize)
      || targetSize! > sourceSize! + Number(trigger!.feat_max_relative_size)) return false;
  }
  const sourceAction = state.catalogActions.find((candidate) => candidate.id === sourceActionId);
  if (trigger?.feat_requires_shield === true || trigger?.feat_requires_melee === true) {
    if (!sourceAction || targetIds.length !== 1 || !shieldMasterBashEligible({
      actor,
      sourceAction,
      targetDistanceFt: gridDistanceFt(state.tokens[actor.id].position, state.tokens[targetIds[0]].position),
    })) return false;
  }
  if (trigger?.feat_charger === true) {
    const movement = before.recentStraightMovementByActor?.[actor.id];
    const targetId = targetIds.length === 1 ? targetIds[0] : undefined;
    const targetPosition = targetId ? before.tokens[targetId]?.position : undefined;
    const actorPosition = before.tokens[actor.id]?.position;
    const round = before.world.scene.mode === 'encounter' ? before.world.scene.round : 0;
    if (!chargerApproachEligible({
      actor, movement, actorPosition, targetPosition, round, distance: gridDistanceFt,
    })) return false;
  }
  if (trigger?.feat_polearm_master_butt === true) {
    const targetId = targetIds.length === 1 ? targetIds[0] : undefined;
    const targetPosition = targetId ? state.tokens[targetId]?.position : undefined;
    const actorPosition = state.tokens[actor.id]?.position;
    const currentTurnKey = state.world.scene.mode === 'encounter'
      ? `encounter:${state.world.scene.round}:${state.world.scene.activeIndex}:${actor.id}`
      : null;
    const completed = Object.values(state.world.attackActions)
      .filter((entry) => entry.actorId === actor.id
        && entry.status === 'completed'
        && currentTurnKey !== null
        && entry.turnKey === currentTurnKey)
      .sort((left, right) => right.startedAtRevision - left.startedAtRevision)[0];
    const weaponCardId = completed?.sequence.entries
      .filter((entry) => entry.kind === 'weapon_attack')
      .at(-1)?.weaponCardId;
    if (!sourceAction || !actorPosition || !targetPosition || !polearmMasterButtEligible({
      actor,
      sourceAction,
      targetDistanceFt: gridDistanceFt(actorPosition, targetPosition),
      completedAttackWeaponCardId: weaponCardId,
    })) return false;
  }
  if (trigger?.feat_gwm_hew === true) {
    const weaponId = actor.runtime.equipment.main_hand;
    const weapon = actor.character.equippedCards?.find((card) => card.id === weaponId)
      ?? actor.character.knownCards?.find((card) => card.id === weaponId);
    const parsed = weapon ? parseWeaponProfile(weapon) : null;
    if (!parsed?.valid || !parsed.profile.attackModes.some((mode) => mode.kind === 'melee')) return false;
    const critical = recentEvents.some((event) => (
      event.type === 'roll' && event.roll.kind === 'd20' && event.roll.outcome === 'crit'
    ));
    const reducedToZero = targetIds.some((targetId) => (
      (before.world.actors[targetId]?.runtime.hp.current ?? 0) > 0
      && state.world.actors[targetId]?.runtime.hp.current === 0
    ));
    if (!critical && !reducedToZero) return false;
  }
  if (trigger?.source_weapon_qualifier !== 'monk_weapon') return true;
  if (sourceCardNumber === 'action_basic_unarmed') return true;
  if (sourceCardNumber !== 'action_basic_weapon') return false;
  const weaponId = actor.runtime.equipment.main_hand;
  const weapon = actor.character.equippedCards?.find((card) => card.id === weaponId);
  if (!weapon) return false;
  const parsed = parseWeaponProfile(weapon);
  return parsed.valid
    && parsed.profile.defaultAttackMode === 'melee'
    && (parsed.profile.proficiencyCategory === 'simple'
      || (parsed.profile.proficiencyCategory === 'martial'
        && parsed.profile.properties.includes('light')));
}

function offerTriggeredAttackActions(input: {
  before: SoloCombatState;
  after: SoloCombatState;
  sourceActorId: string;
  sourceActionId: string;
  targetIds: string[];
}): SoloCombatState {
  const { before, after, sourceActorId, sourceActionId, targetIds } = input;
  const events = attackTriggerEvents(before, after, sourceActorId);
  if (after.world.pendingResolution || after.pendingTriggeredAction
    || !isControlledCharacter(after, sourceActorId)
    || !events.length) return after;
  const actor = after.world.actors[sourceActorId];
  if (!actor) return after;
  const owned = new Set(actor.capabilities.actionIds);
  const options = after.catalogActions.flatMap((action) => {
    if (action.id === sourceActionId || !owned.has(action.id)
      || !events.some((event) => isTriggeredCombatAction(action, event))) return [];
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const trigger = activation?.trigger as Record<string, unknown> | undefined;
    if (!sourceQualifiesForTriggeredAction({
      before, state: after, actor, sourceActionId, targetIds, trigger,
    })) return [];
    const costs = Array.isArray(activation?.cost)
      ? activation.cost as Array<Record<string, unknown>>
      : [];
    const event = events.find((candidate) => isTriggeredCombatAction(action, candidate));
    return canPay(actor.runtime, costs).ok && event ? [{ actionId: action.id, event }] : [];
  });
  const needsSneakTradeoff = options.some(({ event }) => event === 'sneak_attack_hit');
  const tradeoff = needsSneakTradeoff
    ? sneakAttackTradeoff({ before, after, sourceActorId, targetIds })
    : undefined;
  const executableOptions = tradeoff
    ? options
    : options.filter(({ event }) => event !== 'sneak_attack_hit');
  return executableOptions.length ? {
    ...after,
    pendingTriggeredAction: {
      event: executableOptions.some(({ event }) => event === 'sneak_attack_hit')
        ? 'sneak_attack_hit'
        : events[0],
      sourceActorId, sourceActionId,
      targetIds: [...targetIds],
      optionActionIds: executableOptions.map(({ actionId }) => actionId),
      ...(tradeoff ? { sneakAttackTradeoff: tradeoff } : {}),
    },
  } : after;
}

function deniesOpportunityAttack(actor: ActorState): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    const applies = row.applies_to as Record<string, unknown> | undefined;
    if (row.kind === 'modifier' && row.op === 'deny'
      && applies?.interaction === 'opportunity_attack'
      && applies?.trigger === 'self_movement') return true;
    return Object.values(row).some(visit);
  };
  return actor.runtime.activeEffects.some((effect) => visit(effect.mechanics));
}

function executeOpportunityAttacks(
  state: SoloCombatState,
  moverId: string,
  destination: GridPosition,
  rng: Rng,
): SoloCombatState {
  const mover = state.world.actors[moverId];
  const start = state.tokens[moverId]?.position;
  if (!mover || !start) return state;
  const moverDeniedOrdinaryOpportunity = deniesOpportunityAttack(mover);
  let next = state;
  const enemies = Object.values(state.world.actors).filter((actor) => (
    combatRelation(state, moverId, actor.id) === 'enemy' && actor.runtime.hp.current > 0
      && actor.runtime.resources.reaction > 0
      && (!moverDeniedOrdinaryOpportunity || actorOwnsSentinel(actor))
      && gridDistanceFt(state.tokens[actor.id].position, start) <= 5
      && gridDistanceFt(state.tokens[actor.id].position, destination) > 5
  ));
  for (const enemy of enemies) {
    const actionId = next.opportunityActionIds[enemy.id];
    if (!actionId || next.world.actors[moverId].runtime.hp.current <= 0) continue;
    const action = next.catalogActions.find((candidate) => candidate.id === actionId);
    if (!action) continue;
    const warCasterOptions = enemy.capabilities.actionIds.filter((candidateId) => (
      candidateId.endsWith(':war-caster-opportunity')
      && next.catalogActions.some((candidate) => candidate.id === candidateId)
    ));
    if (warCasterOptions.length && isControlledCharacter(next, enemy.id)) {
      return {
        ...next,
        pendingTriggeredAction: {
          event: 'opportunity_attack', sourceActorId: enemy.id, sourceActionId: action.id,
          targetIds: [moverId], optionActionIds: warCasterOptions,
        },
      };
    }
    const command: GameCommand = {
      ...commandBase(next, enemy.id), type: 'UseReactionAction', trigger: 'opportunity_attack', actionId,
      targetIds: [moverId], factsByTarget: { [moverId]: spatialFacts(next, enemy.id, moverId) },
    };
    const beforeAttack = next;
    next = dispatch({ state: next, command, rng, label: action.name });
    next = autoResolveSystemDecisions(next, rng);
    if (!next.world.pendingResolution
      && actorOwnsSentinel(next.world.actors[enemy.id])
      && hasHitRecord(next, beforeAttack.log.length, enemy.id)) {
      const stopActionId = next.world.actors[enemy.id].capabilities.actionIds.find((candidateId) => {
        const candidate = next.catalogActions.find((value) => value.id === candidateId);
        const activation = candidate?.mechanics.activation as Record<string, unknown> | undefined;
        const trigger = activation?.trigger as Record<string, unknown> | undefined;
        return trigger?.feat_sentinel_opportunity === true;
      });
      if (stopActionId) {
        next = executeCombatAction({
          state: next,
          actorId: enemy.id,
          actionId: stopActionId,
          targetIds: [moverId],
          rng,
        });
      }
    }
  }
  return next;
}

function executePolearmEntryAttacks(
  state: SoloCombatState,
  moverId: string,
  start: GridPosition,
  destination: GridPosition,
  rng: Rng,
): SoloCombatState {
  if (state.pendingTriggeredAction || state.world.pendingResolution) return state;
  const mover = state.world.actors[moverId];
  if (!mover) return state;
  let next = state;
  const eligible = Object.values(state.world.actors).filter((actor) => (
    actor.id !== moverId
      && combatRelation(state, moverId, actor.id) === 'enemy'
      && actor.runtime.hp.current > 0
      && actorOwnsPolearmMaster(actor)
      && polearmMasterEntryEligible({
        actor,
        startDistanceFt: gridDistanceFt(state.tokens[actor.id].position, start),
        endDistanceFt: gridDistanceFt(state.tokens[actor.id].position, destination),
      })
  ));
  for (const enemy of eligible) {
    const baseActionId = next.opportunityActionIds[enemy.id];
    const baseAction = baseActionId
      ? next.catalogActions.find((candidate) => candidate.id === baseActionId)
      : undefined;
    const featSources = enemy.capabilities.featureSources?.['general_feat.polearm_master'] ?? [];
    if (!baseAction || !featSources.length || next.world.actors[moverId].runtime.hp.current <= 0) continue;
    const action: RuleActionDefinition = {
      ...clone(baseAction),
      id: `${baseAction.id}:polearm-master-entry`,
      name: `${baseAction.name} — Превентивный удар`,
      sourceEntityIds: [...new Set([...baseAction.sourceEntityIds, ...featSources])] as [string, ...string[]],
    };
    const owner = next.world.actors[enemy.id];
    next = {
      ...next,
      catalogActions: next.catalogActions.some((candidate) => candidate.id === action.id)
        ? next.catalogActions
        : [...next.catalogActions, action].sort((left, right) => left.id.localeCompare(right.id)),
      world: {
        ...next.world,
        actors: {
          ...next.world.actors,
          [owner.id]: {
            ...owner,
            capabilities: {
              ...owner.capabilities,
              actionIds: [...new Set([...owner.capabilities.actionIds, action.id])],
              featureSources: {
                ...(owner.capabilities.featureSources ?? {}),
                [action.id]: [...featSources] as [string, ...string[]],
              },
            },
          },
        },
      },
    };
    if (isControlledCharacter(next, enemy.id)) {
      return {
        ...next,
        pendingTriggeredAction: {
          event: 'opportunity_attack', sourceActorId: enemy.id, sourceActionId: action.id,
          targetIds: [moverId], optionActionIds: [action.id],
        },
      };
    }
    const command: GameCommand = {
      ...commandBase(next, enemy.id), type: 'UseReactionAction', trigger: 'opportunity_attack',
      actionId: action.id, targetIds: [moverId],
      factsByTarget: { [moverId]: spatialFacts(next, enemy.id, moverId) },
    };
    next = autoResolveSystemDecisions(
      dispatch({ state: next, command, rng, label: action.name }),
      rng,
    );
    if (next.world.pendingResolution || next.pendingTriggeredAction) return next;
  }
  return next;
}

function breakOutOfRangeGrapples(
  state: SoloCombatState,
  movedActorId: string,
  rng: Rng,
): SoloCombatState {
  let next = state;
  const candidates = Object.values(state.world.grapples).filter((grapple) => (
    (grapple.grapplerActorId === movedActorId || grapple.targetActorId === movedActorId)
    && gridDistanceFt(
      state.tokens[grapple.grapplerActorId].position,
      state.tokens[grapple.targetActorId].position,
    ) > grapple.reachFt
  ));
  for (const grapple of candidates) {
    next = dispatch({
      state: next,
      command: {
        ...commandBase(next, movedActorId),
        type: 'BreakGrappleRange',
        grappleId: grapple.id,
        facts: spatialFacts(next, grapple.grapplerActorId, grapple.targetActorId),
      },
      rng,
      label: 'Захват прекращён: цель вне досягаемости',
    });
  }
  return next;
}

export function moveActor(input: {
  state: SoloCombatState;
  actorId: string;
  destination: GridPosition;
  maxFeet?: number;
  voluntary?: boolean;
  rng?: Rng;
}): SoloCombatState {
  const token = input.state.tokens[input.actorId];
  if (!token) throw new Error('У участника нет токена на поле');
  if (input.destination.x < 0 || input.destination.y < 0
    || input.destination.x >= TACTICAL_WIDTH || input.destination.y >= TACTICAL_HEIGHT) {
    throw new Error('Клетка находится за пределами поля');
  }
  const distance = gridDistanceFt(token.position, input.destination);
  const actor = input.state.world.actors[input.actorId];
  if (!actor) throw new Error('Участник перемещения отсутствует');
  // The turn ledger is authoritative once materialized: Dash legitimately adds
  // another speed allotment, so clamping the stored value to base speed here
  // would erase that data-driven action. Effective speed is projected whenever
  // a turn starts (and when combat is created), which is where speed conditions
  // such as Ray of Frost establish the next turn's movement budget.
  const available = input.voluntary === false
    ? (input.state.movementRemainingFt[input.actorId] ?? effectiveActorSpeedFt(actor))
    : Math.min(
      input.state.movementRemainingFt[input.actorId] ?? effectiveActorSpeedFt(actor),
      effectiveCombatActorSpeedFt(input.state, input.actorId),
    );
  const maxFeet = input.maxFeet ?? available;
  const movementCost = input.voluntary === false
    ? distance
    : movementCostThroughAreas(input.state, token.position, input.destination, distance);
  if (movementCost > maxFeet) throw new Error(`За это перемещение доступно ${maxFeet} фт.`);
  if (occupiedPositions(input.state, input.actorId).has(`${input.destination.x}:${input.destination.y}`)) {
    throw new Error('Клетка занята');
  }
  let next = input.voluntary === false
    ? input.state
    : executeOpportunityAttacks(input.state, input.actorId, input.destination, input.rng ?? Math.random);
  if (next.world.actors[input.actorId].runtime.hp.current <= 0) return outcome(next);
  if (input.voluntary !== false && effectiveCombatActorSpeedFt(next, input.actorId) === 0) {
    return appendLog(next, input.actorId, 'Перемещение остановлено попаданием провоцированной атаки Стража.');
  }
  const crossed = enteredAndExitedAreas(next, token.position, input.destination);
  const previousStraight = next.recentStraightMovementByActor?.[input.actorId];
  const round = next.world.scene.mode === 'encounter' ? next.world.scene.round : 0;
  const dx = Math.sign(input.destination.x - token.position.x) as -1 | 0 | 1;
  const dy = Math.sign(input.destination.y - token.position.y) as -1 | 0 | 1;
  const continuesStraight = input.voluntary !== false
    && previousStraight?.round === round
    && previousStraight.to.x === token.position.x
    && previousStraight.to.y === token.position.y
    && previousStraight.direction.x === dx
    && previousStraight.direction.y === dy;
  const recentStraightMovementByActor = input.voluntary === false
    ? next.recentStraightMovementByActor
    : {
      ...(next.recentStraightMovementByActor ?? {}),
      [input.actorId]: {
        from: continuesStraight ? { ...previousStraight!.from } : { ...token.position },
        to: { ...input.destination },
        distanceFt: (continuesStraight ? previousStraight!.distanceFt : 0) + distance,
        direction: { x: dx, y: dy },
        round,
      },
    };
  next = {
    ...next,
    tokens: { ...next.tokens, [input.actorId]: { ...next.tokens[input.actorId], position: input.destination } },
    boardRevision: next.boardRevision + 1,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [input.actorId]: Math.max(0, available - movementCost),
    },
    ...(recentStraightMovementByActor ? { recentStraightMovementByActor } : {}),
  };
  if (input.voluntary !== false) {
    next = executePolearmEntryAttacks(
      next, input.actorId, token.position, input.destination, input.rng ?? Math.random,
    );
  }
  next = reconcileInsideAreaConditions(next);
  const movementAreaIds = Object.keys(crossed.movementOccurrences);
  if (movementAreaIds.length) {
    next = queueCombatAreaEvent(
      next, 'move', [input.actorId], movementAreaIds, true, crossed.movementOccurrences,
    );
  }
  if (crossed.exited.length) {
    next = queueCombatAreaEvent(next, 'exit', [input.actorId], crossed.exited);
  }
  if (crossed.entered.length) {
    next = queueCombatAreaEvent(next, 'enter', [input.actorId], crossed.entered, true);
  }
  next = autoResolveSystemDecisions(next, input.rng ?? Math.random);
  next = breakOutOfRangeGrapples(next, input.actorId, input.rng ?? Math.random);
  return appendLog(next, input.actorId, `Перемещение на ${distance} фт.${movementCost > distance ? ` Труднопроходимая местность: потрачено ${movementCost} фт.` : ''}`);
}

function startTurnOrRequestGrappleDamage(
  state: SoloCombatState,
  actorId: string,
  rng: Rng,
): SoloCombatState {
  const actor = state.world.actors[actorId];
  const opportunity = isControlledCharacter(state, actorId)
    ? turnStartGrappleDamageOpportunity({
      passives: actor.passives ?? [],
      sourceActorId: actorId,
      grapples: Object.values(state.world.grapples),
    })
    : null;
  if (opportunity) {
    return {
      ...state,
      pendingTurnStartGrappleDamage: { actorId, ...opportunity },
    };
  }
  const next = dispatch({
    state,
    command: { ...commandBase(state, actorId), type: 'StartTurn' },
    rng,
    label: 'Начало хода',
  });
  const started = {
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [actorId]: effectiveCombatActorSpeedFt(next, actorId),
    },
    recentStraightMovementByActor: Object.fromEntries(Object.entries(
      next.recentStraightMovementByActor ?? {},
    ).filter(([candidateId]) => candidateId !== actorId)),
  };
  return queueCombatAreaEvent(started, 'start_turn', [actorId]);
}

/** Commit the persisted optional Unarmed Fighting damage choice, or decline it. */
export function resolveSoloCombatTurnStart(
  state: SoloCombatState,
  targetActorId: string | null,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.pendingTurnStartGrappleDamage;
  if (!pending) throw new Error('Нет ожидающего выбора в начале хода');
  if (activeActorId(state) !== pending.actorId) throw new Error('Ожидающий выбор больше не относится к активному участнику');
  if (targetActorId !== null && !pending.targetActorIds.includes(targetActorId)) {
    throw new Error('Эту цель больше нельзя ранить захватом');
  }
  const { pendingTurnStartGrappleDamage: _cleared, ...cleared } = state;
  const next = dispatch({
    state: cleared as SoloCombatState,
    command: {
      ...commandBase(cleared as SoloCombatState, pending.actorId),
      type: 'StartTurn',
      ...(targetActorId === null ? {} : {
        turnStartChoices: [{ capabilityId: pending.capabilityId, targetActorId }],
      }),
    },
    rng,
    label: 'Начало хода',
  });
  const started = {
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [pending.actorId]: effectiveCombatActorSpeedFt(next, pending.actorId),
    },
  };
  return queueCombatAreaEvent(started, 'start_turn', [pending.actorId]);
}

export function advanceTurn(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  if (state.outcome !== 'active' || state.world.pendingResolution
    || state.pendingTurnStartGrappleDamage || state.pendingInterception || state.pendingD20Interrupt
    || state.pendingAlertSwapActorIds?.length) return state;
  const endingActorId = activeActorId(state);
  let next = dispatch({
    state,
    command: { ...commandBase(state, endingActorId), type: 'EndTurn' },
    rng: () => { throw new Error('EndTurn не должен бросать кости'); },
    label: 'Конец хода',
  });
  if (next.outcome !== 'active') return next;
  const startingActorId = activeActorId(next);
  next = queueCombatAreaEvent(next, 'end_turn', [endingActorId]);
  if (next.pendingCombatAreaTriggers?.length) {
    return autoResolveSystemDecisions({
      ...next,
      pendingCombatAreaTurnContinuation: { endingActorId, startingActorId },
    }, rng);
  }
  return autoResolveSystemDecisions(
    startTurnOrRequestGrappleDamage(decrementSourceAreas(next, endingActorId), startingActorId, rng),
    rng,
  );
}

/** Resolve one Alert owner's immediate post-Initiative swap, then start turn one
 * after every eligible controlled owner has either swapped or declined. */
export function resolveSoloCombatAlertSwap(
  state: SoloCombatState,
  alertActorId: string,
  allyActorId: string | null,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.pendingAlertSwapActorIds ?? [];
  if (pending[0] !== alertActorId) throw new Error('Этот выбор инициативы больше не ожидается');
  const alertActor = state.world.actors[alertActorId];
  if (!alertActor?.capabilities.featureSources?.[ALERT_INITIATIVE_SWAP_CAPABILITY]) {
    throw new Error('У участника нет способности «Бдительный: обмен инициативой»');
  }

  let next = state;
  if (allyActorId !== null) {
    const ally = state.world.actors[allyActorId];
    if (!ally || combatRelation(state, alertActorId, allyActorId) !== 'ally' || allyActorId === alertActorId) {
      throw new Error('Для обмена инициативой нужен другой союзник в этой сцене');
    }
    next = dispatch({
      state,
      command: {
        ...commandBase(state, alertActorId),
        type: 'SwapInitiative',
        allyActorId,
        facts: {
          factsSource: 'board',
          boardRevision: state.boardRevision,
          relation: 'ally',
          willing: true,
          confirmedByControllerId: ally.controllerId,
        },
      },
      rng: () => { throw new Error('Обмен инициативой не бросает кости'); },
      label: 'Бдительный',
      emptySummary: `обмен инициативой с ${ally.name}`,
    });
    const order = next.world.scene.mode === 'encounter' ? next.world.scene.initiative : [];
    const byActor = new Map(next.initiative.map((entry) => [entry.actorId, entry]));
    next = { ...next, initiative: order.map((actorId) => byActor.get(actorId)!).filter(Boolean) };
  } else {
    next = appendLog(state, alertActorId, 'Бдительный: обмен инициативой пропущен.');
  }

  const remaining = pending.slice(1);
  if (remaining.length) return { ...next, pendingAlertSwapActorIds: remaining };
  const { pendingAlertSwapActorIds: _cleared, ...ready } = next;
  const actorId = activeActorId(ready as SoloCombatState);
  return startTurnOrRequestGrappleDamage(ready as SoloCombatState, actorId, rng);
}

/** Test-scene authority: replace initiative totals while preserving the current turn. */
export function setSoloCombatInitiativeTotals(
  state: SoloCombatState,
  totals: Readonly<Record<string, number>>,
): SoloCombatState {
  if (state.world.scene.mode !== 'encounter') throw new Error('Бой ещё не начат');
  const currentActorId = activeActorId(state);
  const initiative = state.initiative.map((entry) => {
    const raw = totals[entry.actorId];
    if (raw === undefined) return entry;
    if (!Number.isInteger(raw) || raw < -100 || raw > 100) {
      throw new Error('Инициатива должна быть целым числом от −100 до 100');
    }
    return { ...entry, die: raw - entry.bonus, total: raw };
  }).sort((left, right) => (
    right.total - left.total || right.bonus - left.bonus || left.actorId.localeCompare(right.actorId)
  ));
  if (initiative.length !== Object.keys(state.world.actors).length
    || new Set(initiative.map((entry) => entry.actorId)).size !== initiative.length) {
    throw new Error('Порядок инициативы не совпадает с участниками сцены');
  }
  const order = initiative.map((entry) => entry.actorId);
  const activeIndex = order.indexOf(currentActorId);
  if (activeIndex < 0) throw new Error('Активный участник исчез из инициативы');
  return appendLog({
    ...state,
    initiative,
    world: {
      ...state.world,
      scene: { ...state.world.scene, initiative: order, activeIndex },
    },
  }, currentActorId, 'Инициатива сцены изменена конструктором.');
}

/** Test-scene authority: refill one actor without simulating a rest or changing HP/effects. */
export function refreshSoloCombatResources(
  state: SoloCombatState,
  actorId: string,
): SoloCombatState {
  const actor = state.world.actors[actorId];
  if (!actor) throw new Error('Участник сцены не найден');
  const world = {
    ...state.world,
    actors: {
      ...state.world.actors,
      [actorId]: {
        ...actor,
        runtime: {
          ...actor.runtime,
          resources: clone(actor.runtime.maxResources),
        },
      },
    },
  };
  return appendLog({ ...state, world }, actorId, 'Ресурсы восстановлены конструктором сцены.');
}

/** Test-scene authority for recording a real board mount relation. It accepts
 * only an adjacent, living, allied and larger actor and never grants the feat. */
export function setSoloCombatMount(
  state: SoloCombatState,
  riderId: string,
  mountId: string | null,
): SoloCombatState {
  const rider = state.world.actors[riderId];
  if (!rider || !actorOwnsMountedCombatant(rider)) {
    throw new Error('Всадник без черты «Верховой боец» не может закрепить скакуна');
  }
  const relations = { ...(state.mountByRiderId ?? {}) };
  if (mountId === null) {
    delete relations[riderId];
    return appendLog({ ...state, mountByRiderId: relations }, riderId, 'Всадник спешился.');
  }
  const mount = state.world.actors[mountId];
  const riderPosition = state.tokens[riderId]?.position;
  const mountPosition = state.tokens[mountId]?.position;
  const riderSize = effectiveActorSize(rider);
  const mountSize = mount ? effectiveActorSize(mount) : undefined;
  if (!mount || mountId === riderId || !riderPosition || !mountPosition
    || combatRelation(state, riderId, mountId) !== 'ally'
    || mount.runtime.hp.current <= 0
    || !Number.isInteger(riderSize)
    || !Number.isInteger(mountSize)
    || mountSize! <= riderSize!
    || gridDistanceFt(riderPosition, mountPosition) > 5) {
    throw new Error('Скакун должен быть живым союзником, крупнее всадника и находиться в пределах 5 фт.');
  }
  relations[riderId] = mountId;
  return appendLog(
    { ...state, mountByRiderId: relations }, riderId,
    `Скакун закреплён: ${mount.name}. Активен «Удар всадника».`,
  );
}

function availableScenePosition(state: SoloCombatState, side: 'party' | 'opposition'): GridPosition {
  const occupied = new Set(Object.values(state.tokens).map(({ position }) => `${position.x}:${position.y}`));
  const rows = side === 'party'
    ? Array.from({ length: TACTICAL_HEIGHT }, (_, index) => TACTICAL_HEIGHT - 1 - index)
    : Array.from({ length: TACTICAL_HEIGHT }, (_, index) => index);
  for (const y of rows) {
    for (let x = 0; x < TACTICAL_WIDTH; x += 1) {
      if (!occupied.has(`${x}:${y}`)) return { x, y };
    }
  }
  throw new Error('На тактическом поле нет свободной клетки для нового участника');
}

function insertSceneInitiative(
  state: SoloCombatState,
  actorId: string,
  bonus: number,
  rng: Rng,
): SoloCombatState {
  if (state.world.scene.mode !== 'encounter') throw new Error('Бой ещё не начат');
  const currentActorId = activeActorId(state);
  const die = Math.floor(rng() * 20) + 1;
  const initiative = [
    ...state.initiative,
    { actorId, die, bonus, total: die + bonus },
  ].sort((left, right) => (
    right.total - left.total || right.bonus - left.bonus || left.actorId.localeCompare(right.actorId)
  ));
  const order = initiative.map((entry) => entry.actorId);
  const activeIndex = order.indexOf(currentActorId);
  if (activeIndex < 0) throw new Error('Активный участник исчез при добавлении участника');
  return {
    ...state,
    initiative,
    initiativeBonuses: { ...state.initiativeBonuses, [actorId]: bonus },
    world: {
      ...state.world,
      scene: { ...state.world.scene, initiative: order, activeIndex },
    },
  };
}

/** Test-scene authority: add a fresh monster instance without replacing the retained encounter. */
export function addSoloCombatMonster(input: {
  state: SoloCombatState;
  monster: Monster;
  actions: readonly Action[];
  effects: readonly PassiveEffect[];
  rng?: Rng;
}): SoloCombatState {
  if (input.state.world.scene.mode !== 'encounter') throw new Error('Бой ещё не начат');
  const instanceId = `${input.monster.id}:${newSheetRuntimeCommandId()}`;
  const compiled = compileMonsterInstance({
    monster: input.monster,
    instanceId,
    actions: input.actions,
    effects: input.effects,
  });
  const actor: ActorState = { ...clone(compiled.actor), lifecycle: { status: 'alive' } };
  const catalogActions = [...input.state.catalogActions];
  for (const action of compiled.actions) {
    if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(action);
  }
  const opportunityActionIds = { ...input.state.opportunityActionIds };
  const attack = compiled.actions.find(isAttackAction);
  if (attack) {
    const opportunity = opportunityVersion(attack);
    if (!catalogActions.some((candidate) => candidate.id === opportunity.id)) catalogActions.push(opportunity);
    actor.capabilities.actionIds.push(opportunity.id);
    opportunityActionIds[actor.id] = opportunity.id;
  }
  if (input.state.dashActionId && !actor.capabilities.actionIds.includes(input.state.dashActionId)) {
    actor.capabilities.actionIds.push(input.state.dashActionId);
  }
  const position = availableScenePosition(input.state, 'opposition');
  let next: SoloCombatState = {
    ...input.state,
    outcome: 'active',
    boardRevision: input.state.boardRevision + 1,
    world: {
      ...input.state.world,
      revision: input.state.world.revision + 1,
      actors: { ...input.state.world.actors, [actor.id]: actor },
    },
    catalogActions: catalogActions.sort((left, right) => left.id.localeCompare(right.id)),
    actionPresentation: {
      ...input.state.actionPresentation,
      ...Object.fromEntries(input.monster.action_ids.flatMap((actionId) => {
        const row = input.actions.find((candidate) => candidate.id === actionId);
        const projected = compiled.actions.find((candidate) => candidate.id === actionId);
        return row && projected ? [[projected.id, {
          imageUrl: row.image_url,
          description: row.description,
          sourceLabel: input.monster.name,
          entityType: 'action' as const,
          entityId: row.id,
          actionRef: row,
        }] as const] : [];
      })),
    },
    sideByActorId: { ...input.state.sideByActorId, [actor.id]: 'side:opposition' },
    actorPresentation: {
      ...input.state.actorPresentation,
      [actor.id]: {
        templateId: input.monster.id,
        description: input.monster.description,
        size: input.monster.size,
        creatureType: input.monster.creature_type,
        alignment: input.monster.alignment,
        challengeRating: input.monster.challenge_rating,
        source: input.monster.source,
        actionIds: compiled.actions.map((action) => action.id),
        traits: input.monster.effect_ids.flatMap((effectId) => {
          const effect = input.effects.find((candidate) => candidate.id === effectId);
          return effect?.mechanics ? [{
            id: effect.id,
            name: effect.name,
            description: effect.description,
            imageUrl: effect.image_url,
            mechanics: clone(effect.mechanics),
          }] : [];
        }),
      },
    },
    monsterActionIds: { ...input.state.monsterActionIds, [actor.id]: compiled.actions.map(({ id }) => id) },
    opportunityActionIds,
    tokens: {
      ...input.state.tokens,
      [actor.id]: {
        actorId: actor.id,
        templateId: input.monster.id,
        tokenUrl: input.monster.token_url,
        color: '#b94d3f',
        position,
      },
    },
    movementRemainingFt: {
      ...input.state.movementRemainingFt,
      [actor.id]: effectiveActorSpeedFt(actor),
    },
  };
  next = insertSceneInitiative(
    next,
    actor.id,
    Number(input.monster.initiative_bonus ?? actor.character.abilityMods.dex ?? 0),
    input.rng ?? Math.random,
  );
  return appendLog(next, actor.id, 'Добавлен в бой конструктором сцены.');
}

/** Test-scene authority: add another owned sheet as a controlled participant. */
export async function addSoloCombatCharacter(input: {
  state: SoloCombatState;
  participant: SheetCombatParticipantSeed;
  rng?: Rng;
}): Promise<SoloCombatState> {
  if (input.state.world.scene.mode !== 'encounter') throw new Error('Бой ещё не начат');
  const actorId = input.participant.character.id;
  if (input.state.world.actors[actorId]) throw new Error('Этот персонаж уже участвует в сцене');
  const isolated = await createSheetCombatSession({
    source: input.participant,
    targets: [],
    sceneMode: 'exploration',
  });
  // A sheet canonical hash is intentionally character-specific: it includes
  // that character's actions, equipment, and granted effects. Compare the
  // certified combat-session ruleset produced from the participant instead.
  if (isolated.world.ruleset.contentHash !== input.state.world.ruleset.contentHash) {
    throw new Error('Персонаж использует несовместимую версию правил');
  }
  const actor = clone(isolated.world.actors[actorId]);
  const catalogActions = [...input.state.catalogActions];
  for (const action of input.participant.canonical.actions) {
    if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(clone(action));
  }
  const basicActionIds = Object.entries(input.state.actionPresentation ?? {}).flatMap(([actionId, row]) => (
    row.actionRef && TACTICAL_BASIC_ACTIONS.has(row.actionRef.card_number) ? [actionId] : []
  ));
  for (const actionId of basicActionIds) {
    if (!actor.capabilities.actionIds.includes(actionId)) actor.capabilities.actionIds.push(actionId);
  }
  const opportunityActionIds = { ...input.state.opportunityActionIds };
  const attack = input.participant.canonical.actions.find((action) => (
    primitiveType(action) === 'weapon_attack' && isAttackAction(action)
  ));
  if (attack) {
    const opportunity = opportunityVersion(attack);
    if (!catalogActions.some((candidate) => candidate.id === opportunity.id)) catalogActions.push(opportunity);
    actor.capabilities.actionIds.push(opportunity.id);
    opportunityActionIds[actorId] = opportunity.id;
  }
  const position = availableScenePosition(input.state, 'party');
  const controlledIds = [...new Set([...controlledCharacterIds(input.state), actorId])];
  const playerActionIds = [...new Set([
    ...input.participant.canonical.actions.map(({ id }) => id),
    ...basicActionIds,
  ])];
  let next: SoloCombatState = {
    ...input.state,
    outcome: 'active',
    controlledCharacterIds: controlledIds,
    boardRevision: input.state.boardRevision + 1,
    world: {
      ...input.state.world,
      revision: input.state.world.revision + 1,
      actors: { ...input.state.world.actors, [actorId]: actor },
    },
    catalogActions: catalogActions.sort((left, right) => left.id.localeCompare(right.id)),
    actionPresentation: {
      ...input.state.actionPresentation,
      ...(input.participant.actionPresentation ?? {}),
    },
    sideByActorId: { ...input.state.sideByActorId, [actorId]: 'side:party' },
    actorPresentation: {
      ...input.state.actorPresentation,
      [actorId]: {
        creatureType: actor.character.creatureType,
        actionIds: input.participant.canonical.actions.map(({ id }) => id),
        traits: [],
      },
    },
    playerActionIdsByActor: {
      ...(input.state.playerActionIdsByActor ?? { [input.state.characterId]: input.state.playerActionIds }),
      [actorId]: playerActionIds,
    },
    certifiedPlayerActionIdsByActor: {
      ...(input.state.certifiedPlayerActionIdsByActor
        ?? { [input.state.characterId]: input.state.certifiedPlayerActionIds }),
      [actorId]: [...(isolated.certifiedActionIdsByActor[actorId] ?? [])],
    },
    opportunityActionIds,
    participantRuntimeRevisions: {
      ...(input.state.participantRuntimeRevisions
        ?? { [input.state.characterId]: input.state.runtimeRevision }),
      [actorId]: Number(input.participant.character.runtime_revision ?? 0),
    },
    resourceBindingsByActor: {
      ...(input.state.resourceBindingsByActor
        ?? { [input.state.characterId]: input.state.resourceBindings }),
      [actorId]: clone(isolated.resourceBindingsByActor[actorId] ?? {}),
    },
    tokens: {
      ...input.state.tokens,
      [actorId]: {
        actorId,
        tokenUrl: input.participant.character.avatar_url,
        color: '#3f9c68',
        position,
      },
    },
    movementRemainingFt: {
      ...input.state.movementRemainingFt,
      [actorId]: effectiveActorSpeedFt(actor),
    },
  };
  next = insertSceneInitiative(
    next,
    actorId,
    Number(input.participant.character.initiative_bonus ?? actor.character.abilityMods.dex ?? 0),
    input.rng ?? Math.random,
  );
  return appendLog(next, actorId, 'Добавлен в бой конструктором сцены.');
}

/**
 * Refresh owned sheet participants when a retained scene is reopened.
 *
 * Character edits can change more than optimistic-lock revisions and runtime
 * resources: manually attached actions, fighting styles, feats, equipment and
 * prepared spells all live in the canonical actor projection. Replacing only
 * runtime left a retained scene with the old hotbar and passives. This rebases
 * the controlled actors from their freshly compiled sheet seeds while keeping
 * the encounter itself (initiative, tokens, monsters, log and pending state).
 */
export async function refreshSoloCombatParticipants(input: {
  state: SoloCombatState;
  participants: readonly SheetCombatParticipantSeed[];
}): Promise<SoloCombatState> {
  const controlledIds = controlledCharacterIds(input.state);
  const byId = new Map(input.participants.map((participant) => [
    participant.character.id,
    participant,
  ]));
  for (const actorId of controlledIds) {
    if (!byId.has(actorId)) throw new Error(`Combat participant ${actorId} is unavailable`);
  }
  const ordered = controlledIds.map((actorId) => byId.get(actorId)!);
  const base = await createSheetCombatSession({
    source: ordered[0],
    targets: ordered.slice(1),
    sceneMode: 'exploration',
  });
  if (base.world.ruleset.contentHash !== input.state.world.ruleset.contentHash) {
    throw new Error('Character uses an incompatible rules version');
  }

  const actors = { ...input.state.world.actors };
  const catalogActions = [...input.state.catalogActions];
  const basicActionIds = Object.entries(input.state.actionPresentation ?? {}).flatMap(([actionId, row]) => (
    row.actionRef && TACTICAL_BASIC_ACTIONS.has(row.actionRef.card_number) ? [actionId] : []
  ));
  const playerActionIdsByActor = {
    ...(input.state.playerActionIdsByActor
      ?? { [input.state.characterId]: input.state.playerActionIds }),
  };
  const certifiedPlayerActionIdsByActor = {
    ...(input.state.certifiedPlayerActionIdsByActor
      ?? { [input.state.characterId]: input.state.certifiedPlayerActionIds }),
  };
  const participantRuntimeRevisions = {
    ...(input.state.participantRuntimeRevisions
      ?? { [input.state.characterId]: input.state.runtimeRevision }),
  };
  const resourceBindingsByActor = {
    ...(input.state.resourceBindingsByActor
      ?? { [input.state.characterId]: input.state.resourceBindings }),
  };
  const opportunityActionIds = { ...input.state.opportunityActionIds };
  const actorPresentation = { ...input.state.actorPresentation };
  let actionPresentation = { ...(input.state.actionPresentation ?? {}) };

  for (const participant of ordered) {
    const actorId = participant.character.id;
    const freshActor = clone(base.world.actors[actorId]);
    for (const actionId of basicActionIds) {
      if (!freshActor.capabilities.actionIds.includes(actionId)) {
        freshActor.capabilities.actionIds.push(actionId);
      }
    }
    for (const action of participant.canonical.actions) {
      if (!catalogActions.some((candidate) => candidate.id === action.id)) {
        catalogActions.push(clone(action));
      }
    }
    installWarCasterOpportunitySpells({
      actor: freshActor,
      sourceActions: participant.canonical.actions,
      catalogActions,
    });
    const attack = participant.canonical.actions.find((action) => (
      primitiveType(action) === 'weapon_attack' && isAttackAction(action)
    ));
    if (attack) {
      const opportunity = opportunityVersion(attack);
      if (!catalogActions.some((candidate) => candidate.id === opportunity.id)) {
        catalogActions.push(opportunity);
      }
      if (!freshActor.capabilities.actionIds.includes(opportunity.id)) {
        freshActor.capabilities.actionIds.push(opportunity.id);
      }
      opportunityActionIds[actorId] = opportunity.id;
    } else {
      delete opportunityActionIds[actorId];
    }

    actors[actorId] = freshActor;
    const playerActionIds = [...new Set([
      ...participant.canonical.actions.map(({ id }) => id),
      ...basicActionIds,
    ])];
    playerActionIdsByActor[actorId] = playerActionIds;
    certifiedPlayerActionIdsByActor[actorId] = [
      ...(base.certifiedActionIdsByActor[actorId] ?? []),
    ];
    participantRuntimeRevisions[actorId] = Number(participant.character.runtime_revision ?? 0);
    resourceBindingsByActor[actorId] = clone(base.resourceBindingsByActor[actorId] ?? {});
    actionPresentation = {
      ...actionPresentation,
      ...(participant.actionPresentation ?? {}),
    };
    actorPresentation[actorId] = {
      creatureType: freshActor.character.creatureType,
      actionIds: participant.canonical.actions.map(({ id }) => id),
      traits: [],
    };
  }

  return {
    ...input.state,
    runtimeRevision: participantRuntimeRevisions[input.state.characterId],
    world: { ...input.state.world, actors },
    catalogActions: catalogActions.sort((left, right) => left.id.localeCompare(right.id)),
    actionPresentation,
    actorPresentation,
    playerActionIdsByActor,
    playerActionIds: [...playerActionIdsByActor[input.state.characterId]],
    certifiedPlayerActionIdsByActor,
    certifiedPlayerActionIds: [...certifiedPlayerActionIdsByActor[input.state.characterId]],
    opportunityActionIds,
    participantRuntimeRevisions,
    resourceBindingsByActor,
    resourceBindings: clone(resourceBindingsByActor[input.state.characterId]),
  };
}

export function runMonsterTurn(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  if (state.outcome !== 'active' || state.world.pendingResolution || state.pendingD20Interrupt) return state;
  const monsterId = activeActorId(state);
  const monster = state.world.actors[monsterId];
  if (!monster || monster.kind !== 'monster') return state;
  if (monster.runtime.hp.current <= 0) return advanceTurn(state, rng);
  // A persisted monster turn can resume after a player reaction without the
  // original controller stack frame that would have advanced initiative. The
  // action payment is the durable proof that the planner already committed its
  // one supported turn action; never plan and charge that action a second time.
  if ((monster.runtime.maxResources.action ?? 0) > 0
    && (monster.runtime.resources.action ?? 0) <= 0) {
    return advanceTurn(state, rng);
  }
  const targetId = controlledCharacterIds(state)
    .filter((actorId) => (state.world.actors[actorId]?.runtime.hp.current ?? 0) > 0)
    .filter((actorId) => !conditionInteractionDenied({
      world: state.world,
      actorId: monsterId,
      targetActorId: actorId,
      capability: 'harm',
    }))
    .sort((left, right) => (
      gridDistanceFt(state.tokens[monsterId].position, state.tokens[left].position)
        - gridDistanceFt(state.tokens[monsterId].position, state.tokens[right].position)
        || left.localeCompare(right)
    ))[0];
  if (!targetId) {
    return advanceTurn(appendLog(
      state,
      monsterId,
      'Нет допустимой цели: ход завершён без атаки.',
    ), rng);
  }
  const plan = planMonsterTurn(state, monster, targetId);
  let next = state;
  const firstDestination = plan.firstMove.at(-1);
  if (firstDestination) {
    next = moveActor({ state: next, actorId: monsterId, destination: firstDestination, voluntary: true, rng });
  }
  if (next.world.actors[monsterId].runtime.hp.current <= 0 || next.outcome !== 'active') return next;
  if (plan.usesDash) {
    if (!next.dashActionId) throw new Error('В боевом каталоге нет data-driven действия «Рывок»');
    next = executeCombatAction({ state: next, actorId: monsterId, actionId: next.dashActionId, targetIds: [monsterId], rng });
    const dashDestination = plan.dashMove.at(-1);
    if (dashDestination) {
      next = moveActor({ state: next, actorId: monsterId, destination: dashDestination, voluntary: true, rng });
    }
  } else if (plan.attacks) {
    const actionId = next.monsterActionIds[monsterId]?.find((id) => {
      const action = next.catalogActions.find((candidate) => candidate.id === id);
      return action && isAttackAction(action);
    });
    if (actionId) {
      try {
        next = executeCombatAction({ state: next, actorId: monsterId, actionId, targetIds: [targetId], rng });
        next = autoResolveSystemDecisions(next, rng);
      } catch (reason) {
        if (!(reason instanceof Error) || !reason.message.includes('LineOfSightBlocked')) throw reason;
        next = appendLog(next, monsterId, 'Цель не видна: атака пропущена.');
      }
    }
  }
  return next.world.pendingResolution || next.pendingInterception || next.pendingD20Interrupt || next.outcome !== 'active'
    ? next
    : advanceTurn(next, rng);
}

function withInitiativeAndStart(state: SoloCombatState, rng: Rng): SoloCombatState {
  const initiative = Object.values(state.world.actors).map((actor) => {
    const bonus = Number(state.initiativeBonuses[actor.id]
      ?? actor.character.abilityMods.dex
      ?? 0);
    const die = Math.floor(rng() * 20) + 1;
    return { actorId: actor.id, die, bonus, total: die + bonus };
  }).sort((left, right) => right.total - left.total || right.bonus - left.bonus || left.actorId.localeCompare(right.actorId));
  let next = { ...state, initiative };
  next = dispatch({
    state: next,
    command: {
      ...commandBase(next, state.characterId), type: 'StartEncounter',
      initiative: initiative.map((entry) => entry.actorId),
    },
    rng,
    label: 'Инициатива',
  });
  const alertOwners = controlledCharacterIds(next).filter((actorId) => {
    const actor = next.world.actors[actorId];
    return Boolean(actor?.capabilities.featureSources?.[ALERT_INITIATIVE_SWAP_CAPABILITY])
      && controlledCharacterIds(next).some((allyId) => allyId !== actorId);
  });
  if (alertOwners.length) return { ...next, pendingAlertSwapActorIds: alertOwners };
  const actorId = activeActorId(next);
  return startTurnOrRequestGrappleDamage(next, actorId, rng);
}

export async function createSoloCombatState(input: {
  character: ForgeCharacter;
  participant: SheetCombatParticipantSeed;
  allies?: readonly SheetCombatParticipantSeed[];
  selected: readonly SelectedMonster[];
  actions: readonly Action[];
  effects: readonly PassiveEffect[];
  dashAction?: Action;
  rng?: Rng;
}): Promise<SoloCombatState> {
  const monsters: Array<{ template: Monster; actor: ActorState; actions: RuleActionDefinition[] }> = [];
  for (const selection of input.selected) {
    for (let index = 0; index < selection.quantity; index += 1) {
      const instanceId = `${selection.monster.id}:${newSheetRuntimeCommandId()}`;
      const compiled = compileMonsterInstance({
        monster: selection.monster, instanceId,
        actions: input.actions, effects: input.effects,
      });
      monsters.push({ template: selection.monster, ...compiled });
    }
  }
  if (!monsters.length) throw new Error('Выберите хотя бы одного противника');
  const participants = [input.participant, ...(input.allies ?? [])];
  const controlledIds = participants.map(({ character }) => character.id);
  const base = await createSheetCombatSession({
    source: input.participant, targets: participants.slice(1),
    sceneActors: monsters.map((monster) => monster.actor), sceneMode: 'exploration',
  });
  const catalogActions = [...base.catalogActions];
  // The ordinary character sheet exposes every runnable data-owned action. Keep
  // that complete capability set in solo combat; only the reviewed primitive
  // subset is routed through executeSheetCombatAction.
  for (const participant of participants) {
    for (const action of participant.canonical.actions) {
      if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(clone(action));
    }
  }
  const opportunityActionIds: Record<string, string> = {};
  for (const participant of participants) {
    installWarCasterOpportunitySpells({
      actor: base.world.actors[participant.character.id],
      sourceActions: participant.canonical.actions,
      catalogActions,
    });
    const playerAttack = participant.canonical.actions.find((action) => (
      primitiveType(action) === 'weapon_attack' && isAttackAction(action)
    ));
    if (!playerAttack) continue;
    const opportunity = opportunityVersion(playerAttack);
    if (!catalogActions.some((candidate) => candidate.id === opportunity.id)) {
      catalogActions.push(opportunity);
    }
    base.world.actors[participant.character.id].capabilities.actionIds.push(opportunity.id);
    opportunityActionIds[participant.character.id] = opportunity.id;
  }
  const basicRows = input.actions.filter((action) => FAMILIAR_BASIC_ACTIONS.has(action.card_number));
  const tacticalBasics = basicRows.map((action) => projectRuleAction(action));
  const dash = tacticalBasics.find((_, index) => basicRows[index]?.card_number === 'action_basic_dash')
    ?? (input.dashAction ? projectRuleAction(input.dashAction) : undefined);
  for (const action of tacticalBasics) {
    if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(action);
    for (const participant of participants) {
      const actor = base.world.actors[participant.character.id];
      if (!actor.capabilities.actionIds.includes(action.id)) actor.capabilities.actionIds.push(action.id);
    }
  }
  if (dash && !catalogActions.some((action) => action.id === dash.id)) catalogActions.push(dash);
  const monsterActionIds: Record<string, string[]> = {};
  for (const monster of monsters) {
    const ids = monster.actions.map((action) => action.id);
    monsterActionIds[monster.actor.id] = ids;
    for (const action of monster.actions) {
      if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(action);
    }
    const attack = monster.actions.find(isAttackAction);
    if (attack) {
      const opportunity = opportunityVersion(attack);
      if (!catalogActions.some((candidate) => candidate.id === opportunity.id)) catalogActions.push(opportunity);
      base.world.actors[monster.actor.id].capabilities.actionIds.push(opportunity.id);
      opportunityActionIds[monster.actor.id] = opportunity.id;
    }
    if (dash) base.world.actors[monster.actor.id].capabilities.actionIds.push(dash.id);
  }
  const partyColors = ['#3c8ccf', '#8a63c7', '#3f9c68', '#c27a3d'];
  const tokens: SoloCombatState['tokens'] = Object.fromEntries(participants.map((participant, index) => {
    const centeredOffset = (index - (participants.length - 1) / 2) * 2;
    const x = Math.max(1, Math.min(TACTICAL_WIDTH - 2, Math.round(TACTICAL_WIDTH / 2 + centeredOffset)));
    return [participant.character.id, {
      actorId: participant.character.id,
      tokenUrl: participant.character.avatar_url,
      color: partyColors[index % partyColors.length],
      position: { x, y: TACTICAL_HEIGHT - 2 },
    }];
  }));
  monsters.forEach((monster, index) => {
    tokens[monster.actor.id] = {
      actorId: monster.actor.id, templateId: monster.template.id,
      tokenUrl: monster.template.token_url, color: '#b94d3f',
      position: { x: 2 + (index * 3) % (TACTICAL_WIDTH - 3), y: 1 + Math.floor(index / 3) },
    };
  });
  const state: SoloCombatState = {
    schemaVersion: SOLO_COMBAT_SCHEMA_VERSION,
    characterId: input.character.id,
    runtimeRevision: Number(input.character.runtime_revision ?? 0),
    world: clone(base.world), catalogActions: catalogActions.sort((a, b) => a.id.localeCompare(b.id)),
    controlledCharacterIds: controlledIds,
    playerActionIdsByActor: Object.fromEntries(participants.map((participant) => [
      participant.character.id,
      [...new Set([
        ...participant.canonical.actions.map((action) => action.id),
        ...tacticalBasics.map((action) => action.id),
      ])],
    ])),
    playerActionIds: [...new Set([
      ...input.participant.canonical.actions.map((action) => action.id),
      ...tacticalBasics.map((action) => action.id),
    ])],
    actionPresentation: {
      ...Object.assign({}, ...participants.map((participant) => participant.actionPresentation ?? {})),
      ...Object.fromEntries(basicRows.map((action, index) => [tacticalBasics[index].id, {
        imageUrl: action.image_url,
        description: action.description,
        sourceLabel: 'Базовое действие',
        entityType: 'action' as const,
        entityId: action.id,
        actionRef: action,
      }])),
      ...Object.fromEntries(monsters.flatMap((monster) => monster.template.action_ids.flatMap((actionId) => {
        const action = input.actions.find((candidate) => candidate.id === actionId);
        const projected = monster.actions.find((candidate) => candidate.id === actionId);
        return action && projected ? [[projected.id, {
          imageUrl: action.image_url,
          description: action.description,
          sourceLabel: monster.template.name,
          entityType: 'action' as const,
          entityId: action.id,
          actionRef: action,
        }] as const] : [];
      }))),
    },
    sideByActorId: {
      ...Object.fromEntries(controlledIds.map((actorId) => [actorId, 'side:party'])),
      ...Object.fromEntries(monsters.map((monster) => [monster.actor.id, 'side:opposition'])),
    },
    actorPresentation: {
      ...Object.fromEntries(participants.map((participant) => [participant.character.id, {
        creatureType: base.world.actors[participant.character.id].character.creatureType,
        actionIds: participant.canonical.actions.map((action) => action.id),
        traits: [],
      }])),
      ...Object.fromEntries(monsters.map((monster) => [monster.actor.id, {
        templateId: monster.template.id,
        description: monster.template.description,
        size: monster.template.size,
        creatureType: monster.template.creature_type,
        alignment: monster.template.alignment,
        challengeRating: monster.template.challenge_rating,
        source: monster.template.source,
        actionIds: monster.actions.map((action) => action.id),
        traits: monster.template.effect_ids.flatMap((effectId) => {
          const effect = input.effects.find((candidate) => candidate.id === effectId);
          return effect?.mechanics ? [{
            id: effect.id,
            name: effect.name,
            description: effect.description,
            imageUrl: effect.image_url,
            mechanics: clone(effect.mechanics),
          }] : [];
        }),
      }])),
    },
    certifiedPlayerActionIdsByActor: Object.fromEntries(participants.map((participant) => [
      participant.character.id,
      [...(base.certifiedActionIdsByActor[participant.character.id] ?? [])],
    ])),
    certifiedPlayerActionIds: [...base.certifiedActionIdsByActor[input.character.id]],
    monsterActionIds, opportunityActionIds,
    ...(dash ? { dashActionId: dash.id } : {}),
    participantRuntimeRevisions: Object.fromEntries(participants.map(({ character }) => [
      character.id,
      Number(character.runtime_revision ?? 0),
    ])),
    resourceBindingsByActor: Object.fromEntries(participants.map((participant) => [
      participant.character.id,
      clone(base.resourceBindingsByActor[participant.character.id] ?? {}),
    ])),
    resourceBindings: clone(base.resourceBindingsByActor[input.character.id]),
    tokens, worldObjectPositions: {}, combatAreas: {}, pendingCombatAreaTriggers: [], boardRevision: 1,
    movementRemainingFt: Object.fromEntries(Object.values(base.world.actors).map((actor) => [
      actor.id, effectiveActorSpeedFt(actor),
    ])),
    initiativeBonuses: {
      ...Object.fromEntries(participants.map(({ character }) => [
        character.id,
        Number(character.initiative_bonus
          ?? base.world.actors[character.id].character.abilityMods.dex
          ?? 0),
      ])),
      ...Object.fromEntries(monsters.map((monster) => [
        monster.actor.id,
        Number(monster.template.initiative_bonus
          ?? monster.actor.character.abilityMods.dex
          ?? 0),
      ])),
    },
    initiative: [], log: [], outcome: 'active',
  };
  return withInitiativeAndStart(state, input.rng ?? Math.random);
}

export function selectedTargetsForAction(input: {
  state: SoloCombatState;
  actorId?: string;
  actionId: string;
  clickedActorId?: string;
  clickedPosition: GridPosition;
}): string[] {
  const action = input.state.catalogActions.find((candidate) => candidate.id === input.actionId);
  if (!action) throw new Error('Действие отсутствует в боевом каталоге');
  const actorId = input.actorId ?? input.state.characterId;
  const rawTargeting = action.mechanics.targeting as Record<string, unknown> | undefined;
  if (rawTargeting?.domain === 'world' || rawTargeting?.actor_targets === false) return [];
  if (rawTargeting?.shape === 'self') return [actorId];
  if (rawTargeting?.shape === 'area') {
    return areaActorIds({
      state: input.state, sourceActorId: actorId,
      aimPosition: input.clickedPosition, action,
    }).slice(0, action.targeting?.maxTargets ?? 8);
  }
  return input.clickedActorId ? [input.clickedActorId] : [];
}

export function activeActor(state: SoloCombatState): ActorState {
  return state.world.actors[activeActorId(state)];
}
