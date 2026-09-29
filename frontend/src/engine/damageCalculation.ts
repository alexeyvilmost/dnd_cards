import type { DamageCalculation, EngineEvent } from '../mvp/contracts';
import { getDamageLabel } from '../utils/damageTypes';

export function isDamageCalculation(value: unknown): value is DamageCalculation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.beforeResistance) || Number(row.beforeResistance) < 0 || !Array.isArray(row.adjustments)) return false;
  if(row.maximumDamage!==undefined&&(!Number.isSafeInteger(row.maximumDamage)||Number(row.maximumDamage)<0))return false;
  if(row.transferredDamage!==undefined&&(!Number.isSafeInteger(row.transferredDamage)||Number(row.transferredDamage)<0))return false;
  if(row.budgetId!==undefined&&(typeof row.budgetId!=='string'||!row.budgetId))return false;
  const levels: string[] = [];
  for (const rule of row.adjustments) {
    if (!rule || typeof rule !== 'object' || !['immunity', 'resistance', 'vulnerability'].includes(rule.level)
      || !Array.isArray(rule.sourceEntityIds) || !rule.sourceEntityIds.every((id: unknown) => typeof id === 'string' && id.length > 0)) return false;
    levels.push(rule.level);
  }
  return ['', 'immunity', 'resistance', 'vulnerability', 'resistance,vulnerability'].includes(levels.join(','));
}

/** PHB 2024: flat adjustments precede resistance, which precedes vulnerability. */
export function resolveDamageCalculation(calculation: DamageCalculation, damageType: string): {
  amount: number; events: EngineEvent[];
} {
  let amount = Math.max(0, Math.floor(calculation.beforeResistance));
  const events: EngineEvent[] = [];
  for (const rule of calculation.adjustments) {
    const before = amount;
    amount = rule.level === 'immunity' ? 0 : rule.level === 'resistance' ? Math.floor(amount / 2) : amount * 2;
    if (amount === before) continue;
    const label = rule.level === 'immunity' ? 'иммунитет' : rule.level === 'resistance' ? 'сопротивление' : 'уязвимость';
    events.push({ type: 'narrative',
      text: `${label} (${getDamageLabel(damageType).toLocaleLowerCase('ru-RU')}): ${before} → ${amount}`,
      damageAdjustment: { damageType, adjustment: rule.level, before, after: amount,
        sourceEntityIds: rule.sourceEntityIds },
    });
  }
  if(calculation.maximumDamage!==undefined&&amount>calculation.maximumDamage){
    events.push({type:'narrative',text:`Оставшийся предел урона источника: ${amount} → ${calculation.maximumDamage}`});
    amount=calculation.maximumDamage;
  }
  if(calculation.transferredDamage){
    const remaining=Math.max(0,amount-calculation.transferredDamage);
    events.push({type:'narrative',text:`Передача урона другому существу: ${amount} → ${remaining}`});
    amount=remaining;
  }
  return { amount, events };
}
