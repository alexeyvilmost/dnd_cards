/**
 * Парсер и вычислитель формул из docs/unified-mechanics-schema.md §8.
 * Чистый TS — без React.
 */

import { drawDie } from './random';

export type FormulaMarker = 'weapon' | 'auto';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** Значение переменной персонажа: число или кость(и) (см. docs/variables.md). */
export type VariableValue = number | { sides: number; count: number };

export interface FormulaContext {
  abilityMods?: Partial<Record<AbilityKey, number>>;
  profBonus?: number;
  selfLevel?: number;
  classLevels?: Record<string, number>;
  spellcastingMod?: number;
  spellSlotAbove?: number;
  rageBonus?: number;
  characterSpeed?: number;
  /** Модификатор характеристики, использованной для броска атаки этим оружием (СИЛ/ЛВК с учётом
   *  Фехтовального/Дальнобойного). Нужен искусности 2024: СЛ Опрокидывающего и урон Задевающего
   *  считаются «от характеристики, использованной для броска атаки». */
  weaponMod?: number;
  /** Переменные персонажа (martial_arts_die, rage_damage_modifier, ...). */
  variables?: Record<string, VariableValue>;
  rng?: () => number;
}

/**
 * Любая проблема вычисления формулы (парсинг/неизвестный токен/не число).
 * Вызывающие (правила/исполнитель) ловят этот тип и МЯГКО деградируют —
 * пропускают payload/эффект с логом, а НЕ роняют лист/действие. Реальные баги
 * кода (не формульные) наследниками не являются и проходят наверх.
 */
export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

/** Частный случай: формула сослалась на отсутствующую у персонажа переменную. */
export class MissingVariableError extends FormulaError {
  constructor(public readonly variable: string) {
    super(`Переменная формулы недоступна: ${variable}`);
    this.name = 'MissingVariableError';
  }
}

export type FormulaValue = number | FormulaMarker;

/** Внутреннее отложенное «NкM» — бросается при свёртке в число или при `кость * скаляр`. */
type DicePending = { kind: 'dice'; count: number; sides: number };

type EvalValue = number | FormulaMarker | DicePending;

export interface DieRoll {
  sides: number;
  result: number;
  discarded?: boolean;
}

export interface FormulaModifier {
  value: number;
  source: string;
  reason?: string;
}

export interface FormulaRollResult {
  total: number;
  dice: DieRoll[];
  modifiers: FormulaModifier[];
  text: string;
}

const MARKERS = new Set<string>(['weapon', 'auto']);

const ABILITY_LABEL_RU: Record<AbilityKey, string> = {
  str: 'СИЛ',
  dex: 'ЛВК',
  con: 'ТЕЛ',
  int: 'ИНТ',
  wis: 'МДР',
  cha: 'ХАР',
};

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'dice'; count: number; sides: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | ',' }
  | { t: 'lparen' }
  | { t: 'rparen' };

interface EvalSink {
  ctx: FormulaContext;
  rng: () => number;
  dice: DieRoll[];
  modifiers: FormulaModifier[];
  detailed: boolean;
}

function defaultRng(): number {
  return Math.random();
}

