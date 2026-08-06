/**
 * Pure D&D 2024 Fighting Style: Protection contract.
 *
 * Local PHB rule source: officials/kb/phb-2024-en/pages/page-208.txt:69.
 * This module deliberately owns no world mutation. It validates an attack-roll
 * reaction window, produces a source-scoped effect/resource intent, and folds
 * the two lifecycle facts that can end the effect.
 */

export const PROTECTION_2024_CAPABILITY_ID = 'fighting_style.protection.reaction' as const;
export const PROTECTION_2024_MAX_DISTANCE_FT = 5 as const;

export type Protection2024FactSource = 'scenario' | 'board' | 'gm_ruling';
export type Protection2024AttackRollStage = 'before_roll' | 'rolled' | 'resolved';

export interface Protection2024ReactionFacts {
  factsSource: Protection2024FactSource;
  worldRevision: number;
  attackId: string;
  protectorActorId: string;
  attackerActorId: string;
  targetActorId: string;
  attackRollStage: Protection2024AttackRollStage;
  protectorCanSeeAttacker: boolean;
  protectorHoldingShield: boolean;
  protectorReactionAvailable: boolean;
  protectorDistanceToTargetFt: number;
}

export type Protection2024EligibilityRejection =
  | 'invalid_facts'
  | 'wrong_timing'
  | 'target_is_protector'
  | 'attacker_not_visible'
  | 'shield_not_held'
  | 'reaction_unavailable'
  | 'target_out_of_range';

export type Protection2024Eligibility =
  | { eligible: true; facts: Protection2024ReactionFacts }
  | { eligible: false; reason: Protection2024EligibilityRejection };

export interface Protection2024CapabilitySource {
  ownerActorId: string;
  capabilityId: typeof PROTECTION_2024_CAPABILITY_ID;
  sourceEntityIds: readonly [string, ...string[]];
}

export interface Protection2024Effect {
  schemaVersion: 1;
  kind: 'fighting_style_protection_2024';
  id: string;
  source: Protection2024CapabilitySource;
  protectorActorId: string;
  protectedTargetActorId: string;
  triggeringAttackerActorId: string;
  triggeringAttackId: string;
  activatedAtWorldRevision: number;
  expiry: {
    type: 'start_of_protector_next_turn';
    actorId: string;
  };
}

export type Protection2024ReactionDecision = 'use' | 'decline';

export type Protection2024ReactionResult =
  | {
    status: 'rejected';
    reason: Protection2024EligibilityRejection | 'invalid_source' | 'invalid_decision' | 'invalid_effect_id';
    reactionCost: null;
    effect: null;
  }
  | { status: 'declined'; reactionCost: null; effect: null }
  | {
    status: 'activated';
    reactionCost: { actorId: string; resource: 'reaction'; spend: 1 };
    effect: Protection2024Effect;
  };

export type Protection2024EffectIssue =
  | 'not_an_object'
  | 'invalid_schema'
  | 'invalid_kind'
  | 'invalid_effect_id'
  | 'invalid_attack_id'
  | 'invalid_actor_id'
  | 'target_is_protector'
  | 'invalid_activation_revision'
  | 'invalid_source'
  | 'invalid_expiry';

export type Protection2024LifecycleEvent =
  | {
    type: 'turn_started';
    factsSource: Protection2024FactSource;
    worldRevision: number;
    actorId: string;
  }
  | {
    type: 'distance_observed';
    factsSource: Protection2024FactSource;
    worldRevision: number;
    protectorActorId: string;
    protectedTargetActorId: string;
    distanceFt: number;
  };

export type Protection2024LifecycleResult =
  | {
    status: 'active';
    reason: 'other_actor_turn' | 'unrelated_distance' | 'proximity_maintained';
    effect: Protection2024Effect;
  }
  | {
    status: 'ended';
    reason: 'protector_turn_started' | 'proximity_broken';
    effect: null;
  }
  | {
    status: 'rejected';
    reason: 'invalid_effect' | 'invalid_event' | 'stale_event';
    effect: null;
  };

