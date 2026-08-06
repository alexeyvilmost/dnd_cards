import type { Card } from '../types';
import { parseWeaponProfile } from './weaponProfile';

export type LightWeaponExtraAttackIssue =
  | 'already_used'
  | 'attack_action_not_completed'
  | 'attack_action_blocked'
  | 'wrong_turn'
  | 'attack_budget_incomplete'
  | 'no_qualifying_light_attack'
  | 'qualifying_weapon_missing'
  | 'qualifying_weapon_not_light'
  | 'qualifying_weapon_not_equipped'
  | 'extra_weapon_missing'
  | 'extra_weapon_not_light'
  | 'extra_weapon_not_equipped'
  | 'same_weapon'
  | 'bonus_action_unavailable';

export interface LightWeaponExtraAttackFacts {
  qualifyingWeapon: Card;
  extraWeapon: Card;
  extraWeaponHand: 'main' | 'off';
  actionEconomy?: 'bonus_action' | 'attack_action';
}

export type LightWeaponExtraAttackEligibility =
  | { eligible: true; facts: LightWeaponExtraAttackFacts }
  | { eligible: false; issue: LightWeaponExtraAttackIssue };

export function immutableCardHasLightProperty(card: Card | undefined): boolean {
  if (card?.type !== 'weapon') return false;
  const parsed = parseWeaponProfile(card);
  return parsed.valid && parsed.profile.properties.includes('light');
}

export const LIGHT_WEAPON_EXTRA_ATTACK_USE_PREFIX =
  'system:dnd5e-2024:light-property-extra-attack:' as const;

export function lightWeaponExtraAttackUseKey(attackActionId: string): string {
  return `${LIGHT_WEAPON_EXTRA_ATTACK_USE_PREFIX}${attackActionId}`;
}

/**
 * The Light property's default damage keeps a negative attack ability
 * modifier but omits zero or a positive modifier. Two-Weapon Fighting is then
 * free to add the latter through the ordinary passive-modifier pipeline,
 * while a negative modifier is already present and must never be doubled.
 */
export function lightWeaponExtraAttackDamageAbility(
  abilityModifier: number,
): 'auto' | 'none' {
  if (!Number.isInteger(abilityModifier)) {
    throw new Error('Light extra-attack damage requires an integer weapon ability modifier');
  }
  return abilityModifier < 0 ? 'auto' : 'none';
}

function cardById(cards: readonly Card[], cardId: string): Card | undefined {
  return cards.find((card) => card.id === cardId);
}

/**
 * Pure fail-closed policy for the 2024 Light-property Bonus Action attack.
 * Every fact comes from the persisted Attack ledger, immutable Cards, current
 * equipment, turn identity, and authoritative resources. There is no client
 * boolean capable of declaring that an attack or weapon is Light.
 */
export function lightWeaponExtraAttackEligibility(input: {
  attackAction: {
    id: string;
    status: 'open' | 'completed' | 'forfeited';
    turnKey: string;
    blockedByResolutionId?: string;
    attacksRemaining: number;
    entries: ReadonlyArray<{ kind: string; weaponCardId?: string }>;
  };
  currentTurnKey: string;
  selectedWeaponCardId: string;
  cards: readonly Card[];
  equipment: Readonly<Record<string, string | null | undefined>>;
  bonusActions: number;
  firedThisTurn: readonly string[];
  /** Nick replaces the Bonus Action cost with Attack-action timing. */
  actionEconomy?: 'bonus_action' | 'attack_action';
}): LightWeaponExtraAttackEligibility {
  if (input.firedThisTurn.includes(lightWeaponExtraAttackUseKey(input.attackAction.id))) {
    return { eligible: false, issue: 'already_used' };
  }
  if (input.attackAction.blockedByResolutionId) return { eligible: false, issue: 'attack_action_blocked' };
  if (input.attackAction.status !== 'completed') {
    return { eligible: false, issue: 'attack_action_not_completed' };
  }
  if (input.attackAction.turnKey !== input.currentTurnKey) return { eligible: false, issue: 'wrong_turn' };
  if (input.attackAction.attacksRemaining !== 0) {
    return { eligible: false, issue: 'attack_budget_incomplete' };
  }
  const weaponEntries = input.attackAction.entries.filter((entry) => (
    entry.kind === 'weapon_attack'
  ));
  const qualifyingWeapons = weaponEntries.flatMap((entry) => {
    const card = entry.weaponCardId ? cardById(input.cards, entry.weaponCardId) : undefined;
    return card && immutableCardHasLightProperty(card) ? [card] : [];
  });
  if (!qualifyingWeapons.length) {
    const weaponEntry = input.attackAction.entries.find((entry) => entry.kind === 'weapon_attack');
    if (!weaponEntry) return { eligible: false, issue: 'no_qualifying_light_attack' };
    const card = weaponEntry.weaponCardId
      ? cardById(input.cards, weaponEntry.weaponCardId)
      : undefined;
    return card
      ? { eligible: false, issue: 'qualifying_weapon_not_light' }
      : { eligible: false, issue: 'qualifying_weapon_missing' };
  }
  const extraWeapon = cardById(input.cards, input.selectedWeaponCardId);
  if (!extraWeapon) return { eligible: false, issue: 'extra_weapon_missing' };
  if (!immutableCardHasLightProperty(extraWeapon)) {
    return { eligible: false, issue: 'extra_weapon_not_light' };
  }
  const extraWeaponHand = input.equipment.main_hand === extraWeapon.id
    ? 'main'
    : input.equipment.off_hand === extraWeapon.id
      ? 'off'
      : null;
  if (!extraWeaponHand) return { eligible: false, issue: 'extra_weapon_not_equipped' };
  const equippedQualifyingWeapons = qualifyingWeapons.filter((weapon) => (
    weapon.id !== extraWeapon.id
      && Object.entries(input.equipment).some(([slot, cardId]) => (
        (slot === 'main_hand' || slot === 'off_hand') && cardId === weapon.id
      ))
  ));
  if (!equippedQualifyingWeapons.length) {
    if (qualifyingWeapons.every((weapon) => weapon.id === extraWeapon.id)) {
      return { eligible: false, issue: 'same_weapon' };
    }
    return { eligible: false, issue: 'qualifying_weapon_not_equipped' };
  }
  const actionEconomy = input.actionEconomy ?? 'bonus_action';
  if (actionEconomy === 'bonus_action'
    && (!Number.isFinite(input.bonusActions) || input.bonusActions < 1)) {
    return { eligible: false, issue: 'bonus_action_unavailable' };
  }
  return {
    eligible: true,
    facts: {
      qualifyingWeapon: equippedQualifyingWeapons[0],
      extraWeapon,
      extraWeaponHand,
      ...(input.actionEconomy ? { actionEconomy } : {}),
    },
  };
}
