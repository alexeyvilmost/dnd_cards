import type {
  ActorState,
  PendingProtectionReactionResolution,
  WorldState,
} from './domain';
import {
  PROTECTION_2024_CAPABILITY_ID,
  getProtection2024Eligibility,
  protection2024EffectIssue,
  protection2024SourceIssue,
  type Protection2024Effect,
} from './protection';

type ActiveEffectEntry = ActorState['runtime']['activeEffects'][number];

export const PROTECTION_2024_EFFECT_NAME = 'Fighting Style: Protection' as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function protectionEffectEntry(effect: Protection2024Effect): ActiveEffectEntry {
  if (protection2024EffectIssue(effect)) throw new Error('Cannot persist an invalid Protection effect');
  return {
    id: effect.id,
    name: PROTECTION_2024_EFFECT_NAME,
    mechanics: clone(effect) as unknown as Record<string, unknown>,
    expiry: 'manual',
    source: PROTECTION_2024_CAPABILITY_ID,
    ownerId: effect.protectorActorId,
    sourceId: effect.protectorActorId,
  };
}

export function protectionEffectFromEntry(entry: ActiveEffectEntry): Protection2024Effect | null {
  const mechanics = entry.mechanics as Partial<Protection2024Effect>;
  if (mechanics.kind !== 'fighting_style_protection_2024') return null;
  return clone(entry.mechanics) as unknown as Protection2024Effect;
}

export function actorProtectionEffects(actor: ActorState): Protection2024Effect[] {
  return actor.runtime.activeEffects.flatMap((entry) => {
    const effect = protectionEffectFromEntry(entry);
    return effect ? [effect] : [];
  });
}

export function protectionEffectEntryIssue(
  entry: ActiveEffectEntry,
  owner: ActorState,
  world?: Pick<WorldState, 'actors'>,
): string | null {
  const effect = protectionEffectFromEntry(entry);
  if (!effect) return null;
  const issue = protection2024EffectIssue(effect);
  if (issue) return `Protection effect is invalid: ${issue}`;
  if (effect.protectorActorId !== owner.id
    || entry.id !== effect.id
    || !stableId(entry.name)
    || entry.source !== PROTECTION_2024_CAPABILITY_ID
    || entry.ownerId !== owner.id
    || entry.sourceId !== owner.id
    || entry.expiry !== 'manual'
    || entry.roundsLeft !== undefined) {
    return 'Protection active-effect envelope does not match its canonical effect';
  }
  const sources = owner.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID];
  if (protection2024SourceIssue({
    ownerActorId: owner.id,
    capabilityId: PROTECTION_2024_CAPABILITY_ID,
    sourceEntityIds: sources,
  }, owner.id)) {
    return 'Protection effect owner no longer has the exact source capability';
  }
  if (!same(sources, effect.source.sourceEntityIds)) {
    return 'Protection effect source differs from its actor capability';
  }
  if (world && (!world.actors[effect.protectedTargetActorId]
    || !world.actors[effect.triggeringAttackerActorId])) {
    return 'Protection effect references an actor outside its world';
  }
  return null;
}

/**
 * Resolve an equipped Shield from declarative item facts. The card number and
 * display name are content identity/presentation and must not grant behavior.
 */
export function actorHoldsCanonicalShield(actor: ActorState): boolean {
  const offHandId = actor.runtime.equipment.off_hand;
  if (!offHandId) return false;
  const card = [
    ...(actor.character.knownCards ?? []),
    ...(actor.character.equippedCards ?? []),
  ].find((candidate) => candidate.id === offHandId);
  return !!card
    && card.type === 'shield'
    && Array.isArray(card.properties)
    && card.properties.includes('shield');
}

function stableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function validCandidate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const facts = value as Record<string, unknown>;
  return ['scenario', 'board', 'gm_ruling'].includes(String(facts.factsSource))
    && Number.isInteger(facts.boardRevision) && Number(facts.boardRevision) >= 0
    && stableId(facts.protectorActorId)
    && typeof facts.protectorCanSeeAttacker === 'boolean'
    && typeof facts.protectorDistanceToTargetFt === 'number'
    && Number.isFinite(facts.protectorDistanceToTargetFt)
    && Number(facts.protectorDistanceToTargetFt) >= 0;
}

