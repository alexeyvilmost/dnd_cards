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
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import { turnStartGrappleDamageOpportunity } from '../rules-core/fightingStyleComplexPrimitives';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Monster } from '../monsters/types';
import { canPay } from '../engine/cost';
import {
  executeRemoteManipulator as executeEngineRemoteManipulator,
  type RemoteManipulatorCommand,
} from '../engine/execute';
import { describeEngineEvent } from '../engine/events';
import { stoneworkContactFactsFromChoices } from '../mechanics/collectChoices';
import { compileMonsterInstance } from './monsterCompiler';
import { planMonsterTurn } from './monsterAi';
import { projectCombatLogRecords } from './combatLog';
import {
  areaActorIds,
  effectiveActorSpeedFt,
  effectiveCombatActorSpeedFt,
  gridDistanceFt,
  occupiedPositions,
  pushAway,
} from './tacticalGrid';
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
  type SoloCombatState,
} from './types';
import { UNARMED_STRIKE_CHOICE_ID } from './actionChoices';

type Rng = () => number;

export interface SelectedMonster {
  monster: Monster;
  quantity: number;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function buildCatalog(actions: readonly RuleActionDefinition[]): RulesCatalog {
  const byId = new Map(actions.map((action) => [action.id, clone(action)]));
  return {
    getAction: (id) => byId.get(id),
    listActions: () => [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
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
  const entry: CombatLogEntry = {
    id: newSheetRuntimeCommandId(), round, actorId, text: `${actorName}: ${text}`,
    ...(records.length ? { records: clone([...records]) } : {}),
  };
  return { ...state, log: [...state.log.slice(-79), entry] };
}

function eventSummary(records: readonly CombatLogEventRecord[]): string {
  const fragments = records.flatMap((record) => {
    const event = record.event;
    if (!event) return [];
    switch (event.type) {
      case 'damage': return [`урон ${event.amount} (${event.damageType})`];
      case 'healing': return [`лечение ${event.amount}`];
      case 'movement': return [`отталкивание ${event.distanceFt} фт.`];
      case 'condition_applied': return [`состояние: ${event.condition}`];
      case 'resource_spent': return [`потрачено: ${event.resource}`];
      case 'roll': return [event.roll.text];
      default: return [];
    }
  });
  return fragments.length ? fragments.join('; ') : 'действие выполнено';
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
    if (payload.type !== 'WorldObjectMutationRecorded'
      || payload.event.type !== 'WorldObjectCreated'
      || !payload.event.object.illusion) return [];
    const illusion = payload.event.object.illusion;
    const form = illusion.form === 'sound' ? 'звук' : 'изображение';
    return [
      `иллюзия «${illusion.description}» (${form}, ${payload.event.object.roundsLeft ?? 0} раундов; `
      + `изучение: Интеллект (Расследование) против СЛ ${illusion.spellSaveDc})`,
    ];
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
    if (envelope.payload.type !== 'EngineEventRecorded'
      || envelope.payload.event.type !== 'movement'
      || envelope.payload.event.mode !== 'push') continue;
    const source = tokens[envelope.payload.actorId]?.position;
    for (const targetId of envelope.payload.targetIds) {
      const target = tokens[targetId]?.position;
      if (!source || !target) continue;
      const position = pushAway({
        source, target, distanceFt: envelope.payload.event.distanceFt,
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
  next = { ...next, world: nextWorld };
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
  return outcome(next);
}

function dispatch(input: {
  state: SoloCombatState;
  command: GameCommand;
  rng: Rng;
  label: string;
  emptySummary?: string;
}): SoloCombatState {
  const session = new InMemoryRulesSession(input.state.world, buildCatalog(input.state.catalogActions), {
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
  });
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
  const choices: Record<string, string[]> = Object.fromEntries(
    Object.entries(suppliedChoices).map(([id, values]) => [id, [...values]]),
  );
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
    dancingLightsWorldInput = {
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

export function executeCombatAction(input: {
  state: SoloCombatState;
  actorId: string;
  actionId: string;
  targetIds: string[];
  worldPosition?: GridPosition;
  worldInput?: ActionWorldInput;
  choices?: Readonly<Record<string, readonly string[]>>;
  rng?: Rng;
}): SoloCombatState {
  if (input.state.outcome !== 'active') return input.state;
  if (activeActorId(input.state) !== input.actorId) throw new Error('Сейчас ход другого участника');
  const action = input.state.catalogActions.find((candidate) => candidate.id === input.actionId);
  if (!action) throw new Error('Действие отсутствует в снимке боя');
  const declaration = declarationFor(
    input.state,
    input.actorId,
    action,
    input.targetIds,
    input.worldPosition,
    input.choices,
    input.worldInput,
  );
  const rng = input.rng ?? Math.random;
  const withTriggeredHitOffer = (next: SoloCombatState) => offerTriggeredHitActions({
    before: input.state,
    after: next,
    sourceActorId: input.actorId,
    sourceActionId: action.id,
    targetIds: input.targetIds,
  });
  if (isBasicUnarmedStrike(input.state, action)) {
    if (input.targetIds.length !== 1) throw new Error('Безоружный удар требует одну цель');
    const option = input.choices?.[UNARMED_STRIKE_CHOICE_ID]?.[0] ?? 'damage';
    if (option !== 'damage' && option !== 'grapple' && option !== 'shove') {
      throw new Error('Неизвестный вариант безоружного удара');
    }
    const begun = dispatch({
      state: input.state,
      command: { ...commandBase(input.state, input.actorId), type: 'BeginAttackAction' },
      rng,
      label: 'Атака',
    });
    const attackAction = Object.values(begun.world.attackActions).find((candidate) => (
      candidate.actorId === input.actorId && candidate.status === 'open'
    ));
    if (!attackAction) throw new Error('Не удалось открыть действие «Атака»');
    return withTriggeredHitOffer(dispatch({
      state: begun,
      command: {
        ...commandBase(begun, input.actorId),
        type: 'PerformUnarmedStrike',
        attackActionId: attackAction.id,
        option,
        targetActorId: input.targetIds[0],
        facts: spatialFacts(begun, input.actorId, input.targetIds[0]),
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
    return withTriggeredHitOffer(dispatch({ state: input.state, command, rng, label: action.name }));
  }
  if (isControlledCharacter(input.state, input.actorId)
    && SHEET_PRIMITIVES.has(primitiveType(action) ?? '')) {
    const transition = executeSheetCombatAction({
      session: sheetSession(input.state, input.actorId), actorId: input.actorId, actionId: action.id,
      declaration, commandId: newSheetRuntimeCommandId(), rng,
    });
    return withTriggeredHitOffer(applySheetTransition(input.state, input.actorId, action, transition));
  }
  const command: GameCommand = {
    ...commandBase(input.state, input.actorId),
    type: 'UseAction', actionId: action.id,
    targetIds: declaration.targetIds,
    ...(declaration.factsByTarget ? { factsByTarget: declaration.factsByTarget } : {}),
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
  let next = dispatch({ state: input.state, command, rng, label: action.name });
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
  if (action.id !== next.dashActionId) return withTriggeredHitOffer(next);
  return withTriggeredHitOffer({
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [input.actorId]: (next.movementRemainingFt[input.actorId] ?? 0)
        + effectiveCombatActorSpeedFt(next, input.actorId),
    },
  });
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
  return executeCombatAction({
    state: cleared as SoloCombatState,
    actorId: pending.sourceActorId,
    actionId,
    targetIds: pending.targetIds,
    rng,
  });
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

export function autoResolveSystemDecisions(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  let next = state;
  for (let guard = 0; guard < 24 && next.world.pendingResolution; guard += 1) {
    const pending = next.world.pendingResolution;
    if (pending.request.type === 'reaction'
      && isControlledCharacter(next, pending.request.actorId)) break;
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
      next = offerTriggeredHitActions({
        before: beforeDecision,
        after: next,
        sourceActorId: pending.request.trigger.sourceActorId,
        sourceActionId: pending.request.trigger.actionId,
        targetIds: [pending.request.actorId],
      });
    }
  }
  return next;
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
  if (pending.request.trigger.type === 'hit_by_attack') {
    next = offerTriggeredHitActions({
      before: state,
      after: next,
      sourceActorId: pending.request.trigger.sourceActorId,
      sourceActionId: pending.request.trigger.actionId,
      targetIds: [pending.request.actorId],
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
    && activeActorId(next) === actingActorId) {
    return advanceTurn(next, rng);
  }
  return next;
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

function hasHitRecord(
  state: SoloCombatState,
  fromLogIndex: number,
  sourceActorId: string,
): boolean {
  return state.log.slice(fromLogIndex).some((entry) => entry.records?.some((record) => {
    const roll = record.event?.type === 'roll' ? record.event.roll : undefined;
    return record.sourceActorId === sourceActorId
      && roll?.kind === 'd20'
      && (roll.outcome === 'hit' || roll.outcome === 'crit');
  }));
}

function offerTriggeredHitActions(input: {
  before: SoloCombatState;
  after: SoloCombatState;
  sourceActorId: string;
  sourceActionId: string;
  targetIds: string[];
}): SoloCombatState {
  const { before, after, sourceActorId, sourceActionId, targetIds } = input;
  if (after.world.pendingResolution || after.pendingTriggeredAction
    || !isControlledCharacter(after, sourceActorId)
    || !hasHitRecord(after, before.log.length, sourceActorId)) return after;
  const actor = after.world.actors[sourceActorId];
  if (!actor) return after;
  const owned = new Set(actor.capabilities.actionIds);
  const optionActionIds = after.catalogActions.flatMap((action) => {
    if (action.id === sourceActionId || !owned.has(action.id)
      || !isTriggeredCombatAction(action, 'hit')) return [];
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const costs = Array.isArray(activation?.cost)
      ? activation.cost as Array<Record<string, unknown>>
      : [];
    return canPay(actor.runtime, costs).ok ? [action.id] : [];
  });
  return optionActionIds.length ? {
    ...after,
    pendingTriggeredAction: {
      event: 'hit', sourceActorId, sourceActionId,
      targetIds: [...targetIds], optionActionIds,
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
  if (!mover || !start || deniesOpportunityAttack(mover)) return state;
  let next = state;
  const enemies = Object.values(state.world.actors).filter((actor) => (
    combatRelation(state, moverId, actor.id) === 'enemy' && actor.runtime.hp.current > 0
      && actor.runtime.resources.reaction > 0
      && gridDistanceFt(state.tokens[actor.id].position, start) <= 5
      && gridDistanceFt(state.tokens[actor.id].position, destination) > 5
  ));
  for (const enemy of enemies) {
    const actionId = next.opportunityActionIds[enemy.id];
    if (!actionId || next.world.actors[moverId].runtime.hp.current <= 0) continue;
    const action = next.catalogActions.find((candidate) => candidate.id === actionId);
    if (!action) continue;
    const command: GameCommand = {
      ...commandBase(next, enemy.id), type: 'UseReactionAction', trigger: 'opportunity_attack', actionId,
      targetIds: [moverId], factsByTarget: { [moverId]: spatialFacts(next, enemy.id, moverId) },
    };
    next = dispatch({ state: next, command, rng, label: action.name });
    next = autoResolveSystemDecisions(next, rng);
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
  if (distance > maxFeet) throw new Error(`За это перемещение доступно ${maxFeet} фт.`);
  if (occupiedPositions(input.state, input.actorId).has(`${input.destination.x}:${input.destination.y}`)) {
    throw new Error('Клетка занята');
  }
  let next = input.voluntary === false
    ? input.state
    : executeOpportunityAttacks(input.state, input.actorId, input.destination, input.rng ?? Math.random);
  if (next.world.actors[input.actorId].runtime.hp.current <= 0) return outcome(next);
  next = {
    ...next,
    tokens: { ...next.tokens, [input.actorId]: { ...next.tokens[input.actorId], position: input.destination } },
    boardRevision: next.boardRevision + 1,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [input.actorId]: Math.max(0, available - distance),
    },
  };
  next = breakOutOfRangeGrapples(next, input.actorId, input.rng ?? Math.random);
  return appendLog(next, input.actorId, `Перемещение на ${distance} фт.`);
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
  return {
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [actorId]: effectiveCombatActorSpeedFt(next, actorId),
    },
  };
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
  return {
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [pending.actorId]: effectiveCombatActorSpeedFt(next, pending.actorId),
    },
  };
}

export function advanceTurn(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  if (state.outcome !== 'active' || state.world.pendingResolution
    || state.pendingTurnStartGrappleDamage) return state;
  const endingActorId = activeActorId(state);
  let next = dispatch({
    state,
    command: { ...commandBase(state, endingActorId), type: 'EndTurn' },
    rng: () => { throw new Error('EndTurn не должен бросать кости'); },
    label: 'Конец хода',
  });
  if (next.outcome !== 'active') return next;
  const startingActorId = activeActorId(next);
  return startTurnOrRequestGrappleDamage(next, startingActorId, rng);
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
  if (input.participant.canonical.world.ruleset.contentHash !== input.state.world.ruleset.contentHash) {
    throw new Error('Персонаж использует несовместимую версию правил');
  }
  const isolated = await createSheetCombatSession({
    source: input.participant,
    targets: [],
    sceneMode: 'exploration',
  });
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

export function runMonsterTurn(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  if (state.outcome !== 'active' || state.world.pendingResolution) return state;
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
    .sort((left, right) => (
      gridDistanceFt(state.tokens[monsterId].position, state.tokens[left].position)
        - gridDistanceFt(state.tokens[monsterId].position, state.tokens[right].position)
        || left.localeCompare(right)
    ))[0];
  if (!targetId) return outcome(state);
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
      next = executeCombatAction({ state: next, actorId: monsterId, actionId, targetIds: [targetId], rng });
      next = autoResolveSystemDecisions(next, rng);
    }
  }
  return next.world.pendingResolution || next.outcome !== 'active' ? next : advanceTurn(next, rng);
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
  const basicRows = input.actions.filter((action) => TACTICAL_BASIC_ACTIONS.has(action.card_number));
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
    tokens, worldObjectPositions: {}, boardRevision: 1,
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
