/**
 * Слайс 1 «предмет = эффект»: механики надетых/настроенных предметов доходят до resolveCharacterRules
 * через input.runtimeSources (source.type='item'). Чинит баг «бонусы характеристик/владений/чувств от
 * предметов не работают» (ветка была пуста). Флагман — value_method ОТ ПРЕДМЕТА (Пояс силы огра): в
 * valueMethod.test это был явно отложенный случай. Плюс анти-задвоение: числовые роли (max_hp/speed) и КЗ
 * от предмета НЕ вливаются в ruleState (их считает канал breakdown/passives листа, там предметы уже есть).
 */
import { describe, expect, it } from 'vitest';
import { resolveCharacterRules } from './resolveCharacterRules';
import type { RuntimeRuleSource } from './types';
import { emptyDraft, type CharacterDraft } from '../types';
import type { AssembledCharacter } from '../assemble';

function baseAssembled(): AssembledCharacter {
  return {
    race: { id: 'x', name: 'x', speed: 30 }, klass: null, subclass: null, background: null,
    feats: [], effects: [], actions: [], spells: [],
    pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
}

function resolve(mechanics: unknown, opts?: { str?: number }): ReturnType<typeof resolveCharacterRules> {
  const draft: CharacterDraft = {
    ...emptyDraft(),
    abilities: { str: opts?.str ?? 10, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
    level: 5,
  };
  const runtimeSources: RuntimeRuleSource[] = mechanics == null ? [] : [
    { source: { type: 'item', id: 'belt-of-ogre', name: 'Пояс силы огра' }, mechanics: mechanics as Record<string, unknown> },
  ];
  return resolveCharacterRules({ draft, assembled: baseAssembled(), runtimeSources });
}

const item = (...effects: unknown[]): unknown => ({ effects });
// Реальная форма механик предмета (все 93 предмета с механиками в проде): effects[] с
// resolution:'auto' + result[]. payloadsFromMechanics извлекает result при resolution==='auto'.
const realItem = (...payloads: unknown[]): unknown => ({ effects: [{ resolution: 'auto', result: payloads }] });

describe('Слайс 1 — предмет доходит до резолвера правил (runtimeSources: item)', () => {
  it('grant_ability_score от предмета поднимает характеристику и модификатор', () => {
    const rs = resolve(item({ kind: 'grant_ability_score', ability: 'str', amount: 2 }), { str: 14 });
    expect(rs.abilities.str).toBe(16);
    expect(rs.abilityMods.str).toBe(3); // 16 → +3
  });

  it('ФЛАГМАН: value_method от ПРЕДМЕТА (Пояс силы огра) — СИЛ=19, если ниже', () => {
    expect(resolve(item({ kind: 'value_method', target: 'str', formula: '19' }), { str: 12 }).abilities.str).toBe(19);
  });

  it('value_method-предмет НЕ опускает уже-высокую СИЛ', () => {
    expect(resolve(item({ kind: 'value_method', target: 'str', formula: '19' }), { str: 20 }).abilities.str).toBe(20);
  });

  it('grant_sense от предмета (очки ночного зрения) → чувство darkvision', () => {
    const rs = resolve(item({ kind: 'grant_sense', sense: 'darkvision', range: 60 }));
    expect(rs.senses.some((s) => s.sense === 'darkvision' && s.range === 60)).toBe(true);
  });

  it('прирост характеристики от предмета доходит до навыков (СИЛ 19 → Атлетика +4 базой)', () => {
    // Без владения: бонус навыка = модификатор характеристики. СИЛ 19 → +4.
    const rs = resolve(item({ kind: 'value_method', target: 'str', formula: '19' }), { str: 12 });
    expect(rs.skillBonuses.athletics).toBe(4);
  });

  it('АНТИ-ЗАДВОЕНИЕ: числовой modifier предмета (max_hp/speed) НЕ меняет ruleState (канал breakdown)', () => {
    const bare = resolve(null);
    const withItem = resolve(item(
      { kind: 'modifier', applies_to: { roll: 'max_hp' }, value: '+5' },
      { kind: 'modifier', applies_to: { roll: 'speed' }, value: '+10' },
    ));
    expect(withItem.maxHP).toBe(bare.maxHP);
    expect(withItem.speed).toBe(bare.speed);
  });

  it('АНТИ-ЗАДВОЕНИЕ: КЗ-модификатор предмета НЕ меняет «голый» ruleState.armorClass', () => {
    const bare = resolve(null);
    const withItem = resolve(item({ kind: 'modifier', applies_to: { roll: 'ac' }, value: '+2' }));
    expect(withItem.armorClass).toBe(bare.armorClass);
  });

  it('РЕАЛЬНАЯ ФОРМА КОНТЕНТА: value_method в effects[{resolution:auto,result}] доходит', () => {
    // Форма, которую реально используют предметы в проде (не плоский kind). Гарантирует, что
    // payloadsFromMechanics извлекает payload из result при resolution:'auto'.
    expect(resolve(realItem({ kind: 'value_method', target: 'str', formula: '19' }), { str: 12 }).abilities.str).toBe(19);
  });

  it('РЕАЛЬНАЯ ФОРМА КОНТЕНТА: grant_ability_score в result[] поднимает характеристику', () => {
    const rs = resolve(realItem({ kind: 'grant_ability_score', ability: 'con', amount: 2 }));
    expect(rs.abilities.con).toBe(14); // база 12 + 2
  });

  it('дискриминатор: тот же числовой modifier от НЕ-предмета (врем. эффект) — max_hp меняется', () => {
    const draft: CharacterDraft = { ...emptyDraft(), abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, level: 5 };
    const bare = resolveCharacterRules({ draft, assembled: baseAssembled() });
    const withFx = resolveCharacterRules({
      draft, assembled: baseAssembled(),
      runtimeSources: [{
        source: { type: 'temporary_effect', id: 'aid', name: 'Помощь' },
        mechanics: { effects: [{ kind: 'modifier', applies_to: { roll: 'max_hp' }, value: '+5' }] },
      }],
    });
    expect(withFx.maxHP).toBe(bare.maxHP + 5); // не-предмет по-прежнему вливает числовое в ruleState
  });
});
