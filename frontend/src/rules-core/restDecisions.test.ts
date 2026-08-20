import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import {
  resolveSlotRecoveryRestDecision,
  type SlotRecoveryRestDecisionPolicy,
} from './restDecisions';

const POLICY: SlotRecoveryRestDecisionPolicy = {
  kind: 'slot_recovery',
  decisionType: 'study_recovery',
  rest: 'short_rest',
  capabilityId: 'rest:study-recovery',
  levelSource: { kind: 'class_level', classId: 'scholar', minimum: 1, maximum: 20 },
  budget: { mode: 'ceil_divide_level', divisor: 2 },
  slotResource: {
    prefix: 'study_rank_',
    minimumLevel: 1,
    maximumLevel: 5,
    restoreAmount: 1,
  },
  charge: { resource: 'study_recovery_charge', amount: 1 },
  maximumPerRest: 1,
};

function runtime(input: {
  charge?: number;
  slots?: Record<number, { current: number; max: number }>;
} = {}): RuntimeState {
  const resources: Record<string, number> = {
    action: 1,
    study_recovery_charge: input.charge ?? 1,
  };
  const maxResources: Record<string, number> = {
    action: 1,
    study_recovery_charge: input.charge ?? 1,
  };
  for (const [level, slots] of Object.entries(input.slots ?? { 1: { current: 1, max: 2 } })) {
    resources[`study_rank_${level}`] = slots.current;
    maxResources[`study_rank_${level}`] = slots.max;
  }
  return {
    hp: { current: 6, max: 6, temp: 0 },
    resources,
    maxResources,
    equipment: {},
    inventory: [],
    activeEffects: [],
    firedThisTurn: [],
    firedThisRest: [],
  };
}

describe('generic catalog-owned slot recovery rest decision', () => {
  it('uses only policy-declared class and resource identities', () => {
    const before = runtime();
    const result = resolveSlotRecoveryRestDecision({
      state: before,
      classLevels: { scholar: 1 },
      policy: POLICY,
      decision: { type: 'study_recovery', slotLevels: [1] },
    });

    expect(result).toMatchObject({
      status: 'allowed',
      recoveryBudget: 1,
      recoveredSlotLevels: [1],
      spentResource: {
        resource: 'study_recovery_charge', amount: 1, remaining: 0,
      },
      restoredResources: [{ resource: 'study_rank_1', amount: 1, current: 2 }],
      state: { resources: { study_rank_1: 2, study_recovery_charge: 0 } },
    });
    expect(before.resources).toMatchObject({ study_rank_1: 1, study_recovery_charge: 1 });
  });

  it('supports multiple recovered resources within the declared rounded-up level budget', () => {
    const result = resolveSlotRecoveryRestDecision({
      state: runtime({ charge: 3, slots: { 1: { current: 1, max: 4 }, 2: { current: 1, max: 3 } } }),
      classLevels: { scholar: 6 },
      policy: POLICY,
      decision: { type: 'study_recovery', slotLevels: [2, 1] },
    });

    expect(result).toMatchObject({
      status: 'allowed',
      recoveryBudget: 3,
      recoveredSlotLevels: [1, 2],
      spentResource: { amount: 3, remaining: 0 },
      state: { resources: { study_rank_1: 2, study_rank_2: 2, study_recovery_charge: 0 } },
    });
  });

  it('prices recovery by selected level total instead of multiplying the level budget by uses', () => {
    const result = resolveSlotRecoveryRestDecision({
      state: runtime({ charge: 2, slots: { 3: { current: 0, max: 1 } } }),
      classLevels: { scholar: 6 },
      policy: POLICY,
      decision: { type: 'study_recovery', slotLevels: [3] },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'RestDecisionUnavailable' });
  });

  it.each([
    { label: 'wrong or missing source level', level: 0, slots: [1], code: 'RestDecisionInvalidLevelSource' },
    { label: 'empty choice', level: 1, slots: [] as number[], code: 'RestDecisionSelectionEmpty' },
    { label: 'level outside declared series', level: 20, slots: [6], code: 'RestDecisionSlotLevelInvalid' },
    { label: 'selection above budget', level: 3, slots: [2, 1], code: 'RestDecisionBudgetExceeded' },
  ])('rejects $label before mutating state', ({ level, slots, code }) => {
    const before = runtime({ slots: { 1: { current: 0, max: 4 }, 2: { current: 0, max: 3 }, 6: { current: 0, max: 1 } } });
    const snapshot = JSON.stringify(before);
    const result = resolveSlotRecoveryRestDecision({
      state: before,
      classLevels: { scholar: level },
      policy: POLICY,
      decision: { type: 'study_recovery', slotLevels: slots },
    });

    expect(result).toMatchObject({ status: 'rejected', code });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('rejects an unavailable charge and full or absent target resources atomically', () => {
    const resolve = (state: RuntimeState) => resolveSlotRecoveryRestDecision({
      state,
      classLevels: { scholar: 1 },
      policy: POLICY,
      decision: { type: 'study_recovery', slotLevels: [1] },
    });
    expect(resolve(runtime({ charge: 0 })))
      .toMatchObject({ status: 'rejected', code: 'RestDecisionUnavailable' });
    expect(resolve(runtime({ slots: { 1: { current: 2, max: 2 } } })))
      .toMatchObject({ status: 'rejected', code: 'RestDecisionSlotNotExpended' });
    expect(resolve(runtime({ slots: {} })))
      .toMatchObject({ status: 'rejected', code: 'RestDecisionSlotNotExpended' });
  });
});
