import type {ForgeCharacter} from '../character/types';
import policy from './data/classes.json';

export const isRunClass = (cardNumber: string | undefined) => !!cardNumber && policy.class_cards.includes(cardNumber);

export function isRunEligible(character: ForgeCharacter, eligibleClassIds: string | readonly string[] | undefined): boolean {
  const ids=typeof eligibleClassIds==='string'?[eligibleClassIds]:eligibleClassIds??[];
  if (!character.class_id || !ids.includes(character.class_id) || character.level !== policy.starting_level
    || character.character_type === 'dungeon_crawl' || character.access_mode !== 'owner') return false;
  if (character.class_levels != null) {
    const entries = Object.entries(character.class_levels);
    if (entries.length !== 1 || entries[0][0] !== character.class_id || entries[0][1] !== policy.starting_level) return false;
  }
  return true;
}
