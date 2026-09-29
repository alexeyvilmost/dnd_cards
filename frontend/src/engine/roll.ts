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
  advantageDiceCount,
  declaredDieResult,
  critRangeShift,
  shouldReroll,
  d20DieBonus,
  outcomeOverride,
  rollTriggers,
  rollD20BonusDice,
  rollD20FailureBonusDice,
  d20MinimumTotal,
  d20MinimumDie,
} from './rollRules';
import { drawDie, type DieAwareRandomSource } from './random';

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
    const tlabel = target.type === 'ac' ? 'КД' : 'СЛ';
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
  opts = (opts.rng as DieAwareRandomSource).transformD20?.(opts) ?? opts;
  (opts.rng as DieAwareRandomSource).inspectD20?.(opts);
  const rng = opts.rng;
  const rules = opts.rules ?? [];
  const deniedAdvantage = rules.some(rule => rule.op === 'deny_advantage');
  const hasAdvantage = !deniedAdvantage && (opts.hasAdvantage ?? opts.advantage === 'advantage');
  const hasDisadvantage = opts.hasDisadvantage ?? opts.advantage === 'disadvantage';
  const advantage: AdvantageState = hasAdvantage === hasDisadvantage ? 'none'
    : hasAdvantage ? 'advantage' : 'disadvantage';
  const modifiers = [...(opts.modifiers ?? [])];
  const modSum = modifiers.reduce((s, m) => s + m.value, 0);
  const faces = d20Faces(rules); // set_die: к24 вместо к20
  const dice: DieRoll[] = [];
  const usedRuleKeys:string[]=[];

  const count = advantage === 'none' ? 1 : advantageDiceCount(rules);
  const primaryDice = Array.from({length: count}, () => {
    const result=drawDie(rng,faces),ordinal=(rng as DieAwareRandomSource).lastDieDrawOrdinal;
    return {sides:faces,result,...(ordinal===undefined?{}:{drawOrdinal:ordinal})} as DieRoll;
  });
  const ordered = [...primaryDice].sort((left, right) => advantage === 'disadvantage'
    ? left.result - right.result : right.result - left.result);
  const primaryKept = ordered[0];
  const comparisonDice = ordered.slice(1);
  for (const die of comparisonDice) die.discarded = true;
  dice.push(...ordered);
  let natural = primaryKept.result;

  // reroll (Везение полурослика): натуральную кость по правилу перебрасываем ОДИН раз, берём новую.
  const rerollRule=rules.find(rule=>shouldReroll([rule],natural));
  if (rerollRule) {
    if(typeof rerollRule.once_per_turn==='string'&&rerollRule.once_per_turn.trim())usedRuleKeys.push(rerollRule.once_per_turn);
    const kept = dice.find((d) => !d.discarded);
    if (kept) kept.discarded = true;
    natural = drawDie(rng, faces);
    dice.push({ sides: faces, result: natural,
      ...((rng as DieAwareRandomSource).lastDieDrawOrdinal===undefined?{}:{drawOrdinal:(rng as DieAwareRandomSource).lastDieDrawOrdinal}) });
  }

  const inspired = faces === 20 ? (rng as DieAwareRandomSource).rerollD20?.(dice) : undefined;
  if (inspired !== undefined) {
    if (!Number.isInteger(inspired) || inspired < 1 || inspired > 20) throw new Error('Invalid replacement d20');
    const kept = dice.find(die => !die.discarded)!;
    kept.discarded = true;
    const replacement: DieRoll = {sides: 20, result: inspired, source: (rng as DieAwareRandomSource).rerollD20Source ?? 'Переброс'};
    // Only one die is rerolled. The other advantage/disadvantage die remains.
    const other = advantage !== 'none' ? comparisonDice[0] : undefined;
    const useOther = other && (advantage === 'advantage' ? other.result > inspired : other.result < inspired);
    if (useOther) {other.discarded = false; replacement.discarded = true;}
    dice.push(replacement);
    natural = useOther ? other.result : inspired;
  }

  const declared = declaredDieResult(rules, faces);
  if (declared && natural !== declared.value) {
    const kept = dice.find(die => !die.discarded)!;
    kept.discarded = true;
    dice.push({sides: faces, result: declared.value, source: declared.source});
    natural = declared.value;
  }

  // die_bonus к самой d20-кости (+N к каждой к20/к24) — в total, детекцию крита не меняет.
  const dieBonus = d20DieBonus(rules, faces);
  const bonusDice = rollD20BonusDice(rules, rng);
  const bonusDiceTotal = bonusDice.reduce((sum, die) => sum + die.result * (die.sign ?? 1), 0);
  const minimumDie=d20MinimumDie(rules,faces);
  const dieFloorBonus=minimumDie?Math.max(0,minimumDie.value-natural):0;
  if(dieFloorBonus)modifiers.push({value:dieFloorBonus,source:minimumDie!.source});
  const rawTotal = natural + dieFloorBonus + dieBonus + bonusDiceTotal + modSum;
  const minimumTotal = d20MinimumTotal(rules);
  const floorBonus = minimumTotal ? Math.max(0, minimumTotal.value - rawTotal) : 0;
  if (floorBonus) modifiers.push({ value: floorBonus, source: minimumTotal!.source });
  let total = rawTotal + floorBonus;
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
  if (rules.some(rule => rule.op === 'critical_on_hit') && outcome === 'hit') outcome = 'crit';
  if (rules.some(rule => rule.op === 'force_success')) outcome = opts.target?.type === 'ac' ? 'crit' : 'success';

  // A data-owned after-failure boon rolls only after the base test misses or
  // fails. Forced outcomes remain authoritative and do not spend the boon.
  const failureBonusDice = !forced && (outcome === 'miss' || outcome === 'fail')
    ? rollD20FailureBonusDice(rules, rng)
    : [];
  if (failureBonusDice.length) {
    total += failureBonusDice.reduce((sum, die) => sum + die.result * (die.sign ?? 1), 0);
    if (opts.target?.type === 'ac' && natural > 1) {
      outcome = total >= opts.target.value ? 'hit' : 'miss';
    } else if (opts.target?.type === 'dc') {
      outcome = total >= opts.target.value ? 'success' : 'fail';
    }
  }

  if (outcome === 'crit' && rules.some(rule => rule.op === 'deny_critical')) outcome = 'hit';

  // on_roll-триггеры (на 15 при атаке → парализовать) — payload-ы отдаём вызывающему для применения.
  const triggered = rollTriggers(rules, natural);

  return {
    kind: 'd20',
    dice: [...dice, ...bonusDice, ...failureBonusDice],
    advantage,
    modifiers,
    total,
    target: opts.target,
    outcome,
    text: buildD20Text(
      dice, modifiers, total, opts.target, outcome, dieBonus, [...bonusDice, ...failureBonusDice],
    ),
    ...(failureBonusDice.length ? { usedFailureBonus: true as const } : {}),
    ...(usedRuleKeys.length?{usedRuleKeys}:{}),
    ...(triggered.length ? { triggered } : {}),
  };
}

