import type { RollD20Options } from '../mvp/contracts';
import { rollD20 } from './roll';
import { d20Faces, outcomeOverride, shouldReroll } from './rollRules';

type Profile = Omit<RollD20Options, 'rng'>;
type Distribution = Map<number, number>;

function bonusDistribution(rules: Record<string, unknown>[], op: string): Distribution {
  let sums: Distribution = new Map([[0, 1]]);
  for (const rule of rules.filter(row => row.op === op)) {
    const sides = Math.floor(Number(rule.faces ?? rule.die ?? rule.value));
    if (!Number.isFinite(sides) || sides < 2) continue;
    const count = Math.max(1, Math.floor(Number(rule.count ?? 1)));
    const sign = Number(rule.sign ?? 1) < 0 ? -1 : 1;
    for (let n = 0; n < count; n++) {
      const next: Distribution = new Map();
      for (const [sum, weight] of sums) for (let die = 1; die <= sides; die++) {
        const value = sum + die * sign;
        next.set(value, (next.get(value) ?? 0) + weight / sides);
      }
      sums = next;
    }
  }
  return sums;
}

/** Exact distribution, including advantage, a single reroll, bonus dice and
 * failure-only dice. The shared d20 resolver owns natural 1/20, critical range,
 * minimum totals and declared outcome overrides. */
export function attackHitProbability(profile: Profile): number {
  if (profile.target?.type !== 'ac') return 0;
  const rules = profile.rules ?? [];
  const faces = d20Faces(rules);
  const natural: Distribution = new Map();
  for (let die = 1; die <= faces; die++) {
    const weight = profile.advantage === 'advantage' ? (2 * die - 1) / faces ** 2
      : profile.advantage === 'disadvantage' ? (2 * (faces - die) + 1) / faces ** 2 : 1 / faces;
    if (shouldReroll(rules, die)) {
      for (let reroll = 1; reroll <= faces; reroll++) natural.set(reroll, (natural.get(reroll) ?? 0) + weight / faces);
    } else natural.set(die, (natural.get(die) ?? 0) + weight);
  }
  const bonuses = bonusDistribution(rules, 'bonus_die');
  const failureBonuses = bonusDistribution(rules, 'bonus_die_on_failure');
  const baseRules = rules.filter(rule => !['reroll', 'bonus_die', 'bonus_die_on_failure'].includes(String(rule.op)));
  let hits = 0;
  for (const [die, weight] of natural) for (const [bonus, bonusWeight] of bonuses) {
    const roll = rollD20({...profile, advantage: 'none', rules: baseRules,
      modifiers: [...(profile.modifiers ?? []), {value: bonus, source: 'Дополнительные кости'}],
      rng: () => (die - 0.5) / faces});
    if (roll.outcome === 'hit' || roll.outcome === 'crit') hits += weight * bonusWeight;
    else if (roll.outcome === 'miss' && die > 1 && !outcomeOverride(rules, die)) {
      for (const [extra, extraWeight] of failureBonuses) if (roll.total + extra >= profile.target.value) {
        hits += weight * bonusWeight * extraWeight;
      }
    }
  }
  return Math.max(0, Math.min(1, hits));
}
