import type { PendingAttack } from './encounterTypes';

export interface HitPointPools {
  hp: number;
  temp: number;
}

/** Derive the exact HP channels consumed by one resolved attack. */
export function pendingAttackDamage(
  before: HitPointPools,
  after: HitPointPools,
): Pick<PendingAttack, 'damage' | 'hpDamage' | 'tempHpDamage'> {
  const hpDamage = Math.max(0, before.hp - after.hp);
  const tempHpDamage = Math.max(0, before.temp - after.temp);
  return { damage: hpDamage + tempHpDamage, hpDamage, tempHpDamage };
}

/** Undo only the damage represented by a pending attack. New records preserve
 * HP and temporary HP separately. Legacy records retain their historic HP-only
 * fallback so old persisted encounters remain readable. */
export function restoreNegatedPendingAttack(
  current: HitPointPools & { maxHp: number },
  attack: Pick<PendingAttack, 'damage' | 'hpDamage' | 'tempHpDamage'>,
): HitPointPools {
  const hasChannels = Number.isFinite(attack.hpDamage)
    && Number.isFinite(attack.tempHpDamage);
  const hpDamage = hasChannels ? Math.max(0, attack.hpDamage ?? 0) : Math.max(0, attack.damage);
  const tempHpDamage = hasChannels ? Math.max(0, attack.tempHpDamage ?? 0) : 0;
  return {
    hp: Math.min(current.maxHp, current.hp + hpDamage),
    temp: current.temp + tempHpDamage,
  };
}

/** Whether the reaction-produced Armor Class turns the triggering hit into a
 * miss. Critical hits remain hits: their natural-20/critical authority is
 * carried by the pending attack rather than reconstructed from its total. */
export function isPendingAttackNegated(
  attack: Pick<PendingAttack, 'attackTotal' | 'crit'>,
  armorClassAfterReaction: number,
): boolean {
  return attack.crit !== true
    && Number.isFinite(attack.attackTotal)
    && Number.isFinite(armorClassAfterReaction)
    && attack.attackTotal < armorClassAfterReaction;
}
