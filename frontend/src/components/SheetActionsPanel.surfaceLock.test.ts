import { describe, expect, it } from 'vitest';
import { sheetActionPanelLockIssue } from './SheetActionsPanel';

describe('SheetActionsPanel authoritative-surface lock', () => {
  it('returns the exact player-facing reason used to disable every action', () => {
    expect(sheetActionPanelLockIssue('Use the dedicated combat surface')).toEqual({
      disabled: true,
      reason: 'Use the dedicated combat surface',
    });
  });

  it('does not lock ordinary character-sheet actions', () => {
    expect(sheetActionPanelLockIssue()).toBeNull();
  });
});