export interface Protection2024AttackRollFacts {
  factsSource: Protection2024FactSource;
  worldRevision: number;
  attackId: string;
  targetActorId: string;
  attackRollStage: Protection2024AttackRollStage;
  protectorDistanceToProtectedTargetFt: number;
}

export type Protection2024AttackRollResult =
  | {
    status: 'active';
    reason: 'protected_target' | 'different_target';
    imposeDisadvantage: boolean;
    effect: Protection2024Effect;
  }
  | {
    status: 'ended';
    reason: 'proximity_broken';
    imposeDisadvantage: false;
    effect: null;
  }
  | {
    status: 'rejected';
    reason: 'invalid_effect' | 'invalid_facts' | 'stale_facts' | 'wrong_timing';
    imposeDisadvantage: false;
    effect: null;
  };

type JsonRecord = Record<string, unknown>;

const FACT_SOURCES = new Set<Protection2024FactSource>(['scenario', 'board', 'gm_ruling']);
const ATTACK_ROLL_STAGES = new Set<Protection2024AttackRollStage>([
  'before_roll', 'rolled', 'resolved',
]);

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function validRevision(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validFactSource(value: unknown): value is Protection2024FactSource {
  return typeof value === 'string' && FACT_SOURCES.has(value as Protection2024FactSource);
}

function parseReactionFacts(value: unknown): Protection2024ReactionFacts | null {
  const facts = record(value);
  if (!facts
    || !validFactSource(facts.factsSource)
    || !validRevision(facts.worldRevision)
    || !stableId(facts.attackId)
    || !stableId(facts.protectorActorId)
    || !stableId(facts.attackerActorId)
    || !stableId(facts.targetActorId)
    || typeof facts.attackRollStage !== 'string'
    || !ATTACK_ROLL_STAGES.has(facts.attackRollStage as Protection2024AttackRollStage)
    || typeof facts.protectorCanSeeAttacker !== 'boolean'
    || typeof facts.protectorHoldingShield !== 'boolean'
    || typeof facts.protectorReactionAvailable !== 'boolean'
    || !validDistance(facts.protectorDistanceToTargetFt)) return null;
  return facts as unknown as Protection2024ReactionFacts;
}

/**
 * Validate the optional reaction window. Only the protected target must differ
 * from the protector; team relation is intentionally irrelevant to the PHB rule.
 */
export function getProtection2024Eligibility(value: unknown): Protection2024Eligibility {
  const facts = parseReactionFacts(value);
  if (!facts) return { eligible: false, reason: 'invalid_facts' };
  if (facts.attackRollStage !== 'before_roll') {
    return { eligible: false, reason: 'wrong_timing' };
  }
  if (facts.targetActorId === facts.protectorActorId) {
    return { eligible: false, reason: 'target_is_protector' };
  }
  if (!facts.protectorCanSeeAttacker) {
    return { eligible: false, reason: 'attacker_not_visible' };
  }
  if (!facts.protectorHoldingShield) {
    return { eligible: false, reason: 'shield_not_held' };
  }
  if (!facts.protectorReactionAvailable) {
    return { eligible: false, reason: 'reaction_unavailable' };
  }
  if (facts.protectorDistanceToTargetFt > PROTECTION_2024_MAX_DISTANCE_FT) {
    return { eligible: false, reason: 'target_out_of_range' };
  }
  return { eligible: true, facts };
}

function validSourceIds(value: unknown): value is readonly [string, ...string[]] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((sourceId) => stableId(sourceId))
    && new Set(value).size === value.length;
}

/**
 * Validate the mechanics-owned capability envelope. Content certification is
 * responsible for pinning concrete database entities; the runtime only needs
 * stable, non-ambiguous provenance and later compares it with actor ownership.
 */
