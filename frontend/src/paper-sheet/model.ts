import { evaluate, FormulaError, type AbilityKey } from '../engine/formula';
import { ABILITY_IDS, SKILL_IDS, SKILL_ABILITY, abilityMod, proficiencyBonusForLevel } from '../character/rules/foundation';
import { carryingCapacity, carrySizeMultiplier } from '../character/runtime';

/** An editable document, deliberately separate from a certified character or combat state. */
export interface PaperSheetDocument {
  version: 1;
  fields: Record<string, string>;
  checks: Record<string, boolean>;
  training: Record<string, 0 | 1 | 2>;
  sections: Record<string, { text: string; fontSize: number }>;
  settings: { grid: boolean };
  weaponRows: number;
  spellRows: number;
  portrait: string;
  /** Opaque source plus the initial projection: unchanged foreign data is never reconstructed. */
  exchange?: { format: 'lss'; source: string; baseline: string; spells?: string };
}

export interface SheetCalculation {
  values: Record<string, number>;
  errors: Record<string, string>;
}

/** Computed equipment values are a view of the document, never edits to its base fields. */
export interface PaperEquipmentProjection {
  abilityScores?: Partial<Record<AbilityKey, number>>;
  fieldOverrides?: Record<string, number>;
  sources?: Record<string, string[]>;
}

export const PAPER_SHEET_STORAGE_KEY = 'bagofholding.paper-sheet.v1';
const MAX_DOCUMENT_LENGTH = 10_000_000;
const MAX_FORMULA_LENGTH = 2_000;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

const DEFAULT_FIELDS: Record<string, string> = {
  level: '1', str: '10', dex: '10', con: '10', int: '10', wis: '10', cha: '10',
  hitDiceCurrent: '1', hitDiceMax: '=[LVL]',
};

const SCALAR_FIELDS = new Set([
  ...ABILITY_IDS, 'level', 'xp', 'ac', 'speed', 'hpCurrent', 'hpMax', 'hpTemp',
  'hitDiceCurrent', 'hitDiceMax', 'coinCp', 'coinSp', 'coinEp', 'coinGp', 'coinPp',
]);

const DERIVED_FIELDS = [
  'proficiency', 'initiative', 'passive', 'spellMod', 'spellDC', 'spellAttack', 'jumpHigh', 'jumpLong', 'capacity',
  ...ABILITY_IDS.map(key => `${key}Mod`),
  ...ABILITY_IDS.map(key => `save.${key}`),
  ...SKILL_IDS.map(key => `skill.${key}`),
];

// The document stores select keys; the shared character calculator uses size categories.
const SIZE_CATEGORIES = new Map<string, number>([
  ['tiny', 0], ['small', 1], ['medium', 2], ['large', 3], ['huge', 4], ['gargantuan', 5],
]);

/** Blank derived fields mean automatic calculation; other blank fields remain blank. */
export function createPaperSheet(): PaperSheetDocument {
  return {
    version: 1, fields: { ...DEFAULT_FIELDS }, checks: {}, training: {}, sections: {},
    settings: { grid: true }, weaponRows: 1, spellRows: 38, portrait: '',
  };
}

/** The original editable input, not the calculated display value. */
export function fieldValue(document: PaperSheetDocument, key: string): string {
  return has(document.fields, key) ? document.fields[key] : '';
}

/** Human-readable defaults use the same references that users can enter in a field. */
export function defaultFormula(key: string, document?: PaperSheetDocument): string {
  if (key === 'capacity') {
    const size = SIZE_CATEGORIES.get(document?.fields.size ?? '');
    return size === undefined ? '' : `=floor([STR_SCORE] * 15 * ${carrySizeMultiplier(size)})`;
  }
  const ability = ABILITY_IDS.find(id => key === `${id}Mod`);
  if (ability) return `=floor((${ability} - 10) / 2)`;
  if (key.startsWith('save.') && ABILITY_IDS.includes(key.slice(5) as AbilityKey)) {
    return `=[${key.slice(5).toUpperCase()}] + [PROF] * ${document?.training[key] ?? 0}`;
  }
  const skill = key.startsWith('skill.') ? key.slice(6) : '';
  if (SKILL_IDS.includes(skill)) {
    return `=[${SKILL_ABILITY[skill].toUpperCase()}] + [PROF] * ${document?.training[skill] ?? 0}`;
  }
  const spellAbility = document?.fields.spellAbility;
  const formulas: Record<string, string> = {
    proficiency: '=2 + floor((max(1, [LVL]) - 1) / 4)',
    initiative: '=[DEX]', passive: '=10 + [skill.perception]',
    spellMod: spellAbility && ABILITY_IDS.includes(spellAbility as AbilityKey) ? `=[${spellAbility.toUpperCase()}]` : '',
    spellDC: '=8 + [PROF] + [spellMod]', spellAttack: '=[PROF] + [spellMod]',
    jumpHigh: '=max(0, 3 + [STR])', jumpLong: '=max(0, [STR_SCORE])',
  };
  return formulas[key] ?? '';
}

