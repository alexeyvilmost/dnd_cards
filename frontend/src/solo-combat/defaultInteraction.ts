import type { RuleActionDefinition } from '../rules-core/domain';
import {actorFootprint, footprintDistanceFt} from './footprint';
import { weaponAttackPreview, bindEquippedWeaponActionContext } from '../engine/weapon';
import {compileDeclaredMechanicsTargeting} from '../rules-core/actionTargeting';
import { playerActionIdsFor, spatialFacts, type SoloCombatState } from './types';
import {boardDimensions} from './boardGeometry';
import {
  effectiveCombatActorSpeedFt,
  reachableRoutes,
  type TacticalRoute,
} from './tacticalGrid';

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(records)];
}

/** The same equipped-weapon binding used by authoritative attack execution. */
export function combatActionRangeFt(state:SoloCombatState,actorId:string,action:RuleActionDefinition):number {
  const actor=state.world.actors[actorId];
  const cards=new Map([...(actor.character.knownCards??[]),...(actor.character.equippedCards??[])].map(c=>[c.id,c]));
  const mechanics=bindEquippedWeaponActionContext(action.mechanics,actor.runtime.equipment,cards);
  return mechanics===action.mechanics ? action.targeting?.rangeFt??5 : compileDeclaredMechanicsTargeting(mechanics).rangeFt;
}

export function combatActionIsAttack(
  state: Pick<SoloCombatState, 'actionPresentation'>,
  action: RuleActionDefinition | undefined,
): boolean {
  if (!action) return false;
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  const cardNumber = state.actionPresentation?.[action.id]?.actionRef?.card_number;
  return primitive?.type === 'weapon_attack'
    || primitive?.type === 'unarmed_strike'
    || cardNumber === 'action_basic_unarmed'
    || records(action.mechanics.effects).some((effect) => effect.resolution === 'attack_roll');
}

/** The implicit hostile-click action: equipped weapon first, canonical
 * Unarmed Strike only as a fallback. Availability is validated by the caller. */
export function defaultCombatAttackAction(
  state: SoloCombatState,
  actorId: string,
): RuleActionDefinition | undefined {
  const actions = playerActionIdsFor(state, actorId).flatMap((id) => {
    const action = state.catalogActions.find((candidate) => candidate.id === id);
    return action ? [action] : [];
  });
  const actor = state.world.actors[actorId];
  const heldCardIds = actor ? new Set([
    actor.runtime.equipment.main_hand,
    actor.runtime.equipment.off_hand,
  ].filter(Boolean)) : new Set<string>();
  const holdsWeapon = actor ? [
    ...(actor.character.knownCards ?? []),
    ...(actor.character.equippedCards ?? []),
  ].some((card) => heldCardIds.has(card.id) && card.type === 'weapon') : false;
  return actions.find((action) => (
    actor
    && (action.mechanics.primitive as Record<string, unknown> | undefined)?.type === 'weapon_attack'
    && (holdsWeapon || Boolean(weaponAttackPreview(
      action.mechanics,
      actor.character,
      actor.runtime.equipment,
      actor.runtime,
      actor.passives ?? [],
    )))
  )) ?? actions.find((action) => (
    state.actionPresentation?.[action.id]?.actionRef?.card_number === 'action_basic_unarmed'
      || (action.mechanics.primitive as Record<string, unknown> | undefined)?.type === 'unarmed_strike'
  ));
}

export function combatMovementAvailableFt(state: SoloCombatState, actorId: string): number {
  const speed = effectiveCombatActorSpeedFt(state, actorId);
  if (speed <= 0) return 0;
  return state.pendingAdditionalMovement?.actorId === actorId
    ? state.pendingAdditionalMovement.remainingFt
    : state.movementRemainingFt[actorId] ?? speed;
}

export interface CombatApproachRoute extends TacticalRoute {
  available: boolean;
  availableFt: number;
  remainingFt: number;
}

export function combatMovementRoute(
  state: SoloCombatState,
  actorId: string,
  destination: {x: number; y: number},
): CombatApproachRoute | null {
  const availableFt = combatMovementAvailableFt(state, actorId);
  const {width,height}=boardDimensions(state);
  const maximumBoardRouteFt = width * height * 15;
  const route = reachableRoutes(state, actorId, maximumBoardRouteFt, destination)
    .find((candidate) => candidate.destination.x === destination.x && candidate.destination.y === destination.y);
  return route ? {
    ...route,
    available: route.costFt <= availableFt,
    availableFt,
    remainingFt: Math.max(0, availableFt - route.costFt),
  } : null;
}

/** Cheapest legal movement destination from which the action's declared range
 * reaches the target. The route may exceed this turn's remaining movement so
 * the UI can explain the exact shortfall instead of only saying “out of range”. */
export function combatApproachRoute(
  state: SoloCombatState,
  actorId: string,
  targetActorId: string,
  rangeFt: number,
): CombatApproachRoute | null {
  const origin = state.tokens[actorId]?.position;
  const target = state.tokens[targetActorId]?.position;
  if (!origin || !target) return null;
  const availableFt = combatMovementAvailableFt(state, actorId);
  const {width,height}=boardDimensions(state);
  const maximumBoardRouteFt = width * height * 15;
  const candidates: TacticalRoute[] = [
    {destination: origin, path: [], costFt: 0},
    ...reachableRoutes(state, actorId, maximumBoardRouteFt),
  ];
  const route = candidates
    .filter((candidate) => footprintDistanceFt(candidate.destination, target, actorFootprint(state.world.actors[actorId], state), actorFootprint(state.world.actors[targetActorId], state)) <= Math.max(0, rangeFt))
    .filter(candidate=>spatialFacts({...state,tokens:{...state.tokens,[actorId]:{...state.tokens[actorId],position:candidate.destination}}},actorId,targetActorId,false).lineOfSight)
    .sort((left, right) => left.costFt - right.costFt
      || Math.hypot(left.destination.x - target.x, left.destination.y - target.y)
        - Math.hypot(right.destination.x - target.x, right.destination.y - target.y)
      || Math.hypot(left.destination.x - origin.x, left.destination.y - origin.y)
        - Math.hypot(right.destination.x - origin.x, right.destination.y - origin.y)
      || left.path.length - right.path.length
      || left.destination.y - right.destination.y
      || left.destination.x - right.destination.x)[0];
  if (!route) return null;
  return route.path.length ? combatMovementRoute(state, actorId, route.destination) : {
    ...route, available: true, availableFt, remainingFt: availableFt,
  };
}
