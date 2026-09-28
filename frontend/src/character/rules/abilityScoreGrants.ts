export interface AbilityScoreGrant {
  amount: number;
  cap?: number;
}

/** Apply declared permanent increases without letting an ordinary increase
 * borrow a different source's higher ceiling. Acquisition order is absent
 * from assembled data, so equal limits are grouped and lower limits apply
 * first. Negative changes preserve the existing uncapped-delta contract. */
export function applyAbilityScoreGrants(base: number, grants: readonly AbilityScoreGrant[]): number {
  const increases = new Map<number, number>();
  let score = base;
  for (const grant of grants) {
    if (!Number.isFinite(grant.amount)) continue;
    if (grant.amount <= 0) {
      score += grant.amount;
      continue;
    }
    const cap = Number.isFinite(grant.cap) && Number(grant.cap) > 0 ? Number(grant.cap) : 20;
    increases.set(cap, (increases.get(cap) ?? 0) + grant.amount);
  }
  for (const [cap, amount] of [...increases].sort(([left], [right]) => left - right)) {
    const ceiling = Math.max(base, cap);
    score = Math.max(score, Math.min(score + amount, ceiling));
  }
  return score;
}