const ALIASES: Record<string, string> = {
  prof: 'proficiency', prof_bonus: 'proficiency', pb: 'proficiency', бм: 'proficiency', бв: 'proficiency',
  lvl: 'level', self_level: 'level', уровень: 'level',
  кд: 'ac', скорость: 'speed', инициатива: 'initiative', восприятие: 'skill.perception',
  сила: 'str', ловкость: 'dex', телосложение: 'con', интеллект: 'int', мудрость: 'wis', харизма: 'cha',
  сил: 'strMod', лвк: 'dexMod', тел: 'conMod', инт: 'intMod', мдр: 'wisMod', хар: 'chaMod',
};
for (const ability of ABILITY_IDS) {
  ALIASES[`${ability}_score`] = ability;
  ALIASES[`${ability}_mod`] = `${ability}Mod`;
}

const FUNCTION_NAMES = new Set(['min', 'max', 'floor', 'ceil']);

/**
 * Only token translation belongs here: arithmetic is evaluated by the existing
 * mechanics parser. References are bound to numeric variables before evaluation.
 * No JavaScript evaluation, dice, engine markers, or random source is available.
 */
function scalarFormula(expression: string, resolve: (reference: string, bracket: boolean) => number): number {
  const source = expression.trim().replace(/^=/, '').trim();
  if (!source || source.length > MAX_FORMULA_LENGTH) throw new FormulaError('Формула пуста или слишком длинная.');
  const variables: Record<string, number> = {};
  const tokens: string[] = [];
  let index = 0;
  let depth = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) { index += space[0].length; continue; }
    if (tokens.length >= 512) throw new FormulaError('В формуле слишком много операций.');
    // Reject dice before translating identifiers; even a zero-count die is not a scalar.
    if (/^(?:\d+\s*)?[dдк]\s*\d+/i.test(rest)) throw new FormulaError('В формулах листа нельзя бросать кости.');
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    if (number) {
      const value = Number(number[0]);
      const name = `paper_value_${Object.keys(variables).length}`;
      variables[name] = value;
      tokens.push(name);
      index += number[0].length;
      continue;
    }
    const bracket = /^\[([\p{L}_][\p{L}\p{N}_.]*)\]/u.exec(rest);
    const identifier = bracket ?? /^([\p{L}_][\p{L}\p{N}_.]*)/u.exec(rest);
    if (identifier) {
      const name = identifier[1];
      index += identifier[0].length;
      if (!bracket && /^\s*\(/.test(source.slice(index))) {
        if (!FUNCTION_NAMES.has(name.toLowerCase())) throw new FormulaError(`Неизвестная функция: ${name}.`);
        tokens.push(name.toLowerCase());
      } else {
        const variable = `paper_value_${Object.keys(variables).length}`;
        variables[variable] = resolve(name, Boolean(bracket));
        tokens.push(variable);
      }
      continue;
    }
    const symbol = source[index++];
    if (!'+-*/(),'.includes(symbol)) throw new FormulaError(`Недопустимый символ в формуле: ${symbol}.`);
    if (symbol === '(' && ++depth > 64) throw new FormulaError('Слишком глубокая вложенность формулы.');
    if (symbol === ')') depth--;
    // The shared engine handles unary minus; a unary plus does not change a scalar.
    if (symbol === '+' && (tokens.length === 0 || ['(', ',', '+', '-', '*', '/'].includes(tokens[tokens.length - 1]))) continue;
    tokens.push(symbol);
  }
  const result = evaluate(tokens.join(' '), {
    variables,
    rng: () => { throw new FormulaError('В формулах листа нельзя бросать кости.'); },
  });
  if (typeof result !== 'number' || !Number.isFinite(result)) throw new FormulaError('Результат должен быть конечным числом. Проверьте деление на ноль.');
  return Object.is(result, -0) ? 0 : result;
}

