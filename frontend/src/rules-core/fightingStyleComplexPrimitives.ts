type Dict = Record<string, unknown>;

export interface UnarmedDamageProfile {
  dice: string;
  ability: 'str';
  damageType: string;
  source: string;
}

export interface GrappleRelationView {
  grapplerActorId: string;
  targetActorId: string;
}

export interface InterceptionFacts {
  interceptorActorId: string;
  attackerActorId: string;
  targetActorId: string;
  attackHit: boolean;
  interceptorCanSeeAttacker: boolean;
  interceptorDistanceToTargetFt: number;
  interceptorHoldingShieldOrSimpleOrMartialWeapon: boolean;
  interceptorReactionAvailable: boolean;
  proficiencyBonus: number;
  incomingDamage: number;
}

export type InterceptionRejectionReason =
  | 'invalid_definition'
  | 'invalid_facts'
  | 'attack_missed'
  | 'invalid_participants'
  | 'attacker_not_visible'
  | 'target_out_of_range'
  | 'equipment_requirement_failed'
  | 'reaction_unavailable';

interface DiceFormula {
  count: number;
  sides: number;
}

function dict(value: unknown): value is Dict {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function payloads(mechanics: unknown): Dict[] {
  if (!dict(mechanics) || !Array.isArray(mechanics.effects)) return [];
  return mechanics.effects.flatMap((effect) => (
    dict(effect) && Array.isArray(effect.result)
      ? effect.result.filter(dict)
      : []
  ));
}

function parsedDice(value: unknown): DiceFormula | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)d(\d+)$/u.exec(value.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || count > 100
    || !Number.isInteger(sides) || sides < 2 || sides > 1_000) return null;
  return { count, sides };
}

function rollDice(formula: DiceFormula, rng: () => number): { total: number; values: number[] } {
  const values = Array.from({ length: formula.count }, () => (
    Math.floor(Math.min(0.999999999, Math.max(0, rng())) * formula.sides) + 1
  ));
  return { total: values.reduce((sum, value) => sum + value, 0), values };
}

/**
 * Resolves a data-owned replacement for the system Unarmed Strike damage die.
 * Equipment qualification is supplied as an immutable fact by the caller; no
 * Fighting Style id or localized name selects behavior.
 */
export function resolveUnarmedDamageProfile(
  passives: readonly unknown[],
  facts: { holdingWeaponOrShield: boolean },
): UnarmedDamageProfile | null {
  const candidates = passives.flatMap((mechanics) => payloads(mechanics))
    .filter((payload) => payload.kind === 'unarmed_damage_profile');
  if (candidates.length !== 1) return null;
  const payload = candidates[0];
  const normalDice = parsedDice(payload.dice);
  const emptyHandsDice = parsedDice(payload.empty_hands_dice);
  const selected = facts.holdingWeaponOrShield ? normalDice : emptyHandsDice;
  if (!selected || payload.ability !== 'str'
    || typeof payload.damage_type !== 'string' || !payload.damage_type.trim()) return null;
  return {
    dice: `${selected.count}d${selected.sides}`,
    ability: 'str',
    damageType: payload.damage_type.trim(),
    source: typeof payload.source === 'string' && payload.source.trim()
      ? payload.source.trim()
      : 'Unarmed Strike damage profile',
  };
}

/**
 * Apply the data-owned Fighting Style profile to a catalog Unarmed Strike.
 * The action identity, activation cost, targeting, and any non-damage riders
 * remain unchanged; only primary damage payloads of structurally declared
 * unarmed attack rolls are replaced.
 */
export function applyUnarmedDamageProfileToAction<
  T extends { mechanics?: Record<string, unknown> | null },
>(
  action: T,
  passives: readonly unknown[],
  facts: { holdingWeaponOrShield: boolean },
): T {
  const profile = resolveUnarmedDamageProfile(passives, facts);
  const mechanics = dict(action.mechanics) ? action.mechanics : null;
  if (!profile || !mechanics || !Array.isArray(mechanics.effects)) return action;

  let changed = false;
  const effects = mechanics.effects.map((candidate) => {
    if (!dict(candidate)
      || candidate.resolution !== 'attack_roll'
      || candidate.attack_kind !== 'unarmed'
      || !Array.isArray(candidate.on_hit)) return candidate;
    let replaced = false;
    const onHit = candidate.on_hit.map((payload) => {
      if (replaced || !dict(payload) || payload.kind !== 'damage') return payload;
      replaced = true;
      changed = true;
      const { dice: _dice, ability: _ability, ...rest } = payload;
      return {
        ...rest,
        amount: `${profile.dice} + ${profile.ability}`,
        type: profile.damageType,
      };
    });
    return replaced ? { ...candidate, on_hit: onHit } : candidate;
  });
  return changed
    ? { ...action, mechanics: { ...mechanics, effects } }
    : action;
}

/**
 * Resolves the optional start-of-turn damage against one creature actually
 * grappled by the source. Returning `declined` for a missing target preserves
 * the player's "may" choice without manufacturing a pending target.
 */
