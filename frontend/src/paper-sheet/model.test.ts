import { describe, expect, it, vi } from 'vitest';
import {
  PAPER_SHEET_STORAGE_KEY, calculateSheet, createPaperSheet, defaultFormula, evaluatePaperFormula,
  exportPaperSheet, fieldValue, importPaperSheet, loadPaperSheet, savePaperSheet,
} from './model';

describe('editable paper document calculations', () => {
  it('starts with a blank paper form and the standard calculated ability/skill values', () => {
    const sheet = createPaperSheet();
    const { values, errors } = calculateSheet(sheet);
    expect(values).toMatchObject({ str: 10, dex: 10, level: 1, strMod: 0, proficiency: 2, initiative: 0, passive: 10, jumpHigh: 3, jumpLong: 10 });
    expect(values['save.str']).toBe(0);
    expect(values['skill.athletics']).toBe(0);
    expect(values.hitDiceMax).toBe(1);
    expect(values.ac).toBeUndefined();
    expect(values.speed).toBeUndefined();
    expect(values.capacity).toBeUndefined();
    expect(values.spellDC).toBeUndefined();
    expect(fieldValue(sheet, 'ac')).toBe('');
    expect(errors).toEqual({});
  });

  it.each([
    { level: '5', strength: '17', dexterity: '14', wisdom: '12', training: 1 as const, bonus: 3, athletics: 6, perception: 4 },
    { level: '13', strength: '7', dexterity: '19', wisdom: '16', training: 2 as const, bonus: 5, athletics: 8, perception: 13 },
  ])('reuses the same formulas for independently authored characters: $level', input => {
    const sheet = createPaperSheet();
    Object.assign(sheet.fields, { level: input.level, str: input.strength, dex: input.dexterity, wis: input.wisdom, spellAbility: 'wis' });
    Object.assign(sheet.training, { athletics: input.training, perception: input.training, 'save.dex': 1 });
    const { values, errors } = calculateSheet(sheet);
    expect(errors).toEqual({});
    expect(values.proficiency).toBe(input.bonus);
    expect(values['skill.athletics']).toBe(input.athletics);
    expect(values['skill.perception']).toBe(input.perception);
    expect(values.passive).toBe(10 + input.perception);
    expect(values['save.dex']).toBe(values.dexMod + input.bonus);
    expect(values.spellAttack).toBe(values.wisMod + input.bonus);
    expect(values.spellDC).toBe(8 + values.spellAttack);
  });

  it('resolves bracket modifier aliases, score references, Russian names and generic fields', () => {
    const sheet = createPaperSheet();
    Object.assign(sheet.fields, {
      str: '16', dex: '14', con: '15', level: '7', hpMax: '=[LVL] * (6 + [CON])',
      ac: '=12 + min([DEX], 2)', 'weapon.0.bonus': '=[STR] + [PROF]',
      'weapon.1.bonus': '=[weapon.0.bonus] + floor([STR_SCORE] / 10)',
      'custom.multiple': '=max(str, [DEX_SCORE]) + [БМ] + [ЛВК] + [уровень]',
    });
    const { values, errors } = calculateSheet(sheet);
    expect(errors).toEqual({});
    expect(values).toMatchObject({ hpMax: 56, ac: 14, 'weapon.0.bonus': 6, 'weapon.1.bonus': 7, 'custom.multiple': 28 });
    expect(evaluatePaperFormula('8 + [PROF] + [WIS]', sheet)).toEqual({ value: 11 });
    expect(evaluatePaperFormula('ceil(2.2) + floor(.9) + +2', sheet)).toEqual({ value: 5 });
  });

  it('preserves raw overrides and propagates them through dependants, then restores automatic calculation when cleared', () => {
    const sheet = createPaperSheet();
    Object.assign(sheet.fields, { dex: '18', dexMod: '6', proficiency: '=3 + 1', 'skill.perception': '9', initiative: '=[DEX] + 2' });
    sheet.training['save.dex'] = 1;
    let result = calculateSheet(sheet);
    expect(result.values).toMatchObject({ dexMod: 6, proficiency: 4, initiative: 8, passive: 19, 'save.dex': 10 });
    expect(fieldValue(sheet, 'initiative')).toBe('=[DEX] + 2');
    sheet.fields.dexMod = '';
    sheet.fields.proficiency = '';
    sheet.fields['skill.perception'] = '';
    result = calculateSheet(sheet);
    expect(result.values).toMatchObject({ dexMod: 4, proficiency: 2, initiative: 6, passive: 10, 'save.dex': 6 });
    expect(defaultFormula('save.dex', sheet)).toBe('=[DEX] + [PROF] * 1');
  });

  it('projects equipped ability scores through dependent formulas without changing editable base values', () => {
    const sheet = createPaperSheet();
    sheet.fields.str = '12';
    sheet.fields['weapon.0.bonus'] = '=[STR] + [PROF] + 1';
    sheet.training.athletics = 1;
    const equipped = { abilityScores: { str: 19 }, fieldOverrides: { ac: 17 } };
    const result = calculateSheet(sheet, equipped);
    expect(result.values).toMatchObject({ str: 19, strMod: 4, 'skill.athletics': 6, 'weapon.0.bonus': 7, ac: 17 });
    expect(evaluatePaperFormula('8 + [STR]', sheet, equipped)).toEqual({ value: 12 });
    expect(sheet.fields.str).toBe('12');
    expect(fieldValue(sheet, 'ac')).toBe('');
    expect(calculateSheet(sheet).values.str).toBe(12);
  });

  it('includes weapon proficiency in a live formula only when its category is checked', () => {
    const sheet = createPaperSheet();
    sheet.fields.str = '16';
    sheet.fields['weapon.0.bonus'] = '=[STR] + [PROF] * [weapon_proficiency.martial] + 1';
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(4);
    sheet.checks['proficiency.martialWeapons'] = true;
    expect(calculateSheet(sheet).values['weapon.0.bonus']).toBe(6);
    expect(evaluatePaperFormula('[weapon_proficiency.simple]', sheet)).toEqual({ value: 0 });
    sheet.checks['proficiency.simpleWeapons'] = true;
    expect(evaluatePaperFormula('[weapon_proficiency.simple]', sheet)).toEqual({ value: 1 });
  });

  it.each([
    { size: 'tiny', strength: '11', capacity: 82 },
    { size: 'large', strength: '17', capacity: 510 },
  ])('derives carrying capacity with the shared size calculator: $size, Strength $strength', input => {
    const sheet = createPaperSheet();
    Object.assign(sheet.fields, { size: input.size, str: input.strength });
    const result = calculateSheet(sheet);
    expect(result.errors).toEqual({});
    expect(result.values.capacity).toBe(input.capacity);
    expect(evaluatePaperFormula(defaultFormula('capacity', sheet), sheet)).toEqual({ value: input.capacity });
  });

  it('keeps carrying capacity blank for unknown size and restores size-based calculation after removing an override', () => {
    const sheet = createPaperSheet();
    sheet.fields.size = 'unknown';
    expect(calculateSheet(sheet).values.capacity).toBeUndefined();
    expect(calculateSheet(sheet).errors.capacity).toBeUndefined();
    expect(defaultFormula('capacity', sheet)).toBe('');
    sheet.fields.capacity = '=[STR_SCORE] * 20';
    expect(calculateSheet(sheet).values.capacity).toBe(200);
    sheet.fields.size = 'huge';
    expect(calculateSheet(sheet).values.capacity).toBe(200);
    sheet.fields.capacity = '';
    expect(calculateSheet(sheet).values.capacity).toBe(600);
    sheet.fields.str = '16';
    expect(calculateSheet(sheet).values.capacity).toBe(960);
    sheet.fields.size = '';
    expect(calculateSheet(sheet).values.capacity).toBeUndefined();
    expect(calculateSheet(sheet).errors).toEqual({});
  });

  it('reports invalid or cyclic expressions per field without erasing the rest of the sheet', () => {
    const sheet = createPaperSheet();
    Object.assign(sheet.fields, { ac: '=speed + 1', speed: '=ac + 2', hpMax: '=10 / 0', hpCurrent: '=missing + 1', hpTemp: '=1 + (' });
    const { values, errors } = calculateSheet(sheet);
    expect(values.proficiency).toBe(2);
    expect(values.passive).toBe(10);
    expect(errors.ac).toMatch(/Циклическая ссылка/);
    expect(errors.speed).toMatch(/Циклическая ссылка/);
    expect(errors.hpMax).toMatch(/конечным числом/);
    expect(errors.hpCurrent).toMatch(/пусто или недоступно/);
    expect(errors.hpTemp).toBeTruthy();
    expect(values.hpMax).toBeUndefined();
    expect(sheet.fields.hpMax).toBe('=10 / 0');
  });

  it('never rolls dice or executes code when evaluating user formulas', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected random draw'); });
    try {
      for (const expression of ['1d20 + 4', '2 * d6', '0d20', '1к6', 'globalThis.alert(1)', 'constructor', '__proto__', 'max(1, 2); 3', 'min()', 'weapon']) {
        expect(evaluatePaperFormula(expression, createPaperSheet()).error, expression).toBeTruthy();
      }
      expect(evaluatePaperFormula('=10 + 2 * (3 - 1)', createPaperSheet())).toEqual({ value: 14 });
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
  });

  it('bounds formula complexity and detects direct self references', () => {
    const sheet = createPaperSheet();
    sheet.fields.str = '=[STR_SCORE] + 1';
    expect(calculateSheet(sheet).errors.str).toMatch(/Циклическая ссылка/);
    expect(evaluatePaperFormula(`${'('.repeat(100)}1${')'.repeat(100)}`, sheet).error).toMatch(/вложенность/);
    expect(evaluatePaperFormula('1 + '.repeat(1000), sheet).error).toMatch(/длинная/);
  });
});