function calculator(document: PaperSheetDocument, equipment?: PaperEquipmentProjection) {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const active = new Set<string>();
  const fieldNames = new Map([...SCALAR_FIELDS, ...DERIVED_FIELDS, ...Object.keys(document.fields)].map(key => [key.toLowerCase(), key]));
  const resolveReference = (reference: string, bracket: boolean): number => {
    const lower = reference.toLowerCase();
    if (reference.split('.').some(key => FORBIDDEN_KEYS.has(key))) throw new FormulaError('Недопустимая ссылка на поле.');
    const key = bracket && ABILITY_IDS.includes(lower as AbilityKey)
      ? `${lower}Mod`
      : (has(ALIASES, lower) ? ALIASES[lower] : fieldNames.get(lower) ?? reference);
    return resolveField(key);
  };
  const resolveField = (key: string): number => {
    if (has(values, key)) return values[key];
    if (has(errors, key)) throw new FormulaError(errors[key]);
    if (active.has(key)) throw new FormulaError(`Циклическая ссылка: ${[...active, key].join(' → ')}.`);
    if (active.size >= 64) throw new FormulaError('Слишком длинная цепочка зависимостей.');
    active.add(key);
    try {
      const raw = fieldValue(document, key).trim();
      let result: number;
      const equippedScore = ABILITY_IDS.includes(key as AbilityKey) ? equipment?.abilityScores?.[key as AbilityKey] : undefined;
      const equippedField = equipment?.fieldOverrides?.[key];
      if (equippedScore !== undefined) {
        result = equippedScore;
      } else if (equippedField !== undefined) {
        result = equippedField;
      } else if (key === 'weapon_proficiency.simple' || key === 'weapon_proficiency.martial') {
        const check = key === 'weapon_proficiency.simple' ? 'proficiency.simpleWeapons' : 'proficiency.martialWeapons';
        result = document.checks[check] ? 1 : 0;
      } else if (raw) {
        result = NUMBER.test(raw) ? Number(raw) : scalarFormula(raw, resolveReference);
      } else if (key === 'proficiency') {
        result = proficiencyBonusForLevel(resolveField('level'));
      } else if (ABILITY_IDS.some(ability => key === `${ability}Mod`)) {
        result = abilityMod(resolveField(key.slice(0, -3)));
      } else if (key === 'capacity' && SIZE_CATEGORIES.has(document.fields.size)) {
        result = carryingCapacity(resolveField('str'), SIZE_CATEGORIES.get(document.fields.size));
      } else {
        const formula = defaultFormula(key, document);
        if (!formula) throw new FormulaError(`Поле «${key}» пусто или недоступно.`);
        result = scalarFormula(formula, resolveReference);
      }
      if (!Number.isFinite(result)) throw new FormulaError('Результат должен быть конечным числом.');
      values[key] = result;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось вычислить формулу.';
      errors[key] = message;
      throw new FormulaError(message);
    } finally {
      active.delete(key);
    }
  };
  return { values, errors, resolveField, resolveReference };
}

export function calculateSheet(document: PaperSheetDocument, equipment?: PaperEquipmentProjection): SheetCalculation {
  const calc = calculator(document, equipment);
  const fields = new Set([
    ...DERIVED_FIELDS,
    ...Object.keys(document.fields).filter(key => SCALAR_FIELDS.has(key) || fieldValue(document, key).trim().startsWith('=')),
    ...Object.keys(equipment?.fieldOverrides ?? {}),
    ...Object.keys(equipment?.abilityScores ?? {}),
  ]);
  for (const key of fields) {
    if (key === 'capacity' && !fieldValue(document, key).trim() && !SIZE_CATEGORIES.has(document.fields.size) && equipment?.fieldOverrides?.capacity === undefined) continue;
    // An unselected casting ability leaves the three spell summary cells empty.
    if (['spellMod', 'spellDC', 'spellAttack'].includes(key)
      && !fieldValue(document, key).trim() && !fieldValue(document, 'spellAbility').trim()
      && !fieldValue(document, 'spellMod').trim() && equipment?.fieldOverrides?.[key] === undefined) continue;
    if (SCALAR_FIELDS.has(key) && !fieldValue(document, key).trim()
      && equipment?.fieldOverrides?.[key] === undefined && equipment?.abilityScores?.[key as AbilityKey] === undefined) continue;
    try { calc.resolveField(key); } catch { /* Localized field errors are returned to the editor. */ }
  }
  return { values: calc.values, errors: calc.errors };
}

export function evaluatePaperFormula(expression: string, document: PaperSheetDocument, equipment?: PaperEquipmentProjection): { value?: number; error?: string } {
  try {
    return { value: scalarFormula(expression, calculator(document, equipment).resolveReference) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Не удалось вычислить формулу.' };
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Некорректный раздел «${label}».`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length > 2_000) throw new Error(`Слишком много полей в разделе «${label}».`);
  for (const key of Object.keys(result)) {
    if (!key || key.length > 150 || key.split('.').some(part => FORBIDDEN_KEYS.has(part))) throw new Error(`Недопустимое имя поля в разделе «${label}».`);
  }
  return result;
}

function stringValue(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Некорректный текст в поле «${label}».`);
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`Некорректное значение «${label}».`);
  return value;
}

