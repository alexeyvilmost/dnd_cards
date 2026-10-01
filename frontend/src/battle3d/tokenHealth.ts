/** Fraction of the portrait shaded for lost hit points; temporary hits remain separate. */
export function lostHealthFraction(hp: number, maxHp: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0;
  return 1 - Math.max(0, Math.min(1, hp / maxHp));
}
