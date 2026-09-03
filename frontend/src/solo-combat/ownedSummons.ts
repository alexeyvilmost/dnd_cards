import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import type { GridPosition, InitiativeEntry, SoloCombatState } from './types';
import { TACTICAL_HEIGHT, TACTICAL_WIDTH } from './types';

type Dict = Record<string, unknown>;

export interface OwnedSummonPolicy {
  summonKey: string;
  name: string;
  creatureType: string;
  size: number;
  speedFt: number;
  armorClass: { base: number; perSpellLevel: number };
  hitPoints: { base: number; perSpellLevel: number; scaleFromLevel: number };
  duration: 'until_destroyed' | 'concentration' | { rounds: number };
}

const BASIC_ACTION_CARDS = new Set([
  'action_basic_dash', 'action_basic_disengage', 'action_basic_dodge',
]);

function finite(value: unknown, minimum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : null;
}

function statFormula(value: unknown, path: string): OwnedSummonPolicy['armorClass'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const row = value as Dict;
  const base = finite(row.base, 0);
  const perSpellLevel = finite(row.per_spell_level, 0);
  if (base === null || perSpellLevel === null) {
    throw new Error(`${path} requires non-negative base and per_spell_level`);
  }
  return { base, perSpellLevel };
}

/** Strict parser: malformed catalog data never silently mints a board actor. */
export function ownedSummonPolicy(action: RuleActionDefinition): OwnedSummonPolicy | null {
  const primitive = action.mechanics.primitive as Dict | undefined;
  if (primitive?.type !== 'owned_summon') return null;
  const summonKey = typeof primitive.summon_key === 'string' ? primitive.summon_key.trim() : '';
  const name = typeof primitive.name === 'string' ? primitive.name.trim() : '';
  const creatureType = typeof primitive.creature_type === 'string'
    ? primitive.creature_type.trim() : '';
  const size = finite(primitive.size, 0);
  const speedFt = finite(primitive.speed_ft, 1);
  if (!summonKey || !name || !creatureType || size === null || size > 5 || speedFt === null
    || primitive.initiative !== 'immediately_after_owner' || primitive.replace_existing !== true) {
    throw new Error(`${action.id}: owned_summon identity or stat block is malformed`);
  }
  const armorClass = statFormula(primitive.armor_class, `${action.id}.armor_class`);
  const hitPointsRaw = primitive.hit_points;
  const hitPoints = statFormula(hitPointsRaw, `${action.id}.hit_points`);
  const scaleFromLevel = hitPointsRaw && typeof hitPointsRaw === 'object'
    ? finite((hitPointsRaw as Dict).scale_from_level, 0) : null;
  if (scaleFromLevel === null) throw new Error(`${action.id}.hit_points requires scale_from_level`);
  const rawDuration = primitive.duration;
  let duration: OwnedSummonPolicy['duration'];
  if (rawDuration === 'until_destroyed' || rawDuration === 'concentration') duration = rawDuration;
  else if (rawDuration && typeof rawDuration === 'object' && !Array.isArray(rawDuration)) {
    const rounds = finite((rawDuration as Dict).rounds, 1);
    if (rounds === null || !Number.isInteger(rounds)) throw new Error(`${action.id}.duration rounds are invalid`);
    duration = { rounds };
  } else throw new Error(`${action.id}.duration is invalid`);
  return {
    summonKey, name, creatureType, size, speedFt, armorClass,
    hitPoints: { ...hitPoints, scaleFromLevel }, duration,
  };
}

function stat(formula: OwnedSummonPolicy['armorClass'], castLevel: number, scaleFrom = 0): number {
  return formula.base + Math.max(0, castLevel - scaleFrom) * formula.perSpellLevel;
}

function basicActionIds(state: SoloCombatState): string[] {
  return state.catalogActions.flatMap((action) => {
    const cardNumber = state.actionPresentation?.[action.id]?.actionRef?.card_number;
    return cardNumber && BASIC_ACTION_CARDS.has(cardNumber) ? [action.id] : [];
  });
}

