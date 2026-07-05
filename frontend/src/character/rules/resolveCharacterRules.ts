import type { Action, PassiveEffect } from '../../types';
import type { OriginAction, OriginEffect } from '../assemble';
import { computeMaxHP, spellcasting } from '../derive';
import { normalizeSkillId, normalizeSkillList } from '../skillNormalize';
import { ABILITY_KEYS, type AbilityKey } from '../types';
import { abilityMod, abilityOfSkill, ABILITY_IDS, SKILL_IDS, proficiencyBonusForLevel } from './foundation';
import type {
  AppliedGrant,
  CharacterRuleState,
  GrantMode,
  ProficiencyKind,
  RuleConflict,
  RuleInput,
  RuleSource,
  RuleSourceType,
} from './types';

type Dict = Record<string, unknown>;

const emptySetMap = () => ({
  skill: new Map<string, AppliedGrant>(),
  saving_throw: new Map<string, AppliedGrant>(),
  tool: new Map<string, AppliedGrant>(),
  language: new Map<string, AppliedGrant>(),
  weapon: new Map<string, AppliedGrant>(),
  armor: new Map<string, AppliedGrant>(),
  spell: new Map<string, AppliedGrant>(),
});

const sourceFromOrigin = (origin: { kind: string; id: string; name: string }, feature?: { id: string; name: string }): RuleSource => ({
  type: origin.kind === 'race' ? 'species' : (origin.kind as RuleSourceType),
  id: `${origin.kind}:${origin.id}:${feature?.id || 'base'}`,
  name: feature ? `${origin.name}: ${feature.name}` : origin.name,
});

const choiceInstanceId = (source: RuleSource, rawChoiceId: string) => `${source.id}:${rawChoiceId}`;

const grantId = (grant: Omit<AppliedGrant, 'id'>) =>
  `${grant.source.type}:${grant.source.id}:${grant.kind}:${grant.mode}:${grant.value}:${grant.choiceId || ''}`;

const normalizedValue = (kind: AppliedGrant['kind'], value: string) =>
  kind === 'skill' ? normalizeSkillId(value) : value;

function payloadsFromMechanics(mechanics: Record<string, unknown> | null | undefined): Dict[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const out: Dict[] = [];
  for (const item of effects as Dict[]) {
    if (item?.kind) {
      out.push(item);
    } else if (item?.resolution === 'auto' && Array.isArray(item.result)) {
      out.push(...(item.result as Dict[]));
    }
  }
  return out;
}

function selectedChoicePayloads(choice: Dict, selected: string[]): Dict[] {
  const out: Dict[] = [];
  const opts = (choice.options || {}) as Dict;
  const items = Array.isArray(opts.items) ? (opts.items as Dict[]) : [];

  for (const value of selected) {
    const item = items.find((it) => String(it.id) === value);
    if (item && Array.isArray(item.grants)) {
      out.push(...(item.grants as Dict[]));
      continue;
    }

    const template = (choice.grant || {}) as Dict;
    if (!template.kind) continue;
    out.push({ ...template, value });
  }

  return out;
}

function addGrant(
  grant: Omit<AppliedGrant, 'id'>,
  maps: ReturnType<typeof emptySetMap>,
  expertise: { skill: Map<string, AppliedGrant>; tool: Map<string, AppliedGrant> },
  appliedGrants: AppliedGrant[],
  conflicts: RuleConflict[],
) {
  const value = normalizedValue(grant.kind, grant.value);
  const full: AppliedGrant = { ...grant, value, id: grantId({ ...grant, value }) };

  if (full.mode === 'expertise') {
    if (full.kind !== 'skill' && full.kind !== 'tool') {
      conflicts.push({
        code: 'unsupported_grant',
        message: `Экспертиза для типа «${full.kind}» пока не поддерживается.`,
        severity: 'warning',
        kind: full.kind,
        value,
        source: full.source,
        choiceId: full.choiceId,
      });
      return;
    }
    const proficiencyMap = maps[full.kind];
    if (!proficiencyMap.has(value)) {
      conflicts.push({
        code: 'missing_proficiency_for_expertise',
        message: `Экспертиза «${value}» требует владения этим навыком или инструментом.`,
        severity: 'error',
        kind: full.kind,
        value,
        source: full.source,
        choiceId: full.choiceId,
      });
    }
    const expertiseMap = expertise[full.kind];
    if (!expertiseMap.has(value)) expertiseMap.set(value, full);
    appliedGrants.push(full);
    return;
  }

  if (full.kind === 'spell') {
    const existing = maps.spell.get(value);
    if (existing && (existing.source.id !== full.source.id || existing.choiceId !== full.choiceId)) {
      conflicts.push({
        code: 'duplicate_spell',
        message: `Заклинание «${value}» уже выбрано из «${existing.source.name}», повтор из «${full.source.name}» не применяется.`,
        severity: 'error',
        kind: 'spell',
        value,
        source: full.source,
        existingSource: existing.source,
        choiceId: full.choiceId,
      });
      return;
    }
    if (!existing) {
      maps.spell.set(value, full);
      appliedGrants.push(full);
    }
    return;
  }

  const existing = maps[full.kind].get(value);
  if (existing && (existing.source.id !== full.source.id || existing.choiceId !== full.choiceId)) {
    conflicts.push({
      code: 'duplicate_proficiency',
      message: `«${value}» уже получено из «${existing.source.name}», повтор из «${full.source.name}» не применяется.`,
      severity: 'error',
      kind: full.kind,
      value,
      source: full.source,
      existingSource: existing.source,
      choiceId: full.choiceId,
    });
    return;
  }

  if (!existing) {
    maps[full.kind].set(value, full);
    appliedGrants.push(full);
  }
}

