import type { Card } from '../types';

export interface DeclaredTestWeaponProfile {
  weaponType: string;
  proficiencyCategory: 'simple' | 'martial';
  attackAbility: 'str' | 'dex' | 'finesse';
  damageLines: Array<{ dice: string; type: string }>;
  versatileGrip?: { dice: string; type: string };
  defaultAttackMode: 'melee' | 'ranged';
  attackModes: Array<
    | { kind: 'melee'; reach_ft: number }
    | { kind: 'ranged'; normal_ft: number; long_ft: number }
  >;
  properties: string[];
  masteryEffectId: string;
  ammo?: { card_id: string; name?: string } | null;
  enchantment?: {
    attack_bonus: number;
    damage_bonus: number;
    extra_damage_lines: Array<{ dice: string; type: string }>;
  };
  attunementRequired?: boolean;
}

/** Test-only builder whose callers must state every rule-bearing weapon fact. */
export function withDeclaredTestWeaponProfile(
  card: Card,
  input: DeclaredTestWeaponProfile,
): Card {
  return {
    ...card,
    mechanics: {
      ...(card.mechanics ?? {}),
      weapon_profile: {
        weapon_type: input.weaponType,
        proficiency_category: input.proficiencyCategory,
        attack_ability: input.attackAbility,
        damage_lines: input.damageLines.map((line) => ({ ...line })),
        ...(input.versatileGrip ? { versatile_grip: { ...input.versatileGrip } } : {}),
        default_attack_mode: input.defaultAttackMode,
        attack_modes: input.attackModes.map((mode) => ({ ...mode })),
        properties: [...input.properties],
        ...(input.properties.includes('heavy') ? {
          heavy: {
            minimum_ability_score: 13,
            ability_by_mode: { melee: 'str', ranged: 'dex' },
            consequence: 'attack_disadvantage',
          },
        } : {}),
        mastery_effect_id: input.masteryEffectId,
        ammo: input.ammo ?? null,
        enchantment: input.enchantment ?? {
          attack_bonus: 0,
          damage_bonus: 0,
          extra_damage_lines: [],
        },
        attunement: { required: input.attunementRequired ?? false },
      },
    },
  };
}