function summonPosition(
  state: SoloCombatState,
  ownerActorId: string,
  action: RuleActionDefinition,
  requested?: GridPosition,
): GridPosition {
  const occupied = new Set(Object.values(state.tokens).map(({ position }) => `${position.x}:${position.y}`));
  if (!requested) throw new Error('Выберите свободную клетку для призванного существа');
  if (requested.x < 0 || requested.x >= TACTICAL_WIDTH
    || requested.y < 0 || requested.y >= TACTICAL_HEIGHT) {
    throw new Error('Клетка призыва находится за пределами поля');
  }
  if (occupied.has(`${requested.x}:${requested.y}`)) {
    throw new Error('Для призванного существа нужна свободная клетка');
  }
  const source = state.tokens[ownerActorId]?.position;
  if (!source) throw new Error('Владелец призыва отсутствует на поле');
  const distanceFt = Math.max(
    Math.abs(source.x - requested.x), Math.abs(source.y - requested.y),
  ) * 5;
  if (action.targeting?.rangeFt !== undefined && distanceFt > action.targeting.rangeFt) {
    throw new Error(`Клетка призыва должна быть в пределах ${action.targeting.rangeFt} фт.`);
  }
  if (action.targeting?.requiresLineOfSight) {
    const steps = Math.max(Math.abs(requested.x - source.x), Math.abs(requested.y - source.y));
    const blocked = Object.values(state.combatAreas ?? {}).some((area) => (
      area.heavilyObscured && area.cells.some((cell) => {
        for (let index = 0; index <= steps; index += 1) {
          const ratio = steps === 0 ? 0 : index / steps;
          if (cell.x === Math.round(source.x + (requested.x - source.x) * ratio)
            && cell.y === Math.round(source.y + (requested.y - source.y) * ratio)) return true;
        }
        return false;
      })
    ));
    if (blocked) throw new Error('Клетка призыва не видна владельцу');
  }
  return { ...requested };
}

function summonInitiative(
  initiative: readonly InitiativeEntry[], ownerActorId: string, summonActorId: string,
): InitiativeEntry[] {
  const retained = initiative.filter(({ actorId }) => actorId !== summonActorId);
  const ownerIndex = retained.findIndex(({ actorId }) => actorId === ownerActorId);
  if (ownerIndex < 0) throw new Error('Владелец призыва отсутствует в инициативе');
  const owner = retained[ownerIndex];
  return [
    ...retained.slice(0, ownerIndex + 1),
    { actorId: summonActorId, die: owner.die, bonus: owner.bonus, total: owner.total },
    ...retained.slice(ownerIndex + 1),
  ];
}

function withoutActor(state: SoloCombatState, actorId: string): SoloCombatState {
  const removedGrappleIds = new Set(Object.values(state.world.grapples)
    .filter((grapple) => grapple.grapplerActorId === actorId || grapple.targetActorId === actorId)
    .map((grapple) => grapple.id));
  const actors = Object.fromEntries(Object.entries(state.world.actors)
    .filter(([id]) => id !== actorId)
    .map(([id, actor]) => [id, removedGrappleIds.size === 0 ? actor : {
      ...actor,
      runtime: {
        ...actor.runtime,
        activeEffects: actor.runtime.activeEffects.filter(
          (effect) => !removedGrappleIds.has(effect.id.replace(/^grapple:/, '')),
        ),
      },
    }]));
  const grapples = Object.fromEntries(Object.entries(state.world.grapples).filter(
    ([grappleId]) => !removedGrappleIds.has(grappleId),
  ));
  const tokens = { ...state.tokens }; delete tokens[actorId];
  const sideByActorId = { ...state.sideByActorId }; delete sideByActorId[actorId];
  const actorPresentation = { ...state.actorPresentation }; delete actorPresentation[actorId];
  const movementRemainingFt = { ...state.movementRemainingFt }; delete movementRemainingFt[actorId];
  const initiativeBonuses = { ...state.initiativeBonuses }; delete initiativeBonuses[actorId];
  const playerActionIdsByActor = { ...(state.playerActionIdsByActor ?? {}) };
  delete playerActionIdsByActor[actorId];
  const certifiedPlayerActionIdsByActor = { ...(state.certifiedPlayerActionIdsByActor ?? {}) };
  delete certifiedPlayerActionIdsByActor[actorId];
  const mountByRiderId = Object.fromEntries(Object.entries(state.mountByRiderId ?? {}).filter(
    ([riderId, mountId]) => riderId !== actorId && mountId !== actorId,
  ));
  const combatAreas = Object.fromEntries(Object.entries(state.combatAreas ?? {}).filter(
    ([, area]) => area.sourceActorId !== actorId,
  ));
  const pendingCombatAreaTriggers = (state.pendingCombatAreaTriggers ?? []).filter(
    (trigger) => trigger.actorId !== actorId && combatAreas[trigger.areaId] !== undefined,
  );
  const initiative = state.initiative.filter((entry) => entry.actorId !== actorId);
  const currentActorId = state.world.scene.mode === 'encounter'
    ? state.world.scene.initiative[state.world.scene.activeIndex] : null;
  const order = state.world.scene.mode === 'encounter'
    ? state.world.scene.initiative.filter((id) => id !== actorId) : [];
  const activeIndex = currentActorId && currentActorId !== actorId
    ? Math.max(0, order.indexOf(currentActorId))
    : Math.min(state.world.scene.mode === 'encounter' ? state.world.scene.activeIndex : 0, Math.max(0, order.length - 1));
  return {
    ...state,
    world: {
      ...state.world, actors, grapples,
      ...(state.world.scene.mode === 'encounter'
        ? { scene: { ...state.world.scene, initiative: order, activeIndex } } : {}),
    },
    tokens, sideByActorId, actorPresentation, movementRemainingFt, initiativeBonuses,
    playerActionIdsByActor, certifiedPlayerActionIdsByActor, mountByRiderId, initiative,
    combatAreas, pendingCombatAreaTriggers,
    boardRevision: state.boardRevision + 1,
  };
}

