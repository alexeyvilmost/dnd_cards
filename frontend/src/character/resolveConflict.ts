import type { AssembledCharacter } from './assemble';
import { classSkillChoice } from './forgeHelpers';
import type { CharacterDraft } from './types';
import { normalizeSkillId, normalizeSkillList } from './skillNormalize';
import { getSkillGrantSource } from './rules/resolveCharacterRules';
import type { CharacterRuleState, RuleConflict, RuleSource } from './rules/types';
import { SKILLS, labelOf } from '../mechanics/registries';

/** Слот выбора, который можно переназначить для разрешения дубля навыка. */
export type ConflictReplaceSlot = {
  /** Ключ выбора: `class_skill_choices` или id из resolvedChoices. */
  choiceId: string;
  kind: 'class_skills' | 'resolved_choice';
  sourceName: string;
  currentValue: string;
  /** Виды навыков, доступные этому источнику. */
  pool: string[];
};

export type ConflictPartyPool = {
  sourceName: string;
  skills: string[];
};

function sourceDisplayName(src: RuleSource): string {
  const base = src.name.split(':')[0]?.trim() || src.name;
  return base;
}

function matchesEntity(
  src: RuleSource,
  type: RuleSource['type'],
  entity: { id: string; name: string } | null | undefined,
): boolean {
  if (!entity || src.type !== type) return false;
  if (src.id === entity.id) return true;
  if (src.id.includes(entity.id)) return true;
  const base = sourceDisplayName(src);
  return base === entity.name || src.name === entity.name;
}

/** Пул навыков источника конфликта (класс / предыстория / choice). */
export function skillPoolForSource(
  src: RuleSource,
  draft: CharacterDraft,
  assembled: AssembledCharacter,
): string[] {
  if (matchesEntity(src, 'class', assembled.klass)) {
    return normalizeSkillList(classSkillChoice(assembled)?.options);
  }
  if (matchesEntity(src, 'background', assembled.background)) {
    return normalizeSkillList(assembled.background?.skill_proficiencies);
  }

  const fromChoices = new Set<string>();
  for (const pc of assembled.pendingChoices) {
    if (pc.source !== 'skill') continue;
    const originType = pc.origin.kind === 'race' ? 'species' : pc.origin.kind;
    if (originType !== src.type) continue;
    const originName = pc.origin.name;
    if (
      sourceDisplayName(src) !== originName
      && src.name !== originName
      && !src.name.startsWith(`${originName}:`)
      && !src.id.includes(pc.origin.id)
    ) {
      continue;
    }
    if (Array.isArray(pc.filter)) {
      for (const id of normalizeSkillList(pc.filter)) fromChoices.add(id);
    } else if (pc.filter && pc.filter !== 'proficient') {
      // filter как категория — оставляем все навыки; точный фильтр редкий
      for (const s of SKILLS) fromChoices.add(s.id);
    } else {
      for (const s of SKILLS) fromChoices.add(s.id);
    }
  }
  return [...fromChoices];
}

function pushUniqueSlot(slots: ConflictReplaceSlot[], slot: ConflictReplaceSlot) {
  if (slots.some((s) => s.choiceId === slot.choiceId && s.currentValue === slot.currentValue)) return;
  slots.push(slot);
}

/**
 * Слоты, в которых сейчас «сидит» конфликтующий навык и которые можно переназначить.
 * Фиксированные гранты (навыки предыстории без choice) сюда не попадают.
 */
export function findConflictReplaceSlots(
  conflict: RuleConflict,
  draft: CharacterDraft,
  assembled: AssembledCharacter,
): ConflictReplaceSlot[] {
  if (conflict.code !== 'duplicate_proficiency' || conflict.kind !== 'skill' || !conflict.value) {
    return [];
  }
  const value = normalizeSkillId(conflict.value);
  const parties = [conflict.existingSource, conflict.source].filter(Boolean) as RuleSource[];
  const slots: ConflictReplaceSlot[] = [];

  for (const src of parties) {
    const pool = skillPoolForSource(src, draft, assembled);
    const sourceName = sourceDisplayName(src);

    if (
      matchesEntity(src, 'class', assembled.klass)
      && draft.classSkillChoices.some((s) => normalizeSkillId(s) === value)
    ) {
      pushUniqueSlot(slots, {
        choiceId: 'class_skill_choices',
        kind: 'class_skills',
        sourceName,
        currentValue: value,
        pool: pool.length ? pool : normalizeSkillList(classSkillChoice(assembled)?.options),
      });
    }

    // choiceId на самом конфликте — сторона, чей грант не применился
    if (conflict.choiceId && conflict.source && sourceDisplayName(conflict.source) === sourceName) {
      const cid = conflict.choiceId;
      if (cid === 'class_skill_choices') {
        pushUniqueSlot(slots, {
          choiceId: cid,
          kind: 'class_skills',
          sourceName,
          currentValue: value,
          pool: pool.length ? pool : normalizeSkillList(classSkillChoice(assembled)?.options),
        });
      } else {
        const pc = assembled.pendingChoices.find((c) => c.id === cid);
        const choicePool = Array.isArray(pc?.filter)
          ? normalizeSkillList(pc.filter as string[])
          : (pool.length ? pool : SKILLS.map((s) => s.id));
        const selected = draft.resolvedChoices[cid] || [];
        if (selected.some((s) => normalizeSkillId(s) === value) || selected.length === 0) {
          pushUniqueSlot(slots, {
            choiceId: cid,
            kind: 'resolved_choice',
            sourceName,
            currentValue: value,
            pool: choicePool,
          });
        }
      }
    }

    for (const pc of assembled.pendingChoices) {
      if (pc.source !== 'skill' || pc.filter === 'proficient') continue;
      const originType = pc.origin.kind === 'race' ? 'species' : pc.origin.kind;
      if (originType !== src.type) continue;
      if (
        sourceDisplayName(src) !== pc.origin.name
        && !src.name.startsWith(`${pc.origin.name}:`)
        && !src.id.includes(pc.origin.id)
      ) {
        continue;
      }
      const selected = draft.resolvedChoices[pc.id] || [];
      if (!selected.some((s) => normalizeSkillId(s) === value)) continue;
      const choicePool = Array.isArray(pc.filter)
        ? normalizeSkillList(pc.filter as string[])
        : SKILLS.map((s) => s.id);
      pushUniqueSlot(slots, {
        choiceId: pc.id,
        kind: 'resolved_choice',
        sourceName,
        currentValue: value,
        pool: choicePool,
      });
    }
  }

  return slots;
}

