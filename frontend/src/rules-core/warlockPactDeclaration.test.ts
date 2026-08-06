import { describe, expect, it } from 'vitest';
import { bindWarlockPactDeclaration } from './warlockPactDeclaration';
import {
  PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
} from './testing/pactBladePolicyFixtures';

const pact = (primitive: Record<string, unknown>, effects: unknown[] = []) => ({
  activation: { mode: primitive.type === 'pact_blade_bond' ? 'active' : 'passive' },
  primitive,
  effects,
});

describe('declarative Warlock pact binding', () => {
  it('selects all three pact projections from primitive mechanics without entity identity', () => {
    expect(bindWarlockPactDeclaration(pact({
      type: 'pact_blade_bond', stateCapability: 'warlock.pact.blade',
      policy: PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
    }))).toMatchObject({
      kind: 'blade', capabilityId: 'warlock.pact.blade',
      lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
    });

    expect(bindWarlockPactDeclaration(pact({
      type: 'pact_chain_familiar',
      stateCapability: 'warlock.pact.chain',
      grantedSpell: 'renamed-find-familiar-reference',
    }, [{
      resolution: 'auto',
      result: [{ kind: 'grant_spell', value: 'renamed-find-familiar-reference' }],
    }]))).toMatchObject({
      kind: 'chain',
      grantedSpell: 'renamed-find-familiar-reference',
    });

    expect(bindWarlockPactDeclaration(pact({
      type: 'pact_tome_book',
      stateCapability: 'warlock.pact.tome',
      cantripChoiceId: 'renamed_cantrips',
      ritualChoiceId: 'renamed_rituals',
      bookObjectKind: 'book_of_shadows',
      slotResource: 'renamed_slot_pool',
    }, [
      { kind: 'choice', id: 'renamed_cantrips', context: 'in_play', resolution: 'on_rest' },
      { kind: 'choice', id: 'renamed_rituals', context: 'in_play', resolution: 'on_rest' },
    ]))).toMatchObject({
      kind: 'tome',
      cantripChoiceId: 'renamed_cantrips',
      ritualChoiceId: 'renamed_rituals',
      slotResource: 'renamed_slot_pool',
    });
  });

  it('fails closed on missing or contradictory DB-owned declarations', () => {
    expect(bindWarlockPactDeclaration({
      card_number: 'EFF-pact-chain',
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'grant_spell', value: 'spell' }] }],
    })).toBeNull();
    expect(bindWarlockPactDeclaration(pact({
      type: 'pact_chain_familiar',
      stateCapability: 'warlock.pact.blade',
      grantedSpell: 'spell',
    }, [{ resolution: 'auto', result: [{ kind: 'grant_spell', value: 'other-spell' }] }]))).toBeNull();
    expect(bindWarlockPactDeclaration(pact({
      type: 'pact_tome_book',
      stateCapability: 'warlock.pact.tome',
      cantripChoiceId: 'same',
      ritualChoiceId: 'same',
      bookObjectKind: 'book_of_shadows',
      slotResource: 'spell_slot_1',
    }, [{ kind: 'choice', id: 'same', context: 'in_play', resolution: 'on_rest' }]))).toBeNull();
    expect(bindWarlockPactDeclaration(pact({
      type: 'pact_blade_bond', stateCapability: 'warlock.pact.blade',
    }))).toBeNull();
    for (const policy of [
      { separation_distance_ft: 5, continuous_separation_seconds_to_end: 60 },
      { ...PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY, separation_distance_ft: -1 },
      { ...PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY, continuous_separation_seconds_to_end: 0 },
      { ...PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY, unknown: true },
    ]) {
      expect(bindWarlockPactDeclaration(pact({
        type: 'pact_blade_bond', stateCapability: 'warlock.pact.blade', policy,
      }))).toBeNull();
    }
  });
});
