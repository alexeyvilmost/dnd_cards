import type { ExecuteContext, ExecuteResult, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Executor = (state: RuntimeState, mechanics: Dict, ctx: ExecuteContext) => ExecuteResult;
const record = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);

/** Removed effect instances, not names, own their termination consequences.
 * Replaying the already accepted postimage has no removed instance to execute. */
export function reconcileEndedEffects(before: RuntimeState, after: RuntimeState, ctx: ExecuteContext, execute: Executor,
  options: { elapsedRounds?: number; boundary?: 'start' | 'end' } = {}): ExecuteResult {
  const retained = new Set(after.activeEffects.map(effect => effect.id));
  const endedMaximumDelta=before.activeEffects.filter(effect=>!retained.has(effect.id))
    .reduce((sum,effect)=>sum+Number((effect.mechanics as Dict).max_hp_delta??0),0);
  if(!Number.isSafeInteger(endedMaximumDelta))throw Error('Ended maximum HP adjustment must be an integer');
  const nextMaximum=Math.max(1,after.hp.max-endedMaximumDelta);
  let state = endedMaximumDelta===0?after:{...after,hp:{...after.hp,max:nextMaximum,current:Math.min(after.hp.current,nextMaximum)}};
  const events: ExecuteResult['events'] = [];
  for (const effect of before.activeEffects) {
    if (retained.has(effect.id) || effect.mechanics.on_end === undefined) continue;
    const declaration = effect.mechanics.on_end;
    if (!record(declaration) || !Array.isArray(declaration.effects) || !declaration.effects.length
      || declaration.effects.some(row => !record(row) || row.resolution !== 'auto' || row.who !== 'self' || !Array.isArray(row.result))) {
      throw Error('on_end.effects must contain automatic owner-owned payloads');
    }
    const source = effect.actionContext;
    const oldIds = new Set(state.activeEffects.map(entry => entry.id));
    const result = execute(state, { name: effect.name, effects: declaration.effects,
      ...(effect.mechanics.damage_source_kind ? { damage_source_kind: effect.mechanics.damage_source_kind } : {}) }, {
      ...ctx, target: undefined, selfId: effect.ownerId ?? ctx.selfId, effectSourceId: source?.sourceId ?? effect.sourceId,
      ...(source ? { character: { ...ctx.character, ...source.character }, spell: source.spell } : {}), suppressSpellCastEvent: true,
    });
    state = result.state;
    if (options.boundary === 'start') state = { ...state, activeEffects: state.activeEffects.map(entry =>
      !oldIds.has(entry.id) && entry.sourceTurnExpiry && entry.sourceTurnExpiry.sourceActorId === (effect.ownerId ?? ctx.selfId)
        ? { ...entry, sourceTurnExpiry: { ...entry.sourceTurnExpiry, armed: true } } : entry) };
    events.push(...result.events);
    // A one-hour rest does not leave a one-turn consequence that happened
    // minutes earlier. Only newly created timed entries consume that remainder.
    const remaining = Math.max(0, (options.elapsedRounds ?? 0) - (effect.roundsLeft ?? options.elapsedRounds ?? 0));
    if (remaining) state = { ...state, activeEffects: state.activeEffects.flatMap(entry => {
      if (oldIds.has(entry.id)) return [entry];
      if ((entry.roundsLeft != null && entry.roundsLeft <= remaining)
        || entry.sourceTurnExpiry || ['end_of_turn','start_of_next_turn'].includes(String(entry.expiry))) {
        events.push({ type: 'effect_expired', name: entry.name }); return [];
      }
      return [entry.roundsLeft == null ? entry : { ...entry, roundsLeft: entry.roundsLeft - remaining }];
    }) };
  }
  return { state, events };
}
