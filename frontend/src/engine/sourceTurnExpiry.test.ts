import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { applySourceTurnBoundary } from './sourceTurnExpiry';

const SOURCE = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';

function runtime(boundary: 'start' | 'end'): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: {},
    maxResources: {},
    equipment: {},
    inventory: [],
    activeEffects: [{
      id: 'ray-of-sickness:poisoned',
      name: 'Отравленный · Луч болезни',
      source: 'Луч болезни',
      sourceId: SOURCE,
      ownerId: OWNER,
      mechanics: { kind: 'condition', value: 'poisoned' },
      sourceTurnExpiry: {
        sourceActorId: SOURCE,
        ownerActorId: OWNER,
        boundary,
      },
    }],
  };
}

describe('source-relative effect lifecycle', () => {
  it('arms an end-boundary effect at the next source turn start and expires it at that turn end', () => {
    const before = runtime('end');
    const unrelatedEnd = applySourceTurnBoundary(before, {
      sourceActorId: SOURCE,
      ownerActorId: OWNER,
      boundary: 'end',
    });
    expect(unrelatedEnd.changed).toBe(false);
    expect(unrelatedEnd.state).toBe(before);

    const armed = applySourceTurnBoundary(before, {
      sourceActorId: SOURCE,
      ownerActorId: OWNER,
      boundary: 'start',
    });
    expect(armed.changed).toBe(true);
    expect(armed.events).toEqual([]);
    expect(armed.state.activeEffects[0].sourceTurnExpiry?.armed).toBe(true);

    const expired = applySourceTurnBoundary(armed.state, {
      sourceActorId: SOURCE,
      ownerActorId: OWNER,
      boundary: 'end',
    });
    expect(expired.state.activeEffects).toEqual([]);
    expect(expired.events).toEqual([{
      type: 'effect_expired',
      name: 'Отравленный · Луч болезни',
    }]);
  });

  it('expires a start-boundary effect at source start without arming it', () => {
    const expired = applySourceTurnBoundary(runtime('start'), {
      sourceActorId: SOURCE,
      ownerActorId: OWNER,
      boundary: 'start',
    });
    expect(expired.state.activeEffects).toEqual([]);
    expect(expired.events).toHaveLength(1);
  });

  it('ignores effects whose persisted owner/source relation does not match', () => {
    const before = runtime('end');
    before.activeEffects[0].ownerId = SOURCE;
    const result = applySourceTurnBoundary(before, {
      sourceActorId: SOURCE,
      ownerActorId: OWNER,
      boundary: 'start',
    });
    expect(result.changed).toBe(false);
    expect(result.state).toBe(before);
  });
});
