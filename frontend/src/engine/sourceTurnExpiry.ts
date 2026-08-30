import type { EngineEvent, RuntimeState } from '../mvp/contracts';

export interface SourceTurnBoundaryResult {
  state: RuntimeState;
  events: EngineEvent[];
  changed: boolean;
}

/**
 * Advance effects whose duration is expressed relative to another creature's
 * turn. The strict owner/source checks make persisted relation metadata the
 * authority and prevent a similarly named effect from expiring by accident.
 */
export function applySourceTurnBoundary(
  state: RuntimeState,
  input: {
    sourceActorId: string;
    ownerActorId: string;
    boundary: 'start' | 'end';
  },
): SourceTurnBoundaryResult {
  const events: EngineEvent[] = [];
  let changed = false;
  const activeEffects = state.activeEffects.flatMap((effect) => {
    const lifecycle = effect.sourceTurnExpiry;
    const matches = lifecycle?.sourceActorId === input.sourceActorId
      && lifecycle.ownerActorId === input.ownerActorId
      && effect.sourceId === input.sourceActorId
      && effect.ownerId === input.ownerActorId;
    if (!matches || !lifecycle) return [effect];

    if (input.boundary === 'start' && lifecycle.boundary === 'start') {
      changed = true;
      events.push({ type: 'effect_expired', name: effect.name });
      return [];
    }
    if (input.boundary === 'start'
      && lifecycle.boundary === 'end'
      && lifecycle.armed !== true) {
      changed = true;
      return [{
        ...effect,
        sourceTurnExpiry: { ...lifecycle, armed: true as const },
      }];
    }
    if (input.boundary === 'end'
      && lifecycle.boundary === 'end'
      && lifecycle.armed === true) {
      changed = true;
      events.push({ type: 'effect_expired', name: effect.name });
      return [];
    }
    return [effect];
  });

  return {
    state: changed ? { ...state, activeEffects } : state,
    events,
    changed,
  };
}
