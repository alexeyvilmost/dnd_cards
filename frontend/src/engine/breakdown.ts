/**
 * Разбивка значений листа (фаза F2).
 */
import type { CharacterContext, RollModifier, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { computeAC } from './ac';
import { hitDieMax } from '../character/derive';
import { abilityOfSkill } from '../character/rules/foundation';
import { payloadsOf } from './mechanicsView';

type Dict = Record<string, unknown>;
type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};

const FIGHTER_SAVE_PROF: AbilityKey[] = ['str', 'con'];

function fighterSaves(ctx: CharacterContext): Set<AbilityKey> {
  if (ctx.classLevels?.fighter) return new Set(FIGHTER_SAVE_PROF);
  return new Set();
}

function defaultHitDie(ctx: CharacterContext): string {
  if (ctx.classLevels?.fighter) return 'd10';
  return 'd8';
}

function acModifiersFromEffects(state: RuntimeState, passives: Dict[]): RollModifier[] {
  const parts: RollModifier[] = [];
  const sources = [
    ...state.activeEffects.map((e) => ({ name: e.name, mech: e.mechanics })),
    ...passives.map((m, i) => ({ name: String(m.name ?? `пассивка ${i}`), mech: m })),
  ];
  for (const { name, mech } of sources) {
    for (const payload of payloadsOf(mech as Dict)) {
      if (payload.kind !== 'modifier') continue;
      const applies = payload.applies_to as Dict | undefined;
      if (applies?.roll !== 'ac') continue;
      if (payload.op !== 'add' || payload.value == null) continue;
      const raw = String(payload.value).replace(/^\+/, '');
      const value = Number(raw);
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
  const fxParts = acModifiersFromEffects(state, passives);
  const fxSum = fxParts.reduce((s, p) => s + p.value, 0);
  return {
    value: base.value + fxSum,
    parts: [...base.parts, ...fxParts],
  };
}

function breakdownMaxHp(character: CharacterContext, state: RuntimeState): ValueBreakdown {
  const hitDie = character.hitDie ?? defaultHitDie(character);
  const dieMax = hitDieMax(hitDie);
  const conMod = character.abilityMods.con ?? 0;
  const lvl = Math.max(1, character.level);

  if (lvl === 1) {
    const parts: RollModifier[] = [
      { value: dieMax, source: 'кость хитов', reason: hitDie },
      { value: conMod, source: 'ТЕЛ', reason: 'модификатор характеристики' },
    ];
    return { value: dieMax + conMod, parts };
  }

  const perLevel = Math.floor(dieMax / 2) + 1 + conMod;
  const parts: RollModifier[] = [
    { value: dieMax, source: 'кость хитов', reason: '1-й уровень' },
    { value: (lvl - 1) * perLevel, source: 'уровни', reason: `${lvl - 1}×(${Math.floor(dieMax / 2) + 1}+ТЕЛ)` },
  ];
  const value = parts.reduce((s, p) => s + p.value, 0);
  return { value, parts };
}

function breakdownSave(ability: AbilityKey, character: CharacterContext): ValueBreakdown {
  const mod = character.abilityMods[ability] ?? 0;
  const parts: RollModifier[] = [
    { value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики' },
  ];
  let total = mod;
  if (fighterSaves(character).has(ability)) {
    parts.push({ value: character.profBonus, source: 'БМ', reason: 'владение' });
    total += character.profBonus;
  }
  return { value: total, parts };
}

function breakdownSkill(skillId: string, character: CharacterContext): ValueBreakdown {
  const ability = abilityOfSkill(skillId) as AbilityKey;
  const mod = character.abilityMods[ability] ?? 0;
  return {
    value: mod,
    parts: [{ value: mod, source: ABILITY_LABEL[ability], reason: 'модификатор характеристики' }],
  };
}

export function breakdownValue(
  what: 'ac' | 'max_hp' | 'initiative' | 'speed' | `save:${string}` | `skill:${string}`,
  character: CharacterContext,
  state: RuntimeState,
  passives: Dict[],
): ValueBreakdown {
  if (what === 'ac') return breakdownAC(character, state, passives);
  if (what === 'max_hp') return breakdownMaxHp(character, state);
  if (what === 'initiative') {
    const v = character.abilityMods.dex ?? 0;
    return { value: v, parts: [{ value: v, source: 'ЛВК', reason: 'модификатор инициативы' }] };
  }
  if (what === 'speed') {
    const v = character.characterSpeed ?? 30;
    return { value: v, parts: [{ value: v, source: 'скорость', reason: 'базовая' }] };
  }
  if (what.startsWith('save:')) {
    return breakdownSave(what.slice(5) as AbilityKey, character);
  }
  if (what.startsWith('skill:')) {
    return breakdownSkill(what.slice(6), character);
  }
  return { value: 0, parts: [] };
}
