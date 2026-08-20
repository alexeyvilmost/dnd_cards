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
  DecisionResponse,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { Monster } from '../monsters/types';
import { compileMonsterInstance } from './monsterCompiler';
import { planMonsterTurn } from './monsterAi';
import { projectCombatLogRecords } from './combatLog';
import {
  areaActorIds,
  effectiveActorSpeedFt,
  gridDistanceFt,
  occupiedPositions,
  pushAway,
} from './tacticalGrid';
import {
  SOLO_COMBAT_SCHEMA_VERSION,
  TACTICAL_HEIGHT,
  TACTICAL_WIDTH,
  combatRelation,
  spatialFacts,
  type CombatLogEntry,
  type CombatLogEventRecord,
  type GridPosition,
  type SoloCombatState,
} from './types';

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
  const player = state.world.actors[state.characterId];
  if (!player || player.runtime.hp.current <= 0) return { ...state, outcome: 'defeat' };
  const livingOpponent = Object.values(state.world.actors).some((actor) => (
    actor.runtime.hp.current > 0
      && combatRelation(state, state.characterId, actor.id) === 'enemy'
  ));
  return livingOpponent ? state : { ...state, outcome: 'victory' };
}

function transitionState(
  state: SoloCombatState,
  actorId: string,
  label: string,
  nextWorld: WorldState,
  rawEvents: readonly UncommittedRuleEvent[],
): SoloCombatState {
  const records = projectCombatLogRecords(rawEvents);
  let next = { ...state, world: nextWorld };
  next = applyForcedMovement(next, rawEvents);
  next = appendLog(next, actorId, `${label}: ${eventSummary(records)}`, records);
  return outcome(next);
}

