/**
 * Разбор описания существа на атаки (#4).
 * Ищет строки «Бросок рукопашной атаки» / «Бросок дальнобойной атаки»,
 * вытаскивает бонус к попаданию и все составляющие урона (в т.ч. несколько типов),
 * и умеет бросать атаку (всегда 2 к20, урон кидается всегда — вне зависимости от попадания).
 */

export interface DamagePart {
  count: number;
  sides: number;
  bonus: number;
  /** Тип урона, например «дробящего урона» или «урона некротической энергией». */
  type: string;
}

export interface Attack {
  name: string;
  kind: 'melee' | 'ranged';
  bonus: number;
  damages: DamagePart[];
}

export interface ParsedAttacks {
  melee?: Attack;
  ranged?: Attack;
}

const MELEE_MARKER = 'Бросок рукопашной атаки';
const RANGED_MARKER = 'Бросок дальнобойной атаки';

/** «1к10 + 3», «3к6», «2d8-1» → { count, sides, bonus }. */
function parseDiceExpr(expr: string): { count: number; sides: number; bonus: number } | null {
  const m = expr.match(/(\d+)\s*[кkдd]\s*(\d+)\s*(?:([+-])\s*(\d+))?/i);
  if (!m) return null;
  const bonus = m[3] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
  return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10), bonus };
}

/** Разбирает часть после «Попадание:» на составляющие урона. */
function parseDamage(hitText: string): DamagePart[] {
  const parts: DamagePart[] = [];
  const re = /(\d+)\s*\(([^)]*[кkдd]\d[^)]*)\)\s*([^+()]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hitText)) !== null) {
    const dice = parseDiceExpr(m[2]);
    if (!dice) continue;
    const type = m[3]
      .replace(/\s+/g, ' ')
      .replace(/[.;].*$/, '')
      .trim();
    parts.push({ count: dice.count, sides: dice.sides, bonus: dice.bonus, type: type || 'урона' });
  }
  return parts;
}

function parseAttackFromAction(name: string, text: string, kind: 'melee' | 'ranged'): Attack {
  const marker = kind === 'melee' ? MELEE_MARKER : RANGED_MARKER;
  const bonusMatch = text.match(new RegExp(`${marker}:?\\s*([+-]?\\d+)`));
  const bonus = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;

  const hitIndex = text.indexOf('Попадание');
  const hitText = hitIndex >= 0 ? text.slice(hitIndex) : '';
  const damages = parseDamage(hitText);

  return { name: name.trim(), kind, bonus, damages };
}

/** Разбивает описание (формат «Название\nтекст», блоки через пустую строку) на атаки. */
export function parseAttacks(description: string): ParsedAttacks {
  if (!description) return {};
  const blocks = description.split(/\n\s*\n/);
  const result: ParsedAttacks = {};

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const newlineIndex = trimmed.indexOf('\n');
    const name = newlineIndex >= 0 ? trimmed.slice(0, newlineIndex) : trimmed;
    const text = newlineIndex >= 0 ? trimmed.slice(newlineIndex + 1) : trimmed;

    if (!result.melee && text.includes(MELEE_MARKER)) {
      result.melee = parseAttackFromAction(name, text, 'melee');
    }
    if (!result.ranged && text.includes(RANGED_MARKER)) {
      result.ranged = parseAttackFromAction(name, text, 'ranged');
    }
  }
  return result;
}

// --- Бросок атаки ---------------------------------------------------------

export interface AttackRoll {
  /** Значение кости d20 (без бонуса). */
  die: number;
  /** Итог с бонусом попадания. */
  total: number;
}

export interface DamageRoll {
  /** Значения каждой кости. */
  dice: number[];
  bonus: number;
  total: number;
  type: string;
}

export interface AttackRollResult {
  attackName: string;
  bonus: number;
  attackRolls: AttackRoll[];
  damageRolls: DamageRoll[];
}

function d(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/** Кидает атаку: всегда два d20 к попаданию и весь урон (независимо от попадания). */
export function rollAttack(attack: Attack): AttackRollResult {
  const attackRolls: AttackRoll[] = [0, 1].map(() => {
    const die = d(20);
    return { die, total: die + attack.bonus };
  });

  const damageRolls: DamageRoll[] = attack.damages.map((part) => {
    const dice = Array.from({ length: part.count }, () => d(part.sides));
    const total = dice.reduce((a, b) => a + b, 0) + part.bonus;
    return { dice, bonus: part.bonus, total, type: part.type };
  });

  return { attackName: attack.name, bonus: attack.bonus, attackRolls, damageRolls };
}