function tokenize(input: string): Token[] {
  // Нормализуем пробелы (в т.ч. NBSP из конструктора), иначе «prof d4» может не склеиться.
  const s = input.trim().replace(/[\u00a0\u202f\u2007\u2009\u200b]/g, ' ').replace(/\s+/g, ' ');
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'rparen' });
      i++;
      continue;
    }
    if ('+-*/,'.includes(ch)) {
      tokens.push({ t: 'op', v: ch as '+' | '-' | '*' | '/' | ',' });
      i++;
      continue;
    }

    const diceMatch = s.slice(i).match(/^(\d+)d(\d+)/i);
    if (diceMatch) {
      tokens.push({ t: 'dice', count: Number(diceMatch[1]), sides: Number(diceMatch[2]) });
      i += diceMatch[0].length;
      continue;
    }

    // Голая кость «d4» = 1d4 (чтобы писать `2 * d4` и `d4 * 2`).
    const bareDiceMatch = s.slice(i).match(/^d(\d+)/i);
    if (bareDiceMatch) {
      tokens.push({ t: 'dice', count: 1, sides: Number(bareDiceMatch[1]) });
      i += bareDiceMatch[0].length;
      continue;
    }

    // class_level:<id> / N dM — исторический синтаксис (делитель обязателен).
    const scalingMatch = s.slice(i).match(/^class_level:([a-z0-9_-]+)\s*\/\s*(\d+)\s+d(\d+)/i);
    if (scalingMatch) {
      const classId = scalingMatch[1];
      const divisor = Number(scalingMatch[2]);
      const sides = Number(scalingMatch[3]);
      tokens.push({ t: 'id', v: `__scaling__:${classId}:${divisor}:${sides}` });
      i += scalingMatch[0].length;
      continue;
    }

    // <числовая переменная> [/ делитель] dN → ceil(value/div) раз кости dN.
    // Работает для prof_bonus, self_level, str, cha, rage_damage_modifier и т.п.
    // Требует пробел перед dN; без него токен остаётся скаляром. Маркеры weapon/auto — нет.
    const varScalingMatch = s.slice(i).match(/^([a-zA-Z_][a-zA-Z0-9_:]*)(?:\s*\/\s*(\d+))?\s+d(\d+)/i);
    if (varScalingMatch) {
      const varId = varScalingMatch[1];
      if (!MARKERS.has(varId.toLowerCase())) {
        const divisor = Number(varScalingMatch[2] || 1);
        const sides = Number(varScalingMatch[3]);
        // id в конце: в имени могут быть двоеточия (class_level:rogue без «/N»).
        tokens.push({ t: 'id', v: `__scaling_var__:${divisor}:${sides}:${varId}` });
        i += varScalingMatch[0].length;
        continue;
      }
    }

    const idMatch = s.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_:]*/);
    if (idMatch) {
      tokens.push({ t: 'id', v: idMatch[0] });
      i += idMatch[0].length;
      continue;
    }

    const numMatch = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (numMatch) {
      tokens.push({ t: 'num', v: Number(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }

    throw new FormulaError(`Неизвестный символ в формуле «${input}» около «${s.slice(i, i + 8)}»`);
  }

  return tokens;
}

function rollDice(count: number, sides: number, sink: EvalSink): number {
  let sum = 0;
  const n = Math.max(0, Math.floor(count));
  for (let i = 0; i < n; i++) {
    const result = drawDie(sink.rng, sides);
    if (sink.detailed) sink.dice.push({ sides, result });
    sum += result;
  }
  return sum;
}

function addModifier(sink: EvalSink, value: number, source: string, reason?: string): number {
  if (sink.detailed && value !== 0) {
    sink.modifiers.push({ value, source, reason });
  }
  return value;
}

function isDicePending(v: EvalValue): v is DicePending {
  return typeof v === 'object' && v !== null && (v as DicePending).kind === 'dice';
}

function pendingDice(count: number, sides: number): DicePending {
  return { kind: 'dice', count: Math.max(0, Math.floor(count)), sides };
}

/** Свернуть отложенную кость в число (бросок). Маркеры — ошибка. */
function forceNumber(v: EvalValue, sink: EvalSink): number {
  if (typeof v === 'string') {
    throw new FormulaError(`Маркер «${v}» нельзя использовать в арифметике`);
  }
  if (isDicePending(v)) return rollDice(v.count, v.sides, sink);
  return v;
}

/**
 * Умножение с асимметрией костей:
 *   скаляр * кость  → бросить кость (скаляр × count) раз (отложенно);
 *   кость * скаляр  → бросить кость, умножить сумму на скаляр;
 *   число * число   → обычное произведение;
 *   кость * кость   — ошибка.
 */
function multiplyValues(left: EvalValue, right: EvalValue, sink: EvalSink): EvalValue {
  if (typeof left === 'string' || typeof right === 'string') {
    throw new FormulaError('Маркеры weapon/auto нельзя умножать');
  }
  if (typeof left === 'number' && isDicePending(right)) {
    return pendingDice(left * right.count, right.sides);
  }
  if (isDicePending(left) && typeof right === 'number') {
    return rollDice(left.count, left.sides, sink) * right;
  }
  if (isDicePending(left) && isDicePending(right)) {
    throw new FormulaError('Нельзя умножать кость на кость');
  }
  return (left as number) * (right as number);
}

/**
 * Скаляр для «X dN»: только числа (БМ, уровень, мод. характеристики, number-переменные).
 * Dice-переменные и маркеры — ошибка (число костей должно быть известно до броска).
 */
function resolveNumericScalar(id: string, ctx: FormulaContext): number {
  const lower = id.toLowerCase();
  if (MARKERS.has(lower)) {
    throw new FormulaError(`Маркер «${id}» нельзя использовать как число костей`);
  }
  if (lower === 'prof_bonus' || lower === 'prof') return ctx.profBonus ?? 0;
  if (lower === 'self_level') return ctx.selfLevel ?? 0;
  if (lower === 'spellcasting') return ctx.spellcastingMod ?? 0;
  if (lower === 'spell_slot_above') return ctx.spellSlotAbove ?? 0;
  if (lower === 'rage_bonus') return ctx.rageBonus ?? 0;
  if (lower === 'character_speed') return ctx.characterSpeed ?? 0;
  if (lower === 'weapon_mod') return ctx.weaponMod ?? 0;
  if (lower.startsWith('class_level:')) {
    const classId = lower.slice('class_level:'.length);
    return ctx.classLevels?.[classId] ?? 0;
  }
  const ability = lower as AbilityKey;
  if (ability in ABILITY_LABEL_RU) return ctx.abilityMods?.[ability] ?? 0;

  const variable = ctx.variables?.[lower] ?? ctx.variables?.[id];
  if (variable !== undefined) {
    if (typeof variable === 'number') return variable;
    throw new FormulaError(`«${id}» — кость, а не число; нельзя писать «${id} d…»`);
  }
  throw new MissingVariableError(id);
}

/** Есть ли в ctx значение для превью «X dN» (иначе оставляем имя переменной). */
function isNumericScalarKnown(id: string, ctx: FormulaContext): boolean {
  const lower = id.toLowerCase();
  if (MARKERS.has(lower)) return false;
  if (lower === 'prof_bonus' || lower === 'prof') return ctx.profBonus !== undefined;
  if (lower === 'self_level') return ctx.selfLevel !== undefined;
  if (lower === 'spellcasting') return ctx.spellcastingMod !== undefined;
  if (lower === 'spell_slot_above') return ctx.spellSlotAbove !== undefined;
  if (lower === 'rage_bonus') return ctx.rageBonus !== undefined;
  if (lower === 'character_speed') return ctx.characterSpeed !== undefined;
  if (lower === 'weapon_mod') return ctx.weaponMod !== undefined;
  if (lower.startsWith('class_level:')) {
    const classId = lower.slice('class_level:'.length);
    return ctx.classLevels?.[classId] !== undefined;
  }
  const ability = lower as AbilityKey;
  if (ability in ABILITY_LABEL_RU) return ctx.abilityMods?.[ability] !== undefined;
  const variable = ctx.variables?.[lower] ?? ctx.variables?.[id];
  return typeof variable === 'number';
}

function resolveId(id: string, sink: EvalSink): EvalValue {
  const lower = id.toLowerCase();
  const { ctx } = sink;
  if (MARKERS.has(lower)) return lower as FormulaMarker;

  if (lower.startsWith('__scaling__:')) {
    const [, classId, divStr, sidesStr] = lower.split(':');
    const level = ctx.classLevels?.[classId] ?? 0;
    const count = Math.ceil(level / Number(divStr));
    return pendingDice(count, Number(sidesStr));
  }

  if (lower.startsWith('__scaling_self__:')) {
    const [, divStr, sidesStr] = lower.split(':');
    const level = ctx.selfLevel ?? 0;
    const count = Math.ceil(level / Number(divStr));
    return pendingDice(count, Number(sidesStr));
  }

  if (lower.startsWith('__scaling_var__:')) {
    const rest = id.slice('__scaling_var__:'.length);
    const m = /^(\d+):(\d+):(.+)$/i.exec(rest);
    if (!m) throw new FormulaError(`Битый scaling-токен: ${id}`);
    const divisor = Number(m[1]);
    const sides = Number(m[2]);
    const varId = m[3];
    const n = resolveNumericScalar(varId, sink.ctx);
    const count = Math.max(0, Math.ceil(n / (divisor || 1)));
    return pendingDice(count, sides);
  }

  if (lower === 'prof_bonus' || lower === 'prof') {
    return addModifier(sink, ctx.profBonus ?? 0, 'БМ', 'бонус мастерства');
  }
  if (lower === 'self_level') {
    return addModifier(sink, ctx.selfLevel ?? 0, 'уровень', 'уровень персонажа');
  }
  if (lower === 'spellcasting') {
    return addModifier(sink, ctx.spellcastingMod ?? 0, 'заклин.', 'модификатор заклинаний');
  }
  if (lower === 'spell_slot_above') {
    return addModifier(sink, ctx.spellSlotAbove ?? 0, 'ячейка+', 'уровень ячейки выше');
  }
  if (lower === 'rage_bonus') {
    return addModifier(sink, ctx.rageBonus ?? 0, 'ярость', 'бонус ярости');
  }
  if (lower === 'character_speed') {
    return addModifier(sink, ctx.characterSpeed ?? 0, 'скорость', 'скорость персонажа');
  }
  if (lower === 'weapon_mod') {
    return addModifier(sink, ctx.weaponMod ?? 0, 'оружие', 'модификатор характеристики атаки');
  }

  if (lower.startsWith('class_level:')) {
    const classId = lower.slice('class_level:'.length);
    const v = ctx.classLevels?.[classId] ?? 0;
    return addModifier(sink, v, `ур.${classId}`, 'уровень класса');
  }

  const ability = lower as AbilityKey;
  if (ability in ABILITY_LABEL_RU) {
    const v = ctx.abilityMods?.[ability] ?? 0;
    return addModifier(sink, v, ABILITY_LABEL_RU[ability], 'модификатор характеристики');
  }

  // Переменные: number → модификатор; dice → отложенная кость (для асимметрии *).
  const variable = ctx.variables?.[lower] ?? ctx.variables?.[id];
  if (variable !== undefined) {
    if (typeof variable === 'number') {
      return addModifier(sink, variable, id, 'переменная');
    }
    return pendingDice(variable.count, variable.sides);
  }

  throw new MissingVariableError(id);
}

function parseExpr(tokens: Token[], pos: { i: number }, sink: EvalSink): EvalValue {
  let left = parseTerm(tokens, pos, sink);

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) break;
    pos.i++;
    const right = parseTerm(tokens, pos, sink);
    const a = forceNumber(left, sink);
    const b = forceNumber(right, sink);
    left = tok.v === '+' ? a + b : a - b;
  }
  return left;
}

