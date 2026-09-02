import type { AbilityKey, CharacterDraft, ForgeCharacter } from './types';
import type { CharacterClass } from '../types';

export function normalizedClassLevels(
  value: Record<string, number> | null | undefined,
  primaryClassId: string | null | undefined,
  totalLevel: number,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, raw] of Object.entries(value ?? {})) {
    const level = Math.max(0, Math.floor(Number(raw)));
    if (id && level > 0) result[id] = level;
  }
  if (!Object.keys(result).length && primaryClassId) {
    result[primaryClassId] = Math.max(1, Math.floor(totalLevel || 1));
  }
  return result;
}

export function draftClassLevels(draft: Pick<CharacterDraft, 'classLevels' | 'classId' | 'level'>): Record<string, number> {
  return normalizedClassLevels(draft.classLevels, draft.classId, draft.level);
}

export function characterClassLevels(character: Pick<ForgeCharacter, 'class_levels' | 'class_id' | 'level'>): Record<string, number> {
  return normalizedClassLevels(character.class_levels, character.class_id, character.level);
}

export function totalClassLevel(levels: Record<string, number>): number {
  return Object.values(levels).reduce((sum, level) => sum + Math.max(0, Math.floor(Number(level))), 0);
}

const MULTICLASS_REQUIREMENTS: Record<string, { all?: AbilityKey[]; any?: AbilityKey[] }> = {
  barbarian: { all: ['str'] }, bard: { all: ['cha'] }, cleric: { all: ['wis'] }, druid: { all: ['wis'] },
  fighter: { any: ['str', 'dex'] }, monk: { all: ['dex', 'wis'] }, paladin: { all: ['str', 'cha'] },
  ranger: { all: ['dex', 'wis'] }, rogue: { all: ['dex'] }, sorcerer: { all: ['cha'] },
  warlock: { all: ['cha'] }, wizard: { all: ['int'] },
};

function classRuleKey(klass: CharacterClass): string {
  const card = (klass.card_number || '').replace(/^CLASS[-_]/i, '').toLowerCase();
  const aliases: Record<string, string> = { warrior: 'fighter' };
  return aliases[card] ?? card;
}

/** D&D 2024 multiclass prerequisite: each listed primary score must be at least 13. */
export function multiclassPrerequisiteIssues(
  klass: CharacterClass,
  abilities: Partial<Record<AbilityKey, number>>,
): string[] {
  const required = MULTICLASS_REQUIREMENTS[classRuleKey(klass)] ?? {};
  const issues = (required.all ?? [])
    .filter((ability) => Number(abilities[ability] ?? 0) < 13)
    .map((ability) => `${ability.toUpperCase()} 13`);
  if (required.any?.length && !required.any.some((ability) => Number(abilities[ability] ?? 0) >= 13)) {
    issues.push(`${required.any.map((ability) => ability.toUpperCase()).join(' или ')} 13`);
  }
  return issues;
}

export function addClassLevel(
  draft: Pick<CharacterDraft, 'classLevels' | 'classId' | 'level'>,
  classId: string,
): Record<string, number> {
  const levels = draftClassLevels(draft);
  levels[classId] = (levels[classId] ?? 0) + 1;
  return levels;
}
