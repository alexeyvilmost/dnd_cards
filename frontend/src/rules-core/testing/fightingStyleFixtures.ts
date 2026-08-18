import type { FightingStyleEntityReference } from '../fightingStyles';

/**
 * Snapshot identities used only by certification tests. Runtime behavior is
 * selected by `mechanics.fighting_style`, never by these UUIDs/card numbers.
 */
export const MICRO_MVP_FIGHTING_STYLE_ENTITIES = {
  archery: {
    featCardNumber: 'FEAT-0063',
    featEntityId: 'bca8edf6-27ce-4399-8e34-bdadd59674b3',
    effectCardNumber: 'fs_archery',
    effectEntityId: '76acce68-ebbe-4cef-ba2c-3ca4042c3656',
    sourceEntityIds: [
      'bca8edf6-27ce-4399-8e34-bdadd59674b3', 'FEAT-0063',
      '76acce68-ebbe-4cef-ba2c-3ca4042c3656', 'fs_archery',
    ] as const,
  },
  defense: {
    featCardNumber: 'FEAT-0056',
    featEntityId: '25896e04-0c1d-4917-97fc-7feef7f836e1',
    effectCardNumber: 'fs_defense',
    effectEntityId: '284c2459-dbe5-4ad5-9e06-c2417ab046a7',
    sourceEntityIds: [
      '25896e04-0c1d-4917-97fc-7feef7f836e1', 'FEAT-0056',
      '284c2459-dbe5-4ad5-9e06-c2417ab046a7', 'fs_defense',
    ] as const,
  },
  twoWeaponFighting: {
    featCardNumber: 'FEAT-0061',
    featEntityId: '440e7209-1602-415e-a5bb-e8bf42b3f720',
    effectCardNumber: 'fs_two_weapon',
    effectEntityId: '1ea32433-e3d0-4ab9-a8c0-cd159af6534d',
    sourceEntityIds: [
      '440e7209-1602-415e-a5bb-e8bf42b3f720', 'FEAT-0061',
      '1ea32433-e3d0-4ab9-a8c0-cd159af6534d', 'fs_two_weapon',
    ] as const,
  },
  protection: {
    featCardNumber: 'FEAT-0055',
    featEntityId: 'c061b389-be25-439b-b9fc-71cfa43e195b',
    effectCardNumber: 'fs_protection',
    effectEntityId: '48feb5da-5003-46b0-94b4-afa064182519',
    sourceEntityIds: [
      'c061b389-be25-439b-b9fc-71cfa43e195b', 'FEAT-0055',
      '48feb5da-5003-46b0-94b4-afa064182519', 'fs_protection',
    ] as const,
  },
} as const;

export type MicroMvpFightingStyleProjectionKind =
  keyof typeof MICRO_MVP_FIGHTING_STYLE_ENTITIES;

export const PROTECTION_REACTION_CAPABILITY = 'fighting_style.protection.reaction' as const;
export const PROTECTION_2024_SOURCE_ENTITY_IDS =
  MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds;

export interface FightingStyleProjectionBinding {
  kind: MicroMvpFightingStyleProjectionKind;
  sourceEntityIds: readonly [string, ...string[]];
}

export function bindMicroMvpFightingStyleProjection(
  reference: FightingStyleEntityReference,
): FightingStyleProjectionBinding | null {
  const kinds = Object.keys(
    MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  ) as MicroMvpFightingStyleProjectionKind[];
  for (const kind of kinds) {
    const entity = MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind];
    if (reference.featEntityId !== entity.featEntityId
      || reference.featCardNumber !== entity.featCardNumber
      || reference.effectEntityId !== entity.effectEntityId
      || reference.effectCardNumber !== entity.effectCardNumber
      || !reference.relatedEffectEntityIds.includes(reference.effectEntityId)) continue;
    return { kind, sourceEntityIds: entity.sourceEntityIds };
  }
  return null;
}

function exactBinding(binding: FightingStyleProjectionBinding): boolean {
  const canonical = MICRO_MVP_FIGHTING_STYLE_ENTITIES[binding.kind].sourceEntityIds;
  return canonical.length === binding.sourceEntityIds.length
    && canonical.every((sourceId, index) => sourceId === binding.sourceEntityIds[index]);
}