function parseTerm(tokens: Token[], pos: { i: number }, sink: EvalSink): EvalValue {
  let left = parseFactor(tokens, pos, sink);

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.t === 'op' && (tok.v === '*' || tok.v === '/')) {
      pos.i++;
      const right = parseFactor(tokens, pos, sink);
      if (tok.v === '*') {
        left = multiplyValues(left, right, sink);
      } else {
        left = forceNumber(left, sink) / forceNumber(right, sink);
      }
      continue;
    }
    // Неявное «скаляр кость» (prof d4, 2 d6) = скаляр * кость → N бросков.
    // Нужно, когда токены не склеились в scaling (пробел/юникод) или написали «2 d4».
    if (typeof left === 'number' && tok.t === 'dice') {
      pos.i++;
      left = multiplyValues(left, pendingDice(tok.count, tok.sides), sink);
      continue;
    }
    // Неявное «скаляр dice_var» (prof martial_arts_die).
    if (typeof left === 'number' && tok.t === 'id' && tokens[pos.i + 1]?.t !== 'lparen') {
      try {
        const peek = resolveId(tok.v, { ...sink, detailed: false });
        if (isDicePending(peek)) {
          pos.i++;
          left = multiplyValues(left, peek, sink);
          continue;
        }
      } catch {
        // не dice-переменная — пусть разберёт внешний уровень / выбросит ошибку
      }
    }
    break;
  }
  return left;
}

