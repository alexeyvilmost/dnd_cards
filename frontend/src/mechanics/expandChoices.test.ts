/**
 * Ярус 1.1: разворот выбранной choice-ветки в пассивы. Тесты дискриминирующие — до правки
 * collectPassiveMechanics отдавал механику как есть, и выбранное сопротивление в пассивы НЕ
 * попадало. Отдельно проверяем защиту от рассинхрона ключа (неверный ключ → пусто).
 */
import { describe, expect, it } from 'vitest';
import { expandPassiveChoicePayloads, passiveSourceId, choiceInstanceId } from './expandChoices';
import { collectPassiveMechanics } from '../character/resourceInit';
import { payloadsOf } from '../engine/mechanicsView';
import { collectModifiers } from '../engine/modifiers';
import { applyIncomingDamage } from '../engine/execute';
import type { AssembledCharacter } from '../character/assemble';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

const origin = { kind: 'feat', id: 'elemental-adept', name: 'Родство со стихией' };
const feature = { id: 'eff-resist', name: 'Родство' };
const src = passiveSourceId(origin, feature);
const key = choiceInstanceId(src, 'elemental_resist');

// Пассивка с выбором сопротивления (options.items с явными grants — корректная рантайм-форма).
const resistMech: Dict = {
  activation: { mode: 'passive' }, name: 'Родство со стихией',
  effects: [{ kind: 'choice', id: 'elemental_resist', options: { source: 'damage_type', items: [
    { id: 'fire', name: 'Огонь', grants: [{ kind: 'resistance', damage_type: 'fire', value: 'resistance' }] },
    { id: 'cold', name: 'Холод', grants: [{ kind: 'resistance', damage_type: 'cold', value: 'resistance' }] },
  ] } }],
};

describe('expandPassiveChoicePayloads — единичный разворот', () => {
  it('выбранное сопротивление разворачивается в рантайм-пейлоад', () => {
    expect(expandPassiveChoicePayloads(resistMech, src, { [key]: ['fire'] }))
      .toEqual([{ kind: 'resistance', damage_type: 'fire', value: 'resistance' }]);
  });
  it('без выбора — пусто (регрессия: раньше выбор вообще не разворачивался)', () => {
    expect(expandPassiveChoicePayloads(resistMech, src, {})).toEqual([]);
  });
  it('неверный ключ (рассинхрон) → пусто — защита от тихого несовпадения', () => {
    expect(expandPassiveChoicePayloads(resistMech, src, { 'feat:wrong:elemental_resist': ['fire'] })).toEqual([]);
  });
  it('fallback на «голый» rawChoiceId тоже читается', () => {
    expect(expandPassiveChoicePayloads(resistMech, src, { elemental_resist: ['cold'] }))
      .toEqual([{ kind: 'resistance', damage_type: 'cold', value: 'resistance' }]);
  });
  it('build-гранты (grant_*) НЕ тащатся в пассивы — их применяет резолвер', () => {
    const skillMech: Dict = { effects: [{ kind: 'choice', id: 'skl', options: { source: 'skill' }, apply: { kind: 'grant_proficiency', prof: 'skill' } }] };
    const k = choiceInstanceId(src, 'skl');
    expect(expandPassiveChoicePayloads(skillMech, src, { [k]: ['stealth'] })).toEqual([]);
  });

  // Штатная форма конструктора: source:'damage_type' с grant-шаблоном {kind:'resistance'} (blocks.ts),
  // БЕЗ per-item grants. До нормализации давала {kind:'resistance', value:'fire'} — resistanceLevelFor не матчил.
  it('конструктор-форма (apply-шаблон resistance) приводится к рабочему виду', () => {
    const ctorMech: Dict = { effects: [{ kind: 'choice', id: 'res', options: { source: 'damage_type' }, grant: { kind: 'resistance' } }] };
    const k = choiceInstanceId(src, 'res');
    expect(expandPassiveChoicePayloads(ctorMech, src, { [k]: ['fire'] }))
      .toEqual([{ kind: 'resistance', damage_type: 'fire', value: 'resistance' }]);
  });
  it('явный уровень (immunity) в items-форме нормализацией НЕ ломается', () => {
    const immMech: Dict = { effects: [{ kind: 'choice', id: 'imm', options: { source: 'damage_type', items: [
      { id: 'fire', grants: [{ kind: 'resistance', damage_type: 'fire', value: 'immunity' }] },
    ] } }] };
    const k = choiceInstanceId(src, 'imm');
    expect(expandPassiveChoicePayloads(immMech, src, { [k]: ['fire'] }))
      .toEqual([{ kind: 'resistance', damage_type: 'fire', value: 'immunity' }]);
  });
  it('несколько выбранных значений → несколько пейлоадов', () => {
    expect(expandPassiveChoicePayloads(resistMech, src, { [key]: ['fire', 'cold'] })).toEqual([
      { kind: 'resistance', damage_type: 'fire', value: 'resistance' },
      { kind: 'resistance', damage_type: 'cold', value: 'resistance' },
    ]);
  });
  it('вложенный choice в grants разворачивается рекурсивно тем же ключом', () => {
    const nested: Dict = { effects: [{ kind: 'choice', id: 'outer', options: { source: 'explicit', items: [
      { id: 'branch', grants: [{ kind: 'choice', id: 'inner', options: { source: 'damage_type' }, grant: { kind: 'resistance' } }] },
    ] } }] };
    const out = expandPassiveChoicePayloads(nested, src, { [choiceInstanceId(src, 'outer')]: ['branch'], [choiceInstanceId(src, 'inner')]: ['cold'] });
    expect(out).toEqual([{ kind: 'resistance', damage_type: 'cold', value: 'resistance' }]);
  });
});

