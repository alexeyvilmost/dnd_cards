import type {PendingD20Interrupt} from './types';
import definitions from '../engine/data/rollInfluences.json';

/** Read-only adapter for archived worker snapshots. Never changes their state,
 * artifact hash, transcript or command semantics. New workers do not emit this shape. */
export function persistedRollPresentation(pending: PendingD20Interrupt | undefined): PendingD20Interrupt | undefined {
  if (!pending) return pending;
  const legacy = pending as unknown as {operation?: string; heroic?: NonNullable<PendingD20Interrupt['held']>};
  if (legacy.operation !== 'heroic_reroll' || !legacy.heroic) return pending;
  const action = definitions.find(row => row.id === 'core.heroic-inspiration')!;
  return {...pending, operation:'roll_influence', timing:'after_roll_before_outcome',
    held: {...legacy.heroic, kind:legacy.heroic.roll.kind === 'check' ? 'check' : legacy.heroic.saveResponse ? 'save' : 'attack'},
    responders:[{actorId:pending.command.actorId,effectId:action.id,effectName:action.name}]};
}