export function resolveTurnStartGrappleDamage(input: {
  passives: readonly unknown[];
  sourceActorId: string;
  selectedCapabilityId?: string | null;
  selectedTargetActorId?: string | null;
  grapples: readonly GrappleRelationView[];
  rng: () => number;
}):
  | { status: 'unavailable' | 'declined' | 'invalid_capability' | 'invalid_target' }
  | {
    status: 'resolved';
    capabilityId: string;
    targetActorId: string;
    amount: number;
    damageType: string;
    dice: string;
    values: number[];
    source: string;
  } {
  const candidates = input.passives.flatMap((mechanics) => payloads(mechanics))
    .filter((payload) => payload.kind === 'turn_start_grapple_damage');
  if (candidates.length !== 1) return { status: 'unavailable' };
  if (!input.selectedCapabilityId && !input.selectedTargetActorId) return { status: 'declined' };
  const payload = candidates[0];
  const formula = parsedDice(payload.dice);
  if (!formula || typeof payload.capability_id !== 'string' || !payload.capability_id.trim()
    || typeof payload.damage_type !== 'string' || !payload.damage_type.trim()) {
    return { status: 'unavailable' };
  }
  if (input.selectedCapabilityId !== payload.capability_id) {
    return { status: 'invalid_capability' };
  }
  if (!input.selectedTargetActorId) return { status: 'invalid_target' };
  const eligible = input.grapples.some((grapple) => (
    grapple.grapplerActorId === input.sourceActorId
    && grapple.targetActorId === input.selectedTargetActorId
  ));
  if (!eligible) return { status: 'invalid_target' };
  const rolled = rollDice(formula, input.rng);
  return {
    status: 'resolved',
    capabilityId: payload.capability_id.trim(),
    targetActorId: input.selectedTargetActorId,
    amount: rolled.total,
    damageType: payload.damage_type.trim(),
    dice: `${formula.count}d${formula.sides}`,
    values: rolled.values,
    source: typeof payload.source === 'string' && payload.source.trim()
      ? payload.source.trim()
      : 'Turn-start grapple damage',
  };
}

function interceptionDefinition(mechanics: unknown): {
  capabilityId: string;
  dice: DiceFormula;
} | null {
  if (!dict(mechanics) || !dict(mechanics.fighting_style)
    || mechanics.fighting_style.mode !== 'reaction_capability'
    || typeof mechanics.fighting_style.capability_id !== 'string'
    || !Array.isArray(mechanics.capabilities)) return null;
  const capabilityId = mechanics.fighting_style.capability_id.trim();
  const capability = mechanics.capabilities.find((candidate) => (
    dict(candidate) && candidate.id === capabilityId
  ));
  if (!dict(capability) || capability.trigger !== 'other_target_hit'
    || !dict(capability.reduction) || capability.reduction.bonus !== 'prof') return null;
  const dice = parsedDice(capability.reduction.dice);
  return capabilityId && dice ? { capabilityId, dice } : null;
}

/**
 * Pure multi-actor damage-interception primitive. A board/controller supplies
 * observations; the primitive owns participant, visibility, range, equipment,
 * reaction, dice and damage-floor rules.
 */
export function resolveInterceptionReaction(input: {
  mechanics: unknown;
  facts: InterceptionFacts;
  decision: 'use' | 'decline';
  rng: () => number;
}):
  | { status: 'declined'; reactionSpent: false; damageAfter: number }
  | { status: 'rejected'; reason: InterceptionRejectionReason; reactionSpent: false }
  | {
    status: 'resolved';
    capabilityId: string;
    reactionSpent: true;
    rolledReduction: number;
    appliedReduction: number;
    damageAfter: number;
    diceValues: number[];
  } {
  const definition = interceptionDefinition(input.mechanics);
  if (!definition) return { status: 'rejected', reason: 'invalid_definition', reactionSpent: false };
  const facts = input.facts;
  const ids = [facts.interceptorActorId, facts.attackerActorId, facts.targetActorId];
  if (ids.some((id) => typeof id !== 'string' || !id.trim())
    || !Number.isFinite(facts.interceptorDistanceToTargetFt)
    || facts.interceptorDistanceToTargetFt < 0
    || !Number.isInteger(facts.proficiencyBonus) || facts.proficiencyBonus < 1
    || !Number.isFinite(facts.incomingDamage) || facts.incomingDamage < 0) {
    return { status: 'rejected', reason: 'invalid_facts', reactionSpent: false };
  }
  if (!facts.attackHit) return { status: 'rejected', reason: 'attack_missed', reactionSpent: false };
  if (facts.interceptorActorId === facts.attackerActorId
    || facts.interceptorActorId === facts.targetActorId
    || facts.attackerActorId === facts.targetActorId) {
    return { status: 'rejected', reason: 'invalid_participants', reactionSpent: false };
  }
  if (!facts.interceptorCanSeeAttacker) {
    return { status: 'rejected', reason: 'attacker_not_visible', reactionSpent: false };
  }
  if (facts.interceptorDistanceToTargetFt > 5) {
    return { status: 'rejected', reason: 'target_out_of_range', reactionSpent: false };
  }
  if (!facts.interceptorHoldingShieldOrSimpleOrMartialWeapon) {
    return { status: 'rejected', reason: 'equipment_requirement_failed', reactionSpent: false };
  }
  if (!facts.interceptorReactionAvailable) {
    return { status: 'rejected', reason: 'reaction_unavailable', reactionSpent: false };
  }
  const incoming = Math.floor(facts.incomingDamage);
  if (input.decision === 'decline') {
    return { status: 'declined', reactionSpent: false, damageAfter: incoming };
  }
  const roll = rollDice(definition.dice, input.rng);
  const rolledReduction = roll.total + facts.proficiencyBonus;
  const appliedReduction = Math.min(incoming, rolledReduction);
  return {
    status: 'resolved',
    capabilityId: definition.capabilityId,
    reactionSpent: true,
    rolledReduction,
    appliedReduction,
    damageAfter: incoming - appliedReduction,
    diceValues: roll.values,
  };
}
