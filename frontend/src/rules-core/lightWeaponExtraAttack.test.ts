import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import {
  immutableCardHasLightProperty,
  lightWeaponExtraAttackDamageAbility,
  lightWeaponExtraAttackUseKey,
  lightWeaponExtraAttackEligibility,
  type LightWeaponExtraAttackIssue,
} from './lightWeaponExtraAttack';

function weapon(id: string, properties: string[], legacyProperties: string[]): Card {
  return {
    id,
    type: 'weapon',
    weapon_type: `legacy_${id}`,
    properties: legacyProperties,
    mechanics: {
      weapon_profile: {
        weapon_type: id,
        proficiency_category: id === 'dagger' ? 'simple' : 'martial',
        attack_ability: id === 'longsword' ? 'str' : 'finesse',
        damage_lines: [{ dice: id === 'dagger' ? '1d4' : '1d6', type: 'slashing' }],
        default_attack_mode: 'melee',
        attack_modes: [{ kind: 'melee', reach_ft: 5 }],
        properties,
        mastery_effect_id: `mastery:${id}`,
        ammo: null,
        enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
        attunement: { required: false },
      },
    },
  } as unknown as Card;
}

const DAGGER = weapon('dagger', ['light', 'finesse'], []);
const SCIMITAR = weapon('scimitar', ['light', 'finesse'], []);
const LONGSWORD = weapon('longsword', [], ['light']);
const GREATSWORD = weapon('greatsword', ['two_handed', 'heavy'], []);

function eligibility(overrides: Partial<Parameters<typeof lightWeaponExtraAttackEligibility>[0]> = {}) {
  return lightWeaponExtraAttackEligibility({
    attackAction: {
      id: 'attack-1',
      status: 'completed',
      turnKey: 'encounter:1:0:fighter',
      attacksRemaining: 0,
      entries: [{ kind: 'weapon_attack', weaponCardId: DAGGER.id }],
    },
    currentTurnKey: 'encounter:1:0:fighter',
    selectedWeaponCardId: SCIMITAR.id,
    cards: [DAGGER, SCIMITAR, LONGSWORD],
    equipment: { main_hand: DAGGER.id, off_hand: SCIMITAR.id },
    bonusActions: 1,
    firedThisTurn: [],
    ...overrides,
  });
}