function parseFunctionCall(name: string, tokens: Token[], pos: { i: number }, sink: EvalSink): number {
  pos.i++; // (
  const args: number[] = [];
  while (pos.i < tokens.length && tokens[pos.i].t !== 'rparen') {
    const v = parseExpr(tokens, pos, sink);
    args.push(forceNumber(v, sink));
    const sep = tokens[pos.i];
    if (sep?.t === 'op' && sep.v === ',') pos.i++;
    else break;
  }
  if (tokens[pos.i]?.t !== 'rparen') throw new FormulaError('Ожидалась закрывающая скобка');
  pos.i++;
  const fn = name.toLowerCase();
  if (fn === 'min') return Math.min(...args);
  if (fn === 'max') return Math.max(...args);
  throw new FormulaError(`Неизвестная функция формулы: ${name}`);
}

function parseFactor(tokens: Token[], pos: { i: number }, sink: EvalSink): EvalValue {
  const tok = tokens[pos.i];
  if (!tok) throw new FormulaError('Незавершённая формула');

  if (tok.t === 'num') {
    pos.i++;
    return tok.v;
  }

  if (tok.t === 'dice') {
    pos.i++;
    return pendingDice(tok.count, tok.sides);
  }

  if (tok.t === 'id') {
    const id = tok.v;
    pos.i++;
    if (tokens[pos.i]?.t === 'lparen') {
      return parseFunctionCall(id, tokens, pos, sink);
    }
    return resolveId(id, sink);
  }

  if (tok.t === 'lparen') {
    pos.i++;
    const val = parseExpr(tokens, pos, sink);
    if (tokens[pos.i]?.t !== 'rparen') throw new FormulaError('Ожидалась закрывающая скобка');
    pos.i++;
    return val;
  }

  if (tok.t === 'op' && tok.v === '-') {
    pos.i++;
    const val = parseFactor(tokens, pos, sink);
    return -forceNumber(val, sink);
  }

  throw new FormulaError(`Неожиданный токен: ${JSON.stringify(tok)}`);
}