function dispatch(input: {
  state: SoloCombatState;
  command: GameCommand;
  rng: Rng;
  label: string;
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
    session.getState(), session.getEvents(),
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
  const grant = world.actors[actorId].spellcastingAccess?.grants.find((candidate) => candidate.actionId === action.id);
  if (!grant) throw new Error(`Для «${action.name}» не найден источник заклинания в листе`);
  return { grantId: grant.grantId, mode: 'normal' as const, castLevel: action.spell.level };
}

function declarationFor(
  state: SoloCombatState,
  actorId: string,
  action: RuleActionDefinition,
  targetIds: string[],
  suppliedChoices: Readonly<Record<string, readonly string[]>> = {},
): SheetCanonicalCommandInput {
  const primitive = primitiveType(action);
  const factsByTarget = Object.fromEntries(targetIds.map((targetId) => [
    targetId, spatialFacts(state, actorId, targetId),
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
  return {
    sceneMode: 'encounter', targetIds, factsByTarget,
    ...(action.kind === 'spell' ? { spell: selectedSpellDeclaration(state.world, actorId, action) } : {}),
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(primitive === 'burning_hands_objects' || primitive === 'area_object_push'
      ? { worldInput: { type: 'area_objects', factsByObject: {} } as const }
      : {}),
  };
}

function sheetSession(state: SoloCombatState): SheetCombatSession {
  // The strict sheet bridge receives only the reviewed slice. Generic data-driven
  // actions use the ordinary rules-core UseAction pipeline below.
  const certifiedIds = new Set(state.certifiedPlayerActionIds);
  const catalogActions = state.catalogActions.filter((action) => certifiedIds.has(action.id));
  const catalog = buildCatalog(catalogActions);
  return {
    sourceCharacterId: state.characterId,
    participantRevisions: { [state.characterId]: state.runtimeRevision },
    catalogActions,
    certifiedActionIdsByActor: {
      [state.characterId]: state.certifiedPlayerActionIds,
      ...state.monsterActionIds,
    },
    resourceBindingsByActor: { [state.characterId]: state.resourceBindings },
    world: state.world,
    catalog,
  };
}

function applySheetTransition(
  state: SoloCombatState,
  action: RuleActionDefinition,
  transition: SheetCombatTransition,
): SoloCombatState {
  return transitionState(state, state.characterId, action.name, transition.nextWorld, transition.events);
}

export function executeCombatAction(input: {
  state: SoloCombatState;
  actorId: string;
  actionId: string;
  targetIds: string[];
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
    input.choices,
  );
  const rng = input.rng ?? Math.random;
  if (input.actorId === input.state.characterId && SHEET_PRIMITIVES.has(primitiveType(action) ?? '')) {
    const transition = executeSheetCombatAction({
      session: sheetSession(input.state), actorId: input.actorId, actionId: action.id,
      declaration, commandId: newSheetRuntimeCommandId(), rng,
    });
    return applySheetTransition(input.state, action, transition);
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
      },
    } : {}),
  };
  const next = dispatch({ state: input.state, command, rng, label: action.name });
  if (action.id !== next.dashActionId) return next;
  return {
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [input.actorId]: (next.movementRemainingFt[input.actorId] ?? 0)
        + effectiveActorSpeedFt(next.world.actors[input.actorId]),
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

export function autoResolveSystemDecisions(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  let next = state;
  for (let guard = 0; guard < 24 && next.world.pendingResolution; guard += 1) {
    const pending = next.world.pendingResolution;
    if (pending.request.type === 'reaction' && pending.request.actorId === next.characterId) break;
    const response: DecisionResponse = pending.request.type === 'reaction'
      ? { kind: 'reaction', actionId: null }
      : pending.request.type === 'shove_outcome'
        ? { kind: 'shove_outcome', outcome: 'push_5ft' }
        : { kind: 'roll', roll: { mode: 'system' } };
    next = resolveDecision(next, response, rng);
  }
  return next;
}

export function resolvePlayerReaction(
  state: SoloCombatState,
  actionId: string | null,
  rng: Rng = Math.random,
): SoloCombatState {
  const pending = state.world.pendingResolution;
  if (!pending || pending.request.type !== 'reaction' || pending.request.actorId !== state.characterId) {
    throw new Error('Нет ожидающей реакции персонажа');
  }
  return autoResolveSystemDecisions(resolveDecision(state, { kind: 'reaction', actionId }, rng), rng);
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
  const available = input.state.movementRemainingFt[input.actorId]
    ?? effectiveActorSpeedFt(actor);
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
  return appendLog(next, input.actorId, `Перемещение на ${distance} фт.`);
}

export function advanceTurn(state: SoloCombatState): SoloCombatState {
  if (state.outcome !== 'active' || state.world.pendingResolution) return state;
  const endingActorId = activeActorId(state);
  let next = dispatch({
    state,
    command: { ...commandBase(state, endingActorId), type: 'EndTurn' },
    rng: () => { throw new Error('EndTurn не должен бросать кости'); },
    label: 'Конец хода',
  });
  if (next.outcome !== 'active') return next;
  const startingActorId = activeActorId(next);
  next = dispatch({
    state: next,
    command: { ...commandBase(next, startingActorId), type: 'StartTurn' },
    rng: () => { throw new Error('StartTurn не должен бросать кости'); },
    label: 'Начало хода',
  });
  return {
    ...next,
    movementRemainingFt: {
      ...next.movementRemainingFt,
      [startingActorId]: effectiveActorSpeedFt(next.world.actors[startingActorId]),
    },
  };
}

export function runMonsterTurn(state: SoloCombatState, rng: Rng = Math.random): SoloCombatState {
  if (state.outcome !== 'active' || state.world.pendingResolution) return state;
  const monsterId = activeActorId(state);
  const monster = state.world.actors[monsterId];
  if (!monster || monster.kind !== 'monster') return state;
  if (monster.runtime.hp.current <= 0) return advanceTurn(state);
  const plan = planMonsterTurn(state, monster, state.characterId);
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
      next = executeCombatAction({ state: next, actorId: monsterId, actionId, targetIds: [next.characterId], rng });
      next = autoResolveSystemDecisions(next, rng);
    }
  }
  return next.world.pendingResolution || next.outcome !== 'active' ? next : advanceTurn(next);
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
  return dispatch({
    state: next,
    command: { ...commandBase(next, actorId), type: 'StartTurn' },
    rng: () => { throw new Error('StartTurn не должен бросать кости'); },
    label: 'Начало хода',
  });
}

export async function createSoloCombatState(input: {
  character: ForgeCharacter;
  participant: SheetCombatParticipantSeed;
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
  const base = await createSheetCombatSession({
    source: input.participant, targets: [],
    sceneActors: monsters.map((monster) => monster.actor), sceneMode: 'exploration',
  });
  const catalogActions = [...base.catalogActions];
  // The ordinary character sheet exposes every runnable data-owned action. Keep
  // that complete capability set in solo combat; only the reviewed primitive
  // subset is routed through executeSheetCombatAction.
  for (const action of input.participant.canonical.actions) {
    if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(clone(action));
  }
  const playerAttack = catalogActions.find((action) => (
    primitiveType(action) === 'weapon_attack' && isAttackAction(action)
  ));
  const opportunityActionIds: Record<string, string> = {};
  if (playerAttack) {
    const opportunity = opportunityVersion(playerAttack);
    catalogActions.push(opportunity);
    base.world.actors[input.character.id].capabilities.actionIds.push(opportunity.id);
    opportunityActionIds[input.character.id] = opportunity.id;
  }
  const basicRows = input.actions.filter((action) => TACTICAL_BASIC_ACTIONS.has(action.card_number));
  const tacticalBasics = basicRows.map((action) => projectRuleAction(action));
  const dash = tacticalBasics.find((_, index) => basicRows[index]?.card_number === 'action_basic_dash')
    ?? (input.dashAction ? projectRuleAction(input.dashAction) : undefined);
  for (const action of tacticalBasics) {
    if (!catalogActions.some((candidate) => candidate.id === action.id)) catalogActions.push(action);
    if (!base.world.actors[input.character.id].capabilities.actionIds.includes(action.id)) {
      base.world.actors[input.character.id].capabilities.actionIds.push(action.id);
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
  const tokens: SoloCombatState['tokens'] = {
    [input.character.id]: {
      actorId: input.character.id, tokenUrl: input.character.avatar_url,
      color: '#3c8ccf', position: { x: Math.floor(TACTICAL_WIDTH / 2), y: TACTICAL_HEIGHT - 2 },
    },
  };
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
    playerActionIds: [...new Set([
      ...input.participant.canonical.actions.map((action) => action.id),
      ...tacticalBasics.map((action) => action.id),
    ])],
    actionPresentation: {
      ...(input.participant.actionPresentation ?? {}),
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
      [input.character.id]: 'side:party',
      ...Object.fromEntries(monsters.map((monster) => [monster.actor.id, 'side:opposition'])),
    },
    actorPresentation: {
      [input.character.id]: {
        creatureType: base.world.actors[input.character.id].character.creatureType,
        actionIds: input.participant.canonical.actions.map((action) => action.id),
        traits: [],
      },
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
    certifiedPlayerActionIds: [...base.certifiedActionIdsByActor[input.character.id]],
    monsterActionIds, opportunityActionIds,
    ...(dash ? { dashActionId: dash.id } : {}),
    resourceBindings: clone(base.resourceBindingsByActor[input.character.id]),
    tokens, boardRevision: 1,
    movementRemainingFt: Object.fromEntries(Object.values(base.world.actors).map((actor) => [
      actor.id, effectiveActorSpeedFt(actor),
    ])),
    initiativeBonuses: {
      [input.character.id]: Number(input.character.initiative_bonus
        ?? base.world.actors[input.character.id].character.abilityMods.dex
        ?? 0),
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
  actionId: string;
  clickedActorId?: string;
  clickedPosition: GridPosition;
}): string[] {
  const action = input.state.catalogActions.find((candidate) => candidate.id === input.actionId);
  if (!action) throw new Error('Действие отсутствует в боевом каталоге');
  const rawTargeting = action.mechanics.targeting as Record<string, unknown> | undefined;
  if (rawTargeting?.shape === 'self') return [input.state.characterId];
  if (rawTargeting?.shape === 'area') {
    return areaActorIds({
      state: input.state, sourceActorId: input.state.characterId,
      aimPosition: input.clickedPosition, action,
    }).slice(0, action.targeting?.maxTargets ?? 8);
  }
  return input.clickedActorId ? [input.clickedActorId] : [];
}

export function activeActor(state: SoloCombatState): ActorState {
  return state.world.actors[activeActorId(state)];
}