describe('paper document import and persistence', () => {
  it('round trips edits, original formulas, training, portraits and section formatting', () => {
    const sheet = createPaperSheet();
    sheet.fields.name = 'Мира';
    sheet.fields.ac = '=10 + [DEX]';
    sheet.sections.features = { text: 'Первая строка\n{{8 + [PROF] + [WIS]}}', fontSize: 14 };
    sheet.checks['death.success.1'] = true;
    sheet.training.arcana = 2;
    sheet.settings.grid = false;
    sheet.weaponRows = 3;
    sheet.portrait = 'data:image/png;base64,YWJj';
    expect(importPaperSheet(exportPaperSheet(sheet))).toEqual(sheet);
    const other = createPaperSheet();
    other.fields.name = 'Ивар';
    expect(sheet.fields.name).toBe('Мира');
    expect(other.sections.features).toBeUndefined();
  });

  it.each([
    'not json', 'null', '[]', '{"version":2,"fields":{}}',
    '{"version":1,"fields":{"level":5}}',
    '{"version":1,"fields":{"__proto__":"bad"}}',
    '{"version":1,"fields":{},"training":{"arcana":3}}',
    '{"version":1,"fields":{},"checks":{"x":"true"}}',
    '{"version":1,"fields":{},"sections":{"x":{"text":"a","fontSize":-100}}}',
    '{"version":1,"fields":{},"weaponRows":10000}',
    '{"version":1,"fields":{},"portrait":"javascript:alert(1)"}',
    '{"version":1,"fields":{},"portrait":"data:image/svg+xml;base64,YWJj"}',
  ])('rejects malformed imported data before replacing the current document: %s', raw => {
    expect(() => importPaperSheet(raw)).toThrow();
  });

  it('persists and reloads a full document using a stable namespaced key', () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
    const sheet = createPaperSheet();
    sheet.fields.name = 'Альта';
    sheet.fields.wis = '16';
    sheet.training.perception = 2;
    expect(savePaperSheet(sheet, storage)).toEqual({});
    expect(saved.has(PAPER_SHEET_STORAGE_KEY)).toBe(true);
    const loaded = loadPaperSheet(storage);
    expect(loaded.error).toBeUndefined();
    expect(loaded.document).toEqual(sheet);
    expect(calculateSheet(loaded.document).values.passive).toBe(17);
  });

  it('returns actionable errors for storage failures and leaves malformed saved bytes untouched', () => {
    const saved = '{broken';
    const setItem = vi.fn();
    const failedLoad = loadPaperSheet({ getItem: () => saved, setItem });
    expect(failedLoad.error).toMatch(/Сохранённые данные не изменены/);
    expect(failedLoad.document).toEqual(createPaperSheet());
    expect(setItem).not.toHaveBeenCalled();
    const unavailable = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(loadPaperSheet(unavailable).error).toMatch(/SecurityError/);
    expect(savePaperSheet(createPaperSheet(), unavailable).error).toMatch(/Скачайте JSON/);
  });
});