function evalTokens(tokens: Token[], ctx: FormulaContext, detailed: boolean): FormulaValue {
  const sink: EvalSink = {
    ctx,
    rng: ctx.rng ?? defaultRng,
    dice: [],
    modifiers: [],
    detailed,
  };
  const pos = { i: 0 };
  const result = parseExpr(tokens, pos, sink);
  if (pos.i < tokens.length) throw new FormulaError('Лишние символы в формуле');
  if (typeof result === 'string') return result;
  if (isDicePending(result)) return rollDice(result.count, result.sides, sink);
  return result;
}

/** Вычислить формулу. Число возвращается как есть; weapon/auto — маркеры. */
export function evaluate(formula: string | number, ctx: FormulaContext = {}): FormulaValue {
  if (typeof formula === 'number') return formula;
  const trimmed = formula.trim();
  if (!trimmed) throw new FormulaError('Пустая формула');
  if (MARKERS.has(trimmed.toLowerCase())) return trimmed.toLowerCase() as FormulaMarker;
  return evalTokens(tokenize(trimmed), ctx, false);
}

function formatModifier(m: FormulaModifier): string {
  const sign = m.value >= 0 ? '+' : '';
  return `${sign}${m.value} ${m.source}`;
}

function buildRollText(dice: DieRoll[], modifiers: FormulaModifier[], total: number): string {
  const parts: string[] = [];
  if (dice.length) {
    const bySides = new Map<number, number[]>();
    for (const d of dice) {
      if (!bySides.has(d.sides)) bySides.set(d.sides, []);
      bySides.get(d.sides)!.push(d.result);
    }
    for (const [sides, results] of bySides) {
      parts.push(`к${sides}: ${results.join('+')}`);
    }
  }
  for (const m of modifiers) parts.push(formatModifier(m));
  return parts.length ? `${parts.join(' ')} = ${total}` : String(total);
}

