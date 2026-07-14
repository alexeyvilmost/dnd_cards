import type { Action, PassiveEffect } from '../../types';
import type { OriginAction, OriginEffect } from '../assemble';
import { computeMaxHP, spellcasting } from '../derive';
import { armorClassValue } from '../../engine/ac';
import { foldModifiers, type ModifierOp } from '../../engine/modifiers';
import type { CharacterContext, RuntimeState } from '../../mvp/contracts';
import { evaluate, type FormulaContext } from '../../engine/formula';
import { parseFreeuse, type FreeuseSpec } from '../../engine/freeuse';
import { normalizeSkillId, normalizeSkillList } from '../skillNormalize';
import { sourceKey, instanceFeatureId } from '../../mechanics/choiceKey';
import { MAX_CHOICE_DEPTH, choiceInstanceId, selectedChoicePayloads, payloadsFromMechanics } from '../../mechanics/expandChoices';
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
  feat: new Map<string, AppliedGrant>(),
});

const sourceFromOrigin = (origin: { kind: string; id: string; name: string; instanceKey?: string }, feature?: { id: string; name: string }): RuleSource => ({
  type: origin.kind === 'race' ? 'species' : (origin.kind as RuleSourceType),
  // instanceKey (повторяемая черта на разных слотах) входит в featureId → ключи выборов
  // экземпляров различны; совпадает с тем, что пишет форге (assemble → instanceFeatureId).
  id: sourceKey(origin.kind, origin.id, instanceFeatureId(feature?.id ?? '', origin.instanceKey)),
  name: feature ? `${origin.name}: ${feature.name}` : origin.name,
});

// Ключ выбора (choiceInstanceId), MAX_CHOICE_DEPTH, selectedChoicePayloads и payloadsFromMechanics
// вынесены в mechanics/expandChoices.ts и переиспользуются пассивами листа — единый ключ, без рассинхрона.

const grantId = (grant: Omit<AppliedGrant, 'id'>) =>
  `${grant.source.type}:${grant.source.id}:${grant.kind}:${grant.mode}:${grant.value}:${grant.choiceId || ''}`;

const normalizedValue = (kind: AppliedGrant['kind'], value: string) =>
  kind === 'skill' ? normalizeSkillId(value) : value;

