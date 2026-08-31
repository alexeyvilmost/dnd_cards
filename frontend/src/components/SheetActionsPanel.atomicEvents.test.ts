import { describe, expect, it, vi } from 'vitest';
import type { CharacterEventRow } from '../character/api';
import { contextualizeSheetJournalEvents, surfaceAcceptedSheetAtomicEvents } from './SheetActionsPanel';

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

  it('adds a durable action and target heading to ordinary sheet journal events', () => {
    const events = [{ type: 'damage', amount: 5, damageType: 'force' }] as const;
    expect(contextualizeSheetJournalEvents({
      actionName: 'Волшебная стрела',
      targetNames: ['Пугало', 'Пугало'],
      events,
    })).toEqual([
      { type: 'narrative', text: 'Волшебная стрела → Пугало' },
      events[0],
    ]);
    expect(events).toHaveLength(1);
  });
});