/** Бросок формулы с разбивкой по костям и модификаторам (для лога). */
export function rollFormula(
  formula: string,
  ctx: FormulaContext | Record<string, unknown> = {},
  opts?: { modifiers?: FormulaModifier[]; rng?: () => number },
): FormulaRollResult {
  const trimmed = formula.trim();
  const fctx: FormulaContext = { ...(ctx as FormulaContext), rng: opts?.rng ?? (ctx as FormulaContext).rng };
  const sink: EvalSink = {
    ctx: fctx,
    rng: opts?.rng ?? fctx.rng ?? defaultRng,
    dice: [],
    modifiers: [],
    detailed: true,
  };

  if (MARKERS.has(trimmed.toLowerCase())) {
    throw new FormulaError(`Формула-маркер «${trimmed}» не бросается`);
  }

  const tokens = tokenize(trimmed);
  const pos = { i: 0 };
  const result = parseExpr(tokens, pos, sink);
  if (pos.i < tokens.length) throw new FormulaError(`Лишние символы в формуле «${formula}»`);
  if (typeof result === 'string') throw new FormulaError(`Формула-маркер «${result}» не бросается`);

  const rolled = isDicePending(result) ? rollDice(result.count, result.sides, sink) : result;
  const extra = (opts?.modifiers || []).reduce((s, m) => s + m.value, 0);
  const allModifiers = [...sink.modifiers, ...(opts?.modifiers || [])];
  const total = rolled + extra;

  return {
    total,
    dice: sink.dice,
    modifiers: allModifiers,
    text: buildRollText(sink.dice, allModifiers, total),
  };
}

function describeId(id: string, ctx: FormulaContext): string {
  const lower = id.toLowerCase();
  if (MARKERS.has(lower)) return lower === 'weapon' ? 'оружие' : 'авто';

  if (lower.startsWith('__scaling__:')) {
    const [, classId, divStr, sidesStr] = lower.split(':');
    if (!ctx.classLevels || ctx.classLevels[classId] === undefined) {
      return `class_level:${classId}/${divStr} к${sidesStr}`;
    }
    const count = Math.ceil((ctx.classLevels[classId] ?? 0) / Number(divStr));
    return `${count}к${sidesStr}`;
  }

  if (lower.startsWith('__scaling_self__:')) {
    const [, divStr, sidesStr] = lower.split(':');
    if (ctx.selfLevel === undefined) {
      const div = Number(divStr);
      return div > 1 ? `self_level/${div} к${sidesStr}` : `self_level к${sidesStr}`;
    }
    const count = Math.ceil(ctx.selfLevel / Number(divStr));
    return `${count}к${sidesStr}`;
  }

  if (lower.startsWith('__scaling_var__:')) {
    const rest = id.slice('__scaling_var__:'.length);
    const m = /^(\d+):(\d+):(.+)$/i.exec(rest);
    if (!m) return id;
    const divisor = Number(m[1]);
    const sides = m[2];
    const varId = m[3];
    if (!isNumericScalarKnown(varId, ctx)) {
      return divisor > 1 ? `${varId}/${divisor} к${sides}` : `${varId} к${sides}`;
    }
    try {
      const n = resolveNumericScalar(varId, ctx);
      const count = Math.max(0, Math.ceil(n / (divisor || 1)));
      return `${count}к${sides}`;
    } catch {
      return divisor > 1 ? `${varId}/${divisor} к${sides}` : `${varId} к${sides}`;
    }
  }

  if (lower === 'prof_bonus' || lower === 'prof') {
    if (ctx.profBonus === undefined) return id;
    const v = ctx.profBonus;
    return v >= 0 ? `+${v} БМ` : `${v} БМ`;
  }
  if (lower === 'self_level') {
    if (ctx.selfLevel === undefined) return id;
    return String(ctx.selfLevel);
  }
  if (lower === 'spellcasting') {
    if (ctx.spellcastingMod === undefined) return id;
    const v = ctx.spellcastingMod;
    return v >= 0 ? `+${v} заклин.` : `${v} заклин.`;
  }
  if (lower === 'spell_slot_above') {
    if (ctx.spellSlotAbove === undefined) return id;
    return String(ctx.spellSlotAbove);
  }
  if (lower === 'rage_bonus') {
    if (ctx.rageBonus === undefined) return id;
    return String(ctx.rageBonus);
  }
  if (lower === 'character_speed') {
    if (ctx.characterSpeed === undefined) return id;
    return String(ctx.characterSpeed);
  }
  if (lower === 'weapon_mod') {
    if (ctx.weaponMod === undefined) return id;
    const v = ctx.weaponMod;
    return v >= 0 ? `+${v}` : String(v);
  }

  if (lower.startsWith('class_level:')) {
    const classId = lower.slice('class_level:'.length);
    if (!ctx.classLevels || ctx.classLevels[classId] === undefined) return id;
    return String(ctx.classLevels[classId]);
  }

  const ability = lower as AbilityKey;
  if (ability in ABILITY_LABEL_RU) {
    if (!ctx.abilityMods || ctx.abilityMods[ability] === undefined) return id;
    const v = ctx.abilityMods[ability] ?? 0;
    const label = ABILITY_LABEL_RU[ability];
    return v >= 0 ? `+${v} [${label}]` : `${v} [${label}]`;
  }

  const variable = ctx.variables?.[lower] ?? ctx.variables?.[id];
  if (variable !== undefined) {
    if (typeof variable === 'number') return String(variable);
    return `${variable.count}к${variable.sides}`;
  }

  return id;
}