/** Пулы обоих участников конфликта — для подписи «доступно Воину / Артисту». */
export function conflictPartyPools(
  conflict: RuleConflict,
  draft: CharacterDraft,
  assembled: AssembledCharacter,
): ConflictPartyPool[] {
  const parties = [conflict.existingSource, conflict.source].filter(Boolean) as RuleSource[];
  const out: ConflictPartyPool[] = [];
  for (const src of parties) {
    const skills = skillPoolForSource(src, draft, assembled);
    if (!skills.length) continue;
    out.push({ sourceName: sourceDisplayName(src), skills });
  }
  return out;
}

/**
 * Навыки, которыми персонаж ещё не владеет, из объединения пулов участников,
 * и которые можно назначить в выбранный слот.
 */
export function availableReplacementSkills(
  slot: ConflictReplaceSlot,
  partyPools: ConflictPartyPool[],
  ruleState: CharacterRuleState,
): { id: string; label: string; from: string[] }[] {
  const union = new Set<string>();
  for (const p of partyPools) for (const id of p.skills) union.add(id);
  // Слот должен уметь принять навык — пересечение с его пулом.
  const slotPool = new Set(slot.pool.length ? slot.pool : union);

  const bySkill = new Map<string, string[]>();
  for (const p of partyPools) {
    for (const id of p.skills) {
      if (!slotPool.has(id) && !union.has(id)) continue;
      if (!slotPool.has(id)) continue;
      const list = bySkill.get(id) ?? [];
      if (!list.includes(p.sourceName)) list.push(p.sourceName);
      bySkill.set(id, list);
    }
  }
  // Если partyPools пуст — опираемся только на пул слота.
  if (!bySkill.size) {
    for (const id of slotPool) bySkill.set(id, [slot.sourceName]);
  }

  const out: { id: string; label: string; from: string[] }[] = [];
  for (const [id, from] of bySkill) {
    if (id === slot.currentValue) continue;
    if (getSkillGrantSource(ruleState, id)) continue;
    out.push({ id, label: labelOf(SKILLS, id), from });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return out;
}

/** Применить замену навыка в драфте. */
export function applySkillConflictReplacement(
  draft: CharacterDraft,
  slot: ConflictReplaceSlot,
  newSkillId: string,
): CharacterDraft {
  const next = normalizeSkillId(newSkillId);
  const prev = normalizeSkillId(slot.currentValue);
  if (slot.kind === 'class_skills') {
    const skills = draft.classSkillChoices.map((s) => (normalizeSkillId(s) === prev ? next : s));
    // Если текущего значения не было (редко) — заменяем первый слот / добавляем.
    if (!draft.classSkillChoices.some((s) => normalizeSkillId(s) === prev)) {
      return { ...draft, classSkillChoices: [...draft.classSkillChoices.filter((s) => normalizeSkillId(s) !== next), next] };
    }
    return { ...draft, classSkillChoices: skills };
  }
  const current = draft.resolvedChoices[slot.choiceId] || [];
  const replaced = current.some((s) => normalizeSkillId(s) === prev)
    ? current.map((s) => (normalizeSkillId(s) === prev ? next : s))
    : [...current.filter((s) => normalizeSkillId(s) !== next), next];
  return {
    ...draft,
    resolvedChoices: { ...draft.resolvedChoices, [slot.choiceId]: replaced },
  };
}

export function canResolveSkillConflict(
  conflict: RuleConflict,
  draft: CharacterDraft,
  assembled: AssembledCharacter,
  ruleState: CharacterRuleState,
): boolean {
  const slots = findConflictReplaceSlots(conflict, draft, assembled);
  if (!slots.length) return false;
  const parties = conflictPartyPools(conflict, draft, assembled);
  return slots.some((slot) => availableReplacementSkills(slot, parties, ruleState).length > 0);
}