describe('canonical Light-property extra-attack policy', () => {
  it('keeps a negative damage modifier but omits zero or a positive modifier before TWF', () => {
    expect(lightWeaponExtraAttackDamageAbility(-2)).toBe('auto');
    expect(lightWeaponExtraAttackDamageAbility(0)).toBe('none');
    expect(lightWeaponExtraAttackDamageAbility(3)).toBe('none');
    expect(() => lightWeaponExtraAttackDamageAbility(1.5)).toThrow(/integer/);
  });

  it('derives one legal extra attack from the completed Attack ledger and two distinct equipped immutable Light Cards', () => {
    expect(immutableCardHasLightProperty(DAGGER)).toBe(true);
    expect(immutableCardHasLightProperty(SCIMITAR)).toBe(true);
    expect(immutableCardHasLightProperty(LONGSWORD)).toBe(false);
    expect(eligibility()).toEqual({
      eligible: true,
      facts: {
        qualifyingWeapon: DAGGER,
        extraWeapon: SCIMITAR,
        extraWeaponHand: 'off',
      },
    });
    expect(eligibility({
      attackAction: {
        id: 'attack-1', status: 'completed', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        entries: [{ kind: 'weapon_attack', weaponCardId: SCIMITAR.id }],
      },
      selectedWeaponCardId: DAGGER.id,
    })).toMatchObject({
      eligible: true,
      facts: { qualifyingWeapon: SCIMITAR, extraWeapon: DAGGER, extraWeaponHand: 'main' },
    });
    expect(eligibility({
      attackAction: {
        id: 'attack-1', status: 'completed', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        entries: [
          { kind: 'weapon_attack', weaponCardId: DAGGER.id },
          { kind: 'weapon_attack', weaponCardId: SCIMITAR.id },
        ],
      },
      selectedWeaponCardId: DAGGER.id,
    })).toMatchObject({
      eligible: true,
      facts: { qualifyingWeapon: SCIMITAR, extraWeapon: DAGGER, extraWeaponHand: 'main' },
    });
  });

  it('fails closed for ledger, turn, immutable Card, equipment, identity, and Bonus Action violations', () => {
    const probes: Array<[LightWeaponExtraAttackIssue, Parameters<typeof eligibility>[0]]> = [
      ['already_used', { firedThisTurn: [lightWeaponExtraAttackUseKey('attack-1')] }],
      ['attack_action_not_completed', { attackAction: {
        id: 'attack-1', status: 'forfeited', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        entries: [{ kind: 'weapon_attack', weaponCardId: DAGGER.id }],
      } }],
      ['attack_action_blocked', { attackAction: {
        id: 'attack-1', status: 'open', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        blockedByResolutionId: 'reaction', entries: [{ kind: 'weapon_attack', weaponCardId: DAGGER.id }],
      } }],
      ['wrong_turn', { currentTurnKey: 'encounter:1:1:fighter' }],
      ['attack_budget_incomplete', { attackAction: {
        id: 'attack-1', status: 'completed', turnKey: 'encounter:1:0:fighter', attacksRemaining: 1,
        entries: [{ kind: 'weapon_attack', weaponCardId: DAGGER.id }],
      } }],
      ['no_qualifying_light_attack', { attackAction: {
        id: 'attack-1', status: 'completed', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        entries: [{ kind: 'unarmed_strike' }],
      } }],
      ['qualifying_weapon_missing', { attackAction: {
        id: 'attack-1', status: 'completed', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        entries: [{ kind: 'weapon_attack', weaponCardId: 'missing' }],
      } }],
      ['qualifying_weapon_not_light', { attackAction: {
        id: 'attack-1', status: 'completed', turnKey: 'encounter:1:0:fighter', attacksRemaining: 0,
        entries: [{ kind: 'weapon_attack', weaponCardId: LONGSWORD.id }],
      }, equipment: { main_hand: LONGSWORD.id, off_hand: SCIMITAR.id } }],
      ['qualifying_weapon_not_equipped', { equipment: { off_hand: SCIMITAR.id } }],
      ['extra_weapon_missing', { selectedWeaponCardId: 'missing' }],
      ['same_weapon', { selectedWeaponCardId: DAGGER.id }],
      ['extra_weapon_not_light', {
        selectedWeaponCardId: LONGSWORD.id,
        equipment: { main_hand: DAGGER.id, off_hand: LONGSWORD.id },
      }],
      ['extra_weapon_not_equipped', { equipment: { main_hand: DAGGER.id } }],
      ['bonus_action_unavailable', { bonusActions: 0 }],
    ];
    for (const [issue, override] of probes) {
      expect(eligibility(override), issue).toEqual({ eligible: false, issue });
    }
  });

  it('Dual Wielder allows a one-handed melee extra weapon but never a two-handed one', () => {
    expect(eligibility({
      selectedWeaponCardId: LONGSWORD.id,
      equipment: { main_hand: DAGGER.id, off_hand: LONGSWORD.id },
      allowNonLightMeleeExtraWeapon: true,
    })).toMatchObject({
      eligible: true,
      facts: { qualifyingWeapon: DAGGER, extraWeapon: LONGSWORD, extraWeaponHand: 'off' },
    });
    expect(eligibility({
      selectedWeaponCardId: LONGSWORD.id,
      equipment: { main_hand: DAGGER.id, off_hand: LONGSWORD.id },
    })).toEqual({ eligible: false, issue: 'extra_weapon_not_light' });
    expect(eligibility({
      cards: [DAGGER, SCIMITAR, LONGSWORD, GREATSWORD],
      selectedWeaponCardId: GREATSWORD.id,
      equipment: { main_hand: DAGGER.id, off_hand: GREATSWORD.id },
      allowNonLightMeleeExtraWeapon: true,
    })).toEqual({ eligible: false, issue: 'extra_weapon_not_dual_wielder_eligible' });
  });
});
