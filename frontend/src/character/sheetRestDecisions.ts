import type { AssembledCharacter } from './assemble';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';
import {
  resolveSlotRecoveryRestDecision,
  type SlotRecoveryRestDecisionPolicy,
} from '../rules-core/restDecisions';

export interface SheetSlotRecoveryPolicy {
  actionId: string;
  name: string;
  policy: SlotRecoveryRestDecisionPolicy;
}

/** Compile only owned, catalog-declared rest actions; ordinary active actions are irrelevant. */
export function collectSheetSlotRecoveryPolicies(
  assembled: Pick<AssembledCharacter, 'actions'>,
): SheetSlotRecoveryPolicy[] {
  const policies = assembled.actions.flatMap(({ action }) => {
    const activation = action.mechanics?.activation as Record<string, unknown> | undefined;
    if (activation?.mode !== 'rest_decision') return [];
    const projected = projectRuleAction(action);
    return projected.restDecision?.rest === 'short_rest'
      ? [{ actionId: projected.id, name: projected.name, policy: projected.restDecision }]
      : [];
  });
  const decisionTypes = policies.map(({ policy }) => policy.decisionType);
  if (new Set(decisionTypes).size !== decisionTypes.length) {
    throw new Error('Owned short-rest decision types must be unambiguous');
  }
  return policies.sort((left, right) => (
    left.name.localeCompare(right.name) || left.actionId.localeCompare(right.actionId)
  ));
}

export interface SlotRecoveryPickerState {
  available: boolean;
  budget: number;
  recoverableByLevel: Record<number, number>;
}

export function slotRecoveryPickerState(input: {
  state: RuntimeState;
  classLevels?: Readonly<Record<string, number>>;
  policy: SlotRecoveryRestDecisionPolicy;
}): SlotRecoveryPickerState {
  const level = input.classLevels?.[input.policy.levelSource.classId] ?? 0;
  const validLevel = Number.isInteger(level)
    && level >= input.policy.levelSource.minimum
    && level <= input.policy.levelSource.maximum;
  const levelBudget = validLevel ? Math.ceil(level / input.policy.budget.divisor) : 0;
  const charge = input.policy.charge;
  const chargeBudget = charge.amount > 0
    ? Math.floor((input.state.resources[charge.resource] ?? 0) / charge.amount)
    : 0;
  const budget = Math.min(levelBudget, chargeBudget);
  const recoverableByLevel: Record<number, number> = {};
  for (
    let slotLevel = input.policy.slotResource.minimumLevel;
    slotLevel <= input.policy.slotResource.maximumLevel;
    slotLevel += 1
  ) {
    const resource = `${input.policy.slotResource.prefix}${slotLevel}`;
    const current = input.state.resources[resource] ?? 0;
    const maximum = input.state.maxResources[resource] ?? 0;
    const missing = Math.max(0, maximum - current);
    const units = Math.floor(missing / input.policy.slotResource.restoreAmount);
    if (units > 0 && slotLevel <= budget) recoverableByLevel[slotLevel] = units;
  }
  return {
    available: validLevel && budget > 0 && Object.keys(recoverableByLevel).length > 0,
    budget,
    recoverableByLevel,
  };
}

/** Apply UI selections through the same generic primitive used by TakeShortRest. */
export function applySheetSlotRecoverySelections(input: {
  state: RuntimeState;
  classLevels?: Record<string, number>;
  policies: readonly SheetSlotRecoveryPolicy[];
  selections: Readonly<Record<string, readonly number[]>>;
}): { state: RuntimeState; events: EngineEvent[] } {
  let state = input.state;
  const events: EngineEvent[] = [];
  for (const { policy } of input.policies) {
    const slotLevels = [...(input.selections[policy.decisionType] ?? [])];
    if (!slotLevels.length) continue;
    const result = resolveSlotRecoveryRestDecision({
      state,
      classLevels: input.classLevels,
      policy,
      decision: { type: policy.decisionType, slotLevels },
    });
    if (result.status === 'rejected') throw new Error(result.message);
    state = result.state;
    events.push({ type: 'resource_spent', ...result.spentResource });
    events.push(...result.restoredResources.map((restored) => ({
      type: 'resource_restored' as const,
      ...restored,
    })));
  }
  return { state, events };
}
