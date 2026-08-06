import { describe, expect, it } from 'vitest';
import {
  bindDeclarativeFightingStyleProjection,
} from './fightingStyles';
import {
  MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  archeryAttackRollBonus,
  bindMicroMvpFightingStyleProjection,
  createMicroMvpFightingStylePassiveMechanics,
  createMicroMvpProtectionCapabilityMechanics,
  defenseArmorClassBonus,
  protectionEffectAtTurnStart,
  protectionImposesDisadvantage,
  protectionReactionEligibility,
  PROTECTION_REACTION_CAPABILITY,
  type MicroMvpFightingStyleProjectionKind,
  type ProtectionEffectState,
  type ProtectionTriggerFacts,
  resolveProtectionReaction,
  twoWeaponFightingDamageBonus,
} from './testing/fightingStyleFixtures';

const PROTECTION_SOURCE_IDS = ['custom-guardian-effect', 'EFFECT-custom-guardian'] as const;

const ELIGIBLE_PROTECTION_FACTS: ProtectionTriggerFacts = {
  factsSource: 'scenario',
  boardRevision: 17,
  defenderActorId: 'fighter',
  attackerActorId: 'goblin',
  targetActorId: 'wizard',
  targetRelationToDefender: 'ally',
  defenderDistanceToTargetFt: 5,
  defenderCanSeeAttacker: true,
  defenderHasEquippedShield: true,
  defenderReactionAvailable: true,
};

function acceptedProtection(): ProtectionEffectState {
  const result = resolveProtectionReaction({
    triggeringAttackId: 'attack-1',
    sourceEntityIds: PROTECTION_SOURCE_IDS,
    facts: ELIGIBLE_PROTECTION_FACTS,
  });
  if (result.status !== 'accepted') throw new Error(`Unexpected rejection: ${result.reason}`);
  return result.effect;
}

