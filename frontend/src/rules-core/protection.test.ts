import { describe, expect, it } from 'vitest';
import {
  PROTECTION_2024_CAPABILITY_ID,
  PROTECTION_2024_MAX_DISTANCE_FT,
  advanceProtection2024Effect,
  getProtection2024Eligibility,
  protection2024EffectIssue,
  protection2024SourceIssue,
  resolveProtection2024AttackRoll,
  resolveProtection2024Reaction,
  type Protection2024CapabilitySource,
  type Protection2024Effect,
  type Protection2024ReactionFacts,
} from './protection';
import { PROTECTION_2024_SOURCE_ENTITY_IDS } from './testing/fightingStyleFixtures';

const SOURCE: Protection2024CapabilitySource = {
  ownerActorId: 'protector',
  capabilityId: PROTECTION_2024_CAPABILITY_ID,
  sourceEntityIds: [...PROTECTION_2024_SOURCE_ENTITY_IDS],
};

const ELIGIBLE_FACTS: Protection2024ReactionFacts = {
  factsSource: 'scenario',
  worldRevision: 12,
  attackId: 'attack-1',
  protectorActorId: 'protector',
  attackerActorId: 'attacker',
  targetActorId: 'target',
  attackRollStage: 'before_roll',
  protectorCanSeeAttacker: true,
  protectorHoldingShield: true,
  protectorReactionAvailable: true,
  protectorDistanceToTargetFt: 5,
};

