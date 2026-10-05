/** Preserve the current HP share when a build changes the maximum. A living
 * character keeps at least one HP after integer rounding; temporary HP are
 * independent and never participate in the proportion. */
export function currentHpForMaximum(current: number, previousMaximum: number, nextMaximum: number): number {
  const maximum = Math.max(0, Math.floor(nextMaximum));
  const previous = Math.max(0, Math.floor(previousMaximum));
  const boundedCurrent = Math.max(0, Math.min(Math.floor(current), previous || Math.floor(current)));
  if (!maximum || !boundedCurrent) return 0;
  if (!previous) return Math.min(boundedCurrent, maximum);
  return Math.min(maximum, Math.max(1, Math.round(boundedCurrent * maximum / previous)));
}

/** Additional capacity is available immediately; already spent capacity is
 * not restored. A smaller maximum only clamps the remaining current value. */
export function currentResourceForMaximum(current: number, previousMaximum: number, nextMaximum: number): number {
  const maximum = Math.max(0, Math.floor(nextMaximum));
  const previous = Math.max(0, Math.floor(previousMaximum));
  return Math.max(0, Math.min(maximum, Math.floor(current) + Math.max(0, maximum - previous)));
}

/** The initializer and an accepted equipment transition share the same
 * remaining-charge policy. A dormant item pool remembers that it has already
 * been initialized; drawing the provider again is not a rest or a restore. */
export function currentResourceAfterProjection(
  current: number | undefined, previousMaximum: number | undefined,
  nextMaximum: number, itemOwned: boolean,
): number {
  if (current == null) return nextMaximum;
  const oldMaximum = previousMaximum ?? nextMaximum;
  return itemOwned && oldMaximum === 0
    ? Math.min(current, nextMaximum)
    : currentResourceForMaximum(current, oldMaximum, nextMaximum);
}
