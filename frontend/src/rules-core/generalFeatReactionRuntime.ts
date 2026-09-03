import type { ActorState, RuleActionDefinition, SpatialFacts } from './domain';
import { ownsGeneralFeatCapability } from './generalFeatDamageRuntime';
import { parseWeaponProfile } from './weaponProfile';

export const DEFENSIVE_DUELIST_CAPABILITY = 'general_feat.defensive_duelist';
export const GRAPPLER_CAPABILITY = 'general_feat.grappler';
export const SHIELD_MASTER_CAPABILITY = 'general_feat.shield_master';
export const SENTINEL_CAPABILITY = 'general_feat.sentinel';
export const CHARGER_CAPABILITY = 'general_feat.charger';

function actorCard(actor: ActorState, cardId: string | null | undefined) {
  if (!cardId) return undefined;
  return actor.character.equippedCards?.find((card) => card.id === cardId)
    ?? actor.character.knownCards?.find((card) => card.id === cardId);
}

export function actorHoldsShieldForFeat(actor: ActorState): boolean {
  return (['main_hand', 'off_hand'] as const).some((slot) => {
    const card = actorCard(actor, actor.runtime.equipment[slot]);
    return card?.type === 'shield' || card?.defense_type === 'shield';
  });
}

export function actorWieldsFinesseWeapon(actor: ActorState): boolean {
  return (['main_hand', 'off_hand'] as const).some((slot) => {
    const card = actorCard(actor, actor.runtime.equipment[slot]);
    if (!card || card.type !== 'weapon') return false;
    const parsed = parseWeaponProfile(card);
    return parsed.valid && parsed.profile.properties.includes('finesse');
  });
}

export function actionHasMeleeAttackRoll(action: RuleActionDefinition): boolean {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Array<Record<string, unknown>>
    : [];
  return effects.some((effect) => (
    effect.resolution === 'attack_roll'
    && typeof effect.attack_kind === 'string'
    && effect.attack_kind.includes('melee')
  ));
}

/**
 * Defensive Duelist is a hit reaction, but it is offered only for a melee
 * attack while the defender still owns the feat and wields a Finesse weapon.
 * All inputs come from the canonical actor/action and persisted spatial facts.
 */
export function defensiveDuelistReactionEligible(input: {
  defender: ActorState;
  incomingAction: RuleActionDefinition;
  facts: SpatialFacts;
}): boolean {
  return ownsGeneralFeatCapability(input.defender, DEFENSIVE_DUELIST_CAPABILITY)
    && actorWieldsFinesseWeapon(input.defender)
    && actionHasMeleeAttackRoll(input.incomingAction)
    && input.facts.distanceFt <= 5;
}

/** A tiny source-owned passive used only for attacks against the creature the
 * owner is currently grappling. The grapple relation remains authoritative. */
export function grapplerAttackAdvantagePassive(sourceEntityIds: readonly string[]) {
  return {
    id: 'runtime:general-feat:grappler-advantage',
    name: 'Борец: преимущество по захваченной цели',
    sourceEntityIds: [...sourceEntityIds],
    activation: { mode: 'passive' },
    effects: [{ resolution: 'auto', result: [{
      kind: 'modifier', op: 'advantage',
      applies_to: { roll: 'attack' },
    }] }],
  };
}

export function actorOwnsGrappler(actor: ActorState): boolean {
  return ownsGeneralFeatCapability(actor, GRAPPLER_CAPABILITY);
}

export function actorOwnsShieldMaster(actor: ActorState): boolean {
  return ownsGeneralFeatCapability(actor, SHIELD_MASTER_CAPABILITY);
}

export function actorOwnsSentinel(actor: ActorState): boolean {
  return ownsGeneralFeatCapability(actor, SENTINEL_CAPABILITY);
}

export function actorOwnsCharger(actor: ActorState): boolean {
  return ownsGeneralFeatCapability(actor, CHARGER_CAPABILITY);
}

export function shieldMasterBashEligible(input: {
  actor: ActorState;
  sourceAction: RuleActionDefinition;
  targetDistanceFt: number;
}): boolean {
  return actorOwnsShieldMaster(input.actor)
    && actorHoldsShieldForFeat(input.actor)
    && actionHasMeleeAttackRoll(input.sourceAction)
    && input.targetDistanceFt <= 5;
}

/** Validate Charger's 10-foot straight approach from persisted board facts. */
export function chargerApproachEligible(input: {
  actor: ActorState;
  movement: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    distanceFt: number;
    round: number;
  } | undefined;
  actorPosition: { x: number; y: number } | undefined;
  targetPosition: { x: number; y: number } | undefined;
  round: number;
  distance: (left: { x: number; y: number }, right: { x: number; y: number }) => number;
}): boolean {
  const { movement, actorPosition, targetPosition } = input;
  if (!actorOwnsCharger(input.actor) || !movement || !actorPosition || !targetPosition
    || movement.round !== input.round || movement.distanceFt < 10
    || movement.to.x !== actorPosition.x || movement.to.y !== actorPosition.y
    || input.distance(movement.to, targetPosition) > 5
    || input.distance(movement.from, targetPosition) <= input.distance(movement.to, targetPosition)) {
    return false;
  }
  const moveX = movement.to.x - movement.from.x;
  const moveY = movement.to.y - movement.from.y;
  const targetX = targetPosition.x - movement.from.x;
  const targetY = targetPosition.y - movement.from.y;
  return moveX * targetY - moveY * targetX === 0
    && moveX * targetX + moveY * targetY > 0;
}
