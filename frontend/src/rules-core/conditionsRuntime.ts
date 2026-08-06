/**
 * Rules-core adapter for condition mechanics.
 *
 * It translates stable world actor identities and explicit board/GM facts into
 * the generic engine predicates declared by condition effects.  The adapter
 * contains no branches by condition id; adding a condition remains a content
 * operation as long as it is expressible with the registered primitives.
 */
import {
  activeConditionWorldFactEnabled,
  conditionCapabilityDenied,
  conditionThresholdOutcomes,
  projectedAgainst,
  type EvalContext,
  type ModifierQueryFacts,
} from './legacy/engineAdapter';
import type { ActorState, WorldState } from './domain';

export interface ConditionSourceObservation {
  sourceActorId: string;
  lineOfSight: boolean;
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
}

export interface ConditionDistanceObservation {
  actorAId: string;
  actorBId: string;
  distanceFt: number;
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
}

export interface ConditionVisibilityObservation {
  observerActorId: string;
  observedActorId: string;
  canSee: boolean;
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
}

export interface ConditionRollFacts {
  rollerActorId: string;
  rollTargetActorId?: string;
  sourceObservations?: readonly ConditionSourceObservation[];
  distanceObservations?: readonly ConditionDistanceObservation[];
  visibilityObservations?: readonly ConditionVisibilityObservation[];
}

function actor(world: WorldState, actorId: string): ActorState {
  const found = world.actors[actorId];
  if (!found) throw new Error(`Unknown condition interaction actor ${actorId}`);
  return found;
}

export function conditionEvalContext(facts: ConditionRollFacts): EvalContext {
  const distancesFt: Record<string, Record<string, number>> = {};
  for (const observation of facts.distanceObservations ?? []) {
    (distancesFt[observation.actorAId] ??= {})[observation.actorBId] = observation.distanceFt;
    (distancesFt[observation.actorBId] ??= {})[observation.actorAId] = observation.distanceFt;
  }
  const visibility: Record<string, Record<string, boolean>> = {};
  for (const observation of facts.visibilityObservations ?? []) {
    (visibility[observation.observerActorId] ??= {})[observation.observedActorId] = observation.canSee;
  }
  return {
    rollerActorId: facts.rollerActorId,
    ...(facts.rollTargetActorId ? { rollTargetActorId: facts.rollTargetActorId } : {}),
    conditionSourceFacts: Object.fromEntries(
      (facts.sourceObservations ?? []).map((observation) => [
        observation.sourceActorId,
        { lineOfSight: observation.lineOfSight },
      ]),
    ),
    distancesFt,
    visibility,
  };
}

/** Query a data-declared restriction such as Charmed harm denial or
 * Frightened voluntary approach denial. */
export function conditionInteractionDenied(input: {
  world: WorldState;
  actorId: string;
  targetActorId: string;
  capability: 'harm' | 'movement_toward_condition_source';
  sourceObservations?: readonly ConditionSourceObservation[];
  distanceObservations?: readonly ConditionDistanceObservation[];
  visibilityObservations?: readonly ConditionVisibilityObservation[];
}): boolean {
  const owner = actor(input.world, input.actorId);
  actor(input.world, input.targetActorId);
  return conditionCapabilityDenied(
    owner.runtime,
    input.capability,
    conditionEvalContext({
      rollerActorId: owner.id,
      rollTargetActorId: input.targetActorId,
      sourceObservations: input.sourceObservations,
      distanceObservations: input.distanceObservations,
      visibilityObservations: input.visibilityObservations,
    }),
    owner.passives ?? [],
  );
}

/** Enforce sight-related condition facts for an action whose content declares
 * that its target must be seen. Condition ids are deliberately absent here:
 * both the observer restriction and target concealment are mechanics
 * primitives supplied by condition data. */
export function conditionTargetingSightIssue(input: {
  world: WorldState;
  sourceActorId: string;
  targetActorId: string;
  requiresSight: boolean;
  canSeeTarget?: boolean;
}): 'source_cannot_see' | 'target_unseen' | null {
  if (!input.requiresSight) return null;
  const source = actor(input.world, input.sourceActorId);
  const target = actor(input.world, input.targetActorId);
  if (activeConditionWorldFactEnabled(source.runtime, 'cannot_see')) {
    return 'source_cannot_see';
  }
  if (activeConditionWorldFactEnabled(
    target.runtime,
    'cannot_be_targeted_by_requires_sight_unless_seen',
  ) && input.canSeeTarget !== true) {
    return 'target_unseen';
  }
  return null;
}

/** Project target-owned condition mechanics onto a roller. Used for incoming
 * attacks and social checks without giving the client authority over outcomes. */
export function projectConditionRules(input: {
  world: WorldState;
  rollerActorId: string;
  targetActorId: string;
  roll: 'attack' | 'ability_check';
  attackRange?: 'melee' | 'ranged';
  filter?: ModifierQueryFacts;
  sourceObservations?: readonly ConditionSourceObservation[];
  distanceObservations?: readonly ConditionDistanceObservation[];
  visibilityObservations?: readonly ConditionVisibilityObservation[];
}) {
  const roller = actor(input.world, input.rollerActorId);
  const target = actor(input.world, input.targetActorId);
  return projectedAgainst(
    {
      id: target.id,
      ac: target.ac,
      characterContext: target.character,
      runtimeState: target.runtime,
      passives: target.passives,
      conditionImmunities: target.traits?.conditionImmunities,
    },
    input.roll,
    input.attackRange,
    conditionEvalContext({
      rollerActorId: roller.id,
      rollTargetActorId: target.id,
      sourceObservations: input.sourceObservations,
      distanceObservations: input.distanceObservations,
      visibilityObservations: input.visibilityObservations,
    }),
    input.filter,
  );
}

/** Machine-readable terminal facts. The command handler may translate these
 * into lifecycle events; this pure adapter makes the threshold replay-testable. */
export function terminalConditionFacts(world: WorldState): Array<{
  actorId: string;
  condition: string;
  level: number;
  outcome: 'death';
}> {
  return Object.values(world.actors).flatMap((owner) => (
    conditionThresholdOutcomes(owner.runtime).map((outcome) => ({
      actorId: owner.id,
      ...outcome,
    }))
  ));
}