/** Removes only summons whose explicit data-owned end condition is observable. */
export function reconcileOwnedSummons(state: SoloCombatState): SoloCombatState {
  let next = state;
  const unique = new Set<string>();
  for (const actor of Object.values(state.world.actors)) {
    const summon = actor.ownedSummon;
    if (!summon) continue;
    const uniqueKey = `${summon.ownerActorId}\u0000${summon.sourceActionId}\u0000${summon.summonKey}`;
    if (unique.has(uniqueKey)) {
      throw new Error(`Duplicate owned summon lifecycle ${uniqueKey.replaceAll('\u0000', ':')}`);
    }
    unique.add(uniqueKey);
    const owner = next.world.actors[summon.ownerActorId];
    const round = next.world.scene.mode === 'encounter' ? next.world.scene.round : 0;
    const expired = summon.duration.type === 'rounds' && round > summon.duration.expiresAfterRound;
    const concentrationLost = summon.duration.type === 'concentration'
      && next.world.concentrations[summon.ownerActorId]?.actionId !== summon.sourceActionId;
    if (actor.runtime.hp.current <= 0 || owner?.lifecycle?.status === 'dead'
      || !owner || expired || concentrationLost) {
      next = withoutActor(next, actor.id);
    }
  }
  if (next.world.scene.mode !== 'encounter'
    || !Object.values(next.world.actors).some((actor) => actor.ownedSummon)) return next;
  const currentActorId = next.world.scene.initiative[next.world.scene.activeIndex] ?? null;
  const entries = new Map(next.initiative.map((entry) => [entry.actorId, entry]));
  const summonsByOwner = new Map<string, string[]>();
  for (const actor of Object.values(next.world.actors)) {
    if (!actor.ownedSummon) continue;
    summonsByOwner.set(actor.ownedSummon.ownerActorId, [
      ...(summonsByOwner.get(actor.ownedSummon.ownerActorId) ?? []), actor.id,
    ]);
  }
  const baseOrder = next.world.scene.initiative.filter((actorId) => !next.world.actors[actorId]?.ownedSummon);
  const order = baseOrder.flatMap((actorId) => [
    actorId,
    ...(summonsByOwner.get(actorId) ?? []).sort((left, right) => left.localeCompare(right)),
  ]);
  const initiative = order.map((actorId) => entries.get(actorId)).filter((entry): entry is InitiativeEntry => !!entry);
  if (initiative.length !== order.length) throw new Error('Owned summon has no tactical initiative entry');
  const activeIndex = currentActorId ? order.indexOf(currentActorId) : next.world.scene.activeIndex;
  if (activeIndex < 0) throw new Error('Active actor disappeared while reconciling owned summons');
  const changed = order.some((actorId, index) => next.world.scene.mode === 'encounter'
    && next.world.scene.initiative[index] !== actorId);
  return changed ? {
    ...next,
    initiative,
    world: { ...next.world, scene: { ...next.world.scene, initiative: order, activeIndex } },
    boardRevision: next.boardRevision + 1,
  } : next;
}

