import type { AbilityKey, CharacterDraft, ForgeCharacter, SaveForgeCharacterRequest } from './types';
import { ABILITY_KEYS } from './types';
import type { AssembledCharacter } from './assemble';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import type { CharacterRuleState } from './rules/types';
import { collectChosenSpellUuids } from '../engine/spellRefs';
import { isEntityUuid } from '../engine/ids';

export function characterToDraft(c: ForgeCharacter): CharacterDraft {
  const classSkillChoices = (c.rule_state?.appliedGrants || [])
    .filter((grant) => grant.kind === 'skill' && grant.choiceId === 'class_skill_choices')
    .map((grant) => grant.value);

  const legacySlugs = (c.spell_ids || []).filter((id) => !isEntityUuid(id));
  const knownSlugs = (c.rule_state?.spells?.known || []).filter((id) => !isEntityUuid(id));
  const grantedSpellSlugs = [...new Set([...legacySlugs, ...knownSlugs])];

  return {
    id: c.id,
    name: c.name,
    avatarUrl: c.avatar_url,
    raceId: c.race_id ?? null,
    lineageId: c.lineage_id ?? null,
    classId: c.class_id ?? null,
    backgroundId: c.background_id ?? null,
    level: c.level || 1,
    featIds: c.feat_ids || [],
    spellIds: (c.spell_ids || []).filter(isEntityUuid),
    grantedSpellSlugs,
    abilities: (c.abilities as Partial<Record<AbilityKey, number>>) || {},
    classSkillChoices,
    resolvedChoices: c.resolved_choices || {},
  };
}

// Разбор class.skill_choices вида {count, options[]}
export function classSkillChoice(assembled: AssembledCharacter): { count: number; options: string[] } | null {
  const sc = assembled.klass?.skill_choices as { count?: number; options?: string[] } | undefined;
  if (!sc || !sc.count) return null;
  return { count: Number(sc.count), options: Array.isArray(sc.options) ? sc.options : [] };
}

export function finalSkills(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  return resolveCharacterRules({ draft, assembled }).proficiencies.skills;
}

export function finalTools(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  return resolveCharacterRules({ draft, assembled }).proficiencies.tools;
}

export function finalLanguages(draft: CharacterDraft, assembled: AssembledCharacter): string[] {
  return resolveCharacterRules({ draft, assembled }).proficiencies.languages;
}

export function finalSaves(assembled: AssembledCharacter): string[] {
  return assembled.klass?.saving_throws || [];
}

export function buildSavePayload(
  draft: CharacterDraft,
  assembled: AssembledCharacter,
  ruleState: CharacterRuleState = resolveCharacterRules({ draft, assembled }),
): SaveForgeCharacterRequest {
  const maxHP = ruleState.maxHP;
  return {
    name: draft.name.trim(),
    avatar_url: draft.avatarUrl,
    race_id: draft.raceId,
    lineage_id: draft.lineageId,
    class_id: draft.classId,
    background_id: draft.backgroundId,
    level: draft.level,
    feat_ids: draft.featIds,
    spell_ids: collectChosenSpellUuids(draft, assembled),
    abilities: draft.abilities,
    skill_proficiencies: ruleState.proficiencies.skills,
    skill_expertise: ruleState.expertise.skills,
    saving_throw_proficiencies: ruleState.proficiencies.savingThrows,
    tool_proficiencies: ruleState.proficiencies.tools,
    tool_expertise: ruleState.expertise.tools,
    languages: ruleState.proficiencies.languages,
    resolved_choices: draft.resolvedChoices,
    rule_state: ruleState,
    max_hp: maxHP,
    current_hp: maxHP,
    speed: ruleState.speed,
    proficiency_bonus: ruleState.proficiencyBonus,
    armor_class: ruleState.armorClass,
    initiative_bonus: ruleState.initiativeBonus,
    passive_perception: ruleState.passivePerception,
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
  const ruleState = resolveCharacterRules({ draft, assembled });
  issues.push(...ruleState.conflicts.filter((c) => c.severity === 'error').map((c) => c.message));
  return issues;
}
