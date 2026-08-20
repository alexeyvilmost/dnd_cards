import { describe, expect, it } from 'vitest';
import contentPatch from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import type { Action } from '../types';
import type { AssembledCharacter } from './assemble';
import type { RuntimeState } from '../mvp/contracts';
import {
  applySheetSlotRecoverySelections,
  collectSheetSlotRecoveryPolicies,
  slotRecoveryPickerState,
} from './sheetRestDecisions';

const recoveryPatch = contentPatch.mechanicsPatches.actions.find((row) => (
  row.cardNumber === 'ACTION-0001'
))!;

function assembly(): AssembledCharacter {
  const action = {
    id: recoveryPatch.entityId,
    card_number: recoveryPatch.cardNumber,
    name: 'Магическое восстановление',
    mechanics: recoveryPatch.mechanics,
  } as unknown as Action;
  return {
    actions: [{
      action,
      origin: { kind: 'class', id: 'wizard-class', name: 'Wizard' },
    }],
  } as unknown as AssembledCharacter;
}

function runtime(): RuntimeState {
  return {
    hp: { current: 8, max: 10, temp: 0 },
    resources: { magic_recovery_charge: 1, spell_slot_1: 0 },
    maxResources: { magic_recovery_charge: 1, spell_slot_1: 2 },
    equipment: {}, inventory: [], activeEffects: [],
  };
}

describe('sheet catalog rest decisions', () => {
  it('compiles the owned rest_decision action without class/name branching', () => {
    const [entry] = collectSheetSlotRecoveryPolicies(assembly());
    expect(entry.policy).toMatchObject({
      kind: 'slot_recovery',
      decisionType: 'arcane_recovery',
      charge: { resource: 'magic_recovery_charge', amount: 1 },
    });
    expect(slotRecoveryPickerState({
      state: runtime(),
      classLevels: { wizard: 1 },
      policy: entry.policy,
    })).toEqual({
      available: true,
      budget: 1,
      recoverableByLevel: { 1: 2 },
    });
  });

  it('applies the selected recovery through the shared primitive', () => {
    const policies = collectSheetSlotRecoveryPolicies(assembly());
    const result = applySheetSlotRecoverySelections({
      state: runtime(),
      classLevels: { wizard: 1 },
      policies,
      selections: { [policies[0].policy.decisionType]: [1] },
    });
    expect(result.state.resources).toMatchObject({
      magic_recovery_charge: 0,
      spell_slot_1: 1,
    });
    expect(result.events).toEqual([
      { type: 'resource_spent', resource: 'magic_recovery_charge', amount: 1, remaining: 0 },
      { type: 'resource_restored', resource: 'spell_slot_1', amount: 1, current: 1 },
    ]);
  });

  it('uses the scalable charge pool as slot-level budget rather than full-budget uses', () => {
    const policies = collectSheetSlotRecoveryPolicies(assembly());
    const highLevel = runtime();
    highLevel.resources = { magic_recovery_charge: 3, spell_slot_3: 0 };
    highLevel.maxResources = { magic_recovery_charge: 3, spell_slot_3: 1 };
    expect(slotRecoveryPickerState({
      state: highLevel,
      classLevels: { wizard: 6 },
      policy: policies[0].policy,
    })).toMatchObject({ available: true, budget: 3, recoverableByLevel: { 3: 1 } });
    const result = applySheetSlotRecoverySelections({
      state: highLevel,
      classLevels: { wizard: 6 },
      policies,
      selections: { arcane_recovery: [3] },
    });
    expect(result.state.resources).toMatchObject({
      magic_recovery_charge: 0,
      spell_slot_3: 1,
    });
    expect(result.events[0]).toMatchObject({ type: 'resource_spent', amount: 3, remaining: 0 });
  });
});
