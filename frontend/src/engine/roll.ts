/**
 * Roll-движок (фаза B2). Чистый TS, rng инъецируется.
 */
import type {
  AdvantageState,
  DieRoll,
  RollD20Options,
  RollLog,
  RollModifier,
} from '../mvp/contracts';

function rollDie(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1;
}

function formatMod(m: RollModifier): string {
  const sign = m.value >= 0 ? '+' : '';
  return `${sign}${m.value} ${m.source}`;
}

function buildD20Text(
  dice: DieRoll[],
  modifiers: RollModifier[],
  total: number,
  target?: RollD20Options['target'],
  outcome?: RollLog['outcome'],
): string {
  const parts: string[] = [];
  const kept = dice.filter((d) => !d.discarded);
  if (kept.length === 1) {
    parts.push(`к20: ${kept[0].result}`);
  } else if (kept.length > 1) {
    parts.push(`к20: ${kept.map((d) => d.result).join(', ')}`);
  } else if (dice.length === 2) {
    const k = dice.find((d) => !d.discarded);
    const disc = dice.find((d) => d.discarded);
    if (k && disc) parts.push(`к20: ${k.result} (отброшено ${disc.result})`);
  }
  for (const m of modifiers) parts.push(formatMod(m));
  let text = parts.join(' ');
  if (parts.length > 1 || modifiers.length) text += ` = ${total}`;
  else if (kept.length) text = `к20: ${kept[0].result}`;

  if (target) {
    const label = target.type === 'ac' ? 'КЗ' : 'СЛ';
    text += ` против ${label} ${target.value}`;
    if (outcome === 'crit') text += ' — крит';
    else if (outcome === 'hit') text += ' — попадание';
    else if (outcome === 'miss') text += ' — промах';
    else if (outcome === 'success') text += ' — успех';
    else if (outcome === 'fail') text += ' — провал';
  }
  return text;
}

/** Бросок d20 с опциональным преимуществом/помехой и модификаторами. */
export function rollD20(opts: RollD20Options): RollLog {
  const rng = opts.rng;
  const advantage: AdvantageState = opts.advantage ?? 'none';
  const modifiers = opts.modifiers ?? [];
  const modSum = modifiers.reduce((s, m) => s + m.value, 0);
  const dice: DieRoll[] = [];

  let natural: number;
  if (advantage === 'advantage' || advantage === 'disadvantage') {
    const d1 = rollDie(20, rng);
    const d2 = rollDie(20, rng);
    const takeHigh = advantage === 'advantage';
    const kept = takeHigh ? Math.max(d1, d2) : Math.min(d1, d2);
    const dropped = takeHigh ? Math.min(d1, d2) : Math.max(d1, d2);
    dice.push({ sides: 20, result: kept });
    dice.push({ sides: 20, result: dropped, discarded: true });
    natural = kept;
  } else {
    natural = rollDie(20, rng);
    dice.push({ sides: 20, result: natural });
  }

  const total = natural + modSum;
  let outcome: RollLog['outcome'];

  if (opts.target) {
    if (opts.target.type === 'ac') {
      const critAt = opts.critRange ?? 20;
      if (natural === 1) {
        outcome = 'miss';
      } else if (natural >= critAt) {
        outcome = 'crit';
      } else {
        outcome = total >= opts.target.value ? 'hit' : 'miss';
      }
    } else {
      outcome = total >= opts.target.value ? 'success' : 'fail';
    }
  }

  return {
    kind: 'd20',
    dice,
    advantage,
    modifiers,
    total,
    target: opts.target,
    outcome,
    text: buildD20Text(dice, modifiers, total, opts.target, outcome),
  };
}