export function protection2024SourceIssue(
  value: unknown,
  protectorActorId: string,
): 'invalid_source' | null {
  const source = record(value);
  if (!source
    || !stableId(protectorActorId)
    || source.ownerActorId !== protectorActorId
    || source.capabilityId !== PROTECTION_2024_CAPABILITY_ID
    || !validSourceIds(source.sourceEntityIds)) return 'invalid_source';
  return null;
}

/**
 * Resolve the optional Reaction without mutating resources. The caller commits
 * `reactionCost` and `effect` atomically before rolling the attack.
 */
export function resolveProtection2024Reaction(input: {
  decision: Protection2024ReactionDecision;
  effectId?: string;
  source: Protection2024CapabilitySource;
  facts: Protection2024ReactionFacts;
}): Protection2024ReactionResult {
  const eligibility = getProtection2024Eligibility(input.facts);
  if (!eligibility.eligible) {
    return {
      status: 'rejected', reason: eligibility.reason, reactionCost: null, effect: null,
    };
  }
  const facts = eligibility.facts;
  if (protection2024SourceIssue(input.source, facts.protectorActorId)) {
    return { status: 'rejected', reason: 'invalid_source', reactionCost: null, effect: null };
  }
  if (input.decision === 'decline') {
    return { status: 'declined', reactionCost: null, effect: null };
  }
  if (input.decision !== 'use') {
    return { status: 'rejected', reason: 'invalid_decision', reactionCost: null, effect: null };
  }
  if (!stableId(input.effectId)) {
    return { status: 'rejected', reason: 'invalid_effect_id', reactionCost: null, effect: null };
  }
  const source: Protection2024CapabilitySource = {
    ownerActorId: input.source.ownerActorId,
    capabilityId: PROTECTION_2024_CAPABILITY_ID,
    sourceEntityIds: [...input.source.sourceEntityIds] as [string, ...string[]],
  };
  return {
    status: 'activated',
    reactionCost: { actorId: facts.protectorActorId, resource: 'reaction', spend: 1 },
    effect: {
      schemaVersion: 1,
      kind: 'fighting_style_protection_2024',
      id: input.effectId,
      source,
      protectorActorId: facts.protectorActorId,
      protectedTargetActorId: facts.targetActorId,
      triggeringAttackerActorId: facts.attackerActorId,
      triggeringAttackId: facts.attackId,
      activatedAtWorldRevision: facts.worldRevision,
      expiry: {
        type: 'start_of_protector_next_turn',
        actorId: facts.protectorActorId,
      },
    },
  };
}

/** Validate persisted effect state before it can modify an attack roll. */
export function protection2024EffectIssue(value: unknown): Protection2024EffectIssue | null {
  const effect = record(value);
  if (!effect) return 'not_an_object';
  if (effect.schemaVersion !== 1) return 'invalid_schema';
  if (effect.kind !== 'fighting_style_protection_2024') return 'invalid_kind';
  if (!stableId(effect.id)) return 'invalid_effect_id';
  if (!stableId(effect.triggeringAttackId)) return 'invalid_attack_id';
  if (!stableId(effect.protectorActorId)
    || !stableId(effect.protectedTargetActorId)
    || !stableId(effect.triggeringAttackerActorId)) return 'invalid_actor_id';
  if (effect.protectedTargetActorId === effect.protectorActorId) return 'target_is_protector';
  if (!validRevision(effect.activatedAtWorldRevision)) return 'invalid_activation_revision';
  if (protection2024SourceIssue(effect.source, effect.protectorActorId)) return 'invalid_source';
  const expiry = record(effect.expiry);
  if (!expiry
    || expiry.type !== 'start_of_protector_next_turn'
    || expiry.actorId !== effect.protectorActorId) return 'invalid_expiry';
  return null;
}

