/**
 * Разбивка значений листа (фаза F2).
 */
import type { CharacterContext, RollModifier, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { computeAC } from './ac';
import { hitDieMax } from '../character/derive';
import { abilityOfSkill } from '../character/rules/foundation';
import { payloadsOf } from './mechanicsView';
import { evaluate, type FormulaContext } from './formula';

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
  };
}

/**
 * Числовые self-модификаторы эффектов для заданной роли (ac/max_hp/speed/…).
 * Значение может быть формулой («2*self_level» у Крепкого) — вычисляется.
 * Единый сборщик: раньше существовал только для КЗ (acModifiersFromEffects).
 */
function modifiersFromEffects(
  roll: string,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): RollModifier[] {
  const parts: RollModifier[] = [];
  const ctx = formulaCtxOf(character);
  const sources = [
    ...state.activeEffects.map((e) => ({ name: e.name, mech: e.mechanics })),
    ...passives.map((m, i) => ({ name: String(m.name ?? `пассивка ${i}`), mech: m })),
  ];
  for (const { name, mech } of sources) {
    for (const payload of payloadsOf(mech as Dict)) {
      if (payload.kind !== 'modifier') continue;
      const applies = payload.applies_to as Dict | undefined;
      if (applies?.roll !== roll) continue;
      if ((payload.op != null && payload.op !== 'add') || payload.value == null) continue;
      const raw = String(payload.value).replace(/^\+/, '');
      let value: number;
      try {
        const r = evaluate(raw, ctx);
        value = typeof r === 'number' ? r : Number(raw);
      } catch {
        value = Number(raw);
      }
      if (!Number.isNaN(value) && value !== 0) {
        parts.push({ value, source: name, reason: 'эффект' });
      }
    }
  }
  return parts;
}

function breakdownAC(
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  const base = computeAC(character, state, passives);
  const fxParts = modifiersFromEffects('ac', character, state, passives);
  const fxSum = fxParts.reduce((s, p) => s + p.value, 0);
  return {
    value: base.value + fxSum,
    parts: [...base.parts, ...fxParts],
  };
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
  const fxParts = modifiersFromEffects('max_hp', character, state, passives);
  const parts = [...baseParts, ...fxParts];
  return { value: parts.reduce((s, p) => s + p.value, 0), parts };
}

function breakdownSave(ability: AbilityKey, character: CharacterContext): ValueBreakdown {
  const mod = character.abilityMods[ability] ?? 0;
  const parts: RollModifier[] = [
    { value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики' },
  ];
  let total = mod;
  if (saveProficiencies(character).has(ability)) {
    parts.push({ value: character.profBonus, source: 'БМ', reason: 'владение' });
    total += character.profBonus;
  }
  return { value: total, parts };
}

function breakdownSkill(skillId: string, character: CharacterContext): ValueBreakdown {
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
    const fxParts = modifiersFromEffects('initiative', character, state, passives);
    const parts = [{ value: base, source: 'ЛВК', reason: 'модификатор инициативы' }, ...fxParts];
    return { value: parts.reduce((s, p) => s + p.value, 0), parts };
  }
  if (what === 'speed') {
    const base = character.characterSpeed ?? 30;
    const fxParts = modifiersFromEffects('speed', character, state, passives);
    const parts = [{ value: base, source: 'скорость', reason: 'базовая' }, ...fxParts];
    return { value: parts.reduce((s, p) => s + p.value, 0), parts };
  }
  if (what.startsWith('save:')) {
    return breakdownSave(what.slice(5) as AbilityKey, character);
  }
  if (what.startsWith('skill:')) {
    return breakdownSkill(what.slice(6), character);
  }
  return { value: 0, parts: [] };
}
