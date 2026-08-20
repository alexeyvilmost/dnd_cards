import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-complex-fighting-styles.v1.json';
import { validateMechanics } from '../engine/validateMechanics';
import { bindDeclarativeFightingStyleProjection } from './fightingStyles';
import {
  resolveInterceptionReaction,
  resolveTurnStartGrappleDamage,
  resolveUnarmedDamageProfile,
  type InterceptionFacts,
} from './fightingStyleComplexPrimitives';

type Dict = Record<string, unknown>;

const byCard = new Map(definitions.map((definition) => [
  definition.card_number,
  definition.mechanics as Dict,
]));

function required(cardNumber: string): Dict {
  const mechanics = byCard.get(cardNumber);
  if (!mechanics) throw new Error(`Missing ${cardNumber}`);
  return mechanics;
}

const INTERCEPTION_FACTS: InterceptionFacts = {
  interceptorActorId: 'fighter',
  attackerActorId: 'goblin',
  targetActorId: 'wizard',
  attackHit: true,
  interceptorCanSeeAttacker: true,
  interceptorDistanceToTargetFt: 5,
  interceptorHoldingShieldOrSimpleOrMartialWeapon: true,
  interceptorReactionAvailable: true,
  proficiencyBonus: 2,
  incomingDamage: 9,
};

describe('mini-MVP complex Fighting Style primitives', () => {
  it('pins both remaining styles as schema-valid executable data', () => {
    expect(definitions.map((definition) => definition.card_number)).toEqual([
      'fs_interception', 'fs_unarmed',
    ]);
    for (const definition of definitions) {
      expect(validateMechanics(definition.mechanics as Dict, {
        id: definition.card_number,
        name: definition.name,
        kind: 'passive_effect',
      })).toMatchObject({ valid: true, errors: [] });
      expect(JSON.stringify(definition.mechanics)).not.toContain('"kind":"narrative"');
    }
  });

  it('binds behavior from declarations and relations instead of entity ids', () => {
    const bind = (definition: typeof definitions[number]) => bindDeclarativeFightingStyleProjection({
      featEntityId: `feat:${definition.feat_card_number}`,
      featCardNumber: definition.feat_card_number,
      relatedEffectEntityIds: [`effect:${definition.card_number}`],
      effectEntityId: `effect:${definition.card_number}`,
      effectCardNumber: definition.card_number,
      effectMechanics: definition.mechanics,
    });
    expect(bind(definitions[0])).toMatchObject({
      styleId: 'interception',
      mode: 'reaction_capability',
      capabilityId: 'fighting_style.interception.reaction',
    });
    expect(bind(definitions[1])).toMatchObject({
      styleId: 'unarmed_fighting', mode: 'passive_feature',
    });
  });

  it('replaces only Unarmed Strike damage and selects d6/d8 from held equipment facts', () => {
    const unarmed = required('fs_unarmed');
    expect(resolveUnarmedDamageProfile([unarmed], { holdingWeaponOrShield: true }))
      .toMatchObject({ dice: '1d6', ability: 'str', damageType: 'bludgeoning' });
    expect(resolveUnarmedDamageProfile([unarmed], { holdingWeaponOrShield: false }))
      .toMatchObject({ dice: '1d8', ability: 'str', damageType: 'bludgeoning' });
    expect(resolveUnarmedDamageProfile([], { holdingWeaponOrShield: false })).toBeNull();
  });

  it('resolves the optional d4 only against one creature grappled by the source', () => {
    const input = {
      passives: [required('fs_unarmed')],
      sourceActorId: 'fighter',
      selectedCapabilityId: 'fighting_style.unarmed.turn_start_grapple_damage',
      selectedTargetActorId: 'goblin',
      grapples: [{ grapplerActorId: 'fighter', targetActorId: 'goblin' }],
      rng: () => 0.999,
    };
    expect(resolveTurnStartGrappleDamage(input)).toMatchObject({
      status: 'resolved', targetActorId: 'goblin', amount: 4,
      damageType: 'bludgeoning', dice: '1d4', values: [4],
    });
    expect(resolveTurnStartGrappleDamage({ ...input, selectedTargetActorId: 'wolf' }))
      .toEqual({ status: 'invalid_target' });
    expect(resolveTurnStartGrappleDamage({
      ...input, selectedCapabilityId: undefined, selectedTargetActorId: undefined,
    })).toEqual({ status: 'declined' });
  });

  it('spends Interception only for a legal hit and floors damage at zero', () => {
    const mechanics = required('fs_interception');
    expect(resolveInterceptionReaction({
      mechanics, facts: INTERCEPTION_FACTS, decision: 'use', rng: () => 0,
    })).toEqual({
      status: 'resolved',
      capabilityId: 'fighting_style.interception.reaction',
      reactionSpent: true,
      rolledReduction: 3,
      appliedReduction: 3,
      damageAfter: 6,
      diceValues: [1],
    });
    expect(resolveInterceptionReaction({
      mechanics,
      facts: { ...INTERCEPTION_FACTS, incomingDamage: 2 },
      decision: 'use',
      rng: () => 0.999,
    })).toMatchObject({
      status: 'resolved', rolledReduction: 12, appliedReduction: 2, damageAfter: 0,
    });
    expect(resolveInterceptionReaction({
      mechanics, facts: INTERCEPTION_FACTS, decision: 'decline', rng: () => 0,
    })).toEqual({ status: 'declined', reactionSpent: false, damageAfter: 9 });
  });

  it.each([
    ['attack_missed', { attackHit: false }],
    ['attacker_not_visible', { interceptorCanSeeAttacker: false }],
    ['target_out_of_range', { interceptorDistanceToTargetFt: 10 }],
    ['equipment_requirement_failed', { interceptorHoldingShieldOrSimpleOrMartialWeapon: false }],
    ['reaction_unavailable', { interceptorReactionAvailable: false }],
    ['invalid_participants', { targetActorId: 'fighter' }],
  ] as const)('rejects Interception when %s', (reason, patch) => {
    expect(resolveInterceptionReaction({
      mechanics: required('fs_interception'),
      facts: { ...INTERCEPTION_FACTS, ...patch },
      decision: 'use',
      rng: () => 0,
    })).toEqual({ status: 'rejected', reason, reactionSpent: false });
  });
});
