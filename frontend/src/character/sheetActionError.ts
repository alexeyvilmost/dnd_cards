import {resourceLabel} from '../utils/resourcePresentation';

const INCOMPATIBLE_RULESETS = new Set([
  'Atomic participants use incompatible rulesets',
  'Combat participants use incompatible rulesets',
]);

export function playerFacingSheetActionError(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (INCOMPATIBLE_RULESETS.has(detail)) {
    return 'Нельзя применить действие между этими листами: они созданы с несовместимыми версиями правил. Выберите совместимого персонажа или создайте обновлённую копию цели через Forge.';
  }
  if (/character runtime revision (?:is stale|changed during commit)/u.test(detail)
    || /runtime revision changed; rebuild the command from fresh sheets/u.test(detail)) {
    return 'Лист изменился в другой вкладке или во время боя.';
  }
  const missingSlot = /^(?:SpellResourceUnavailable:\s*)?No level ([1-9]) slot for .+$/u.exec(detail);
  if (missingSlot) {
    return `Нет доступного ресурса «${resourceLabel([], `spell_slot_${missingSlot[1]}`)}».`;
  }
  if (/^(?:SpellResourceUnavailable:\s*)?Invalid casting level \d+ for /u.test(detail)) {
    return 'Выберите допустимый круг заклинания.';
  }
  if (/^(?:SpellResourceUnavailable:\s*)?Spell grant .+ has no available free use or slot resource$/u.test(detail)) {
    return 'Нет бесплатного применения или подходящей ячейки.';
  }
  if (/^(?:SpellNotPrepared:\s*)?Spell action .+ but is not prepared$/u.test(detail)) {
    return 'Заклинание не подготовлено.';
  }
  if (/^(?:SpellSourceAmbiguous:\s*)?Spell action .+ has \d+ grants; grantId is required$/u.test(detail)) {
    return 'Выберите источник заклинания.';
  }
  if (/^(?:SpellGrantUnavailable:\s*)?Spell grant .+ has no defined casting access$/u.test(detail)) {
    return 'Заклинание недоступно из выбранного источника.';
  }
  if (/^(?:SpellNormalCastNotAllowed:\s*)?Grant .+ can cast .+ only as a ritual$/u.test(detail)) {
    return 'Из этого источника заклинание доступно только как ритуал.';
  }
  if (/^(?:RitualNotAllowed:\s*)?Grant .+ cannot cast .+ as a ritual$/u.test(detail)) {
    return 'Из этого источника заклинание недоступно как ритуал.';
  }
  const outOfRange = /^OutOfRange: .* is outside (\d+) ft (?:range|unarmed reach)$/u.exec(detail);
  if (outOfRange) {
    return `Цель вне дистанции действия (${outOfRange[1]} фт.).`;
  }
  if (/^TargetNotWilling:/u.test(detail)) {
    return 'Для этого действия нужно явное согласие цели.';
  }
  if (/^TargetArmored:/u.test(detail)) {
    return 'Цель носит доспехи и не подходит для этого действия.';
  }
  if (/^InvalidActionTiming:/u.test(detail)) {
    return 'Сейчас это действие недоступно: дождитесь подходящего события или окна реакции.';
  }
  const unsupportedPending = /^The compatible character sheet cannot resume canonical pending resolution (.+)$/u.exec(detail);
  if (unsupportedPending) {
    return unsupportedPending[1] === 'target_save'
      ? 'Не удалось завершить спасбросок цели. Ресурсы не потрачены; обновите страницу и повторите действие.'
      : 'Действие требует дополнительного решения, которое этот лист пока не может обработать. Ресурсы не потрачены.';
  }
  if (/Stonecunning requires explicit stone-surface contact facts/u.test(detail)) {
    return 'Для Камнечувствия укажите, что персонаж стоит на каменной поверхности или касается её.';
  }
  if (/Stonecunning requires a stone surface/u.test(detail)) {
    return 'Камнечувствие действует только при контакте с каменной поверхностью.';
  }
  if (/Stonecunning stone must be natural or worked/u.test(detail)) {
    return 'Для Камнечувствия выберите природный или обработанный камень.';
  }
  if (/Stonecunning requires standing on or touching the stone surface/u.test(detail)) {
    return 'Для Камнечувствия нужно стоять на камне или касаться каменной поверхности.';
  }
  return detail || 'Не удалось выполнить действие';
}
