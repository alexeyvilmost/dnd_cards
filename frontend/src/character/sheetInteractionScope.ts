import type { CharacterType } from './types';

type ScopedCharacter = { id: string; character_type?: CharacterType };

/** A run character cannot interact with sheets from another game. */
export function sheetTargetBelongsToScope(source: ScopedCharacter, target: ScopedCharacter): boolean {
  return source.id === target.id
    || (source.character_type !== 'dungeon_crawl' && target.character_type !== 'dungeon_crawl');
}

export function runCampTargetIssue(type: CharacterType, requiresTarget: boolean, allowsSelf: boolean): string | null {
  return type === 'dungeon_crawl' && requiresTarget && !allowsSelf
    ? 'Для этого действия нужна цель на поле боя.' : null;
}