function parseLifecycleEvent(value: unknown): Protection2024LifecycleEvent | null {
  const event = record(value);
  if (!event
    || !validFactSource(event.factsSource)
    || !validRevision(event.worldRevision)) return null;
  if (event.type === 'turn_started') {
    return stableId(event.actorId) ? event as unknown as Protection2024LifecycleEvent : null;
  }
  if (event.type === 'distance_observed') {
    return stableId(event.protectorActorId)
      && stableId(event.protectedTargetActorId)
      && validDistance(event.distanceFt)
      ? event as unknown as Protection2024LifecycleEvent
      : null;
  }
  return null;
}

/**
 * Fold a lifecycle observation. Once proximity is broken this returns no
 * effect, so later movement back inside 5 feet cannot resurrect Protection.
 */
export function advanceProtection2024Effect(
  effect: Protection2024Effect,
  value: unknown,
): Protection2024LifecycleResult {
  if (protection2024EffectIssue(effect)) {
    return { status: 'rejected', reason: 'invalid_effect', effect: null };
  }
  const event = parseLifecycleEvent(value);
  if (!event) return { status: 'rejected', reason: 'invalid_event', effect: null };
  if (event.worldRevision <= effect.activatedAtWorldRevision) {
    return { status: 'rejected', reason: 'stale_event', effect: null };
  }
  if (event.type === 'turn_started') {
    return event.actorId === effect.protectorActorId
      ? { status: 'ended', reason: 'protector_turn_started', effect: null }
      : { status: 'active', reason: 'other_actor_turn', effect };
  }
  if (event.protectorActorId !== effect.protectorActorId
    || event.protectedTargetActorId !== effect.protectedTargetActorId) {
    return { status: 'active', reason: 'unrelated_distance', effect };
  }
  return event.distanceFt > PROTECTION_2024_MAX_DISTANCE_FT
    ? { status: 'ended', reason: 'proximity_broken', effect: null }
    : { status: 'active', reason: 'proximity_maintained', effect };
}

function parseAttackRollFacts(value: unknown): Protection2024AttackRollFacts | null {
  const facts = record(value);
  if (!facts
    || !validFactSource(facts.factsSource)
    || !validRevision(facts.worldRevision)
    || !stableId(facts.attackId)
    || !stableId(facts.targetActorId)
    || typeof facts.attackRollStage !== 'string'
    || !ATTACK_ROLL_STAGES.has(facts.attackRollStage as Protection2024AttackRollStage)
    || !validDistance(facts.protectorDistanceToProtectedTargetFt)) return null;
  return facts as unknown as Protection2024AttackRollFacts;
}

/**
 * Query the persistent modifier immediately before an attack roll. The current
 * distance is included as a fail-closed backstop even when movement observations
 * are normally folded by `advanceProtection2024Effect`.
 */
export function resolveProtection2024AttackRoll(
  effect: Protection2024Effect,
  value: unknown,
): Protection2024AttackRollResult {
  if (protection2024EffectIssue(effect)) {
    return {
      status: 'rejected', reason: 'invalid_effect', imposeDisadvantage: false, effect: null,
    };
  }
  const facts = parseAttackRollFacts(value);
  if (!facts) {
    return {
      status: 'rejected', reason: 'invalid_facts', imposeDisadvantage: false, effect: null,
    };
  }
  if (facts.worldRevision < effect.activatedAtWorldRevision) {
    return {
      status: 'rejected', reason: 'stale_facts', imposeDisadvantage: false, effect: null,
    };
  }
  if (facts.attackRollStage !== 'before_roll') {
    return {
      status: 'rejected', reason: 'wrong_timing', imposeDisadvantage: false, effect: null,
    };
  }
  if (facts.protectorDistanceToProtectedTargetFt > PROTECTION_2024_MAX_DISTANCE_FT) {
    return {
      status: 'ended', reason: 'proximity_broken', imposeDisadvantage: false, effect: null,
    };
  }
  const applies = facts.targetActorId === effect.protectedTargetActorId;
  return {
    status: 'active',
    reason: applies ? 'protected_target' : 'different_target',
    imposeDisadvantage: applies,
    effect,
  };
}
