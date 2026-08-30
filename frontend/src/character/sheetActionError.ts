const INCOMPATIBLE_RULESETS = new Set([
  'Atomic participants use incompatible rulesets',
  'Combat participants use incompatible rulesets',
]);

export function playerFacingSheetActionError(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (INCOMPATIBLE_RULESETS.has(detail)) {
    return 'Нельзя применить действие между этими листами: они созданы с несовместимыми версиями правил. Выберите совместимого персонажа или создайте обновлённую копию цели через Forge.';
  }
  const outOfRange = /^OutOfRange: .* is outside (\d+) ft (?:range|unarmed reach)$/u.exec(detail);
  if (outOfRange) {
    return `Цель вне дистанции действия (${outOfRange[1]} фт.).`;
  }
  return detail || 'Не удалось выполнить действие';
}
