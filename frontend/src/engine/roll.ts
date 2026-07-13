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
import { d20Faces, critRangeShift, shouldReroll, d20DieBonus, outcomeOverride, rollTriggers } from './rollRules';

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
  dieBonus = 0,
): string {
  const parts: string[] = [];
  const kept = dice.filter((d) => !d.discarded);
  const faces = kept[0]?.sides ?? dice[0]?.sides ?? 20;
  const label = `к${faces}`;
  const discarded = dice.filter((d) => d.discarded);
  if (kept.length === 1) {
    const dropTxt = discarded.length ? ` (отброшено ${discarded.map((d) => d.result).join(', ')})` : '';
    parts.push(`${label}: ${kept[0].result}${dropTxt}`);
  } else if (kept.length > 1) {
    parts.push(`${label}: ${kept.map((d) => d.result).join(', ')}`);
  } else if (dice.length === 2) {
    const k = dice.find((d) => !d.discarded);
    const disc = dice.find((d) => d.discarded);
    if (k && disc) parts.push(`${label}: ${k.result} (отброшено ${disc.result})`);
  }
  if (dieBonus) parts.push(`${dieBonus >= 0 ? '+' : ''}${dieBonus} кость`);
  for (const m of modifiers) parts.push(formatMod(m));
  let text = parts.join(' ');
  if (parts.length > 1 || modifiers.length) text += ` = ${total}`;
  else if (kept.length) text = `${label}: ${kept[0].result}`;

  if (target) {
    const tlabel = target.type === 'ac' ? 'КЗ' : 'СЛ';
    text += ` против ${tlabel} ${target.value}`;
    if (outcome === 'crit') text += ' — крит';
    else if (outcome === 'crit_miss') text += ' — крит. промах';
    else if (outcome === 'hit') text += ' — попадание';
    else if (outcome === 'miss') text += ' — промах';
    else if (outcome === 'success') text += ' — успех';
    else if (outcome === 'fail') text += ' — провал';
  }
  return text;
}

/** Бросок d20 с преимуществом/помехой, модификаторами и правилами бросков (см. engine/rollRules.ts). */
export function rollD20(opts: RollD20Options): RollLog {
  const rng = opts.rng;
  const advantage: AdvantageState = opts.advantage ?? 'none';
  const modifiers = opts.modifiers ?? [];
  const modSum = modifiers.reduce((s, m) => s + m.value, 0);
  const rules = opts.rules ?? [];
  const faces = d20Faces(rules); // set_die: к24 вместо к20
  const dice: DieRoll[] = [];

  let natural: number;
  if (advantage === 'advantage' || advantage === 'disadvantage') {
    const d1 = rollDie(faces, rng);
    const d2 = rollDie(faces, rng);
    const takeHigh = advantage === 'advantage';
    const kept = takeHigh ? Math.max(d1, d2) : Math.min(d1, d2);
    const dropped = takeHigh ? Math.min(d1, d2) : Math.max(d1, d2);
    dice.push({ sides: faces, result: kept });
    dice.push({ sides: faces, result: dropped, discarded: true });
    natural = kept;
  } else {
    natural = rollDie(faces, rng);
    dice.push({ sides: faces, result: natural });
  }

  // reroll (Везение полурослика): натуральную кость по правилу перебрасываем ОДИН раз, берём новую.
  if (shouldReroll(rules, natural)) {
    const kept = dice.find((d) => !d.discarded);
    if (kept) kept.discarded = true;
    natural = rollDie(faces, rng);
    dice.push({ sides: faces, result: natural });
  }

  // die_bonus к самой d20-кости (+N к каждой к20/к24) — в total, детекцию крита не меняет.
  const dieBonus = d20DieBonus(rules, faces);
  const total = natural + dieBonus + modSum;
  const critAt = (opts.critRange ?? 20) + critRangeShift(rules); // crit_range складывается

  let outcome: RollLog['outcome'];
  if (opts.target) {
    if (opts.target.type === 'ac') {
      if (natural <= 1) outcome = 'miss';
      else if (natural >= critAt) outcome = 'crit';
      else outcome = total >= opts.target.value ? 'hit' : 'miss';
    } else {
      outcome = total >= opts.target.value ? 'success' : 'fail';
    }
  }
  // outcome-override (крит-промах 11–14 и т.п.) — по натуральному значению, поверх базовой логики.
  const forced = outcomeOverride(rules, natural);
  if (forced) outcome = forced as RollLog['outcome'];

  // on_roll-триггеры (на 15 при атаке → парализовать) — payload-ы отдаём вызывающему для применения.
  const triggered = rollTriggers(rules, natural);

  return {
    kind: 'd20',
    dice,
    advantage,
    modifiers,
    total,
    target: opts.target,
    outcome,
    text: buildD20Text(dice, modifiers, total, opts.target, outcome, dieBonus),
    ...(triggered.length ? { triggered } : {}),
  };
}