/** Человекочитаемое описание формулы для лога бросков / превью. */
export function describe(formula: string | number, ctx: FormulaContext = {}): string {
  if (typeof formula === 'number') return String(formula);
  const trimmed = formula.trim();
  if (!trimmed) return '';
  if (MARKERS.has(trimmed.toLowerCase())) return describeId(trimmed.toLowerCase(), ctx);

  const tokens = tokenize(trimmed);
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    const next2 = tokens[i + 2];
    // Сворачиваем «N * MкK» / «скаляр * MкK» в «(N×M)кK» для превью.
    if (
      next?.t === 'op' && next.v === '*'
      && next2
      && (tok.t === 'num' || tok.t === 'id')
      && (next2.t === 'dice' || next2.t === 'id')
    ) {
      const leftNum = tok.t === 'num'
        ? tok.v
        : (isNumericScalarKnown(tok.v, ctx) ? resolveNumericScalar(tok.v, ctx) : null);
      let rightDice: { count: number; sides: number } | null = null;
      if (next2.t === 'dice') {
        rightDice = { count: next2.count, sides: next2.sides };
      } else {
        const v = ctx.variables?.[next2.v.toLowerCase()] ?? ctx.variables?.[next2.v];
        if (v && typeof v !== 'number') rightDice = { count: v.count, sides: v.sides };
        else if (next2.v.toLowerCase().startsWith('__scaling_')) {
          // уже развёрнутый scaling-id в токене не бывает; describeId ниже
          rightDice = null;
        }
      }
      if (leftNum != null && rightDice) {
        parts.push(`${Math.max(0, Math.floor(leftNum * rightDice.count))}к${rightDice.sides}`);
        i += 2;
        continue;
      }
    }
    if (tok.t === 'num') parts.push(String(tok.v));
    else if (tok.t === 'dice') parts.push(`${tok.count}к${tok.sides}`);
    else if (tok.t === 'id') parts.push(describeId(tok.v, ctx));
    else if (tok.t === 'op') parts.push(tok.v);
    else if (tok.t === 'lparen') parts.push('(');
    else if (tok.t === 'rparen') parts.push(')');
  }
  return parts.join(' ')
    .replace(/\s+([+*/])/g, ' $1')
    .replace(/\+\s+-/g, '- ')
    // Идентификаторы сохраняют ведущий «+» для самостоятельного показа
    // («+3 [СИЛ]»), но после бинарного оператора он был бы продублирован.
    .replace(/([+\-*/(])\s+\+(?=\d)/g, '$1 ');
}

/** Превью формулы: известные переменные → значения, кости → «NкM». Без ctx — только кости. */
export function formatFormulaDisplay(formula: string | number, ctx?: FormulaContext | null): string {
  if (typeof formula === 'number') return String(formula);
  const raw = String(formula);
  if (!raw.trim()) return '';
  if (ctx) {
    try {
      return describe(raw, ctx);
    } catch {
      /* битая формула — ниже деградация до кости */
    }
  }
  return raw.replace(/(\d)[dд](\d)/gi, '$1к$2');
}

export function isFormulaMarker(v: unknown): v is FormulaMarker {
  return v === 'weapon' || v === 'auto';
}
