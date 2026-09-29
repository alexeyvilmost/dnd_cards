/** Convert supported finite durations to combat rounds without using wall time.
 * Malformed finite values must expire, never silently become permanent. */
export function finiteDurationRounds(duration: Record<string, unknown> | undefined): number | undefined {
  if (duration?.type !== 'rounds' && duration?.type !== 'minutes' && duration?.type !== 'hours') return undefined;
  const amount = Math.floor(Number(duration.amount));
  const multiplier = duration.type === 'minutes' ? 10 : duration.type === 'hours' ? 600 : 1;
  const rounds = amount * multiplier;
  return Number.isFinite(rounds) && rounds > 0 ? rounds : 1;
}

/** Preserve an already shorter source/turn boundary, otherwise cap a sustained
 * effect. Used for both inline effects and referenced library effects. */
export function cappedEffectDuration(duration:Record<string,unknown>|undefined,cap:number):Record<string,unknown> {
  if(!Number.isSafeInteger(cap)||cap<1)throw Error('Effect duration cap must be a positive integer');
  if(['until_end_of_turn','until_start_of_next_turn','until_end_of_source_turn','until_end_of_round',
    'until_start_of_source_next_turn','until_end_of_source_next_turn'].includes(String(duration?.type))){
    return {...duration,concentration:false};
  }
  return {type:'rounds',amount:Math.min(cap,finiteDurationRounds(duration)??cap),concentration:false};
}
