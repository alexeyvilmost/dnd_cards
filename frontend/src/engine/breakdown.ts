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
import { activeConditionsOf } from './circumstances';

type Dict = Record<string, unknown>;
type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

/** Владения спасбросками приходят только из rule_state/effect grants.
 * Отсутствующая проекция означает отсутствие объявленного владения. */
function saveProficiencies(ctx: CharacterContext): Set<AbilityKey> {
  return new Set((ctx.saveProficiencies ?? []) as AbilityKey[]);
}

function defaultHitDie(): string {
  // A legacy/incomplete context has no authority to infer a die from class
  // identity. Real character contexts project hitDie explicitly.
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
    evalCtx: { character, state, activeConditions: activeConditionsOf(state) },
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
  const hitDie = character.hitDie ?? defaultHitDie();
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
      // KB-114: на уровень не меньше 1 хита (кламп совпадает с computeMaxHP — инвариант C9).
      { value: (lvl - 1) * Math.max(1, Math.floor(dieMax / 2) + 1 + conMod), source: 'уровни', reason: `${lvl - 1}×max(1, ${Math.floor(dieMax / 2) + 1}+ТЕЛ)` },
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
    { value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики', kind: 'ability' },
  ];
  let total = mod;
  if (saveProficiencies(character).has(ability)) {
    parts.push({ value: character.profBonus, source: 'БМ', reason: 'владение', kind: 'proficiency' });
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
    { value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики', kind: 'ability' },
  ];
  let total = mod;
  const expert = character.skillExpertise?.includes(skillId) ?? false;
  const proficient = expert || (character.skillProficiencies?.includes(skillId) ?? false);
  if (expert) {
    parts.push({ value: character.profBonus * 2, source: 'БМ×2', reason: 'экспертиза', kind: 'expertise' });
    total += character.profBonus * 2;
  } else if (proficient) {
    parts.push({ value: character.profBonus, source: 'БМ', reason: 'владение', kind: 'proficiency' });
    total += character.profBonus;
  }
  const fxParts = effectModifiers('ability_check', { skill: skillId, proficient }, character, state, passives);
  for (const p of fxParts) { parts.push(p); total += p.value; }
  return { value: total, parts };
}

export function breakdownValue(
  what:
    | 'ac'
    | 'max_hp'
    | 'initiative'
    | 'speed'
    | 'size'
    | 'passive_perception'
    | 'spell_attack'
    | 'spell_dc'
    | `ability:${string}`
    | `ability_mod:${string}`
    | `save:${string}`
    | `skill:${string}`,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  if (what === 'ac') return breakdownAC(character, state, passives);
  if (what === 'max_hp') return breakdownMaxHp(character, state, passives);
  if (what === 'initiative') {
    const base = character.abilityMods.dex ?? 0;
    const fxParts = effectModifiers('initiative', undefined, character, state, passives);
    const parts: RollModifier[] = [{
      value: base,
      source: 'ЛВК',
      reason: 'модификатор инициативы',
      kind: 'ability',
    }, ...fxParts];
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
    const collected = collectModifiers(state, passives, {
      roll: 'speed', formulaCtx: formulaCtxOf(character),
      evalCtx: { character, state, activeConditions: activeConditionsOf(state) },
    });
    const folded = foldModifiers(base, collected);
    // Live ruleState.characterSpeed already contains this penalty. The visible
    // breakdown starts from baseSpeed, so project the data-declared armor rule
    // exactly once when that explicit base is available.
    const armorPenalty = character.baseSpeed == null ? 0 : passives.some((mechanics) => {
      const profile = mechanics.armor_profile as Dict | undefined;
      const required = Number(profile?.strength_requirement ?? 0);
      const strength = Number(character.abilityScores?.str ?? ((character.abilityMods.str ?? 0) * 2 + 10));
      return required > 0 && strength < required;
    }) ? -10 : 0;
    const parts = [
      { value: base, source: 'скорость', reason: 'базовая' },
      ...folded.parts,
      ...(armorPenalty ? [{ value: armorPenalty, source: 'Доспех', reason: 'не выполнено требование Силы' }] : []),
    ];
    return { value: Math.max(0, folded.value + armorPenalty), parts };
  }
  if (what === 'size') {
    // База = раса; временные модификаторы размера (Большая форма: +1 на 10 раундов) — из активных
    // эффектов. foldModifiers поддержит и op:'set' (превращение в конкретный размер), и аддитив.
    const base = character.baseSize ?? 2;
    const collected = collectModifiers(state, passives, { roll: 'size', formulaCtx: formulaCtxOf(character) });
    const folded = foldModifiers(base, collected);
    const parts = [{ value: base, source: 'размер', reason: 'базовый' }, ...folded.parts];
    return { value: Math.max(0, folded.value), parts };
  }
  if (what.startsWith('ability:')) {
    const ability = what.slice(8) as AbilityKey;
    const score = character.abilityScores?.[ability] ?? ((character.abilityMods[ability] ?? 0) * 2 + 10);
    const sourceParts = character.abilitySources?.[ability];
    const parts = sourceParts?.length
      ? sourceParts
      : [{ value: score, source: ABILITY_LABEL[ability], reason: 'итог после всех постоянных источников' }];
    const additive = parts.reduce((sum, part) => sum + part.value, 0);
    const methods = character.abilityMethods?.[ability] ?? [];
    const selected = methods.reduce<typeof methods[number] | undefined>(
      (best, candidate) => (!best || candidate.value > best.value ? candidate : best),
      undefined,
    );
    if (selected && selected.value > additive) {
      return {
        value: score,
        parts,
        selectedMethod: { name: selected.name, reason: selected.reason },
        rejected: [{ name: 'аддитивная сумма', value: additive }, ...methods
          .filter((candidate) => candidate !== selected)
          .map((candidate) => ({ name: candidate.name, value: candidate.value }))],
      };
    }
    return {
      value: score,
      parts,
    };
  }
  if (what.startsWith('ability_mod:')) {
    const ability = what.slice(12) as AbilityKey;
    const score = character.abilityScores?.[ability] ?? ((character.abilityMods[ability] ?? 0) * 2 + 10);
    const value = character.abilityMods[ability] ?? 0;
    const sourceParts = character.abilitySources?.[ability];
    return {
      value,
      parts: [{
        value,
        source: sourceParts?.length ? `модификатор ${ABILITY_LABEL[ability]}` : ABILITY_LABEL[ability],
        reason: `⌊(${score} − 10) / 2⌋`,
      }],
    };
  }
  if (what === 'passive_perception') {
    const skill = breakdownSkill('perception', character, state, passives);
    const parts: RollModifier[] = [
      { value: 10, source: 'Пассивная проверка', reason: 'базовое значение' },
      ...skill.parts,
    ];
    return { value: parts.reduce((sum, part) => sum + part.value, 0), parts };
  }
  if (what === 'spell_attack' || what === 'spell_dc') {
    const ability = character.spellcastingAbility;
    const abilityLabel = ability ? ABILITY_LABEL[ability] : 'Заклинательная характеристика';
    const spellMod = character.spellcastingMod ?? 0;
    const parts: RollModifier[] = [
      ...(what === 'spell_dc' ? [{ value: 8, source: 'СЛ заклинания', reason: 'базовое значение' }] : []),
      { value: character.profBonus, source: 'БМ', reason: 'бонус мастерства' },
      { value: spellMod, source: abilityLabel, reason: 'модификатор заклинательной характеристики' },
    ];
    return { value: parts.reduce((sum, part) => sum + part.value, 0), parts };
  }
  if (what.startsWith('save:')) {
    return breakdownSave(what.slice(5) as AbilityKey, character, state, passives);
  }
  if (what.startsWith('skill:')) {
    return breakdownSkill(what.slice(6), character, state, passives);
  }
  return { value: 0, parts: [] };
}
