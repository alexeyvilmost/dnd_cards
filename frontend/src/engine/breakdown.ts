/**
 * Разбивка значений листа (фаза F2).
 *
 * Фаза C: числовые модификаторы эффектов собираются единым formula-aware путём
 * (collectModifiers), а не отдельной копией логики. Спасброски и навыки теперь тоже
 * получают модификаторы эффектов (Аура защиты, Благословение и т.п. — раньше не
 * отображались на листе).
 */
import type { CharacterContext, RollModifier, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { armorClassValue } from './ac';
import { hitDieMax } from '../character/derive';
import { abilityOfSkill } from '../character/rules/foundation';
import { collectModifiers, foldModifiers } from './modifiers';
import type { FormulaContext } from './formula';

type Dict = Record<string, unknown>;
type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

/** Владения спасбросками: из rule_state (ctx.saveProficiencies); фолбэк —
 * старый хардкод Воина, чтобы не сломать вызовы без контекста владений. */
function saveProficiencies(ctx: CharacterContext): Set<AbilityKey> {
  if (ctx.saveProficiencies) return new Set(ctx.saveProficiencies as AbilityKey[]);
  if (ctx.classLevels?.fighter) return new Set<AbilityKey>(['str', 'con']);
  return new Set();
}

function defaultHitDie(ctx: CharacterContext): string {
  if (ctx.classLevels?.fighter) return 'd10';
  return 'd8';
}

function formulaCtxOf(character: CharacterContext): FormulaContext {
  return {
    abilityMods: character.abilityMods,
    profBonus: character.profBonus,
    selfLevel: character.level,
    classLevels: character.classLevels,
    spellcastingMod: character.spellcastingMod,
    characterSpeed: character.characterSpeed,
    variables: character.variables,
  };
}

/**
 * Числовые (аддитивные) модификаторы эффектов для роли (max_hp/speed/save/skill/…) — единым
 * formula-aware сборщиком collectModifiers. Advantage игнорируется (разбивка показывает только числа).
 * Не-аддитивная алгебра (C5 set/multiply/upgrade/downgrade) здесь НЕ применяется: эти значения имеют
 * отдельный аддитивный расчёт в resolveCharacterRules/бою, и свёртка только на листе разошлась бы с
 * реальным значением. Единственное значение с общим источником — КЗ (armorClassValue) — свёртку C5
 * применяет там. Обобщение алгебры на скорость/хиты/спасброски — вместе с C8 (value_method).
 */
function effectModifiers(
  roll: string,
  filter: Dict | undefined,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): RollModifier[] {
  return collectModifiers(state, passives, {
    roll,
    ...(filter ? { filter } : {}),
    formulaCtx: formulaCtxOf(character),
  }).modifiers;
}

function breakdownAC(
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  // Единый примитив (engine/ac.ts): та же формула КЗ, что персистит резолв билда (C9).
  return armorClassValue(character, state, passives);
}

function breakdownMaxHp(character: CharacterContext, state: RuntimeState, passives: Dict[]): ValueBreakdown {
  const hitDie = character.hitDie ?? defaultHitDie(character);
  const dieMax = hitDieMax(hitDie);
  const conMod = character.abilityMods.con ?? 0;
  const lvl = Math.max(1, character.level);

  const baseParts: RollModifier[] = lvl === 1
    ? [
      { value: dieMax, source: 'кость хитов', reason: hitDie },
      { value: conMod, source: 'ТЕЛ', reason: 'модификатор характеристики' },
    ]
    : [
      { value: dieMax, source: 'кость хитов', reason: '1-й уровень' },
      { value: conMod, source: 'ТЕЛ', reason: '1-й уровень' },
      { value: (lvl - 1) * (Math.floor(dieMax / 2) + 1 + conMod), source: 'уровни', reason: `${lvl - 1}×(${Math.floor(dieMax / 2) + 1}+ТЕЛ)` },
    ];
  const fxParts = effectModifiers('max_hp', undefined, character, state, passives);
  const parts = [...baseParts, ...fxParts];
  return { value: parts.reduce((s, p) => s + p.value, 0), parts };
}

function breakdownSave(
  ability: AbilityKey,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  const mod = character.abilityMods[ability] ?? 0;
  const parts: RollModifier[] = [
    { value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики' },
  ];
  let total = mod;
  if (saveProficiencies(character).has(ability)) {
    parts.push({ value: character.profBonus, source: 'БМ', reason: 'владение' });
    total += character.profBonus;
  }
  const fxParts = effectModifiers('saving_throw', { ability }, character, state, passives);
  for (const p of fxParts) { parts.push(p); total += p.value; }
  return { value: total, parts };
}

function breakdownSkill(
  skillId: string,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  const ability = abilityOfSkill(skillId) as AbilityKey;
  const mod = character.abilityMods[ability] ?? 0;
  const parts: RollModifier[] = [
    { value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики' },
  ];
  let total = mod;
  if (character.skillExpertise?.includes(skillId)) {
    parts.push({ value: character.profBonus * 2, source: 'БМ×2', reason: 'экспертиза' });
    total += character.profBonus * 2;
  } else if (character.skillProficiencies?.includes(skillId)) {
    parts.push({ value: character.profBonus, source: 'БМ', reason: 'владение' });
    total += character.profBonus;
  }
  const fxParts = effectModifiers('ability_check', { skill: skillId }, character, state, passives);
  for (const p of fxParts) { parts.push(p); total += p.value; }
  return { value: total, parts };
}

export function breakdownValue(
  what: 'ac' | 'max_hp' | 'initiative' | 'speed' | `save:${string}` | `skill:${string}`,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  if (what === 'ac') return breakdownAC(character, state, passives);
  if (what === 'max_hp') return breakdownMaxHp(character, state, passives);
  if (what === 'initiative') {
    const base = character.abilityMods.dex ?? 0;
    const fxParts = effectModifiers('initiative', undefined, character, state, passives);
    const parts = [{ value: base, source: 'ЛВК', reason: 'модификатор инициативы' }, ...fxParts];
    return { value: parts.reduce((s, p) => s + p.value, 0), parts };
  }
  if (what === 'speed') {
    // База = baseSpeed (раса + grant_speed walk, БЕЗ modifier-speed), затем modifier-speed из passives
    // добавляется ОДИН раз. Фолбэк на characterSpeed для контекстов без baseSpeed (тесты/бой). Иначе
    // (при базе=characterSpeed=итог) modifier-speed считался бы дважды — как база и как fxPart.
    const base = character.baseSpeed ?? character.characterSpeed ?? 30;
    // Скорость — единственное производное листа, где НУЖНА не-аддитивная алгебра C5: состояния
    // «Схвачен/Опутан/Парализован/Без сознания» задают Скорость 0 через op:'set' (у Ускорения был
    // бы ×2). foldModifiers применяет и аддитивные модификаторы, и set/multiply/upgrade/downgrade.
    const collected = collectModifiers(state, passives, { roll: 'speed', formulaCtx: formulaCtxOf(character) });
    const folded = foldModifiers(base, collected);
    const parts = [{ value: base, source: 'скорость', reason: 'базовая' }, ...folded.parts];
    return { value: Math.max(0, folded.value), parts };
  }
  if (what.startsWith('save:')) {
    return breakdownSave(what.slice(5) as AbilityKey, character, state, passives);
  }
  if (what.startsWith('skill:')) {
    return breakdownSkill(what.slice(6), character, state, passives);
  }
  return { value: 0, parts: [] };
}
