import { describe, expect, it } from 'vitest';
import { sheetActionNeedsCanonicalAvailability } from './SheetActionsPanel';

describe('run action canonical runtime requirement', () => {
  it.each(['5', '2d4+2'])('builds the worker declaration for a non-primitive %s healing action', (amount) => {
    const action = { mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: { shape: 'self' },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount }] }],
    } };
    // A sheet containing only ordinary data-owned class actions must not wait
    // forever for a canonical build that its camp submit path requires.
    expect(sheetActionNeedsCanonicalAvailability(action, 'dungeon_crawl')).toBe(true);
    expect(sheetActionNeedsCanonicalAvailability(action, 'free')).toBe(false);
  });

  it('keeps the ordinary spell authority even outside a run', () => {
    expect(sheetActionNeedsCanonicalAvailability({ mechanics: {}, spellRef: {} as never }, 'free')).toBe(true);
  });
});
