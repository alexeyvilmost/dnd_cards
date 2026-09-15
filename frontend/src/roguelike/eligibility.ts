import type {ForgeCharacter} from '../character/types';

export function isRunEligible(character: ForgeCharacter, fighterClassId: string | undefined): boolean {
  if (!fighterClassId || character.class_id !== fighterClassId || character.level !== 1
    || character.character_type === 'dungeon_crawl' || character.access_mode !== 'owner') return false;
  if (character.class_levels != null) {
    const entries = Object.entries(character.class_levels);
    if (entries.length !== 1 || entries[0][0] !== fighterClassId || entries[0][1] !== 1) return false;
  }
  return true;
}