function addGrant(
  grant: Omit<AppliedGrant, 'id'>,
  maps: ReturnType<typeof emptySetMap>,
  expertise: { skill: Map<string, AppliedGrant>; tool: Map<string, AppliedGrant> },
  appliedGrants: AppliedGrant[],
  conflicts: RuleConflict[],
  repeatableFeats: Set<string> = new Set(),
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

  if (full.kind === 'feat') {
    // Повторяемую (repeatable) черту можно взять несколько раз (из вида и
    // предыстории) — фиксируем каждый грант. Неповторяемую — один раз, дубль
    // из ДРУГОГО источника даёт предупреждение (не блок).
    const dup = maps.feat.has(value);
    if (dup && !repeatableFeats.has(value)) {
      const existing = maps.feat.get(value)!;
      if (existing.source.id !== full.source.id || existing.choiceId !== full.choiceId) {
        conflicts.push({
          code: 'duplicate_feat',
          message: `Черта «${value}» уже получена из «${existing.source.name}» — повтор из «${full.source.name}» не применяется (черта не повторяемая).`,
          severity: 'warning',
          kind: 'feat',
          value,
          source: full.source,
          existingSource: existing.source,
          choiceId: full.choiceId,
        });
      }
      return;
    }
    if (!dup) maps.feat.set(value, full);
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
      // Дубль из ФИКСИРОВАННОГО гранта (не выбор игрока) исправить нечем —
      // предупреждаем, но не блокируем создание; дубль из выбора — ошибка.
      severity: full.choiceId ? 'error' : 'warning',
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

  if (kind === 'grant_feat') {
    const value = payload.value;
    if (!value) return null;
    return { source, kind: 'feat', value: String(value), mode: 'proficiency', choiceId };
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
      // freeuse: каст без ячейки из пула freeuse-<value> (native и через choice — общая точка).
      freeuse: parseFreeuse(payload.freeuse),
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

// Роли числовых значений листа, на которые ВЛИЯЮТ modifier-пассивки эффектов.
// Фундаментально: любой эффект с числовым self-модификатором (Крепкий → max_hp,
// Оборона → ac, сапоги скорости → speed) вливается в производное значение.
// 'ac' здесь НЕТ намеренно: КЗ считается единым примитивом armorClassValue (C9),
// который сам собирает modifier-эффекты роли 'ac' — иначе двойной учёт.
const NUMERIC_ROLLS = new Set(['max_hp', 'speed', 'initiative', 'size', 'carry']);

/** Собирает числовой self-modifier из payload в аккумулятор numericMods. */
function collectNumericModifier(payload: Dict, formulaCtx: FormulaContext, numericMods: Record<string, number>, source: RuleSource) {
  if (payload.kind !== 'modifier') return;
  // Модификатор с длительностью (Большая форма: size/speed на 10 раундов) применяется в РАНТАЙМЕ
  // при активации действия, а не пассивно на сборке — иначе временный бафф висел бы постоянно.
  if (payload.duration != null) return;
  // Числовые роли предметов (max_hp/speed/initiative) считает канал breakdown/passives листа —
  // там предметы уже присутствуют. Здесь их пропускаем, иначе значение задвоится (Решение 2а:
  // ruleState остаётся «голым» по числовым ролям, единый источник — breakdown). Гранты
  // (grant_ability_score/grant_sense/grant_speed) breakdown НЕ трогает — они идут своим путём.
  if (source.type === 'item') return;
  const roll = String((payload.applies_to as Dict | undefined)?.roll ?? '');
  if (!NUMERIC_ROLLS.has(roll)) return;
  if (payload.op != null && payload.op !== 'add') return; // advantage/disadvantage — не числовые
  if (payload.value == null) return;
  const raw = String(payload.value).replace(/^\+/, '');
  let v: number;
  try {
    const r = evaluate(raw, formulaCtx);
    v = typeof r === 'number' ? r : Number(raw);
  } catch {
    v = Number(raw);
  }
  if (!Number.isNaN(v) && v !== 0) numericMods[roll] = (numericMods[roll] ?? 0) + v;
}

type SenseEntry = { sense: string; range: number };

/** grant_ability_score → накопление дельты характеристики (D3, пред-скан ДО расчёта
 *  модов: прирост должен дойти до maxHP/спасбросков/заклинательства/навыков). */
function applyAbilityDelta(payload: Dict, deltas: Record<AbilityKey, number>) {
  if (String(payload.kind ?? '') !== 'grant_ability_score') return;
  // Прямой грант: ability задан, amount/value — прибавка. Выбор характеристики: apply-шаблон
  // `{kind:'grant_ability_score', amount:N}`, выбранная характеристика приходит в value —
  // поэтому ability берём из ability ИЛИ value, а прибавку строго из amount (value занят id).
  const hasExplicitAbility = payload.ability != null && payload.ability !== '';
  const ability = String((hasExplicitAbility ? payload.ability : payload.value) ?? '').toLowerCase();
  if (!(ABILITY_KEYS as readonly string[]).includes(ability)) return;
  const amount = hasExplicitAbility
    ? Number(payload.amount ?? payload.value ?? 0)
    : Number(payload.amount ?? 0);
  if (!Number.isNaN(amount) && amount !== 0) deltas[ability as AbilityKey] += amount;
}

/** C8: value_method характеристики (парадигма №3) — кандидат-значение для СИЛ/ЛВК/… «Пояс силы огра» =
 *  value_method{target:'str', formula:'19'} → СИЛ = максимум(база+ASI, 19). Вычисляется ДО модов, поэтому
 *  формула не должна ссылаться на характеристики (циклично → тихий 0). ГРАНИЦЫ (роадмап): source —
 *  эффекты/действия (черта/класс/раса) И предметы через runtimeSources (слайс 1 «предмет=эффект»: надетый/
 *  настроенный Пояс силы огра теперь поднимает СИЛ на живом листе). target — только характеристики
 *  (speed/save_dc/ac — продолжение). Уменьшение (drain «СИЛ=3») невыразимо (max). */
function applyAbilityMethod(payload: Dict, methods: Record<AbilityKey, number[]>, fctx: FormulaContext) {
  if (String(payload.kind ?? '') !== 'value_method') return;
  const target = String(payload.target ?? '').toLowerCase();
  if (!(ABILITY_KEYS as readonly string[]).includes(target)) return; // C8: пока только характеристики
  const raw = String(payload.formula ?? payload.value ?? '').replace(/^\+/, '');
  if (!raw) return;
  let v: number;
  try { const r = evaluate(raw, fctx); v = typeof r === 'number' ? r : NaN; }
  catch { v = NaN; }
  if (!Number.isNaN(v)) methods[target as AbilityKey].push(v);
}

/** Пред-скан характеристик по всем источникам (эффекты/действия/runtime), с разворачиванием choice и
 *  уровневым гейтом — зеркалит обход applyPayload. Собирает и аддитивные дельты (grant_ability_score),
 *  и value_method-кандидаты (C8). */
function collectAbilityDeltas(
  input: RuleInput,
  effects: OriginEffect[],
  actions: OriginAction[],
): { deltas: Record<AbilityKey, number>; methods: Record<AbilityKey, number[]> } {
  const deltas = Object.fromEntries(ABILITY_KEYS.map((a) => [a, 0])) as Record<AbilityKey, number>;
  const methods = Object.fromEntries(ABILITY_KEYS.map((a) => [a, [] as number[]])) as Record<AbilityKey, number[]>;
  const level = input.draft.level ?? 1;
  // C8: ctx для value_method-формул на пред-скане. selfLevel/classLevels/переменные доступны;
  // характеристики (abilityMods) НАМЕРЕННО нет — они и вычисляются здесь (цикличность), поэтому
  // формула value_method не должна ссылаться на характеристики (иначе тихо резолвится в 0).
  const preFctx: FormulaContext = {
    selfLevel: level,
    profBonus: proficiencyBonusForLevel(level),
    classLevels: input.assembled.klass?.name ? { [input.assembled.klass.name.toLowerCase()]: level } : {},
    variables: input.assembled.variables,
  };
  const walk = (payload: Dict, source: RuleSource, depth = 0) => {
    if (payload.kind === 'choice') {
      if (depth >= MAX_CHOICE_DEPTH) return;
      const rawChoiceId = String(payload.id || 'choice');
      const choiceId = choiceInstanceId(source.id, rawChoiceId);
      const selected = input.draft.resolvedChoices[choiceId] || input.draft.resolvedChoices[rawChoiceId] || [];
      // Рекурсия зеркалит applyPayload: вложенный choice (ASI: режим → характеристика)
      // разворачивается, grant_ability_score из его item.grants доходит до дельт.
      for (const sp of selectedChoicePayloads(payload, selected)) walk(sp, source, depth + 1);
      return;
    }
    if (passesLevelGate(payload, level)) {
      applyAbilityDelta(payload, deltas);
      applyAbilityMethod(payload, methods, preFctx);
    }
  };
  for (const { effect, origin } of effects) {
    for (const p of payloadsFromMechanics(effect.mechanics)) walk(p, sourceFromOrigin(origin, effect));
  }
  for (const { action, origin } of actions) {
    for (const p of payloadsFromMechanics(action.mechanics)) walk(p, sourceFromOrigin(origin, action));
  }
  for (const runtime of input.runtimeSources || []) {
    for (const p of payloadsFromMechanics(runtime.mechanics)) walk(p, runtime.source);
  }
  return { deltas, methods };
}

/** Строковый размер расы (RU) → числовая категория: Крошечный 0 … Громадный 5. «Средний или
 *  Маленький» → 2 (Средний по умолчанию). Порядок проверок — от больших, чтобы «средний» в составной
 *  строке победил «маленький». */
export function sizeToNumber(s: string | null | undefined): number {
  const k = String(s ?? '').toLowerCase();
  if (k.includes('громадн')) return 5;
  if (k.includes('огромн')) return 4;
  if (k.includes('больш')) return 3;
  if (k.includes('средн')) return 2;
  if (k.includes('маленьк') || k.includes('мал')) return 1;
  if (k.includes('крошечн')) return 0;
  return 2;
}

/**
 * weapon_mastery → ВЫБРАННЫЕ виды оружия для искусности (Weapon Mastery, PHB 2024).
 * Пейлоад приходит из choice особенности «Искусное владение оружием» (source:'weapon',
 * apply:{kind:'weapon_mastery'}) — как выбор кузни, так и in-play (перевыбор на листе после
 * долгого отдыха): оба пути идут через resolvedChoices в этот же резолвер.
 */
function collectWeaponMastery(payload: Dict, masteries: string[]) {
  if (String(payload.kind ?? '') !== 'weapon_mastery') return;
  const v = String(payload.value ?? payload.weapon_type ?? '').trim();
  if (v && !masteries.includes(v)) masteries.push(v);
}

/** grant_sense / grant_speed → чувства и небазовые скорости (walk-прибавка → numericMods.walk_grant,
 *  входит в базовую скорость; non-walk режимы fly/swim/climb → speeds). */
function collectSenseSpeed(
  payload: Dict, formulaCtx: FormulaContext,
  numericMods: Record<string, number>, senses: SenseEntry[], speeds: Record<string, number>,
) {
  const kind = String(payload.kind ?? '');
  if (kind === 'grant_sense') {
    const sense = String(payload.sense ?? payload.value ?? '').toLowerCase();
    if (!sense) return;
    const range = Number(payload.range ?? 60) || 60;
    const existing = senses.find((s) => s.sense === sense);
    if (existing) { if (range > existing.range) existing.range = range; } // несколько источников → больший радиус
    else senses.push({ sense, range });
    return;
  }
  if (kind === 'grant_speed') {
    const mode = String(payload.mode ?? 'walk').toLowerCase();
    const raw = String(payload.value ?? payload.amount ?? 0).replace(/^\+/, '');
    let v: number;
    try { const r = evaluate(raw, formulaCtx); v = typeof r === 'number' ? r : Number(raw); }
    catch { v = Number(raw); } // формульный value (напр. 'walk_speed') без резолва → NaN → мягкий пропуск
    if (Number.isNaN(v) || v === 0) return;
    // grant_speed walk → БАЗОВАЯ скорость (breakdown НЕ добавляет grant_speed повторно, только
    // modifier). Отдельный аккумулятор от numericMods.speed (там modifier-speed, который breakdown
    // повторяет из passives) — иначе база breakdown содержала бы modifier дважды. См. baseSpeed ниже.
    if (mode === 'walk') numericMods.walk_grant = (numericMods.walk_grant ?? 0) + v;
    else speeds[mode] = Math.max(speeds[mode] ?? 0, v); // абсолютная скорость режима (fly/swim/climb)
  }
}

function applyPayload(
  payload: Dict,
  source: RuleSource,
  input: RuleInput,
  maps: ReturnType<typeof emptySetMap>,
  expertise: { skill: Map<string, AppliedGrant>; tool: Map<string, AppliedGrant> },
  appliedGrants: AppliedGrant[],
  conflicts: RuleConflict[],
  numericMods: Record<string, number>,
  formulaCtx: FormulaContext,
  repeatableFeats: Set<string>,
  senses: SenseEntry[],
  speeds: Record<string, number>,
  masteries: string[],
  depth = 0,
) {
  const level = input.draft.level ?? 1;
  if (payload.kind === 'choice') {
    if (depth >= MAX_CHOICE_DEPTH) return;
    const rawChoiceId = String(payload.id || 'choice');
    const choiceId = choiceInstanceId(source.id, rawChoiceId);
    const selected = input.draft.resolvedChoices[choiceId] || input.draft.resolvedChoices[rawChoiceId] || [];
    for (const selectedPayload of selectedChoicePayloads(payload, selected)) {
      // Вложенный choice (напр. item.grants выбранного режима ASI → выбор характеристики):
      // разворачиваем рекурсивно тем же путём, ключ вложенного выбора считается по его id.
      if (selectedPayload.kind === 'choice') {
        applyPayload(selectedPayload, source, input, maps, expertise, appliedGrants, conflicts, numericMods, formulaCtx, repeatableFeats, senses, speeds, masteries, depth + 1);
        continue;
      }
      if (!passesLevelGate(selectedPayload, level)) continue;
      collectNumericModifier(selectedPayload, formulaCtx, numericMods, source);
      collectSenseSpeed(selectedPayload, formulaCtx, numericMods, senses, speeds);
      collectWeaponMastery(selectedPayload, masteries);
      const grant = grantFromPayload(selectedPayload, source, choiceId);
      if (grant) addGrant(grant, maps, expertise, appliedGrants, conflicts, repeatableFeats);
    }
    return;
  }

  if (!passesLevelGate(payload, level)) return;
  collectNumericModifier(payload, formulaCtx, numericMods, source);
  collectSenseSpeed(payload, formulaCtx, numericMods, senses, speeds);
  collectWeaponMastery(payload, masteries);
  const grant = grantFromPayload(payload, source);
  if (grant) addGrant(grant, maps, expertise, appliedGrants, conflicts, repeatableFeats);
}

function applyMechanics(
  entity: PassiveEffect | Action,
  source: RuleSource,
  input: RuleInput,
  maps: ReturnType<typeof emptySetMap>,
  expertise: { skill: Map<string, AppliedGrant>; tool: Map<string, AppliedGrant> },
  appliedGrants: AppliedGrant[],
  conflicts: RuleConflict[],
  numericMods: Record<string, number>,
  formulaCtx: FormulaContext,
  repeatableFeats: Set<string>,
  senses: SenseEntry[],
  speeds: Record<string, number>,
  masteries: string[],
) {
  for (const payload of payloadsFromMechanics(entity.mechanics)) {
    applyPayload(payload, source, input, maps, expertise, appliedGrants, conflicts, numericMods, formulaCtx, repeatableFeats, senses, speeds, masteries);
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
  // Владения класса: доспехи / оружие / инструменты (PHB 2024, таблица класса).
  for (const armor of assembled.klass?.armor_training || []) {
    addGrant({ source: classSource, kind: 'armor', value: armor, mode: 'proficiency' }, maps, expertise, appliedGrants, conflicts);
  }
  for (const weapon of assembled.klass?.weapon_proficiencies || []) {
    addGrant({ source: classSource, kind: 'weapon', value: weapon, mode: 'proficiency' }, maps, expertise, appliedGrants, conflicts);
  }
  for (const tool of assembled.klass?.tool_proficiencies || []) {
    addGrant({ source: classSource, kind: 'tool', value: tool, mode: 'proficiency' }, maps, expertise, appliedGrants, conflicts);
  }

  // D3: grant_ability_score — пред-скан ДО расчёта модов, чтобы прирост дошёл до ВСЕХ
  // производных (maxHP, спасброски, заклинательство, навыки). ASI 4 уровня, +расы/предыстории.
  const { deltas: abilityDeltas, methods: abilityMethods } = collectAbilityDeltas(input, assembled.effects as OriginEffect[], assembled.actions as OriginAction[]);
  const scoresFinal = Object.fromEntries(
    ABILITY_KEYS.map((a) => {
      const base = draft.abilities[a] ?? 10;
      const delta = abilityDeltas[a] ?? 0;
      // Предел 2024: прирост (ASI и т.п.) не поднимает характеристику выше 20; уже-высокую
      // базу (ручной ввод/особые источники) не режем. Уменьшения (drain) не ограничиваем.
      const ceiling = Math.max(base, 20);
      const additive = delta > 0 ? Math.min(base + delta, ceiling) : base + delta;
      // C8: value_method-кандидаты (Пояс силы огра СИЛ=19) — берём МАКСИМУМ(аддитив, ...методы).
      // Методы НЕ режутся потолком 20 (магия: Пояс силы великана 25). Пустой список → аддитив.
      const final = Math.max(additive, ...abilityMethods[a]);
      return [a, Math.max(1, final)];
    }),
  ) as Record<AbilityKey, number>;

  const scores0 = scoresFinal;
  const pb0 = proficiencyBonusForLevel(draft.level);
  const abilityMods0 = Object.fromEntries(
    ABILITY_KEYS.map((ability) => [ability, abilityMod(scores0[ability])]),
  ) as Record<AbilityKey, number>;
  // Контекст формул для числовых модификаторов эффектов («2*self_level» у Крепкого).
  const formulaCtx: FormulaContext = {
    abilityMods: abilityMods0,
    profBonus: pb0,
    selfLevel: draft.level,
    classLevels: assembled.klass?.name ? { [assembled.klass.name.toLowerCase()]: draft.level } : {},
    variables: assembled.variables,
  };
  const numericMods: Record<string, number> = {};
  const senses: SenseEntry[] = [];
  const speeds: Record<string, number> = {};
  // Искусность: выбранные виды оружия (Weapon Mastery 2024).
  const masteries: string[] = [];
  // Повторяемые черты — id из собранных черт (assembled.feats).
  const repeatableFeats = new Set((assembled.feats || []).filter((f) => f.repeatable).map((f) => f.id));

  for (const { effect, origin } of assembled.effects as OriginEffect[]) {
    applyMechanics(effect, sourceFromOrigin(origin, effect), input, maps, expertise, appliedGrants, conflicts, numericMods, formulaCtx, repeatableFeats, senses, speeds, masteries);
  }
  for (const { action, origin } of assembled.actions as OriginAction[]) {
    applyMechanics(action, sourceFromOrigin(origin, action), input, maps, expertise, appliedGrants, conflicts, numericMods, formulaCtx, repeatableFeats, senses, speeds, masteries);
  }
  for (const runtime of input.runtimeSources || []) {
    for (const payload of payloadsFromMechanics(runtime.mechanics)) {
      applyPayload(payload, runtime.source, input, maps, expertise, appliedGrants, conflicts, numericMods, formulaCtx, repeatableFeats, senses, speeds, masteries);
    }
  }

  const scores = scoresFinal;
  const pb = proficiencyBonusForLevel(draft.level);
  const abilityMods = abilityMods0;

  // Заклинательство считаем ДО производных: (а) подкласс-кастеры (Мистический рыцарь/
  // Ловкач) — проброс subclassName, иначе spellcasting=null и лист не показывает СЛ/атаку;
  // (б) spellcastingMod нужен formulaCtx AC-формул (редкие формулы КЗ от заклинательства).
  const spellDerived = spellcasting(assembled.klass?.name, scores, pb, assembled.subclass?.name);
  const spellcastingMod = spellDerived ? abilityMods[spellDerived.ability] : undefined;

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

  // Числовые модификаторы эффектов вливаются в производные значения листа
  // (фундаментально, единообразно с расчётом КЗ через breakdown).
  const maxHP = computeMaxHP(assembled.klass?.hit_die, scores.con, draft.level) + (numericMods.max_hp ?? 0);
  // Единый КЗ (C9): тот же примитив, что на листе (armorClassValue). На этапе резолва
  // билда экипировки нет (стартовое снаряжение уходит в inventory уже после создания) —
  // считается «голый» КЗ: база / Unarmored Defense / set_value ac_base + modifier-эффекты
  // (стиль «Оборона» +1 и т.п.); броню лист учтёт позже сам через breakdownValue('ac').
  const acPassives: Dict[] = [
    ...(assembled.effects as OriginEffect[]).map((e) => e.effect.mechanics),
    ...(assembled.actions as OriginAction[]).map((a) => a.action.mechanics),
    // Предметы в КЗ резолвера НЕ вливаем: ruleState.armorClass — «голый» билд-КЗ (см. выше),
    // а КЗ от предметов лист считает через breakdown('ac')/passives (там предметы уже есть).
    // Не-предметные runtimeSources (врем. эффекты/условия из боя) в КЗ по-прежнему участвуют.
    ...(input.runtimeSources || []).filter((r) => r.source.type !== 'item').map((r) => r.mechanics),
  ].filter((m): m is Dict => !!m && typeof m === 'object');
  const acCharacter: CharacterContext = {
    abilityMods,
    profBonus: pb,
    level: draft.level,
    classLevels: formulaCtx.classLevels,
    variables: assembled.variables,
    spellcastingMod,
  };
  const armorClass = armorClassValue(acCharacter, { equipment: {}, activeEffects: [] } as unknown as RuntimeState, acPassives).value;
  // baseSpeed = раса + прибавки grant_speed(walk); БЕЗ modifier-speed. Разбивка листа
  // (breakdown('speed')) берёт baseSpeed за базу и добавляет modifier-speed из passives ОДИН раз
  // (иначе modifier считался бы дважды, т.к. characterSpeed=ruleState.speed уже его содержит).
  const baseSpeed = (assembled.race?.speed ?? 30) + (numericMods.walk_grant ?? 0);
  // H: не-аддитивная алгебра скорости (Скорость 0 у Схвачен/Опутан/Парализован/Без сознания;
  // ×2 у Ускорения) должна доходить и до ruleState.speed → characterContext.characterSpeed (формулы,
  // будущий грид-бой), а не только до отображения листа (breakdown('speed')). Собираем set/multiply-
  // ops состояний из runtimeSources (лист передаёт активные состояния как condition-источники).
  const speedAdditive = baseSpeed + (numericMods.speed ?? 0); // все аддитивные прибавки
  const speedOps: ModifierOp[] = [];
  for (const rt of input.runtimeSources ?? []) {
    for (const p of payloadsFromMechanics(rt.mechanics)) {
      if (p.kind !== 'modifier' || String(p.scope ?? 'self') === 'target') continue;
      if (String((p.applies_to as Dict | undefined)?.roll ?? '') !== 'speed') continue;
      const op = String(p.op ?? '');
      if (op === 'set' || op === 'multiply' || op === 'upgrade' || op === 'downgrade') {
        const v = Number(String(p.value ?? '').replace(/^\+/, ''));
        if (!Number.isNaN(v)) speedOps.push({ op: op as ModifierOp['op'], value: v, priority: Number(p.priority ?? 0) || 0, source: rt.source.name });
      }
    }
  }
  const speed = speedOps.length
    ? Math.max(0, foldModifiers(speedAdditive, { modifiers: [], advantage: 'none', hasAdvantage: false, hasDisadvantage: false, ops: speedOps, autoFail: false, denied: false, rules: [] }).value)
    : speedAdditive;
  const initiativeBonus = abilityMod(scores.dex) + (numericMods.initiative ?? 0);
  // Размер как числовая категория (Крошечный=0…Громадный=5). База — раса (Голиаф Средний=2);
  // «или Маленький» → Средний по умолчанию. Постоянные size-модификаторы (редко) прибавляются;
  // временные (Большая форма) считает breakdown('size') из активных эффектов.
  const size = sizeToNumber(assembled.race?.size) + (numericMods.size ?? 0);
  // Грузоподъёмность = Сила×15×множитель размера. numericMods.carry — прибавка размера ТОЛЬКО для
  // груза (Мощное телосложение Голиафа: modifier applies_to roll:'carry' +1 → считается на категорию
  // больше). Парадигма №3: это отдельный «метод» размера для формулы груза, не меняющий боевой размер.
  const carrySize = Math.max(0, size + (numericMods.carry ?? 0));
  const carryMult = carrySize <= 0 ? 0.5 : carrySize <= 2 ? 1 : 2 ** (carrySize - 2);
  const carryingCapacity = Math.floor((scores.str ?? 10) * 15 * carryMult);

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
    freeuseSpells: [...maps.spell.values()]
      .filter((g) => g.freeuse)
      .map((g): FreeuseSpec => ({ spell: g.value, ...g.freeuse! })),
    skillBonuses,
    savingThrowBonuses,
    maxHP,
    armorClass,
    speed,
    baseSpeed,
    size,
    carryingCapacity,
    senses,
    speeds,
    weaponMasteries: masteries,
    initiativeBonus,
    passivePerception: 10 + (skillBonuses.perception ?? abilityMod(scores.wis)),
    spellcasting: spellDerived,
    appliedGrants,
    conflicts,
    variables: assembled.variables ?? {},
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
