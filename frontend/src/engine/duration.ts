/** Convert supported finite durations to combat rounds without using wall time.
 * Malformed finite values must expire, never silently become permanent. */
export function finiteDurationRounds(duration: Record<string, unknown> | undefined): number | undefined {
  if (duration?.type !== 'rounds' && duration?.type !== 'minutes' && duration?.type !== 'hours') return undefined;
  const amount = Math.floor(Number(duration.amount));
  const multiplier = duration.type === 'minutes' ? 10 : duration.type === 'hours' ? 600 : 1;
  const rounds = amount * multiplier;
  return Number.isFinite(rounds) && rounds > 0 ? rounds : 1;
}
