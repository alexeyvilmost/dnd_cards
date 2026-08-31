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

  it('explains a stale sheet without exposing CAS or runtime implementation terms', () => {
    expect(playerFacingSheetActionError(new Error('character runtime revision is stale')))
      .toBe('Лист изменился в другой вкладке или во время боя.');
    expect(playerFacingSheetActionError(new Error(
      'f8e7549a-fe5c-4347-9d90-a7e27bfe94b9 runtime revision changed; rebuild the command from fresh sheets',
    ))).toBe('Лист изменился в другой вкладке или во время боя.');
  });

  it('translates canonical range rejections without exposing actor ids', () => {
    expect(playerFacingSheetActionError(new Error(
      'OutOfRange: actor:target is outside 5 ft range',
    ))).toBe('Цель вне дистанции действия (5 фт.).');
    expect(playerFacingSheetActionError(new Error(
      'OutOfRange: actor:target is outside 10 ft unarmed reach',
    ))).toBe('Цель вне дистанции действия (10 фт.).');
  });

  it('translates willingness and armor rejections without exposing actor or action ids', () => {
    expect(playerFacingSheetActionError(new Error(
      'TargetNotWilling: actor:target has not explicitly consented to action:mage-armor',
    ))).toBe('Для этого действия нужно явное согласие цели.');
    expect(playerFacingSheetActionError(new Error(
      'TargetArmored: actor:target is wearing armor',
    ))).toBe('Цель носит доспехи и не подходит для этого действия.');
  });

  it('explains an unsupported pending target save without exposing engine terms', () => {
    const message = playerFacingSheetActionError(new Error(
      'The compatible character sheet cannot resume canonical pending resolution target_save',
    ));
    expect(message).toBe(
      'Не удалось завершить спасбросок цели. Ресурсы не потрачены; обновите страницу и повторите действие.',
    );
    expect(message).not.toContain('canonical');
    expect(message).not.toContain('target_save');
  });

  it('translates Stonecunning fact rejections into an actionable terrain instruction', () => {
    expect(playerFacingSheetActionError(new Error(
      'InvalidFacts: Stonecunning requires explicit stone-surface contact facts',
    ))).toBe('Для Камнечувствия укажите, что персонаж стоит на каменной поверхности или касается её.');
  });
});