function validateDocument(value: unknown): PaperSheetDocument {
  const input = record(value, 'лист');
  if (input.version !== 1) throw new Error('Этот формат листа не поддерживается. Ожидается версия 1.');
  const document = createPaperSheet();
  for (const [key, raw] of Object.entries(record(input.fields, 'поля'))) document.fields[key] = stringValue(raw, key, 20_000);
  for (const [key, raw] of Object.entries(record(input.checks ?? {}, 'отметки'))) {
    if (typeof raw !== 'boolean') throw new Error(`Некорректная отметка «${key}».`);
    document.checks[key] = raw;
  }
  for (const [key, raw] of Object.entries(record(input.training ?? {}, 'владения'))) {
    document.training[key] = integer(raw, key, 0, 2) as 0 | 1 | 2;
  }
  for (const [key, raw] of Object.entries(record(input.sections ?? {}, 'записи'))) {
    const section = record(raw, key);
    document.sections[key] = { text: stringValue(section.text, key, 200_000), fontSize: integer(section.fontSize, key, 6, 48) };
  }
  if (input.settings !== undefined) {
    const settings = record(input.settings, 'настройки');
    if (typeof settings.grid !== 'boolean') throw new Error('Некорректная настройка клеток листа.');
    document.settings.grid = settings.grid;
  }
  if (input.weaponRows !== undefined) document.weaponRows = integer(input.weaponRows, 'строки оружия', 1, 30);
  if (input.spellRows !== undefined) document.spellRows = integer(input.spellRows, 'строки заклинаний', 1, 100);
  if (input.portrait !== undefined) {
    const portrait = stringValue(input.portrait, 'портрет', 7_000_000);
    if (portrait && !/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-zA-Z0-9+/=\r\n]+$/.test(portrait)
      && !/^https:\/\/[^\s]+$/i.test(portrait)) throw new Error('Портрет должен быть изображением или ссылкой HTTPS.');
    document.portrait = portrait;
  }
  if (input.exchange !== undefined) {
    const exchange = record(input.exchange, 'данные обмена');
    if (exchange.format !== 'lss') throw new Error('Неизвестный формат данных обмена.');
    document.exchange = {
      format: 'lss', source: stringValue(exchange.source, 'оригинал LSS', MAX_DOCUMENT_LENGTH),
      baseline: stringValue(exchange.baseline, 'снимок импорта', MAX_DOCUMENT_LENGTH),
      ...(exchange.spells === undefined ? {} : { spells: stringValue(exchange.spells, 'гримуар LSS', MAX_DOCUMENT_LENGTH) }),
    };
  }
  return document;
}

export function importPaperSheet(json: string): PaperSheetDocument {
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_LENGTH) throw new Error('Файл листа слишком большой (максимум 10 МБ).');
  let parsed: unknown;
  try { parsed = JSON.parse(json.replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось прочитать JSON листа.'); }
  return validateDocument(parsed);
}

export function exportPaperSheet(document: PaperSheetDocument): string {
  const json = JSON.stringify(validateDocument(document), null, 2);
  if (new TextEncoder().encode(json).length > MAX_DOCUMENT_LENGTH) throw new Error('Лист слишком большой для сохранения (максимум 10 МБ).');
  return json;
}

type SheetStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadPaperSheet(storage?: SheetStorage): { document: PaperSheetDocument; error?: string } {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) throw new Error('Хранилище браузера недоступно.');
    const saved = target.getItem(PAPER_SHEET_STORAGE_KEY);
    return { document: saved === null ? createPaperSheet() : importPaperSheet(saved) };
  } catch (error) {
    return {
      document: createPaperSheet(),
      error: `Не удалось загрузить лист. ${error instanceof Error ? error.message : 'Хранилище браузера недоступно.'} Сохранённые данные не изменены.`,
    };
  }
}

export function savePaperSheet(document: PaperSheetDocument, storage?: SheetStorage): { error?: string } {
  try {
    const json = exportPaperSheet(document);
    const target = storage ?? globalThis.localStorage;
    if (!target) throw new Error('Хранилище браузера недоступно.');
    target.setItem(PAPER_SHEET_STORAGE_KEY, json);
    return {};
  } catch (error) {
    return { error: `Не удалось сохранить лист в браузере. ${error instanceof Error ? error.message : ''} Скачайте JSON, чтобы сохранить изменения.` };
  }
}
