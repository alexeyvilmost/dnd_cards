import { describe, expect, it } from 'vitest';
import { playerFacingSheetActionError } from './sheetActionError';

describe('playerFacingSheetActionError', () => {
  it.each([{level:2,reference:'arbitrary-river-spell'},{level:7,reference:'different-flame-spell'}])(
    'formats missing level $level slots through the shared resource label without leaking source identity', ({level,reference}) => {
      const message=playerFacingSheetActionError(new Error(`No level ${level} slot for ${reference}`));
      expect(message).toBe(`Нет доступного ресурса «Ячейка ${level}-го круга».`);
      expect(message).not.toContain(reference);
      expect(playerFacingSheetActionError(new Error(`SpellResourceUnavailable: No level ${level} slot for ${reference}`)))
        .toBe(message);
    });
  it.each([
    ['Invalid casting level 0 for action:river','Выберите допустимый круг заклинания.'],
    ['Spell grant source:ritual has no available free use or slot resource','Нет бесплатного применения или подходящей ячейки.'],
    ['Spell action action:flame is in source:class but is not prepared','Заклинание не подготовлено.'],
    ['Spell action action:river has 2 grants; grantId is required','Выберите источник заклинания.'],
    ['Spell grant source:flame has no defined casting access','Заклинание недоступно из выбранного источника.'],
    ['Grant source:ritual can cast action:river only as a ritual','Из этого источника заклинание доступно только как ритуал.'],
    ['Grant source:class cannot cast action:flame as a ritual','Из этого источника заклинание недоступно как ритуал.'],
  ])('localizes the canonical spell rejection %s', (detail,expected)=>{
    expect(playerFacingSheetActionError(new Error(detail))).toBe(expected);
  });
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

  it('translates an out-of-window reaction rejection without exposing action or grant ids', () => {
    const message = playerFacingSheetActionError(new Error(
      'InvalidActionTiming: d87f4507-849f-450b-b328-0198cb011587@CLASS-wizard can only be used in a reaction window',
    ));
    expect(message).toBe(
      'Сейчас это действие недоступно: дождитесь подходящего события или окна реакции.',
    );
    expect(message).not.toContain('InvalidActionTiming');
    expect(message).not.toContain('CLASS-wizard');
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