/** Add a post-roll boon without rerolling or changing the natural d20. */
export function addBonusDieToD20Roll(
  roll: RollLog,
  faces: number,
  source: string,
  rng: () => number,
): RollLog {
  if (roll.kind !== 'd20' || !Number.isInteger(faces) || faces < 2) {
    throw new Error('Invalid post-roll bonus die');
  }
  const result = drawDie(rng, faces);
  const bonusDie: DieRoll = { sides: faces, result, source, sign: 1, role: 'bonus' };
  const total = roll.total + result;
  let outcome = roll.outcome;
  if (roll.target?.type === 'dc') outcome = total >= roll.target.value ? 'success' : 'fail';
  else if (roll.target?.type === 'ac' && outcome !== 'crit' && outcome !== 'crit_miss') {
    const natural = roll.dice.find(die => die.sides === 20 && !die.discarded)?.result;
    outcome = natural === 1 ? 'miss' : total >= roll.target.value ? 'hit' : 'miss';
  }
  const baseText = roll.text.replace(/ против (?:К[ДЗ]|СЛ) .*$/, '');
  const targetText = roll.target
    ? ` против ${roll.target.type === 'ac' ? 'КД' : 'СЛ'} ${roll.target.value}`
    : '';
  const outcomeText = outcome === 'success' ? ' — успех'
    : outcome === 'fail' ? ' — провал'
      : outcome === 'hit' ? ' — попадание'
        : outcome === 'miss' ? ' — промах'
          : outcome === 'crit' ? ' — крит' : '';
  return {
    ...roll,
    dice: [...roll.dice, bonusDie],
    total,
    outcome,
    text: `${baseText} + к${faces}: ${result} (${source}) = ${total}${targetText}${outcomeText}`,
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

  const outcome: RollLog['outcome'] = roll.automaticHit ? 'hit' : roll.outcome === 'crit' || roll.outcome === 'crit_miss'
    ? roll.outcome
    : natural <= 1
      ? 'miss'
      : roll.total >= targetAc ? 'hit' : 'miss';
  const baseText = roll.text.replace(/ против К[ДЗ] .*$/, '');
  const suffix = outcome === 'crit' ? ' — крит'
    : outcome === 'crit_miss' ? ' — крит. промах'
      : outcome === 'hit' ? ' — попадание' : ' — промах';
  return {
    ...roll,
    target: { type: 'ac', value: targetAc,
      ...(roll.target?.breakdown ? {breakdown: {...roll.target.breakdown, value: targetAc,
        parts: [...roll.target.breakdown.parts, ...(targetAc !== roll.target.value ? [{source: 'Изменение КД при реакции', value: targetAc - roll.target.value}] : [])]}} : {}) },
    outcome,
    text: `${baseText} против КД ${targetAc}${suffix}`,
  };
}