describe('micro-MVP D&D 2024 Fighting Styles', () => {
  it('binds behavior from mechanics and relation without known card or UUID identities', () => {
    const passive = bindDeclarativeFightingStyleProjection({
      featEntityId: 'custom-feat-id',
      featCardNumber: 'custom-feat-card',
      relatedEffectEntityIds: ['custom-effect-id'],
      effectEntityId: 'custom-effect-id',
      effectCardNumber: 'custom-effect-card',
      effectMechanics: {
        fighting_style: { id: 'custom_style', mode: 'passive_modifier' },
        activation: { mode: 'passive' },
        effects: [{ resolution: 'auto', result: [{ kind: 'modifier', op: 'add', value: 3 }] }],
      },
    });
    expect(passive).toEqual({
      styleId: 'custom_style',
      mode: 'passive_modifier',
      sourceEntityIds: [
        'custom-feat-id', 'custom-feat-card', 'custom-effect-id', 'custom-effect-card',
      ],
    });

    const reaction = bindDeclarativeFightingStyleProjection({
      featEntityId: 'feat', featCardNumber: 'FEAT-custom',
      relatedEffectEntityIds: ['effect'], effectEntityId: 'effect', effectCardNumber: 'EFF-custom',
      effectMechanics: {
        fighting_style: {
          id: 'guardian', mode: 'reaction_capability', capability_id: 'style.guardian',
        },
        activation: { mode: 'reaction', cost: [{ resource: 'reaction' }] },
        capabilities: [{ id: 'style.guardian' }],
        effects: [],
      },
    });
    expect(reaction).toMatchObject({
      styleId: 'guardian', mode: 'reaction_capability', capabilityId: 'style.guardian',
    });
    expect(bindDeclarativeFightingStyleProjection({
      featEntityId: 'feat', featCardNumber: 'FEAT-custom',
      relatedEffectEntityIds: ['effect'], effectEntityId: 'effect', effectCardNumber: 'EFF-custom',
      effectMechanics: {
        fighting_style: {
          id: 'guardian', mode: 'reaction_capability', capability_id: 'style.guardian',
        },
        activation: { mode: 'reaction', cost: [{ resource: 'reaction', amount: 1 }] },
        capabilities: [{ id: 'style.guardian' }],
      },
    })).toMatchObject({
      styleId: 'guardian', mode: 'reaction_capability', capabilityId: 'style.guardian',
    });
    expect(bindDeclarativeFightingStyleProjection({
      featEntityId: 'feat', featCardNumber: 'FEAT-custom', relatedEffectEntityIds: [],
      effectEntityId: 'effect', effectCardNumber: 'EFF-custom',
      effectMechanics: {},
    })).toBeNull();
  });

  it('rejects incomplete declarative style mechanics without inferring behavior', () => {
    const reference = (effectMechanics: unknown) => ({
      featEntityId: 'feat',
      featCardNumber: 'FEAT-custom',
      relatedEffectEntityIds: ['effect'],
      effectEntityId: 'effect',
      effectCardNumber: 'EFF-custom',
      effectMechanics,
    });
    const passiveModifier = {
      fighting_style: { id: 'custom', mode: 'passive_modifier' },
      activation: { mode: 'passive' },
      effects: [{ result: [{ kind: 'modifier' }] }],
    };
    const reactionCapability = {
      fighting_style: {
        id: 'guardian', mode: 'reaction_capability', capability_id: 'style.guardian',
      },
      activation: { mode: 'reaction', cost: [{ resource: 'reaction' }] },
      capabilities: [{ id: 'style.guardian' }],
    };

    expect(bindDeclarativeFightingStyleProjection({
      ...reference(passiveModifier), featEntityId: ' ',
    })).toBeNull();
    for (const mechanics of [null, 7, [], {}]) {
      expect(bindDeclarativeFightingStyleProjection(reference(mechanics))).toBeNull();
    }
    for (const mechanics of [
      { ...passiveModifier, fighting_style: { id: 7, mode: 'passive_modifier' } },
      { ...passiveModifier, fighting_style: { id: ' ', mode: 'passive_modifier' } },
      { ...passiveModifier, fighting_style: { id: 'custom', mode: 'automatic' } },
      { ...passiveModifier, activation: { mode: 'active' } },
      { ...passiveModifier, effects: undefined },
      { ...passiveModifier, effects: [{}] },
      { ...passiveModifier, effects: [{ result: [{ kind: 'damage' }] }] },
      {
        ...passiveModifier,
        fighting_style: {
          ...passiveModifier.fighting_style,
          capability_id: 'style.unexpected',
        },
      },
      {
        ...reactionCapability,
        fighting_style: { ...reactionCapability.fighting_style, capability_id: 7 },
      },
      {
        ...reactionCapability,
        fighting_style: { ...reactionCapability.fighting_style, capability_id: ' ' },
      },
      { ...reactionCapability, activation: { mode: 'passive' } },
      { ...reactionCapability, activation: { mode: 'reaction' } },
      { ...reactionCapability, activation: { mode: 'reaction', cost: [{ resource: 'bonus_action' }] } },
      { ...reactionCapability, activation: { mode: 'reaction', cost: [{ resource: 'reaction', amount: 2 }] } },
      { ...reactionCapability, capabilities: undefined },
      { ...reactionCapability, capabilities: [{ id: 'style.other' }] },
      {
        ...reactionCapability,
        capabilities: [{ id: 'style.guardian', requirements: { resource: 'reaction' } }],
      },
    ]) {
      expect(bindDeclarativeFightingStyleProjection(reference(mechanics))).toBeNull();
    }
  });

  it('pins every style to the exact feat and effect entities in the production snapshot', () => {
    expect(MICRO_MVP_FIGHTING_STYLE_ENTITIES).toEqual({
      archery: {
        featCardNumber: 'FEAT-0063',
        featEntityId: 'bca8edf6-27ce-4399-8e34-bdadd59674b3',
        effectCardNumber: 'fs_archery',
        effectEntityId: '76acce68-ebbe-4cef-ba2c-3ca4042c3656',
        sourceEntityIds: [
          'bca8edf6-27ce-4399-8e34-bdadd59674b3', 'FEAT-0063',
          '76acce68-ebbe-4cef-ba2c-3ca4042c3656', 'fs_archery',
        ],
      },
      defense: {
        featCardNumber: 'FEAT-0056',
        featEntityId: '25896e04-0c1d-4917-97fc-7feef7f836e1',
        effectCardNumber: 'fs_defense',
        effectEntityId: '284c2459-dbe5-4ad5-9e06-c2417ab046a7',
        sourceEntityIds: [
          '25896e04-0c1d-4917-97fc-7feef7f836e1', 'FEAT-0056',
          '284c2459-dbe5-4ad5-9e06-c2417ab046a7', 'fs_defense',
        ],
      },
      twoWeaponFighting: {
        featCardNumber: 'FEAT-0061',
        featEntityId: '440e7209-1602-415e-a5bb-e8bf42b3f720',
        effectCardNumber: 'fs_two_weapon',
        effectEntityId: '1ea32433-e3d0-4ab9-a8c0-cd159af6534d',
        sourceEntityIds: [
          '440e7209-1602-415e-a5bb-e8bf42b3f720', 'FEAT-0061',
          '1ea32433-e3d0-4ab9-a8c0-cd159af6534d', 'fs_two_weapon',
        ],
      },
      protection: {
        featCardNumber: 'FEAT-0055',
        featEntityId: 'c061b389-be25-439b-b9fc-71cfa43e195b',
        effectCardNumber: 'fs_protection',
        effectEntityId: '48feb5da-5003-46b0-94b4-afa064182519',
        sourceEntityIds: [
          'c061b389-be25-439b-b9fc-71cfa43e195b', 'FEAT-0055',
          '48feb5da-5003-46b0-94b4-afa064182519', 'fs_protection',
        ],
      },
    });
  });

  it('binds only exact feat/effect identities and their declared relation to projection kinds', () => {
    const kinds = Object.keys(
      MICRO_MVP_FIGHTING_STYLE_ENTITIES,
    ) as MicroMvpFightingStyleProjectionKind[];
    for (const kind of kinds) {
      const entity = MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind];
      expect(bindMicroMvpFightingStyleProjection({
        featEntityId: entity.featEntityId,
        featCardNumber: entity.featCardNumber,
        relatedEffectEntityIds: [entity.effectEntityId],
        effectEntityId: entity.effectEntityId,
        effectCardNumber: entity.effectCardNumber,
      })).toEqual({ kind, sourceEntityIds: entity.sourceEntityIds });
    }

    const archery = MICRO_MVP_FIGHTING_STYLE_ENTITIES.archery;
    const exact = {
      featEntityId: archery.featEntityId,
      featCardNumber: archery.featCardNumber,
      relatedEffectEntityIds: [archery.effectEntityId],
      effectEntityId: archery.effectEntityId,
      effectCardNumber: archery.effectCardNumber,
    };
    expect(bindMicroMvpFightingStyleProjection({
      ...exact, featEntityId: 'stale-feat-id',
    })).toBeNull();
    expect(bindMicroMvpFightingStyleProjection({
      ...exact, featCardNumber: 'FEAT-stale',
    })).toBeNull();
    expect(bindMicroMvpFightingStyleProjection({
      ...exact, effectEntityId: 'stale-effect-id',
    })).toBeNull();
    expect(bindMicroMvpFightingStyleProjection({
      ...exact, effectCardNumber: 'fs_stale',
    })).toBeNull();
    expect(bindMicroMvpFightingStyleProjection({
      ...exact, relatedEffectEntityIds: [],
    })).toBeNull();
  });

  it('builds canonical legacy passives with exact provenance and keeps Protection out', () => {
    const mechanics = (kind: MicroMvpFightingStyleProjectionKind) => {
      const sourceEntityIds = MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind].sourceEntityIds;
      return createMicroMvpFightingStylePassiveMechanics({ kind, sourceEntityIds });
    };
    expect(mechanics('archery')).toEqual({
      fighting_style: { id: 'archery', mode: 'passive_modifier' },
      name: 'Fighting Style: Archery',
      sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES.archery.sourceEntityIds,
      activation: { mode: 'passive' },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'modifier',
          applies_to: {
            roll: 'attack', filter: { attackKind: 'weapon', weaponCategory: 'ranged' },
          },
          op: 'add', value: '+2', source: 'Fighting Style: Archery',
        }],
      }],
    });
    expect(mechanics('defense')).toEqual(expect.objectContaining({
      name: 'Fighting Style: Defense',
      sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES.defense.sourceEntityIds,
      effects: [{
        resolution: 'auto',
        result: [expect.objectContaining({
          applies_to: { roll: 'ac', filter: { wearingArmor: true } },
          value: '+1',
        })],
      }],
    }));
    expect(mechanics('twoWeaponFighting')).toEqual(expect.objectContaining({
      name: 'Fighting Style: Two-Weapon Fighting',
      sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES.twoWeaponFighting.sourceEntityIds,
      effects: [{
        resolution: 'auto',
        result: [expect.objectContaining({
          applies_to: {
            roll: 'damage',
            filter: {
              attackKind: 'weapon', extraAttackSource: 'light_property',
              abilityModifierAlreadyIncluded: false,
            },
          },
          value: 'weapon_mod',
        })],
      }],
    }));
    expect(mechanics('protection')).toBeNull();
    expect(createMicroMvpProtectionCapabilityMechanics({
      kind: 'protection',
      sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds,
    })).toEqual({
      fighting_style: {
        id: 'protection', mode: 'reaction_capability',
        capability_id: PROTECTION_REACTION_CAPABILITY,
      },
      name: 'Боевой стиль: Защита',
      sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds,
      activation: { mode: 'reaction', cost: [{ resource: 'reaction' }] },
      capabilities: [{
        id: PROTECTION_REACTION_CAPABILITY,
        source_entity_ids: MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds,
        trigger: 'other_target_attacked',
        requirements: {
          target: 'not_self',
          defender_distance_to_target_ft: { max: 5 },
          defender_can_see_attacker: true,
          equipped_shield: true,
        },
      }],
      effects: [],
    });
    expect(createMicroMvpFightingStylePassiveMechanics({
      kind: 'archery', sourceEntityIds: ['stale-binding'],
    })).toBeNull();
    expect(createMicroMvpProtectionCapabilityMechanics({
      kind: 'protection', sourceEntityIds: ['stale-binding'],
    })).toBeNull();
  });

  it('adds Archery +2 only to attack rolls made with a Ranged weapon', () => {
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'weapon', weaponCategory: 'ranged',
    })).toBe(2);
    expect(archeryAttackRollBonus({
      roll: 'damage', attackKind: 'weapon', weaponCategory: 'ranged',
    })).toBe(0);
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'spell', weaponCategory: 'ranged',
    })).toBe(0);
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'unarmed',
    })).toBe(0);
    expect(archeryAttackRollBonus({
      roll: 'attack', attackKind: 'weapon', weaponCategory: 'melee',
    })).toBe(0);
  });

  it('adds Defense +1 only while Light, Medium, or Heavy armor is worn', () => {
    expect(defenseArmorClassBonus('light')).toBe(1);
    expect(defenseArmorClassBonus('medium')).toBe(1);
    expect(defenseArmorClassBonus('heavy')).toBe(1);
    expect(defenseArmorClassBonus('none')).toBe(0);
    expect(defenseArmorClassBonus('shield')).toBe(0);
    expect(defenseArmorClassBonus('natural')).toBe(0);
  });

  it('adds the ability modifier only to the extra weapon attack granted by Light', () => {
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: 3, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: true, bonus: 3 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: 0, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: true, bonus: 0 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: -1, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: true, bonus: -1 });

    expect(twoWeaponFightingDamageBonus({
      attackKind: 'spell', extraAttackSource: 'light_property',
      abilityModifier: 3, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: false, bonus: 0 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'other',
      abilityModifier: 3, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: false, bonus: 0 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'none',
      abilityModifier: 3, abilityModifierAlreadyIncluded: false,
    })).toEqual({ applies: false, bonus: 0 });
    expect(twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: 3, abilityModifierAlreadyIncluded: true,
    })).toEqual({ applies: false, bonus: 0 });
    expect(() => twoWeaponFightingDamageBonus({
      attackKind: 'weapon', extraAttackSource: 'light_property',
      abilityModifier: 1.5, abilityModifierAlreadyIncluded: false,
    })).toThrow('integer ability modifier');
  });

  it('opens Protection for a visible attack on any other nearby target with Shield and Reaction', () => {
    expect(protectionReactionEligibility(ELIGIBLE_PROTECTION_FACTS)).toEqual({ eligible: true });
    expect(protectionReactionEligibility({
      ...ELIGIBLE_PROTECTION_FACTS, targetRelationToDefender: 'enemy',
    })).toEqual({ eligible: true });
    expect(protectionReactionEligibility({
      ...ELIGIBLE_PROTECTION_FACTS, targetRelationToDefender: 'neutral',
    })).toEqual({ eligible: true });

    const rejected = [
      [{ factsSource: 'forged' }, 'invalid_facts'],
      [{ boardRevision: 1.5 }, 'invalid_facts'],
      [{ boardRevision: -1 }, 'invalid_facts'],
      [{ defenderDistanceToTargetFt: Number.NaN }, 'invalid_facts'],
      [{ defenderDistanceToTargetFt: -1 }, 'invalid_facts'],
      [{ defenderActorId: ' ' }, 'invalid_facts'],
      [{ attackerActorId: '' }, 'invalid_facts'],
      [{ targetActorId: '' }, 'invalid_facts'],
      [{ attackerActorId: 'fighter' }, 'invalid_attack_participants'],
      [{ targetActorId: 'fighter' }, 'invalid_attack_participants'],
      [{ attackerActorId: 'wizard' }, 'invalid_attack_participants'],
      [{ targetRelationToDefender: 'self' }, 'invalid_attack_participants'],
      [{ defenderHasEquippedShield: false }, 'shield_not_equipped'],
      [{ defenderReactionAvailable: false }, 'reaction_unavailable'],
      [{ defenderCanSeeAttacker: false }, 'attacker_not_visible'],
      [{ defenderDistanceToTargetFt: 5.01 }, 'target_out_of_range'],
    ] as const;
    for (const [patch, reason] of rejected) {
      expect(protectionReactionEligibility({
        ...ELIGIBLE_PROTECTION_FACTS,
        ...patch,
      } as ProtectionTriggerFacts))
        .toEqual({ eligible: false, reason });
    }
  });

  it('spends exactly one Reaction only after Protection eligibility succeeds', () => {
    expect(resolveProtectionReaction({
      triggeringAttackId: ' ', sourceEntityIds: PROTECTION_SOURCE_IDS,
      facts: ELIGIBLE_PROTECTION_FACTS,
    })).toEqual({ status: 'rejected', reason: 'invalid_facts', reactionSpent: false });
    expect(resolveProtectionReaction({
      triggeringAttackId: 'attack-no-shield',
      sourceEntityIds: PROTECTION_SOURCE_IDS,
      facts: { ...ELIGIBLE_PROTECTION_FACTS, defenderHasEquippedShield: false },
    })).toEqual({ status: 'rejected', reason: 'shield_not_equipped', reactionSpent: false });

    const accepted = resolveProtectionReaction({
      triggeringAttackId: 'attack-1', sourceEntityIds: PROTECTION_SOURCE_IDS,
      facts: ELIGIBLE_PROTECTION_FACTS,
    });
    expect(accepted).toEqual({
      status: 'accepted',
      reactionSpent: true,
      effect: {
        id: 'protection:fighter:attack-1',
        sourceEntityIds: [...PROTECTION_SOURCE_IDS],
        defenderActorId: 'fighter',
        protectedTargetActorId: 'wizard',
        triggeringAttackerActorId: 'goblin',
        triggeringAttackId: 'attack-1',
        activatedAtBoardRevision: 17,
        expiry: {
          type: 'until_start_of_source_next_turn', sourceActorId: 'fighter',
        },
      },
    });
    expect(JSON.parse(JSON.stringify(accepted))).toEqual(accepted);
  });

  it('imposes Protection Disadvantage on the trigger and later attacks while within 5 feet', () => {
    const effect = acceptedProtection();
    const facts = {
      factsSource: 'board' as const,
      boardRevision: 18,
      attackId: 'attack-1',
      targetActorId: 'wizard',
      defenderDistanceToProtectedTargetFt: 5,
    };
    expect(protectionImposesDisadvantage(effect, facts)).toBe(true);
    expect(protectionImposesDisadvantage(effect, {
      ...facts, attackId: 'attack-2', defenderDistanceToProtectedTargetFt: 0,
    })).toBe(true);

    expect(protectionImposesDisadvantage(effect, { ...facts, boardRevision: 1.5 })).toBe(false);
    expect(protectionImposesDisadvantage(effect, { ...facts, boardRevision: -1 })).toBe(false);
    expect(protectionImposesDisadvantage(effect, {
      ...facts, factsSource: 'forged' as 'board',
    })).toBe(false);
    expect(protectionImposesDisadvantage(effect, { ...facts, attackId: '' })).toBe(false);
    expect(protectionImposesDisadvantage(effect, {
      ...facts, defenderDistanceToProtectedTargetFt: Number.NaN,
    })).toBe(false);
    expect(protectionImposesDisadvantage(effect, {
      ...facts, defenderDistanceToProtectedTargetFt: -1,
    })).toBe(false);
    expect(protectionImposesDisadvantage(effect, { ...facts, targetActorId: 'cleric' })).toBe(false);
    expect(protectionImposesDisadvantage(effect, {
      ...facts, defenderDistanceToProtectedTargetFt: 5.01,
    })).toBe(false);
  });

  it('expires Protection at the defender source-turn boundary, never another actor turn', () => {
    const effect = acceptedProtection();
    expect(protectionEffectAtTurnStart(effect, 'goblin')).toBe(effect);
    expect(protectionEffectAtTurnStart(effect, 'wizard')).toBe(effect);
    expect(protectionEffectAtTurnStart(effect, 'fighter')).toBeNull();
  });
});