export function createMicroMvpFightingStylePassiveMechanics(
  binding: FightingStyleProjectionBinding,
): Record<string, unknown> | null {
  if (!exactBinding(binding) || binding.kind === 'protection') return null;
  const sourceEntityIds = [
    ...MICRO_MVP_FIGHTING_STYLE_ENTITIES[binding.kind].sourceEntityIds,
  ] as [string, ...string[]];
  const result: Record<string, unknown> = binding.kind === 'archery'
    ? {
      kind: 'modifier',
      applies_to: {
        roll: 'attack', filter: { attackKind: 'weapon', weaponCategory: 'ranged' },
      },
      op: 'add', value: '+2', source: 'Fighting Style: Archery',
    }
    : binding.kind === 'defense'
      ? {
        kind: 'modifier',
        applies_to: { roll: 'ac', filter: { wearingArmor: true } },
        op: 'add', value: '+1', source: 'Боевой стиль: Оборона',
        when: [{ kind: 'wearing_armor' }],
      }
      : {
        kind: 'modifier',
        applies_to: {
          roll: 'damage',
          filter: {
            attackKind: 'weapon', extraAttackSource: 'light_property',
            abilityModifierAlreadyIncluded: false,
          },
        },
        op: 'add', value: 'weapon_mod', source: 'Fighting Style: Two-Weapon Fighting',
      };
  return {
    fighting_style: {
      id: binding.kind === 'twoWeaponFighting' ? 'two_weapon_fighting' : binding.kind,
      mode: 'passive_modifier',
    },
    name: result.source as string,
    sourceEntityIds,
    activation: { mode: 'passive' },
    effects: [{ resolution: 'auto', result: [result] }],
  };
}

export function createMicroMvpProtectionCapabilityMechanics(
  binding: FightingStyleProjectionBinding,
): Record<string, unknown> | null {
  if (!exactBinding(binding) || binding.kind !== 'protection') return null;
  const sourceEntityIds = [
    ...MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds,
  ] as [string, ...string[]];
  return {
    fighting_style: {
      id: 'protection',
      mode: 'reaction_capability',
      capability_id: PROTECTION_REACTION_CAPABILITY,
    },
    name: 'Защита',
    sourceEntityIds,
    activation: { mode: 'reaction', cost: [{ resource: 'reaction' }] },
    capabilities: [{
      id: PROTECTION_REACTION_CAPABILITY,
      source_entity_ids: [...sourceEntityIds],
      trigger: 'other_target_attacked',
      requirements: {
        target: 'not_self',
        defender_distance_to_target_ft: { max: 5 },
        defender_can_see_attacker: true,
        equipped_shield: true,
      },
    }],
    effects: [],
  };
}

/** Legacy test oracles. Runtime modifier values come from effect mechanics. */
type AttackKind = 'weapon' | 'spell' | 'unarmed';

export function archeryAttackRollBonus(facts: {
  roll: 'attack' | 'damage';
  attackKind: AttackKind;
  weaponCategory?: 'melee' | 'ranged';
}): number {
  return facts.roll === 'attack'
    && facts.attackKind === 'weapon'
    && facts.weaponCategory === 'ranged'
    ? 2
    : 0;
}

export function defenseArmorClassBonus(
  wornArmorCategory: 'none' | 'light' | 'medium' | 'heavy' | 'shield' | 'natural',
): number {
  return ['light', 'medium', 'heavy'].includes(wornArmorCategory) ? 1 : 0;
}

export function twoWeaponFightingDamageBonus(facts: {
  attackKind: AttackKind;
  extraAttackSource: 'light_property' | 'other' | 'none';
  abilityModifier: number;
  abilityModifierAlreadyIncluded: boolean;
}): { applies: boolean; bonus: number } {
  if (!Number.isInteger(facts.abilityModifier)) {
    throw new Error('Two-Weapon Fighting requires an integer ability modifier');
  }
  if (facts.attackKind !== 'weapon'
    || facts.extraAttackSource !== 'light_property'
    || facts.abilityModifierAlreadyIncluded) return { applies: false, bonus: 0 };
  return { applies: true, bonus: facts.abilityModifier };
}

export type FightingStyleFactSource = 'scenario' | 'board' | 'gm_ruling';
export type ProtectionTargetRelation = 'self' | 'ally' | 'enemy' | 'neutral';

export interface ProtectionTriggerFacts {
  factsSource: FightingStyleFactSource;
  boardRevision: number;
  defenderActorId: string;
  attackerActorId: string;
  targetActorId: string;
  targetRelationToDefender: ProtectionTargetRelation;
  defenderDistanceToTargetFt: number;
  defenderCanSeeAttacker: boolean;
  defenderHasEquippedShield: boolean;
  defenderReactionAvailable: boolean;
}

