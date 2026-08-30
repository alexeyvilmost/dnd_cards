import { describe, expect, it } from 'vitest';
import { playerFacingSheetActionError } from './sheetActionError';

describe('playerFacingSheetActionError', () => {
  it('explains incompatible character rulesets in player-facing Russian', () => {
    const message = playerFacingSheetActionError(
      new Error('Atomic participants use incompatible rulesets'),
    );
    expect(message).toContain('несовместимыми версиями правил');
    expect(message).toContain('Forge');
    expect(message).not.toContain('Atomic participants');
  });

  it('preserves an already useful error', () => {
    expect(playerFacingSheetActionError(new Error('Цель вне дистанции')))
      .toBe('Цель вне дистанции');
  });
});
