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
