/**
 * Оружейный контекст для dice:"weapon", ability:"auto" (фаза C5).
 */
import type { Card } from '../types';
import type { AbilityKey } from './formula';
import type { CharacterContext, WeaponContext } from '../mvp/contracts';
import { cardPropsList } from './equipment';

function weaponCards(ctx: CharacterContext): Card[] {
  return (ctx.equippedCards ?? []).filter((c) => c.type === 'weapon');
}

function pickAbility(card: Card, character: CharacterContext): 'str' | 'dex' {
  const props = cardPropsList(card);
  if (props.includes('finesse')) {
    const str = character.abilityMods.str ?? 0;
    const dex = character.abilityMods.dex ?? 0;
    return dex > str ? 'dex' : 'str';
  }
  return 'str';
}

/** Параметры оружия в указанной руке (по порядку в equippedCards). */
export function weaponContext(character: CharacterContext, hand: 'main' | 'off'): WeaponContext | null {
  const weapons = weaponCards(character);
  if (!weapons.length) return null;

  const card = hand === 'main' ? weapons[0] : weapons[1];
  if (!card) return null;

  return {
    cardId: card.id,
    name: card.name,
    dice: card.bonus_value ?? '1d4',
    ability: pickAbility(card, character),
    damageType: card.damage_type ?? 'bludgeoning',
    properties: cardPropsList(card),
  };
}

export function abilityForWeapon(card: Card, character: CharacterContext): AbilityKey {
  return pickAbility(card, character);
}
