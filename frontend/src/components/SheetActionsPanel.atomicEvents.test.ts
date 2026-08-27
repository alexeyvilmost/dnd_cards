import { describe, expect, it, vi } from 'vitest';
import type { CharacterEventRow } from '../character/api';
import { surfaceAcceptedSheetAtomicEvents } from './SheetActionsPanel';

describe('SheetActionsPanel accepted atomic journal boundary', () => {
  it('reconciles the exact persisted snapshot once and never invokes the legacy event writer', () => {
    const rows: CharacterEventRow[] = [{
      id: 'event-1',
      character_id: 'hero',
      ts: '2026-08-27T00:00:00Z',
      type: 'resource_spent',
      payload: { type: 'resource_spent', resource: 'action', amount: 1, remaining: 0 },
    }, {
      id: 'event-2',
      character_id: 'hero',
      ts: '2026-08-27T00:00:01Z',
      type: 'effect_applied',
      payload: { type: 'effect_applied', name: 'Bless' },
    }];
    const onEvents = vi.fn();
    const onPersistedEvents = vi.fn();

    surfaceAcceptedSheetAtomicEvents({ rows, onEvents, onPersistedEvents });

    expect(onPersistedEvents).toHaveBeenCalledTimes(1);
    expect(onPersistedEvents).toHaveBeenLastCalledWith(rows);
    expect(onEvents).toHaveBeenCalledTimes(0);
  });
});
