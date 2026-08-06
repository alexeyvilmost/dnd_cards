import type { RuleActionDefinition } from './domain';

type Dict = Record<string, unknown>;

export const WEAPON_ATTACK_PRIMITIVE = 'weapon_attack' as const;
export const LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE = 'light_weapon_extra_attack' as const;

export type DeclaredWeaponActionPrimitive =
  | typeof WEAPON_ATTACK_PRIMITIVE
  | typeof LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE;

export type WeaponActionCostPhase = 'template' | 'bound';

export interface DeclaredWeaponActionPolicy {
  primitive: DeclaredWeaponActionPrimitive;
  hand: 'main' | 'off';
  timingResource: 'action' | 'bonus_action';
  activationCost: Dict[];
}

export type DeclaredWeaponActionPolicyResult =
  | { status: 'valid'; policy: DeclaredWeaponActionPolicy }
  | { status: 'invalid'; issue: string };

function object(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Dict
    : null;
}

function exactKeys(value: Dict, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const normalized = [...expected].sort();
  return actual.length === normalized.length
    && actual.every((key, index) => key === normalized[index]);
}

function weaponEffectIssue(action: RuleActionDefinition, hand: 'main' | 'off'): string | null {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects
    : [];
  if (effects.length !== 1) return `${action.id} must declare exactly one weapon attack effect`;
  const effect = object(effects[0]);
  if (!effect
    || effect.resolution !== 'attack_roll'
    || effect.vs !== 'ac'
    || effect.ability !== 'auto'
    || !['weapon_melee', 'weapon_ranged'].includes(String(effect.attack_kind ?? ''))) {
    return `${action.id} has an invalid weapon attack-roll declaration`;
  }
  const tags = Array.isArray(effect.tags) ? effect.tags.map(String) : [];
  const onHit = Array.isArray(effect.on_hit) ? effect.on_hit : [];
  if (onHit.length !== 1) return `${action.id} must declare exactly one weapon damage payload`;
  const damage = object(onHit[0]);
  if (!damage
    || damage.kind !== 'damage'
    || damage.dice !== 'weapon'
    || damage.type !== 'weapon'
    || damage.ability !== (hand === 'main' ? 'auto' : 'none')) {
    return `${action.id} has an invalid weapon damage declaration`;
  }
  if (hand === 'main' && tags.includes('off_hand')) {
    return `${action.id} main-hand primitive declares off_hand`;
  }
  if (hand === 'off' && (!tags.includes('off_hand') || !tags.includes('two_weapon'))) {
    return `${action.id} Light extra attack must declare off_hand and two_weapon`;
  }
  return null;
}

function targetingIssue(action: RuleActionDefinition): string | null {
  const targeting = action.targeting;
  if (!targeting
    || targeting.minTargets !== 1
    || targeting.maxTargets !== 1
    || !Number.isFinite(targeting.rangeFt)
    || targeting.rangeFt <= 0
    || typeof targeting.requiresLineOfSight !== 'boolean'
    || !targeting.allowedRelations.length) {
    return `${action.id} has an invalid single-target weapon contract`;
  }
  return null;
}

function activationCostIssue(input: {
  action: RuleActionDefinition;
  phase: WeaponActionCostPhase;
  timingResource: 'action' | 'bonus_action';
}): { issue: string } | { cost: Dict[] } {
  const activation = object(input.action.mechanics.activation);
  if (!activation || activation.mode !== 'active' || !Array.isArray(activation.cost)) {
    return { issue: `${input.action.id} requires an active activation cost` };
  }
  const cost = activation.cost.map(object);
  if (cost.some((entry) => !entry)) {
    return { issue: `${input.action.id} activation cost contains a malformed entry` };
  }
  const entries = cost as Dict[];
  if (entries.some((entry) => typeof entry.resource !== 'string' || !entry.resource.trim())) {
    return { issue: `${input.action.id} activation cost requires stable resource keys` };
  }
  const timing = entries.filter((entry) => entry.resource === input.timingResource);
  if (timing.length !== 1
    || (timing[0].amount !== undefined && timing[0].amount !== 1)
    || entries.some((entry) => (
      entry.resource === (input.timingResource === 'action' ? 'bonus_action' : 'action')
    ))) {
    return { issue: `${input.action.id} must declare exactly one ${input.timingResource} cost` };
  }
  const contextual = entries.filter((entry) => entry.resource === 'equipped_weapon_ammo');
  if (contextual.length > 1) {
    return { issue: `${input.action.id} declares ambiguous equipped_weapon_ammo costs` };
  }
  if (input.phase === 'template') {
    if (contextual.length !== 1) {
      return { issue: `${input.action.id} template requires exactly one equipped_weapon_ammo marker` };
    }
    if (!Number.isSafeInteger(contextual[0].amount)
      || Number(contextual[0].amount) <= 0
      || contextual[0].card_id !== undefined) {
      return { issue: `${input.action.id} equipped_weapon_ammo marker is invalid` };
    }
  } else {
    if (contextual.length) {
      return { issue: `${input.action.id} bound cost still contains equipped_weapon_ammo` };
    }
  }
  return { cost: entries.map((entry) => ({ ...entry })) };
}

/**
 * Strict data contract for the two catalog actions that enter the canonical
 * Attack-action state machine. The action id and display name are irrelevant:
 * behavior is selected only by the immutable primitive and mechanics markers.
 */
export function parseDeclaredWeaponActionPolicy(
  action: RuleActionDefinition,
  phase: WeaponActionCostPhase,
): DeclaredWeaponActionPolicyResult {
  if (action.kind !== 'nonSpell') {
    return { status: 'invalid', issue: `${action.id} weapon primitive must be non-spell` };
  }
  const primitive = object(action.mechanics.primitive);
  if (!primitive || !exactKeys(primitive, ['type'])) {
    return { status: 'invalid', issue: `${action.id} has an invalid weapon primitive declaration` };
  }
  const type = primitive.type;
  const policy = type === WEAPON_ATTACK_PRIMITIVE
    ? {
      primitive: WEAPON_ATTACK_PRIMITIVE,
      hand: 'main' as const,
      timingResource: 'action' as const,
    }
    : type === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE
      ? {
        primitive: LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
        hand: 'off' as const,
        timingResource: 'bonus_action' as const,
      }
      : null;
  if (!policy) {
    return { status: 'invalid', issue: `${action.id} is not a declared weapon action primitive` };
  }
  const effectIssue = weaponEffectIssue(action, policy.hand);
  if (effectIssue) return { status: 'invalid', issue: effectIssue };
  const targetIssue = targetingIssue(action);
  if (targetIssue) return { status: 'invalid', issue: targetIssue };
  const activation = activationCostIssue({
    action,
    phase,
    timingResource: policy.timingResource,
  });
  if ('issue' in activation) return { status: 'invalid', issue: activation.issue };
  return {
    status: 'valid',
    policy: {
      primitive: policy.primitive,
      hand: policy.hand,
      timingResource: policy.timingResource,
      activationCost: activation.cost,
    },
  };
}
