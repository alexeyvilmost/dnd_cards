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

  it('translates canonical range rejections without exposing actor ids', () => {
    expect(playerFacingSheetActionError(new Error(
      'OutOfRange: actor:target is outside 5 ft range',
    ))).toBe('Цель вне дистанции действия (5 фт.).');
    expect(playerFacingSheetActionError(new Error(
      'OutOfRange: actor:target is outside 10 ft unarmed reach',
    ))).toBe('Цель вне дистанции действия (10 фт.).');
  });

  it('translates Stonecunning fact rejections into an actionable terrain instruction', () => {
    expect(playerFacingSheetActionError(new Error(
      'InvalidFacts: Stonecunning requires explicit stone-surface contact facts',
    ))).toBe('Для Камнечувствия укажите, что персонаж стоит на каменной поверхности или касается её.');
  });
});