/** Validate the complete persisted pre-roll continuation without a process-local catalog. */
export function pendingProtectionResolutionIssue(
  value: unknown,
  world: Pick<WorldState, 'actors'>,
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Protection pending resolution must be an object';
  }
  const pending = value as PendingProtectionReactionResolution;
  if (pending.type !== 'protection_reaction'
    || !stableId(pending.id)
    || !stableId(pending.openedByCommandId)
    || !Number.isInteger(pending.openedAtRevision) || pending.openedAtRevision < 0
    || !Number.isInteger(pending.deadlineLogicalClock) || pending.deadlineLogicalClock < 0
    || !stableId(pending.sourceActorId)
    || !stableId(pending.targetActorId)
    || !stableId(pending.actionId)
    || !world.actors[pending.sourceActorId]
    || !world.actors[pending.targetActorId]) {
    return 'Protection pending resolution has invalid identity or actor references';
  }
  if (!['catalog', 'weapon_melee', 'weapon_ranged', 'unarmed_damage', 'familiar_attack']
    .includes(pending.attackContinuationKind)) {
    return 'Protection pending resolution has an invalid attack continuation kind';
  }
  const weaponContinuation = pending.attackContinuationKind === 'weapon_melee'
    || pending.attackContinuationKind === 'weapon_ranged';
  if ((weaponContinuation && pending.weaponHand !== 'main' && pending.weaponHand !== 'off')
    || (weaponContinuation && !stableId(pending.weaponCardId))
    || (!weaponContinuation
      && (pending.weaponHand !== undefined || pending.weaponCardId !== undefined))) {
    return 'Protection pending resolution has an invalid weapon continuation identity';
  }
  if (!Array.isArray(pending.preRollDisadvantageReasons)
    || pending.preRollDisadvantageReasons.some((reason) => !stableId(reason))
    || new Set(pending.preRollDisadvantageReasons).size !== pending.preRollDisadvantageReasons.length
    || !Array.isArray(pending.protectionCandidates)
    || pending.protectionCandidates.some((candidate) => !validCandidate(candidate))) {
    return 'Protection pending resolution has invalid pre-roll facts';
  }
  const candidateIds = pending.protectionCandidates.map((candidate) => candidate.protectorActorId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    return 'Protection pending resolution has duplicate protector facts';
  }
  const protectionOwners = Object.values(world.actors).filter((actor) => (
    actor.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID]
  )).map((actor) => actor.id).sort();
  if (!same([...candidateIds].sort(), protectionOwners)) {
    return 'Protection pending resolution does not cover every source-owned protector';
  }
  if (!Array.isArray(pending.remainingReactions)
    || pending.remainingReactions.some(({ protectorActorId, facts }) => (
      protectorActorId !== facts.protectorActorId
      || !world.actors[protectorActorId]
      || !getProtection2024Eligibility(facts).eligible
    ))) {
    return 'Protection pending resolution has invalid queued reactions';
  }
  const request = pending.request;
  const trigger = request?.trigger;
  const currentCandidate = request
    ? pending.protectionCandidates.find((candidate) => candidate.protectorActorId === request.actorId)
    : undefined;
  const currentProtector = request ? world.actors[request.actorId] : undefined;
  if (!request || request.type !== 'reaction' || !stableId(request.id)
    || !world.actors[request.actorId]
    || !currentCandidate
    || currentCandidate.boardRevision !== pending.facts.boardRevision
    || currentCandidate.protectorCanSeeAttacker !== true
    || currentCandidate.protectorDistanceToTargetFt > 5
    || request.actorId === pending.targetActorId
    || !currentProtector
    || !actorHoldsCanonicalShield(currentProtector)
    || (currentProtector.runtime.resources.reaction ?? 0) < 1
    || trigger?.type !== 'protection_before_attack'
    || trigger.sourceActorId !== pending.sourceActorId
    || trigger.targetActorId !== pending.targetActorId
    || trigger.actionId !== pending.actionId
    || trigger.attackId !== pending.openedByCommandId
    || request.options.length !== 1
    || request.options[0].actionId !== PROTECTION_2024_CAPABILITY_ID) {
    return 'Protection pending resolution request does not match its attack continuation';
  }
  const remainingIds = pending.remainingReactions.map((entry) => entry.protectorActorId);
  if (new Set(remainingIds).size !== remainingIds.length
    || remainingIds.includes(request.actorId)
    || pending.remainingReactions.some((entry) => {
      const candidate = pending.protectionCandidates.find((value) => (
        value.protectorActorId === entry.protectorActorId
      ));
      return !candidate
        || candidate.boardRevision !== pending.facts.boardRevision
        || entry.facts.attackId !== pending.openedByCommandId
        || entry.facts.attackerActorId !== pending.sourceActorId
        || entry.facts.targetActorId !== pending.targetActorId
        || entry.facts.attackRollStage !== 'before_roll'
        || entry.facts.factsSource !== candidate.factsSource
        || entry.facts.protectorCanSeeAttacker !== candidate.protectorCanSeeAttacker
        || entry.facts.protectorDistanceToTargetFt !== candidate.protectorDistanceToTargetFt;
    })) {
    return 'Protection pending resolution queue does not match its authoritative observations';
  }
  return null;
}