export function materializeOwnedSummon(input: {
  state: SoloCombatState;
  action: RuleActionDefinition;
  ownerActorId: string;
  castLevel: number;
  position?: GridPosition;
}): SoloCombatState {
  const policy = ownedSummonPolicy(input.action);
  if (!policy) return input.state;
  const owner = input.state.world.actors[input.ownerActorId];
  if (!owner) throw new Error('Владелец призыва отсутствует в сцене');
  const actorId = `${owner.id}:summon:${policy.summonKey}`;
  let state = input.state.world.actors[actorId] ? withoutActor(input.state, actorId) : input.state;
  if (policy.duration === 'concentration'
    && state.world.concentrations[owner.id]?.actionId !== input.action.id) {
    throw new Error(`${input.action.name}: концентрация не была зафиксирована`);
  }
  const actionIds = basicActionIds(state);
  const hp = stat(policy.hitPoints, input.castLevel, policy.hitPoints.scaleFromLevel);
  const ac = stat(policy.armorClass, input.castLevel);
  const duration = policy.duration === 'until_destroyed'
    ? { type: 'until_destroyed' as const }
    : policy.duration === 'concentration'
      ? { type: 'concentration' as const }
      : {
        type: 'rounds' as const,
        expiresAfterRound: (state.world.scene.mode === 'encounter' ? state.world.scene.round : 0)
          + policy.duration.rounds,
      };
  const sourceEntityIds = [...new Set([input.action.id, ...input.action.sourceEntityIds])] as [string, ...string[]];
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const actor: ActorState = {
    id: actorId,
    name: policy.name,
    kind: 'summonedActor',
    controllerId: owner.controllerId,
    ac,
    capabilities: {
      actionIds,
      featureSources: Object.fromEntries(actionIds.map((id) => [id, sourceEntityIds])),
    },
    character: {
      creatureType: policy.creatureType,
      abilityScores: scores,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: owner.character.profBonus,
      level: input.castLevel,
      characterSpeed: policy.speedFt,
      baseSpeed: policy.speedFt,
      saveProficiencies: [], skillProficiencies: [], skillExpertise: [],
    },
    runtime: {
      hp: { current: hp, max: hp, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {}, inventory: [], activeEffects: [],
    },
    lifecycle: { status: 'alive' },
    attackProfile: {
      attacksPerAction: 1, size: policy.size, reachFt: 5, graspingParts: [], sourceEntityIds,
    },
    ownedSummon: {
      ownerActorId: owner.id, sourceActionId: input.action.id, sourceEntityIds,
      summonKey: policy.summonKey, initiative: 'immediately_after_owner', duration,
      createdAtWorldRevision: state.world.revision,
    },
  };
  const initiative = summonInitiative(state.initiative, owner.id, actorId);
  const order = initiative.map((entry) => entry.actorId);
  const ownerIndex = order.indexOf(owner.id);
  const currentActorId = state.world.scene.mode === 'encounter'
    ? state.world.scene.initiative[state.world.scene.activeIndex] : null;
  const activeIndex = currentActorId ? order.indexOf(currentActorId) : ownerIndex;
  const position = summonPosition(state, owner.id, input.action, input.position);
  const durationLabel = duration.type === 'until_destroyed' ? 'до исчезновения'
    : duration.type === 'concentration' ? 'концентрация' : `${policy.duration && typeof policy.duration === 'object' ? policy.duration.rounds : 0} раундов`;
  return reconcileOwnedSummons({
    ...state,
    world: {
      ...state.world,
      actors: { ...state.world.actors, [actorId]: actor },
      ...(state.world.scene.mode === 'encounter'
        ? { scene: { ...state.world.scene, initiative: order, activeIndex } } : {}),
    },
    tokens: {
      ...state.tokens,
      [actorId]: { actorId, color: '#7d68bb', position },
    },
    sideByActorId: {
      ...state.sideByActorId,
      [actorId]: state.sideByActorId[owner.id] ?? 'side:party',
    },
    actorPresentation: {
      ...state.actorPresentation,
      [actorId]: {
        description: `Призвано «${input.action.name}». Владелец: ${owner.name}. Ходит сразу после владельца; длительность: ${durationLabel}.`,
        size: ['Крошечный', 'Маленький', 'Средний', 'Большой', 'Огромный', 'Гигантский'][policy.size],
        creatureType: policy.creatureType,
        source: input.action.name,
        actionIds,
        traits: [],
      },
    },
    playerActionIdsByActor: { ...(state.playerActionIdsByActor ?? {}), [actorId]: actionIds },
    certifiedPlayerActionIdsByActor: {
      ...(state.certifiedPlayerActionIdsByActor ?? {}), [actorId]: [],
    },
    movementRemainingFt: { ...state.movementRemainingFt, [actorId]: policy.speedFt },
    initiativeBonuses: { ...state.initiativeBonuses, [actorId]: 0 },
    initiative,
    boardRevision: state.boardRevision + 1,
  });
}