function grantFromPayload(payload: Dict, source: RuleSource, choiceId?: string): Omit<AppliedGrant, 'id'> | null {
  const kind = String(payload.kind || '');
  if (kind === 'grant_language') {
    const value = payload.value;
    if (!value) return null;
    return { source, kind: 'language', value: String(value), mode: 'proficiency', choiceId };
  }

  if (kind === 'grant_expertise') {
    const prof = String(payload.prof || payload.expertise || 'skill') as ProficiencyKind;
    const value = payload.value;
    if (!value) return null;
    return { source, kind: prof, value: String(value), mode: 'expertise', choiceId };
  }

  if (kind === 'grant_spell') {
    const value = payload.value;
    if (!value) return null;
    return {
      source,
      kind: 'spell',
      value: String(value),
      mode: 'proficiency',
      choiceId,
      label: typeof payload.label === 'string' ? payload.label : undefined,
    };
  }

  if (kind !== 'grant_proficiency') return null;
  const prof = String(payload.prof || 'skill') as ProficiencyKind;
  const value = payload.value;
  if (!value) return null;
  // Контент помечает экспертизу по-разному: mode:"expertise" | expertise:true | expert:true.
  const mode: GrantMode = payload.mode === 'expertise' || payload.expertise === true || payload.expert === true
    ? 'expertise'
    : 'proficiency';
  return { source, kind: prof, value: String(value), mode, choiceId };
}

// Уровневый гейт гранта: применяем, только если уровень персонажа достаточен.
// Так способности видов/подвидов распределяются по уровням (Высший эльф:
// Фокус — 1, Обнаружение магии — 3, Туманный шаг — 5).
function passesLevelGate(payload: Dict, level: number): boolean {
  const g = payload.level_gate ?? payload.min_level;
  if (g == null) return true;
  const n = Number(g);
  return Number.isNaN(n) || level >= n;
}

function applyPayload(
  payload: Dict,
  source: RuleSource,
  input: RuleInput,
  maps: ReturnType<typeof emptySetMap>,
  expertise: { skill: Map<string, AppliedGrant>; tool: Map<string, AppliedGrant> },
  appliedGrants: AppliedGrant[],
  conflicts: RuleConflict[],
) {
  const level = input.draft.level ?? 1;
  if (payload.kind === 'choice') {
    const rawChoiceId = String(payload.id || 'choice');
    const choiceId = choiceInstanceId(source, rawChoiceId);
    const selected = input.draft.resolvedChoices[choiceId] || input.draft.resolvedChoices[rawChoiceId] || [];
    for (const selectedPayload of selectedChoicePayloads(payload, selected)) {
      if (!passesLevelGate(selectedPayload, level)) continue;
      const grant = grantFromPayload(selectedPayload, source, choiceId);
      if (grant) addGrant(grant, maps, expertise, appliedGrants, conflicts);
    }
    return;
  }

  if (!passesLevelGate(payload, level)) return;
  const grant = grantFromPayload(payload, source);
  if (grant) addGrant(grant, maps, expertise, appliedGrants, conflicts);
}

function applyMechanics(
  entity: PassiveEffect | Action,
  source: RuleSource,
  input: RuleInput,
  maps: ReturnType<typeof emptySetMap>,
  expertise: { skill: Map<string, AppliedGrant>; tool: Map<string, AppliedGrant> },
  appliedGrants: AppliedGrant[],
  conflicts: RuleConflict[],
) {
  for (const payload of payloadsFromMechanics(entity.mechanics)) {
    applyPayload(payload, source, input, maps, expertise, appliedGrants, conflicts);
  }
}

export function buildRuleInput(input: RuleInput): RuleInput {
  return input;
}

