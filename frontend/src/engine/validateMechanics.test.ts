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
// исполнителя и без пометки planned.
describe('C13: контракт схема ↔ рантайм (payload.kind)', () => {
  const schemaKinds = (schema as unknown as {
    $defs: { payload: { properties: { kind: { enum: string[] } } } };
  }).$defs.payload.properties.kind.enum;

  // Kind-ы, которые движок/сборка РЕАЛЬНО исполняют.
  const HANDLED = [
    'damage', 'healing', 'temp_hp', 'condition', 'resource', 'modifier', 'movement',
    'boon', 'reroll', 'transform', 'narrative', 'add_item', // execute.ts applyPayloads (add_item: S1 контейнеры)
    'resistance', 'set_value',                          // разрешение урона / расчёт AC / рантайм-роутер (2.4)
    'value_method',                                     // сборка: value_method характеристик (C8, Пояс силы огра)
    'variable', 'grant_effect', 'grant_language', 'grant_expertise',
    'grant_proficiency', 'grant_feat', 'grant_spell',   // сборка персонажа
    'choice',                                           // мета-kind (ChoiceResolver)
  ];
  // Kind-ы схемы, ещё НЕ исполняемые — осознанный allowlist (grant_ability_score/
  // grant_sense/grant_speed чинит D3; set_die/grant_action — it.todo).
  const PLANNED = ['grant_action', 'set_die', 'grant_ability_score', 'grant_sense', 'grant_speed'];

  it('каждый исполняемый kind есть в схеме (иначе валидатор бракует рабочий контент)', () => {
    expect(HANDLED.filter((k) => !schemaKinds.includes(k))).toEqual([]);
  });

  it('каждый kind схемы либо исполняется, либо в явном planned-allowlist', () => {
    expect(schemaKinds.filter((k) => !HANDLED.includes(k) && !PLANNED.includes(k))).toEqual([]);
  });
});