// ─── Интеграция: choice → collectPassiveMechanics → resistanceLevelFor → урон вдвое ──────────
function assembledWith(mech: Dict): AssembledCharacter {
  return {
    race: { id: 'x', name: 'x', speed: 30 }, klass: null, subclass: null, background: null,
    feats: [], effects: [{ effect: { id: feature.id, name: feature.name, mechanics: mech }, origin }],
    actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
}
const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
const fresh = (): RuntimeState => ({ hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });

describe('collectPassiveMechanics — выбранный runtime-пейлоад доходит до боя', () => {
  it('выбранное сопротивление появляется в пассивах (payloadsOf видит)', () => {
    const passives = collectPassiveMechanics(assembledWith(resistMech), { [key]: ['fire'] });
    const payloads = passives.flatMap((m) => payloadsOf(m));
    expect(payloads.some((p) => p.kind === 'resistance' && p.damage_type === 'fire')).toBe(true);
  });
  it('и режет входящий урон выбранного типа вдвое (сквозной путь)', () => {
    const passives = collectPassiveMechanics(assembledWith(resistMech), { [key]: ['fire'] });
    const ctx = { character, rng: () => 0.5, passives } as unknown as ExecuteContext;
    expect(applyIncomingDamage(fresh(), 10, ctx, { damageType: 'fire' }).state.hp.current).toBe(15); // 10 → 5
    expect(applyIncomingDamage(fresh(), 10, ctx, { damageType: 'cold' }).state.hp.current).toBe(10); // другой тип — полный
  });
  it('без разрешённого выбора урон не режется (регрессия границы)', () => {
    const passives = collectPassiveMechanics(assembledWith(resistMech), {});
    const ctx = { character, rng: () => 0.5, passives } as unknown as ExecuteContext;
    expect(applyIncomingDamage(fresh(), 10, ctx, { damageType: 'fire' }).state.hp.current).toBe(10);
  });
  it('выбранный modifier доходит до collectModifiers (не только resistance)', () => {
    const modMech: Dict = { name: 'Дар', effects: [{ kind: 'choice', id: 'perk', options: { source: 'explicit', items: [
      { id: 'atk', grants: [{ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '2' }] },
    ] } }] };
    const passives = collectPassiveMechanics(assembledWith(modMech), { [choiceInstanceId(src, 'perk')]: ['atk'] });
    const collected = collectModifiers(fresh(), passives, { roll: 'attack' });
    expect(collected.modifiers.some((m) => m.value === 2)).toBe(true);
  });
});
