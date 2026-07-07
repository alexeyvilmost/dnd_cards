import { describe, expect, it } from 'vitest';
import { collectVariablesFromEffects, parseDice, parseValue } from './variables';
import { evaluate, rollFormula, MissingVariableError } from '../engine/formula';
import { executeAction } from '../engine/execute';
import type { Variable } from '../types';
import { freshFighterState, FIGHTER_CTX, seededRng } from '../mvp/fixtures';

const DEFS: Variable[] = [
  { id: '1', variable_id: 'martial_arts_die', name: 'Кость БИ', var_type: 'dice', default_value: '1d6' },
  { id: '2', variable_id: 'rage_damage_modifier', name: 'Ярость', var_type: 'number', default_value: '2' },
];

// Пассивный эффект, задающий переменную (как в level_progression класса).
const setVar = (id: string, value: string | number, op = 'set') => ({
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [{ kind: 'variable', op, id, value }] }],
});

describe('парсинг значений переменных', () => {
  it('parseDice', () => {
    expect(parseDice('1d8')).toEqual({ sides: 8, count: 1 });
    expect(parseDice('3d6')).toEqual({ sides: 6, count: 3 });
    expect(parseDice('d10')).toEqual({ sides: 10, count: 1 });
    expect(parseDice('2')).toBeNull();
  });
  it('parseValue по типу и по строке', () => {
    expect(parseValue('1d8', 'dice')).toEqual({ sides: 8, count: 1 });
    expect(parseValue('3', 'number')).toBe(3);
    expect(parseValue('1d6')).toEqual({ sides: 6, count: 1 }); // тип из строки
    expect(parseValue(2)).toBe(2);
  });
});

describe('сворачивание variable-payload эффектов', () => {
  it('старший уровень перекрывает младший (монах: d6 на 1, d8 на 5)', () => {
    // Порядок = порядок в level_progression (по возрастанию уровня).
    const vars = collectVariablesFromEffects([setVar('martial_arts_die', '1d6'), setVar('martial_arts_die', '1d8')], DEFS);
    expect(vars.martial_arts_die).toEqual({ sides: 8, count: 1 });
  });
  it('op:set числовой (ярость=2), op:add складывает, op:remove удаляет', () => {
    expect(collectVariablesFromEffects([setVar('rage_damage_modifier', 2)], DEFS).rage_damage_modifier).toBe(2);
    expect(collectVariablesFromEffects([setVar('rage_damage_modifier', 2), setVar('rage_damage_modifier', 1, 'add')], DEFS).rage_damage_modifier).toBe(3);
    expect(collectVariablesFromEffects([setVar('rage_damage_modifier', 2), setVar('rage_damage_modifier', 0, 'remove')], DEFS).rage_damage_modifier).toBeUndefined();
  });
  it('value не задан → берётся default_value справочника', () => {
    const vars = collectVariablesFromEffects([{ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [{ kind: 'variable', op: 'set', id: 'martial_arts_die' }] }] }], DEFS);
    expect(vars.martial_arts_die).toEqual({ sides: 6, count: 1 }); // default 1d6
  });
});

describe('переменные в формулах', () => {
  it('dice-переменная бросается, number — плоский модификатор', () => {
    const ctx = { variables: { martial_arts_die: { sides: 8, count: 1 } }, abilityMods: { wis: 3 }, rng: seededRng(1) };
    const r = rollFormula('martial_arts_die + wis', ctx);
    expect(r.total).toBeGreaterThanOrEqual(1 + 3);
    expect(r.total).toBeLessThanOrEqual(8 + 3);
    expect(r.dice.some((d) => d.sides === 8)).toBe(true);
  });
  it('number-переменная = плоское значение', () => {
    expect(evaluate('rage_damage_modifier', { variables: { rage_damage_modifier: 3 } })).toBe(3);
  });
});

describe('деградация при отсутствии переменной', () => {
  it('формула с отсутствующей переменной кидает MissingVariableError', () => {
    expect(() => evaluate('martial_arts_die', {})).toThrow(MissingVariableError);
  });
  it('executeAction НЕ падает: эффект пропускается с логом', () => {
    const mech = {
      activation: { mode: 'active', cost: [] },
      name: 'Тест-удар',
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: 'martial_arts_die + wis' }] }],
    };
    // У бойца нет martial_arts_die → не падает.
    const { events } = executeAction(freshFighterState(), mech, { character: FIGHTER_CTX, rng: seededRng(1) });
    expect(events.some((e) => e.type === 'narrative' && /martial_arts_die|недоступна/i.test(e.text))).toBe(true);
    expect(events.some((e) => e.type === 'healing')).toBe(false);
  });
  it('с активной переменной тот же эффект применяется', () => {
    const mech = {
      activation: { mode: 'active', cost: [] },
      name: 'Тест-удар',
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: 'martial_arts_die + wis' }] }],
    };
    const ctx = { ...FIGHTER_CTX, variables: { martial_arts_die: { sides: 8, count: 1 } } };
    const { events } = executeAction(freshFighterState(), mech, { character: ctx, rng: seededRng(1) });
    expect(events.some((e) => e.type === 'healing')).toBe(true);
  });
});
