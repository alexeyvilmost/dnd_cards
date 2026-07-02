/**
 * Парсер и вычислитель формул из docs/unified-mechanics-schema.md §8.
 * Чистый TS — без React.
 */

export type FormulaMarker = 'weapon' | 'auto';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface FormulaContext {
  /** Модификаторы характеристик (не сырые значения). */
  abilityMods?: Partial<Record<AbilityKey, number>>;
  profBonus?: number;
  selfLevel?: number;
  classLevels?: Record<string, number>;
  spellcastingMod?: number;
  spellSlotAbove?: number;
  rageBonus?: number;
  characterSpeed?: number;
  /** 0..1, по умолчанию Math.random */
  rng?: () => number;
}

export type FormulaValue = number | FormulaMarker;

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
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'lparen' }
  | { t: 'rparen' };

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
    if ('+-*/'.includes(ch)) {
      tokens.push({ t: 'op', v: ch as '+' | '-' | '*' | '/' });
      i++;
      continue;
    }

    // NdM или class_level:rogue/2 d6
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

    throw new Error(`Неизвестный символ в формуле «${input}» около «${s.slice(i, i + 8)}»`);
  }

  return tokens;
}

function resolveId(id: string, ctx: FormulaContext, rng: () => number): FormulaValue {
  const lower = id.toLowerCase();
  if (MARKERS.has(lower)) return lower as FormulaMarker;

  if (lower.startsWith('__scaling__:')) {
    const [, classId, divStr, sidesStr] = lower.split(':');
    const level = ctx.classLevels?.[classId] ?? 0;
    const count = Math.ceil(level / Number(divStr));
    return rollDice(count, Number(sidesStr), rng);
  }

  if (lower === 'prof_bonus' || lower === 'prof') return ctx.profBonus ?? 0;
  if (lower === 'self_level') return ctx.selfLevel ?? 0;
  if (lower === 'spellcasting') return ctx.spellcastingMod ?? 0;
  if (lower === 'spell_slot_above') return ctx.spellSlotAbove ?? 0;
  if (lower === 'rage_bonus') return ctx.rageBonus ?? 0;
  if (lower === 'character_speed') return ctx.characterSpeed ?? 0;

  if (lower.startsWith('class_level:')) {
    const classId = lower.slice('class_level:'.length);
    return ctx.classLevels?.[classId] ?? 0;
  }

  const ability = lower as AbilityKey;
  if (ability in ABILITY_LABEL_RU) {
    return ctx.abilityMods?.[ability] ?? 0;
  }

  throw new Error(`Неизвестная переменная формулы: ${id}`);
}

function rollDice(count: number, sides: number, rng: () => number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.floor(rng() * sides) + 1;
  }
  return sum;
}

function parseExpr(tokens: Token[], pos: { i: number }, ctx: FormulaContext, rng: () => number): FormulaValue {
  let left = parseTerm(tokens, pos, ctx, rng);

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) break;
    pos.i++;
    const right = parseTerm(tokens, pos, ctx, rng);
    if (typeof left === 'string' || typeof right === 'string') {
      throw new Error('Маркеры weapon/auto нельзя складывать с числами');
    }
    left = tok.v === '+' ? left + right : left - right;
  }
  return left;
}

function parseTerm(tokens: Token[], pos: { i: number }, ctx: FormulaContext, rng: () => number): FormulaValue {
  let left = parseFactor(tokens, pos, ctx, rng);

  while (pos.i < tokens.length) {
    const tok = tokens[pos.i];
    if (tok.t !== 'op' || (tok.v !== '*' && tok.v !== '/')) break;
    pos.i++;
    const right = parseFactor(tokens, pos, ctx, rng);
    if (typeof left === 'string' || typeof right === 'string') {
      throw new Error('Маркеры weapon/auto нельзя умножать');
    }
    left = tok.v === '*' ? left * right : left / right;
  }
  return left;
}

function parseFactor(tokens: Token[], pos: { i: number }, ctx: FormulaContext, rng: () => number): FormulaValue {
  const tok = tokens[pos.i];
  if (!tok) throw new Error('Незавершённая формула');

  if (tok.t === 'num') {
    pos.i++;
    return tok.v;
  }

  if (tok.t === 'dice') {
    pos.i++;
    return rollDice(tok.count, tok.sides, rng);
  }

  if (tok.t === 'id') {
    pos.i++;
    return resolveId(tok.v, ctx, rng);
  }

  if (tok.t === 'lparen') {
    pos.i++;
    const val = parseExpr(tokens, pos, ctx, rng);
    if (tokens[pos.i]?.t !== 'rparen') throw new Error('Ожидалась закрывающая скобка');
    pos.i++;
    return val;
  }

  if (tok.t === 'op' && tok.v === '-') {
    pos.i++;
    const val = parseFactor(tokens, pos, ctx, rng);
    if (typeof val === 'string') throw new Error('Маркер нельзя инвертировать');
    return -val;
  }

  throw new Error(`Неожиданный токен: ${JSON.stringify(tok)}`);
}

/** Вычислить формулу. Число возвращается как есть; weapon/auto — маркеры. */
export function evaluate(formula: string | number, ctx: FormulaContext = {}): FormulaValue {
  if (typeof formula === 'number') return formula;
  const trimmed = formula.trim();
  if (!trimmed) throw new Error('Пустая формула');
  if (MARKERS.has(trimmed.toLowerCase())) return trimmed.toLowerCase() as FormulaMarker;

  const rng = ctx.rng ?? defaultRng;
  const tokens = tokenize(trimmed);
  const pos = { i: 0 };
  const result = parseExpr(tokens, pos, ctx, rng);
  if (pos.i < tokens.length) throw new Error(`Лишние символы в формуле «${formula}»`);
  return result;
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
