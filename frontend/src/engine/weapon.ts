/**
 * Оружейный контекст для dice:"weapon", ability:"auto" (фаза C5).
 */
import type { Card } from '../types';
import type { AbilityKey } from './formula';
import type { CharacterContext, WeaponContext } from '../mvp/contracts';
import { cardPropsList } from './equipment';

function cardById(ctx: CharacterContext, id: string | null | undefined): Card | undefined {
  if (!id) return undefined;
  return (ctx.equippedCards ?? []).find((c) => c.id === id)
    ?? (ctx.knownCards ?? []).find((c) => c.id === id);
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

function cardToWeapon(card: Card, character: CharacterContext): WeaponContext {
  return {
    cardId: card.id,
    name: card.name,
    dice: card.bonus_value ?? '1d4',
    ability: pickAbility(card, character),
    damageType: card.damage_type ?? 'bludgeoning',
    properties: cardPropsList(card),
  };
}

/** Параметры оружия в указанной руке (по слоту equipment, R3). */
export function weaponContext(
  character: CharacterContext,
  hand: 'main' | 'off',
  equipment?: Record<string, string | null | undefined>,
): WeaponContext | null {
  const slot = hand === 'main' ? 'main_hand' : 'off_hand';
  if (equipment) {
    const card = cardById(character, equipment[slot]);
    if (card?.type === 'weapon') return cardToWeapon(card, character);
    return null;
  }

  const weapons = (character.equippedCards ?? []).filter((c) => c.type === 'weapon');
  const card = hand === 'main' ? weapons[0] : weapons[1];
  if (!card) return null;
  return cardToWeapon(card, character);
}

export function abilityForWeapon(card: Card, character: CharacterContext): AbilityKey {
  return pickAbility(card, character);
}
