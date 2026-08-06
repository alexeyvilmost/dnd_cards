import type { RuntimeState } from './legacy/engineAdapter';

/**
 * Data-owned primitive for a rest choice that restores an indexed series of
 * resources (spell slots are one instance). No class or resource identity is
 * built into the interpreter.
 */
export interface SlotRecoveryRestDecisionPolicy {
  kind: 'slot_recovery';
  decisionType: string;
  rest: 'short_rest';
  capabilityId: string;
  levelSource: {
    kind: 'class_level';
    classId: string;
    minimum: number;
    maximum: number;
  };
  budget: {
    mode: 'ceil_divide_level';
    divisor: number;
  };
  slotResource: {
    prefix: string;
    minimumLevel: number;
    maximumLevel: number;
    restoreAmount: number;
  };
  charge: {
    resource: string;
    amount: number;
  };
  maximumPerRest: number;
}

export interface RestDecisionSelection {
  type: string;
  /** One entry per recovered indexed resource. Repeated levels are allowed. */
  slotLevels: number[];
}

/** Compatibility name for existing scenario authoring; execution is generic. */
export type ArcaneRecoveryDecision = RestDecisionSelection;

export type RestDecisionFailureCode =
  | 'RestDecisionInvalidLevelSource'
  | 'RestDecisionSelectionEmpty'
  | 'RestDecisionSlotLevelInvalid'
  | 'RestDecisionBudgetExceeded'
  | 'RestDecisionUnavailable'
  | 'RestDecisionSlotNotExpended';

export interface SlotRecoveryAllowed {
  status: 'allowed';
  state: RuntimeState;
  recoveredSlotLevels: number[];
  recoveryBudget: number;
  spentResource: {
    resource: string;
    amount: number;
    remaining: number;
  };
  restoredResources: Array<{
    resource: string;
    amount: number;
    current: number;
  }>;
}

export interface RestDecisionRejected {
  status: 'rejected';
  code: RestDecisionFailureCode;
  message: string;
}

export type SlotRecoveryResult = SlotRecoveryAllowed | RestDecisionRejected;

function rejected(
  code: RestDecisionFailureCode,
  message: string,
): RestDecisionRejected {
  return { status: 'rejected', code, message };
}

/** Apply one catalog-owned slot-recovery decision atomically. */
export function resolveSlotRecoveryRestDecision(input: {
  state: RuntimeState;
  classLevels?: Record<string, number>;
  policy: SlotRecoveryRestDecisionPolicy;
  decision: RestDecisionSelection;
}): SlotRecoveryResult {
  const sourceLevel = input.classLevels?.[input.policy.levelSource.classId] ?? 0;
  if (!Number.isInteger(sourceLevel)
    || sourceLevel < input.policy.levelSource.minimum
    || sourceLevel > input.policy.levelSource.maximum) {
    return rejected(
      'RestDecisionInvalidLevelSource',
      `${input.policy.decisionType} requires ${input.policy.levelSource.classId} level `
        + `${input.policy.levelSource.minimum}-${input.policy.levelSource.maximum}, got ${sourceLevel}`,
    );
  }

  if (input.decision.type !== input.policy.decisionType
    || !Array.isArray(input.decision.slotLevels)
    || input.decision.slotLevels.length === 0) {
    return rejected(
      'RestDecisionSelectionEmpty',
      `${input.policy.decisionType} must select at least one recoverable resource level`,
    );
  }

  const { minimumLevel, maximumLevel, prefix, restoreAmount } = input.policy.slotResource;
  if (input.decision.slotLevels.some((level) => (
    !Number.isInteger(level) || level < minimumLevel || level > maximumLevel
  ))) {
    return rejected(
      'RestDecisionSlotLevelInvalid',
      `${input.policy.decisionType} accepts levels ${minimumLevel}-${maximumLevel}`,
    );
  }

  const recoveryBudget = Math.ceil(sourceLevel / input.policy.budget.divisor);
  const selectedTotal = input.decision.slotLevels.reduce((sum, level) => sum + level, 0);
  if (selectedTotal > recoveryBudget) {
    return rejected(
      'RestDecisionBudgetExceeded',
      `Selected levels total ${selectedTotal}, exceeding the recovery budget ${recoveryBudget}`,
    );
  }

  const charge = input.policy.charge;
  if ((input.state.resources[charge.resource] ?? 0) < charge.amount) {
    return rejected(
      'RestDecisionUnavailable',
      `${input.policy.decisionType} has no remaining ${charge.resource}`,
    );
  }

  const requestedByResource = new Map<string, number>();
  for (const level of input.decision.slotLevels) {
    const resource = `${prefix}${level}`;
    requestedByResource.set(resource, (requestedByResource.get(resource) ?? 0) + restoreAmount);
  }
  for (const [resource, amount] of requestedByResource) {
    const current = input.state.resources[resource] ?? 0;
    const maximum = input.state.maxResources[resource] ?? 0;
    if (maximum < 1 || current + amount > maximum) {
      return rejected(
        'RestDecisionSlotNotExpended',
        `${resource} does not have ${amount} recoverable expended unit(s)`,
      );
    }
  }

  const resources = { ...input.state.resources };
  resources[charge.resource] -= charge.amount;
  const restoredResources = [...requestedByResource].map(([resource, amount]) => {
    resources[resource] = (resources[resource] ?? 0) + amount;
    return { resource, amount, current: resources[resource] };
  });

  return {
    status: 'allowed',
    state: { ...input.state, resources },
    recoveredSlotLevels: [...input.decision.slotLevels].sort((left, right) => left - right),
    recoveryBudget,
    spentResource: {
      resource: charge.resource,
      amount: charge.amount,
      remaining: resources[charge.resource],
    },
    restoredResources,
  };
}
