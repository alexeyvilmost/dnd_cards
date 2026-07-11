/**
 * Парсер и вычислитель формул из docs/unified-mechanics-schema.md §8.
 * Чистый TS — без React.
 */

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
  const s = input.trim().replace(/\s+/g, ' ');
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

    const scalingMatch = s.slice(i).match(/^class_level:([a-z0-9_-]+)\s*\/\s*(\d+)\s+d(\d+)/i);
    if (scalingMatch) {
      const classId = scalingMatch[1];
      const divisor = Number(scalingMatch[2]);
      const sides = Number(scalingMatch[3]);
      tokens.push({ t: 'id', v: `__scaling__:${classId}:${divisor}:${sides}` });
      i += scalingMatch[0].length;
      continue;
    }

    // self_level [/ делитель] dN → бросок «уровень персонажа [/делитель]» раз кости dN (по образцу
    // class_level). Требует пробел + dN; без него «self_level» остаётся обычным скаляром-слагаемым.
    const selfScalingMatch = s.slice(i).match(/^self_level(?:\s*\/\s*(\d+))?\s+d(\d+)/i);
    if (selfScalingMatch) {
      const divisor = Number(selfScalingMatch[1] || 1);
      const sides = Number(selfScalingMatch[2]);
      tokens.push({ t: 'id', v: `__scaling_self__:${divisor}:${sides}` });
      i += selfScalingMatch[0].length;
      continue;
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
  for (let i = 0; i < count; i++) {
    const result = Math.floor(sink.rng() * sides) + 1;
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

function resolveId(id: string, sink: EvalSink): FormulaValue {
  const lower = id.toLowerCase();
  const { ctx } = sink;
  if (MARKERS.has(lower)) return lower as FormulaMarker;

  if (lower.startsWith('__scaling__:')) {
    const [, classId, divStr, sidesStr] = lower.split(':');
    const level = ctx.classLevels?.[classId] ?? 0;
    const count = Math.ceil(level / Number(divStr));
    return rollDice(count, Number(sidesStr), sink);
  }

  if (lower.startsWith('__scaling_self__:')) {
    const [, divStr, sidesStr] = lower.split(':');
    const level = ctx.selfLevel ?? 0;
    const count = Math.ceil(level / Number(divStr));
    return rollDice(count, Number(sidesStr), sink);
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

  // Переменные персонажа: dice → бросок кости(ей), number → плоский модификатор.
  const variable = ctx.variables?.[lower] ?? ctx.variables?.[id];
  if (variable !== undefined) {
    if (typeof variable === 'number') {
      return addModifier(sink, variable, id, 'переменная');
    }
    return rollDice(variable.count, variable.sides, sink);
  }

  // Токен не разрешён: неактивная/несуществующая переменная или опечатка. НЕ общий
  // throw — специальный тип, чтобы вызывающие мягко пропустили payload (деградация).
  throw new MissingVariableError(id);
}

function parseExpr(tokens: Token[], pos: { i: number }, sink: EvalSink): FormulaValue {
  let left = parseTerm(tokens, pos, sink);

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) break;
    pos.i++;
    const right = parseTerm(tokens, pos, sink);
    if (typeof left === 'string' || typeof right === 'string') {
      throw new FormulaError('Маркеры weapon/auto нельзя складывать с числами');
    }
    left = tok.v === '+' ? left + right : left - right;
  }
  return left;
}

function parseTerm(tokens: Token[], pos: { i: number }, sink: EvalSink): FormulaValue {
  let left = parseFactor(tokens, pos, sink);

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.t !== 'op' || (tok.v !== '*' && tok.v !== '/')) break;
    pos.i++;
    const right = parseFactor(tokens, pos, sink);
    if (typeof left === 'string' || typeof right === 'string') {
      throw new FormulaError('Маркеры weapon/auto нельзя умножать');
    }
    left = tok.v === '*' ? left * right : left / right;
  }
  return left;
}

function parseFunctionCall(name: string, tokens: Token[], pos: { i: number }, sink: EvalSink): number {
  pos.i++; // (
  const args: number[] = [];
  while (pos.i < tokens.length && tokens[pos.i].t !== 'rparen') {
    const v = parseExpr(tokens, pos, sink);
    if (typeof v === 'string') throw new FormulaError(`Маркер «${v}» нельзя использовать в функции`);
    args.push(v);
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

function parseFactor(tokens: Token[], pos: { i: number }, sink: EvalSink): FormulaValue {
  const tok = tokens[pos.i];
  if (!tok) throw new FormulaError('Незавершённая формула');

  if (tok.t === 'num') {
    pos.i++;
    return tok.v;
  }

  if (tok.t === 'dice') {
    pos.i++;
    return rollDice(tok.count, tok.sides, sink);
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
    if (typeof val === 'string') throw new FormulaError('Маркер нельзя инвертировать');
    return -val;
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

  const extra = (opts?.modifiers || []).reduce((s, m) => s + m.value, 0);
  const allModifiers = [...sink.modifiers, ...(opts?.modifiers || [])];
  const total = result + extra;

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
    const level = ctx.classLevels?.[classId] ?? 0;
    const count = Math.ceil(level / Number(divStr));
    return `${count}к${sidesStr}`;
  }

  if (lower === 'prof_bonus' || lower === 'prof') {
    const v = ctx.profBonus ?? 0;
    return v >= 0 ? `+${v} БМ` : `${v} БМ`;
  }
  if (lower === 'self_level') return String(ctx.selfLevel ?? 0);
  if (lower === 'spellcasting') {
    const v = ctx.spellcastingMod ?? 0;
    return v >= 0 ? `+${v} заклин.` : `${v} заклин.`;
  }
  if (lower === 'spell_slot_above') return String(ctx.spellSlotAbove ?? 0);
  if (lower === 'rage_bonus') return String(ctx.rageBonus ?? 0);
  if (lower === 'character_speed') return String(ctx.characterSpeed ?? 0);

  if (lower.startsWith('class_level:')) {
    const classId = lower.slice('class_level:'.length);
    return String(ctx.classLevels?.[classId] ?? 0);
  }

  const ability = lower as AbilityKey;
  if (ability in ABILITY_LABEL_RU) {
    const v = ctx.abilityMods?.[ability] ?? 0;
    const label = ABILITY_LABEL_RU[ability];
    return v >= 0 ? `+${v} [${label}]` : `${v} [${label}]`;
  }

  return id;
}

/** Человекочитаемое описание формулы для лога бросков. */
export function describe(formula: string | number, ctx: FormulaContext = {}): string {
  if (typeof formula === 'number') return String(formula);
  const trimmed = formula.trim();
  if (!trimmed) return '';
  if (MARKERS.has(trimmed.toLowerCase())) return describeId(trimmed.toLowerCase(), ctx);

  const tokens = tokenize(trimmed);
  const parts: string[] = [];
  for (const tok of tokens) {
    if (tok.t === 'num') parts.push(String(tok.v));
    else if (tok.t === 'dice') parts.push(`${tok.count}к${tok.sides}`);
    else if (tok.t === 'id') parts.push(describeId(tok.v, ctx));
    else if (tok.t === 'op') parts.push(tok.v);
    else if (tok.t === 'lparen') parts.push('(');
    else if (tok.t === 'rparen') parts.push(')');
  }
  return parts.join(' ').replace(/\s+([+*/])/g, ' $1').replace(/\+\s+-/g, '- ');
}

export function isFormulaMarker(v: unknown): v is FormulaMarker {
  return v === 'weapon' || v === 'auto';
}
