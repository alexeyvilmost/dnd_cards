import {
  PACT_BLADE_STATE_CAPABILITY,
  PACT_CHAIN_STATE_CAPABILITY,
  PACT_TOME_STATE_CAPABILITY,
  type PactBladeLifecyclePolicy,
} from './warlockPacts';

export type WarlockPactDeclaration =
  | {
    kind: 'blade';
    primitiveType: 'pact_blade_bond';
    capabilityId: typeof PACT_BLADE_STATE_CAPABILITY;
    lifecyclePolicy: PactBladeLifecyclePolicy;
  }
  | {
    kind: 'chain';
    primitiveType: 'pact_chain_familiar';
    capabilityId: typeof PACT_CHAIN_STATE_CAPABILITY;
    grantedSpell: string;
  }
  | {
    kind: 'tome';
    primitiveType: 'pact_tome_book';
    capabilityId: typeof PACT_TOME_STATE_CAPABILITY;
    cantripChoiceId: string;
    ritualChoiceId: string;
    bookObjectKind: 'book_of_shadows';
    slotResource: string;
  };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    ? value
    : null;
}

function pactBladeLifecyclePolicy(value: unknown): PactBladeLifecyclePolicy | null {
  const policy = object(value);
  if (!policy) return null;
  const keys = Object.keys(policy).sort();
  const expected = [
    'continuous_separation_seconds_to_end',
    'end_on_owner_death',
    'separation_distance_ft',
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return null;
  }
  if (!Number.isFinite(policy.separation_distance_ft)
    || Number(policy.separation_distance_ft) < 0
    || !Number.isFinite(policy.continuous_separation_seconds_to_end)
    || Number(policy.continuous_separation_seconds_to_end) <= 0
    || typeof policy.end_on_owner_death !== 'boolean') return null;
  return {
    separationDistanceFt: Number(policy.separation_distance_ft),
    continuousSeparationSecondsToEnd: Number(policy.continuous_separation_seconds_to_end),
    endOnOwnerDeath: policy.end_on_owner_death,
  };
}

function hasGrantSpell(mechanics: Record<string, unknown>, reference: string): boolean {
  const effects = Array.isArray(mechanics.effects) ? mechanics.effects : [];
  const matches = effects.flatMap((effect) => {
    const row = object(effect);
    const result = Array.isArray(row?.result) ? row.result : [];
    return result.filter((payload) => {
      const grant = object(payload);
      return grant?.kind === 'grant_spell' && grant.value === reference;
    });
  });
  return matches.length === 1;
}

function hasRestChoice(mechanics: Record<string, unknown>, choiceId: string): boolean {
  const effects = Array.isArray(mechanics.effects) ? mechanics.effects : [];
  return effects.some((effect) => {
    const choice = object(effect);
    return choice?.kind === 'choice'
      && choice.id === choiceId
      && choice.context === 'in_play'
      && choice.resolution === 'on_rest';
  });
}

/**
 * Bind a Warlock pact projection exclusively from executable mechanics.
 * Entity IDs and card numbers remain provenance/selection data at the caller;
 * they never select Blade, Chain, or Tome behavior here.
 */
export function bindWarlockPactDeclaration(mechanicsValue: unknown): WarlockPactDeclaration | null {
  const mechanics = object(mechanicsValue);
  const primitive = object(mechanics?.primitive);
  const activation = object(mechanics?.activation);
  if (!mechanics || !primitive || !activation) return null;
  const capabilityId = nonBlank(primitive.stateCapability);

  if (primitive.type === 'pact_blade_bond') {
    const lifecyclePolicy = pactBladeLifecyclePolicy(primitive.policy);
    return activation.mode === 'active'
      && capabilityId === PACT_BLADE_STATE_CAPABILITY
      && lifecyclePolicy
      ? {
        kind: 'blade',
        primitiveType: 'pact_blade_bond',
        capabilityId: PACT_BLADE_STATE_CAPABILITY,
        lifecyclePolicy,
      }
      : null;
  }

  if (primitive.type === 'pact_chain_familiar') {
    const grantedSpell = nonBlank(primitive.grantedSpell);
    return activation.mode === 'passive'
      && capabilityId === PACT_CHAIN_STATE_CAPABILITY
      && grantedSpell
      && hasGrantSpell(mechanics, grantedSpell)
      ? {
        kind: 'chain',
        primitiveType: 'pact_chain_familiar',
        capabilityId: PACT_CHAIN_STATE_CAPABILITY,
        grantedSpell,
      }
      : null;
  }

  if (primitive.type === 'pact_tome_book') {
    const cantripChoiceId = nonBlank(primitive.cantripChoiceId);
    const ritualChoiceId = nonBlank(primitive.ritualChoiceId);
    const slotResource = nonBlank(primitive.slotResource);
    return activation.mode === 'passive'
      && capabilityId === PACT_TOME_STATE_CAPABILITY
      && cantripChoiceId
      && ritualChoiceId
      && cantripChoiceId !== ritualChoiceId
      && primitive.bookObjectKind === 'book_of_shadows'
      && slotResource
      && hasRestChoice(mechanics, cantripChoiceId)
      && hasRestChoice(mechanics, ritualChoiceId)
      ? {
        kind: 'tome',
        primitiveType: 'pact_tome_book',
        capabilityId: PACT_TOME_STATE_CAPABILITY,
        cantripChoiceId,
        ritualChoiceId,
        bookObjectKind: 'book_of_shadows',
        slotResource,
      }
      : null;
  }

  return null;
}
