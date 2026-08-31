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
import {
  d20Faces,
  critRangeShift,
  shouldReroll,
  d20DieBonus,
  outcomeOverride,
  rollTriggers,
  rollD20BonusDice,
  d20MinimumTotal,
} from './rollRules';
import { drawDie } from './random';

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
  bonusDice: DieRoll[] = [],
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
  if (bonusDice.length) {
    parts.push(bonusDice.map((die, index) => {
      const negative = die.sign === -1;
      const operator = negative ? '−' : (index === 0 ? '+' : '+');
      return `${operator} к${die.sides}: ${die.result}${die.source ? ` (${die.source})` : ''}`;
    }).join(' '));
  }
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
  const modifiers = [...(opts.modifiers ?? [])];
  const modSum = modifiers.reduce((s, m) => s + m.value, 0);
  const rules = opts.rules ?? [];
  const faces = d20Faces(rules); // set_die: к24 вместо к20
  const dice: DieRoll[] = [];

  let natural: number;
  if (advantage === 'advantage' || advantage === 'disadvantage') {
    const d1 = drawDie(rng, faces);
    const d2 = drawDie(rng, faces);
    const takeHigh = advantage === 'advantage';
    const kept = takeHigh ? Math.max(d1, d2) : Math.min(d1, d2);
    const dropped = takeHigh ? Math.min(d1, d2) : Math.max(d1, d2);
    dice.push({ sides: faces, result: kept });
    dice.push({ sides: faces, result: dropped, discarded: true });
    natural = kept;
  } else {
    natural = drawDie(rng, faces);
    dice.push({ sides: faces, result: natural });
  }

  // reroll (Везение полурослика): натуральную кость по правилу перебрасываем ОДИН раз, берём новую.
  if (shouldReroll(rules, natural)) {
    const kept = dice.find((d) => !d.discarded);
    if (kept) kept.discarded = true;
    natural = drawDie(rng, faces);
    dice.push({ sides: faces, result: natural });
  }

  // die_bonus к самой d20-кости (+N к каждой к20/к24) — в total, детекцию крита не меняет.
  const dieBonus = d20DieBonus(rules, faces);
  const bonusDice = rollD20BonusDice(rules, rng);
  const bonusDiceTotal = bonusDice.reduce((sum, die) => sum + die.result * (die.sign ?? 1), 0);
  const rawTotal = natural + dieBonus + bonusDiceTotal + modSum;
  const minimumTotal = d20MinimumTotal(rules);
  const floorBonus = minimumTotal ? Math.max(0, minimumTotal.value - rawTotal) : 0;
  if (floorBonus) modifiers.push({ value: floorBonus, source: minimumTotal!.source });
  const total = rawTotal + floorBonus;
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
    dice: [...dice, ...bonusDice],
    advantage,
    modifiers,
    total,
    target: opts.target,
    outcome,
    text: buildD20Text(dice, modifiers, total, opts.target, outcome, dieBonus, bonusDice),
    ...(triggered.length ? { triggered } : {}),
  };
}

/**
 * Re-evaluate an already rolled attack against a new AC without consuming RNG.
 * Used by interrupt reactions such as Shield: the dice and modifiers are
 * immutable, while the target value may change before hit effects are applied.
 */
export function retargetAttackRoll(roll: RollLog, targetAc: number): RollLog {
  if (roll.kind !== 'd20') throw new Error('Only d20 attack rolls can be retargeted');
  const natural = roll.dice.find((die) => !die.discarded)?.result;
  if (natural == null) throw new Error('Attack roll has no kept die');

  const outcome: RollLog['outcome'] = roll.outcome === 'crit' || roll.outcome === 'crit_miss'
    ? roll.outcome
    : natural <= 1
      ? 'miss'
      : roll.total >= targetAc ? 'hit' : 'miss';
  const baseText = roll.text.replace(/ против КЗ .*$/, '');
  const suffix = outcome === 'crit' ? ' — крит'
    : outcome === 'crit_miss' ? ' — крит. промах'
      : outcome === 'hit' ? ' — попадание' : ' — промах';
  return {
    ...roll,
    target: { type: 'ac', value: targetAc },
    outcome,
    text: `${baseText} против КЗ ${targetAc}${suffix}`,
  };
}
