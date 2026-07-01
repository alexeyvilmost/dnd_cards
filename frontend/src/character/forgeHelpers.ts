import type { CharacterDraft, SaveForgeCharacterRequest } from './types';
import { ABILITY_KEYS } from './types';
import type { AssembledCharacter } from './assemble';

// Разбор class.skill_choices вида {count, options[]}
export function classSkillChoice(assembled: AssembledCharacter): { count: number; options: string[] } | null {
  const sc = assembled.klass?.skill_choices as { count?: number; options?: string[] } | undefined;
  if (!sc || !sc.count) return null;
  return { count: Number(sc.count), options: Array.isArray(sc.options) ? sc.options : [] };
}

// Собрать значения выборов заданного source из resolvedChoices.
function resolvedBySource(draft: CharacterDraft, assembled: AssembledCharacter, source: string): string[] {
  const out: string[] = [];
  for (const pc of assembled.pendingChoices) {
    if (pc.source === source) out.push(...(draft.resolvedChoices[pc.id] || []));
  }
  return out;
}

export function finalSkills(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  const s = new Set<string>();
  draft.classSkillChoices.forEach((x) => s.add(x));
  (assembled.background?.skill_proficiencies || []).forEach((x) => s.add(x));
  resolvedBySource(draft, assembled, 'skill').forEach((x) => s.add(x));
  return [...s];
}

export function finalTools(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  const s = new Set<string>();
  const bgTool = assembled.background?.tool_proficiency;
  if (bgTool) s.add(bgTool);
  resolvedBySource(draft, assembled, 'tool').forEach((x) => s.add(x));
  return [...s];
}

export function finalLanguages(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  return [...new Set(resolvedBySource(draft, assembled, 'language'))];
}

export function finalSaves(assembled: AssembledCharacter): string[] {
  return assembled.klass?.saving_throws || [];
}

export function buildSavePayload(draft: CharacterDraft, assembled: AssembledCharacter): SaveForgeCharacterRequest {
  const maxHP = assembled.derived.maxHP;
  return {
    name: draft.name.trim(),
    avatar_url: draft.avatarUrl,
    race_id: draft.raceId,
    lineage_id: draft.lineageId,
    class_id: draft.classId,
    background_id: draft.backgroundId,
    level: draft.level,
    feat_ids: draft.featIds,
    spell_ids: draft.spellIds,
    abilities: draft.abilities,
    skill_proficiencies: finalSkills(draft, assembled),
    saving_throw_proficiencies: finalSaves(assembled),
    tool_proficiencies: finalTools(draft, assembled),
    languages: finalLanguages(draft, assembled),
    resolved_choices: draft.resolvedChoices,
    max_hp: maxHP,
    current_hp: maxHP,
    speed: assembled.derived.speed,
    proficiency_bonus: assembled.derived.proficiencyBonus,
  };
}

// Незакрытые обязательные выборы (навыки класса + choice-интеракции).
export function requiredChoiceIssues(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  const issues: string[] = [];
  const sc = classSkillChoice(assembled);
  if (sc && draft.classSkillChoices.length < sc.count) {
    issues.push(`Навыки класса: выберите ${sc.count} (выбрано ${draft.classSkillChoices.length})`);
  }
  for (const pc of assembled.pendingChoices) {
    const sel = draft.resolvedChoices[pc.id] || [];
    if (sel.length < pc.count) {
      issues.push(`«${pc.prompt}»: выберите ${pc.count} (выбрано ${sel.length})`);
    }
  }
  return issues;
}

// Полная проверка готовности к созданию.
export function completionIssues(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push('Введите имя');
  if (!draft.raceId) issues.push('Выберите вид');
  if (!draft.classId) issues.push('Выберите класс');
  if (!draft.backgroundId) issues.push('Выберите предысторию');
  const assigned = ABILITY_KEYS.every((k) => typeof draft.abilities[k] === 'number');
  if (!assigned) issues.push('Задайте характеристики');
  issues.push(...requiredChoiceIssues(draft, assembled));
  return issues;
}
