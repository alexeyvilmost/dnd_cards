import type { AbilityKey, CharacterDraft, ForgeCharacter, SaveForgeCharacterRequest } from './types';
import { ABILITY_KEYS } from './types';
import {
  BONUS_KEY, EQUIPMENT_OPTION_KEY, METHOD_KEY,
  bonusIssues, parseBonuses, pointBuyIssues, serializeBonuses,
} from './pointBuy';
import type { AssembledCharacter } from './assemble';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import type { CharacterRuleState } from './rules/types';
import { collectChosenSpellUuids } from '../engine/spellRefs';
import { isEntityUuid } from '../engine/ids';
import type { Race, RaceTrait } from '../types';
import type { PendingChoice } from '../mechanics/collectChoices';

export function resolveLineageName(
  lineageId: string | null | undefined,
  opts: {
    subraces?: Race[];
    lineages?: RaceTrait[] | null;
    subChoices?: PendingChoice[];
  },
): string | undefined {
  if (!lineageId) return undefined;
  const { subraces = [], lineages, subChoices = [] } = opts;
  const fromSubrace = subraces.find((r) => r.id === lineageId)?.name;
  if (fromSubrace) return fromSubrace;
  const fromLineage = lineages?.find(
    (l) => l.name === lineageId || (l as { id?: string }).id === lineageId,
  )?.name;
  if (fromLineage) return fromLineage;
  for (const pc of subChoices) {
    const item = pc.items?.find((it) => it.id === lineageId);
    if (item?.name) return item.name;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(lineageId)) return undefined;
  return lineageId;
}

export function characterToDraft(c: ForgeCharacter): CharacterDraft {
  const classSkillChoices = (c.rule_state?.appliedGrants || [])
    .filter((grant) => grant.kind === 'skill' && grant.choiceId === 'class_skill_choices')
    .map((grant) => grant.value);

  const legacySlugs = (c.spell_ids || []).filter((id) => !isEntityUuid(id));
  const knownSlugs = (c.rule_state?.spells?.known || []).filter((id) => !isEntityUuid(id));
  const grantedSpellSlugs = [...new Set([...legacySlugs, ...knownSlugs])];

  // Служебные builder:-ключи достаём из resolved_choices и не отдаём их
  // ChoiceResolver-у (buildSavePayload добавит их обратно при сохранении).
  const stored = c.resolved_choices || {};
  const resolvedChoices: Record<string, string[]> = {};
  for (const [key, vals] of Object.entries(stored)) {
    if (!key.startsWith('builder:')) resolvedChoices[key] = vals;
  }
  const abilityMethod = stored[METHOD_KEY]?.[0] === 'manual' ? 'manual' as const : 'point_buy' as const;
  const equipmentOption = stored[EQUIPMENT_OPTION_KEY]?.[0] === 'b' ? 'b' as const : 'a' as const;

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
    abilityMethod,
    abilityBonuses: parseBonuses(stored[BONUS_KEY]),
    equipmentOption,
    classSkillChoices,
    resolvedChoices,
    swapFeat: (c.feat_ids || []).length > 0,
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
    resolved_choices: {
      ...draft.resolvedChoices,
      [METHOD_KEY]: [draft.abilityMethod],
      [BONUS_KEY]: serializeBonuses(draft.abilityBonuses),
      [EQUIPMENT_OPTION_KEY]: [draft.equipmentOption],
    },
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
  if (assigned && draft.abilityMethod === 'point_buy') {
    issues.push(...pointBuyIssues(draft.abilities, draft.abilityBonuses));
  }
  issues.push(...bonusIssues(draft.abilityBonuses));
  issues.push(...requiredChoiceIssues(draft, assembled));
  const ruleState = resolveCharacterRules({ draft, assembled });
  issues.push(...ruleState.conflicts.filter((c) => c.severity === 'error').map((c) => c.message));
  return issues;
}