type ProtectionRejectionReason =
  | 'invalid_facts'
  | 'invalid_attack_participants'
  | 'shield_not_equipped'
  | 'reaction_unavailable'
  | 'attacker_not_visible'
  | 'target_out_of_range';

function hasStableId(value: string): boolean {
  return value.trim().length > 0;
}

function validFacts(facts: Pick<ProtectionTriggerFacts, 'factsSource' | 'boardRevision'>): boolean {
  return ['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)
    && Number.isInteger(facts.boardRevision) && facts.boardRevision >= 0;
}

export function protectionReactionEligibility(facts: ProtectionTriggerFacts):
{ eligible: true } | { eligible: false; reason: ProtectionRejectionReason } {
  if (!validFacts(facts)
    || !Number.isFinite(facts.defenderDistanceToTargetFt)
    || facts.defenderDistanceToTargetFt < 0
    || !hasStableId(facts.defenderActorId)
    || !hasStableId(facts.attackerActorId)
    || !hasStableId(facts.targetActorId)) return { eligible: false, reason: 'invalid_facts' };
  if (facts.defenderActorId === facts.attackerActorId
    || facts.defenderActorId === facts.targetActorId
    || facts.attackerActorId === facts.targetActorId
    || facts.targetRelationToDefender === 'self') {
    return { eligible: false, reason: 'invalid_attack_participants' };
  }
  if (!facts.defenderHasEquippedShield) return { eligible: false, reason: 'shield_not_equipped' };
  if (!facts.defenderReactionAvailable) return { eligible: false, reason: 'reaction_unavailable' };
  if (!facts.defenderCanSeeAttacker) return { eligible: false, reason: 'attacker_not_visible' };
  if (facts.defenderDistanceToTargetFt > 5) return { eligible: false, reason: 'target_out_of_range' };
  return { eligible: true };
}

export interface ProtectionEffectState {
  id: string;
  sourceEntityIds: [string, ...string[]];
  defenderActorId: string;
  protectedTargetActorId: string;
  triggeringAttackerActorId: string;
  triggeringAttackId: string;
  activatedAtBoardRevision: number;
  expiry: { type: 'until_start_of_source_next_turn'; sourceActorId: string };
}

export function resolveProtectionReaction(input: {
  triggeringAttackId: string;
  sourceEntityIds: readonly [string, ...string[]];
  facts: ProtectionTriggerFacts;
}): { status: 'rejected'; reason: ProtectionRejectionReason; reactionSpent: false }
  | { status: 'accepted'; reactionSpent: true; effect: ProtectionEffectState } {
  if (!hasStableId(input.triggeringAttackId)
    || input.sourceEntityIds.some((sourceId) => !hasStableId(sourceId))
    || new Set(input.sourceEntityIds).size !== input.sourceEntityIds.length) {
    return { status: 'rejected', reason: 'invalid_facts', reactionSpent: false };
  }
  const eligibility = protectionReactionEligibility(input.facts);
  if (!eligibility.eligible) {
    return { status: 'rejected', reason: eligibility.reason, reactionSpent: false };
  }
  const { facts } = input;
  return {
    status: 'accepted', reactionSpent: true,
    effect: {
      id: `protection:${facts.defenderActorId}:${input.triggeringAttackId}`,
      sourceEntityIds: [...input.sourceEntityIds],
      defenderActorId: facts.defenderActorId,
      protectedTargetActorId: facts.targetActorId,
      triggeringAttackerActorId: facts.attackerActorId,
      triggeringAttackId: input.triggeringAttackId,
      activatedAtBoardRevision: facts.boardRevision,
      expiry: { type: 'until_start_of_source_next_turn', sourceActorId: facts.defenderActorId },
    },
  };
}

export function protectionImposesDisadvantage(
  effect: ProtectionEffectState,
  facts: {
    factsSource: FightingStyleFactSource;
    boardRevision: number;
    attackId: string;
    targetActorId: string;
    defenderDistanceToProtectedTargetFt: number;
  },
): boolean {
  return validFacts(facts)
    && hasStableId(facts.attackId)
    && Number.isFinite(facts.defenderDistanceToProtectedTargetFt)
    && facts.defenderDistanceToProtectedTargetFt >= 0
    && facts.targetActorId === effect.protectedTargetActorId
    && facts.defenderDistanceToProtectedTargetFt <= 5;
}

export function protectionEffectAtTurnStart(
  effect: ProtectionEffectState,
  startingActorId: string,
): ProtectionEffectState | null {
  return startingActorId === effect.expiry.sourceActorId ? null : effect;
}