function activatedEffect(): Protection2024Effect {
  const result = resolveProtection2024Reaction({
    decision: 'use', effectId: 'effect-1', source: SOURCE, facts: ELIGIBLE_FACTS,
  });
  if (result.status !== 'activated') throw new Error(`Expected activation, got ${result.status}`);
  return result.effect;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('D&D 2024 Fighting Style: Protection pure contract', () => {
  it('pins the micro-MVP capability, source entities, and exact 5-foot boundary', () => {
    expect(PROTECTION_2024_CAPABILITY_ID).toBe('fighting_style.protection.reaction');
    expect(PROTECTION_2024_MAX_DISTANCE_FT).toBe(5);
    expect(PROTECTION_2024_SOURCE_ENTITY_IDS).toEqual([
      'c061b389-be25-439b-b9fc-71cfa43e195b',
      'FEAT-0055',
      '48feb5da-5003-46b0-94b4-afa064182519',
      'fs_protection',
    ]);
  });

  it('opens only the pre-roll Reaction for a visible attack on another target within 5 feet', () => {
    expect(getProtection2024Eligibility(ELIGIBLE_FACTS)).toEqual({
      eligible: true, facts: ELIGIBLE_FACTS,
    });
    expect(getProtection2024Eligibility({
      ...ELIGIBLE_FACTS, protectorDistanceToTargetFt: 0,
    })).toMatchObject({ eligible: true });

    const semanticRejections = [
      [{ attackRollStage: 'rolled' }, 'wrong_timing'],
      [{ attackRollStage: 'resolved' }, 'wrong_timing'],
      [{ targetActorId: 'protector' }, 'target_is_protector'],
      [{ protectorCanSeeAttacker: false }, 'attacker_not_visible'],
      [{ protectorHoldingShield: false }, 'shield_not_held'],
      [{ protectorReactionAvailable: false }, 'reaction_unavailable'],
      [{ protectorDistanceToTargetFt: 5.000_001 }, 'target_out_of_range'],
    ] as const;
    for (const [patch, reason] of semanticRejections) {
      expect(getProtection2024Eligibility({ ...ELIGIBLE_FACTS, ...patch }))
        .toEqual({ eligible: false, reason });
    }
  });

  it('does not invent an ally relation or extra participant restriction absent from the PHB rule', () => {
    expect(getProtection2024Eligibility({
      ...ELIGIBLE_FACTS,
      attackerActorId: ELIGIBLE_FACTS.protectorActorId,
    })).toMatchObject({ eligible: true });
    expect(getProtection2024Eligibility({
      ...ELIGIBLE_FACTS,
      attackerActorId: ELIGIBLE_FACTS.targetActorId,
    })).toMatchObject({ eligible: true });
  });

  it('fails closed for every malformed trigger fact instead of opening a Reaction', () => {
    const malformed: unknown[] = [
      null,
      [],
      { ...ELIGIBLE_FACTS, factsSource: 1 },
      { ...ELIGIBLE_FACTS, factsSource: 'forged' },
      { ...ELIGIBLE_FACTS, worldRevision: 1.5 },
      { ...ELIGIBLE_FACTS, worldRevision: -1 },
      { ...ELIGIBLE_FACTS, attackId: 1 },
      { ...ELIGIBLE_FACTS, attackId: '' },
      { ...ELIGIBLE_FACTS, attackId: ' attack ' },
      { ...ELIGIBLE_FACTS, protectorActorId: '' },
      { ...ELIGIBLE_FACTS, attackerActorId: '' },
      { ...ELIGIBLE_FACTS, targetActorId: '' },
      { ...ELIGIBLE_FACTS, attackRollStage: 1 },
      { ...ELIGIBLE_FACTS, attackRollStage: 'forged' },
      { ...ELIGIBLE_FACTS, protectorCanSeeAttacker: 1 },
      { ...ELIGIBLE_FACTS, protectorHoldingShield: 1 },
      { ...ELIGIBLE_FACTS, protectorReactionAvailable: 1 },
      { ...ELIGIBLE_FACTS, protectorDistanceToTargetFt: '5' },
      { ...ELIGIBLE_FACTS, protectorDistanceToTargetFt: Number.NaN },
      { ...ELIGIBLE_FACTS, protectorDistanceToTargetFt: Number.POSITIVE_INFINITY },
      { ...ELIGIBLE_FACTS, protectorDistanceToTargetFt: -0.01 },
    ];
    for (const facts of malformed) {
      expect(getProtection2024Eligibility(facts)).toEqual({
        eligible: false, reason: 'invalid_facts',
      });
    }
  });

  it('validates mechanics-owned Protection provenance without content identifiers', () => {
    expect(protection2024SourceIssue(SOURCE, 'protector')).toBeNull();
    expect(protection2024SourceIssue({
      ...SOURCE,
      sourceEntityIds: ['custom-protection-effect', 'custom-protection-feat'],
    }, 'protector')).toBeNull();
    const invalidSources: Array<[unknown, string]> = [
      [null, 'protector'],
      [SOURCE, ''],
      [{ ...SOURCE, ownerActorId: 'other' }, 'protector'],
      [{ ...SOURCE, capabilityId: 'same-name-forgery' }, 'protector'],
      [{ ...SOURCE, sourceEntityIds: null }, 'protector'],
      [{ ...SOURCE, sourceEntityIds: [] }, 'protector'],
      [{ ...SOURCE, sourceEntityIds: ['', ...PROTECTION_2024_SOURCE_ENTITY_IDS.slice(1)] }, 'protector'],
      [{ ...SOURCE, sourceEntityIds: ['duplicate', 'duplicate'] }, 'protector'],
    ];
    for (const [source, protectorActorId] of invalidSources) {
      expect(protection2024SourceIssue(source, protectorActorId)).toBe('invalid_source');
    }
  });

  it('spends no resource on rejection or decline and emits one atomic Reaction cost on use', () => {
    expect(resolveProtection2024Reaction({
      decision: 'use', effectId: 'effect', source: SOURCE,
      facts: { ...ELIGIBLE_FACTS, protectorHoldingShield: false },
    })).toEqual({
      status: 'rejected', reason: 'shield_not_held', reactionCost: null, effect: null,
    });
    expect(resolveProtection2024Reaction({
      decision: 'use', effectId: 'effect', source: { ...SOURCE, ownerActorId: 'forged' },
      facts: ELIGIBLE_FACTS,
    })).toEqual({
      status: 'rejected', reason: 'invalid_source', reactionCost: null, effect: null,
    });
    expect(resolveProtection2024Reaction({
      decision: 'decline', source: SOURCE, facts: ELIGIBLE_FACTS,
    })).toEqual({ status: 'declined', reactionCost: null, effect: null });
    expect(resolveProtection2024Reaction({
      decision: 'forged' as 'use', effectId: 'effect', source: SOURCE, facts: ELIGIBLE_FACTS,
    })).toEqual({
      status: 'rejected', reason: 'invalid_decision', reactionCost: null, effect: null,
    });
    expect(resolveProtection2024Reaction({
      decision: 'use', effectId: ' effect ', source: SOURCE, facts: ELIGIBLE_FACTS,
    })).toEqual({
      status: 'rejected', reason: 'invalid_effect_id', reactionCost: null, effect: null,
    });

    const sourceEntityIds = [...SOURCE.sourceEntityIds] as [string, ...string[]];
    const source: Protection2024CapabilitySource = {
      ...jsonClone(SOURCE),
      sourceEntityIds,
    };
    const result = resolveProtection2024Reaction({
      decision: 'use', effectId: 'effect-1', source, facts: ELIGIBLE_FACTS,
    });
    expect(result).toEqual({
      status: 'activated',
      reactionCost: { actorId: 'protector', resource: 'reaction', spend: 1 },
      effect: {
        schemaVersion: 1,
        kind: 'fighting_style_protection_2024',
        id: 'effect-1',
        source: SOURCE,
        protectorActorId: 'protector',
        protectedTargetActorId: 'target',
        triggeringAttackerActorId: 'attacker',
        triggeringAttackId: 'attack-1',
        activatedAtWorldRevision: 12,
        expiry: { type: 'start_of_protector_next_turn', actorId: 'protector' },
      },
    });
    sourceEntityIds[0] = 'mutated-after-resolution';
    expect(result.status === 'activated' && result.effect.source.sourceEntityIds[0])
      .toBe(PROTECTION_2024_SOURCE_ENTITY_IDS[0]);
    expect(jsonClone(result)).toEqual(result);
  });

  it('validates every persisted effect field before allowing a modifier', () => {
    const effect = activatedEffect();
    expect(protection2024EffectIssue(effect)).toBeNull();
    const malformed: Array<[unknown, string]> = [
      [null, 'not_an_object'],
      [[], 'not_an_object'],
      [{ ...effect, schemaVersion: 2 }, 'invalid_schema'],
      [{ ...effect, kind: 'forged' }, 'invalid_kind'],
      [{ ...effect, id: '' }, 'invalid_effect_id'],
      [{ ...effect, triggeringAttackId: '' }, 'invalid_attack_id'],
      [{ ...effect, protectorActorId: '' }, 'invalid_actor_id'],
      [{ ...effect, protectedTargetActorId: '' }, 'invalid_actor_id'],
      [{ ...effect, triggeringAttackerActorId: '' }, 'invalid_actor_id'],
      [{ ...effect, protectedTargetActorId: 'protector' }, 'target_is_protector'],
      [{ ...effect, activatedAtWorldRevision: 1.5 }, 'invalid_activation_revision'],
      [{ ...effect, activatedAtWorldRevision: -1 }, 'invalid_activation_revision'],
      [{ ...effect, source: { ...SOURCE, ownerActorId: 'other' } }, 'invalid_source'],
      [{ ...effect, expiry: null }, 'invalid_expiry'],
      [{ ...effect, expiry: { ...effect.expiry, type: 'end_of_turn' } }, 'invalid_expiry'],
      [{ ...effect, expiry: { ...effect.expiry, actorId: 'other' } }, 'invalid_expiry'],
    ];
    for (const [candidate, issue] of malformed) {
      expect(protection2024EffectIssue(candidate)).toBe(issue);
    }
  });

  it('expires only at the protector next-turn start, never at another actor turn', () => {
    const effect = activatedEffect();
    const otherTurn = advanceProtection2024Effect(effect, {
      type: 'turn_started', factsSource: 'board', worldRevision: 13, actorId: 'attacker',
    });
    expect(otherTurn).toEqual({ status: 'active', reason: 'other_actor_turn', effect });
    expect(advanceProtection2024Effect(effect, {
      type: 'turn_started', factsSource: 'board', worldRevision: 14, actorId: 'protector',
    })).toEqual({
      status: 'ended', reason: 'protector_turn_started', effect: null,
    });
  });

  it('ends permanently when continuous proximity exceeds 5 feet and ignores unrelated observations', () => {
    const effect = activatedEffect();
    expect(advanceProtection2024Effect(effect, {
      type: 'distance_observed', factsSource: 'board', worldRevision: 13,
      protectorActorId: 'other', protectedTargetActorId: 'target', distanceFt: 100,
    })).toEqual({ status: 'active', reason: 'unrelated_distance', effect });
    expect(advanceProtection2024Effect(effect, {
      type: 'distance_observed', factsSource: 'board', worldRevision: 13,
      protectorActorId: 'protector', protectedTargetActorId: 'other', distanceFt: 100,
    })).toEqual({ status: 'active', reason: 'unrelated_distance', effect });
    expect(advanceProtection2024Effect(effect, {
      type: 'distance_observed', factsSource: 'board', worldRevision: 13,
      protectorActorId: 'protector', protectedTargetActorId: 'target', distanceFt: 5,
    })).toEqual({ status: 'active', reason: 'proximity_maintained', effect });
    const ended = advanceProtection2024Effect(effect, {
      type: 'distance_observed', factsSource: 'board', worldRevision: 14,
      protectorActorId: 'protector', protectedTargetActorId: 'target', distanceFt: 5.01,
    });
    expect(ended).toEqual({ status: 'ended', reason: 'proximity_broken', effect: null });
    expect(ended.effect).toBeNull();
  });

  it('rejects invalid, stale, or untrusted lifecycle observations fail-closed', () => {
    const effect = activatedEffect();
    expect(advanceProtection2024Effect({
      ...effect, kind: 'forged',
    } as unknown as Protection2024Effect, {
      type: 'turn_started', factsSource: 'board', worldRevision: 13, actorId: 'protector',
    })).toEqual({ status: 'rejected', reason: 'invalid_effect', effect: null });

    const malformed: unknown[] = [
      null,
      [],
      { type: 'turn_started', factsSource: 1, worldRevision: 13, actorId: 'protector' },
      { type: 'turn_started', factsSource: 'forged', worldRevision: 13, actorId: 'protector' },
      { type: 'turn_started', factsSource: 'board', worldRevision: 1.5, actorId: 'protector' },
      { type: 'forged', factsSource: 'board', worldRevision: 13, actorId: 'protector' },
      { type: 'turn_started', factsSource: 'board', worldRevision: 13, actorId: '' },
      {
        type: 'distance_observed', factsSource: 'board', worldRevision: 13,
        protectorActorId: '', protectedTargetActorId: 'target', distanceFt: 5,
      },
      {
        type: 'distance_observed', factsSource: 'board', worldRevision: 13,
        protectorActorId: 'protector', protectedTargetActorId: '', distanceFt: 5,
      },
      {
        type: 'distance_observed', factsSource: 'board', worldRevision: 13,
        protectorActorId: 'protector', protectedTargetActorId: 'target', distanceFt: Number.NaN,
      },
    ];
    for (const event of malformed) {
      expect(advanceProtection2024Effect(effect, event)).toEqual({
        status: 'rejected', reason: 'invalid_event', effect: null,
      });
    }
    expect(advanceProtection2024Effect(effect, {
      type: 'turn_started', factsSource: 'gm_ruling', worldRevision: 12, actorId: 'protector',
    })).toEqual({ status: 'rejected', reason: 'stale_event', effect: null });
  });

  it('imposes Disadvantage on the triggering and every later attack against the same target', () => {
    const effect = activatedEffect();
    const attackFacts = {
      factsSource: 'board' as const,
      worldRevision: 12,
      attackId: 'attack-1',
      targetActorId: 'target',
      attackRollStage: 'before_roll' as const,
      protectorDistanceToProtectedTargetFt: 5,
    };
    expect(resolveProtection2024AttackRoll(effect, attackFacts)).toEqual({
      status: 'active', reason: 'protected_target', imposeDisadvantage: true, effect,
    });
    expect(resolveProtection2024AttackRoll(effect, {
      ...attackFacts, worldRevision: 20, attackId: 'attack-from-another-creature',
      protectorDistanceToProtectedTargetFt: 0,
    })).toEqual({
      status: 'active', reason: 'protected_target', imposeDisadvantage: true, effect,
    });
    expect(resolveProtection2024AttackRoll(effect, {
      ...attackFacts, worldRevision: 21, attackId: 'other-target-attack', targetActorId: 'other',
    })).toEqual({
      status: 'active', reason: 'different_target', imposeDisadvantage: false, effect,
    });
  });

  it('cancels at an attack-roll backstop when proximity broke and never applies after rolling', () => {
    const effect = activatedEffect();
    const facts = {
      factsSource: 'board' as const,
      worldRevision: 13,
      attackId: 'attack-2',
      targetActorId: 'target',
      attackRollStage: 'before_roll' as const,
      protectorDistanceToProtectedTargetFt: 5.001,
    };
    expect(resolveProtection2024AttackRoll(effect, facts)).toEqual({
      status: 'ended', reason: 'proximity_broken', imposeDisadvantage: false, effect: null,
    });
    for (const attackRollStage of ['rolled', 'resolved'] as const) {
      expect(resolveProtection2024AttackRoll(effect, {
        ...facts, attackRollStage, protectorDistanceToProtectedTargetFt: 5,
      })).toEqual({
        status: 'rejected', reason: 'wrong_timing', imposeDisadvantage: false, effect: null,
      });
    }
  });

  it('rejects invalid or stale attack-roll facts without modifying a roll', () => {
    const effect = activatedEffect();
    const valid = {
      factsSource: 'scenario' as const,
      worldRevision: 13,
      attackId: 'attack-2',
      targetActorId: 'target',
      attackRollStage: 'before_roll' as const,
      protectorDistanceToProtectedTargetFt: 5,
    };
    expect(resolveProtection2024AttackRoll(
      {
        ...effect, source: { ...SOURCE, capabilityId: 'forged' },
      } as unknown as Protection2024Effect,
      valid,
    )).toEqual({
      status: 'rejected', reason: 'invalid_effect', imposeDisadvantage: false, effect: null,
    });
    const malformed: unknown[] = [
      null,
      [],
      { ...valid, factsSource: 1 },
      { ...valid, factsSource: 'forged' },
      { ...valid, worldRevision: 1.5 },
      { ...valid, attackId: '' },
      { ...valid, targetActorId: '' },
      { ...valid, attackRollStage: 1 },
      { ...valid, attackRollStage: 'forged' },
      { ...valid, protectorDistanceToProtectedTargetFt: '5' },
      { ...valid, protectorDistanceToProtectedTargetFt: Number.POSITIVE_INFINITY },
      { ...valid, protectorDistanceToProtectedTargetFt: -1 },
    ];
    for (const facts of malformed) {
      expect(resolveProtection2024AttackRoll(effect, facts)).toEqual({
        status: 'rejected', reason: 'invalid_facts', imposeDisadvantage: false, effect: null,
      });
    }
    expect(resolveProtection2024AttackRoll(effect, { ...valid, worldRevision: 11 })).toEqual({
      status: 'rejected', reason: 'stale_facts', imposeDisadvantage: false, effect: null,
    });
  });
});