export function resolveCharacterRules(input: RuleInput): CharacterRuleState {
  const { draft, assembled } = input;
  const maps = emptySetMap();
  const expertise = { skill: new Map<string, AppliedGrant>(), tool: new Map<string, AppliedGrant>() };
  const appliedGrants: AppliedGrant[] = [];
  const conflicts: RuleConflict[] = [];

  const classSource: RuleSource = {
    type: 'class',
    id: assembled.klass?.id || 'class',
    name: assembled.klass?.name || 'Класс',
  };
  const backgroundSource: RuleSource = {
    type: 'background',
    id: assembled.background?.id || 'background',
    name: assembled.background?.name || 'Предыстория',
  };

  for (const skill of draft.classSkillChoices) {
    addGrant({ source: classSource, kind: 'skill', value: skill, mode: 'proficiency', choiceId: 'class_skill_choices' }, maps, expertise, appliedGrants, conflicts);
  }
  for (const skill of normalizeSkillList(assembled.background?.skill_proficiencies || [])) {
    addGrant({ source: backgroundSource, kind: 'skill', value: skill, mode: 'proficiency' }, maps, expertise, appliedGrants, conflicts);
  }
  if (assembled.background?.tool_proficiency) {
    addGrant({ source: backgroundSource, kind: 'tool', value: assembled.background.tool_proficiency, mode: 'proficiency' }, maps, expertise, appliedGrants, conflicts);
  }
  for (const save of assembled.klass?.saving_throws || []) {
    addGrant({ source: classSource, kind: 'saving_throw', value: save, mode: 'proficiency' }, maps, expertise, appliedGrants, conflicts);
  }

  for (const { effect, origin } of assembled.effects as OriginEffect[]) {
    applyMechanics(effect, sourceFromOrigin(origin, effect), input, maps, expertise, appliedGrants, conflicts);
  }
  for (const { action, origin } of assembled.actions as OriginAction[]) {
    applyMechanics(action, sourceFromOrigin(origin, action), input, maps, expertise, appliedGrants, conflicts);
  }
  for (const runtime of input.runtimeSources || []) {
    for (const payload of payloadsFromMechanics(runtime.mechanics)) {
      applyPayload(payload, runtime.source, input, maps, expertise, appliedGrants, conflicts);
    }
  }

  const scores = draft.abilities;
  const pb = proficiencyBonusForLevel(draft.level);
  const abilityMods = Object.fromEntries(
    ABILITY_KEYS.map((ability) => [ability, abilityMod(scores[ability])]),
  ) as Record<AbilityKey, number>;

  const skillBonuses = Object.fromEntries(SKILL_IDS.map((skill) => {
    const base = abilityMod(scores[abilityOfSkill(skill)]);
    const proficient = maps.skill.has(skill);
    const expert = expertise.skill.has(skill);
    return [skill, base + (proficient ? pb : 0) + (expert ? pb : 0)];
  }));

  const savingThrowBonuses = Object.fromEntries(ABILITY_IDS.map((ability) => {
    const base = abilityMod(scores[ability]);
    return [ability, base + (maps.saving_throw.has(ability) ? pb : 0)];
  })) as Record<AbilityKey, number>;

  const maxHP = computeMaxHP(assembled.klass?.hit_die, scores.con, draft.level);
  const armorClass = 10 + abilityMod(scores.dex);
  const speed = assembled.race?.speed ?? 30;
  const initiativeBonus = abilityMod(scores.dex);

  return {
    version: 1,
    abilities: scores,
    abilityMods,
    proficiencyBonus: pb,
    proficiencies: {
      skills: [...maps.skill.keys()],
      savingThrows: [...maps.saving_throw.keys()],
      tools: [...maps.tool.keys()],
      languages: [...maps.language.keys()],
      weapons: [...maps.weapon.keys()],
      armor: [...maps.armor.keys()],
    },
    expertise: {
      skills: [...expertise.skill.keys()],
      tools: [...expertise.tool.keys()],
    },
    spells: {
      known: [...maps.spell.keys()],
      cantrips: [...maps.spell.values()].filter((g) => g.label === 'cantrip').map((g) => g.value),
      leveled: [...maps.spell.values()].filter((g) => g.label !== 'cantrip').map((g) => g.value),
    },
    skillBonuses,
    savingThrowBonuses,
    maxHP,
    armorClass,
    speed,
    initiativeBonus,
    passivePerception: 10 + (skillBonuses.perception ?? abilityMod(scores.wis)),
    spellcasting: spellcasting(assembled.klass?.name, scores, pb),
    appliedGrants,
    conflicts,
  };
}

export function getSkillGrantSource(ruleState: CharacterRuleState, skill: string): AppliedGrant | undefined {
  const id = normalizeSkillId(skill);
  return ruleState.appliedGrants.find((grant) => grant.kind === 'skill' && grant.mode === 'proficiency' && grant.value === id);
}

export function ruleSourceTypeLabel(source: RuleSource): string {
  switch (source.type) {
    case 'species':
      return 'вид';
    case 'class':
      return 'класс';
    case 'background':
      return 'предыстория';
    case 'feat':
      return 'черта';
    case 'item':
      return 'предмет';
    case 'temporary_effect':
      return 'временный эффект';
    case 'condition':
      return 'состояние';
    case 'action_result':
      return 'действие';
    default:
      return 'источник';
  }
}

export function grantReason(grant: AppliedGrant | undefined): string {
  if (!grant) return '';
  return `Получено: ${ruleSourceTypeLabel(grant.source)} · ${grant.source.name}`;
}
