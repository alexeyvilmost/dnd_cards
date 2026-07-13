import { describe, expect, it } from 'vitest';
import { validateMechanics } from './validateMechanics';
import schema from '../schemas/mechanics.schema.json';

describe('validateMechanics', () => {
  it('пустая механика — валидна', () => {
    expect(validateMechanics(null, { id: 'x', name: 'X', kind: 'passive_effect' }).valid).toBe(true);
  });

  it('валидная пассивка с auto', () => {
    const result = validateMechanics(
      {
        activation: { mode: 'passive' },
        effects: [{ resolution: 'auto', result: [{ kind: 'grant_proficiency', prof: 'skill', value: 'perception' }] }],
      },
      { id: 'darkvision', name: 'Тёмное зрение', kind: 'passive_effect' },
    );
    expect(result.valid).toBe(true);
  });

  it('блокирует невалидный activation.mode', () => {
    const result = validateMechanics(
      { activation: { mode: 'not_a_mode' }, effects: [] },
      { id: 'bad', name: 'Bad', kind: 'action' },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// C13: контракт полноты payload.kind в обе стороны (валидатор ↔ рантайм).
// Ловит регрессию, когда рантайм начинает исполнять kind, забытый в схеме
// (валидатор молча бракует рабочий контент), и наоборот — kind в схеме без
// исполнителя и без явной пометки.
//
// Три категории — «карта поддержки» для классификатора покрытия правил
// (docs/rules-coverage-plan-2026-07-11.md §2). Держать в синхроне с матрицей
// движка (frontend/src/engine/execute.ts applyPayloads + resolveCharacterRules).
describe('C13: контракт схема ↔ рантайм (payload.kind)', () => {
  const schemaKinds = (schema as unknown as {
    $defs: { payload: { properties: { kind: { enum: string[] } } } };
  }).$defs.payload.properties.kind.enum;

  // ПОЛНОСТЬЮ исполняемые: рантайм-роутер меняет состояние либо сборка применяет грант.
  const HANDLED = [
    'damage', 'healing', 'reduce_damage', 'temp_hp', 'condition', 'resource', 'modifier',
    'resistance', 'set_value',                          // урон/AC-метод/рантайм-роутер (ярус 2.4)
    'value_method',                                     // сборка: методы характеристик (C8, Пояс силы огра)
    'narrative', 'add_item',                            // add_item: S1 контейнеры
    'grant_effect', 'grant_language', 'grant_expertise',
    'grant_proficiency', 'grant_feat', 'grant_spell',   // сборка персонажа
    'grant_ability_score', 'grant_sense', 'grant_speed',// D3: применяются резолвером (resolveCharacterRules.ts:253-364)
    'choice',                                           // мета-kind (ChoiceResolver / expandChoices)
  ];
  // ЧАСТИЧНО: kind исполняется, но не полностью (чип+нарратив, один путь, лог-only).
  // Для классификатора покрытия такие фичи — категория «partial» / «needs_engine».
  const PARTIAL = [
    'boon',        // execute.ts: чип+нарратив, кость вводится диалогом кубов вручную
    'reroll',      // execute.ts: только нарратив (переброс — в диалоге кубов)
    'transform',   // execute.ts: чип+нарратив, стат-блок зверя не подменяется
    'movement',    // execute.ts: лог-only (нет модели позиций → ярус 4 EncounterState)
    'grant_action',// работает на ЛИСТЕ (доступ к действию по slug), НЕ в рантайм-роутере (#28)
  ];
  // НЕ реализованы: no-op/заглушка. Category needs_engine (ENG-01/ENG-02).
  const PLANNED = [
    'variable',    // no-op с нарративом «не реализована» (нет RuntimeState.variables) — ENG-01
    'set_die',     // it.todo (engine.coverage.mvp.test.ts) — ENG-02
  ];

  it('категории не пересекаются', () => {
    const all = [...HANDLED, ...PARTIAL, ...PLANNED];
    expect(all.length).toBe(new Set(all).size);
  });

  it('каждый исполняемый/частичный kind есть в схеме (иначе валидатор бракует рабочий контент)', () => {
    expect([...HANDLED, ...PARTIAL].filter((k) => !schemaKinds.includes(k))).toEqual([]);
  });

  it('каждый kind схемы категоризирован (handled | partial | planned)', () => {
    expect(schemaKinds.filter((k) =>
      !HANDLED.includes(k) && !PARTIAL.includes(k) && !PLANNED.includes(k),
    )).toEqual([]);
  });
});
