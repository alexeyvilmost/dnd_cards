export type DiceEntryMode = 'auto' | 'classic' | '3d';

export interface DiceModeSettings {
  diceDialog: boolean;
  dice3d: boolean;
}

/**
 * Определяет первый экран броска.
 * Обычный диалог всегда имеет приоритет, а 3D становится автоматическим
 * только когда диалог отключён отдельно.
 */
export function diceEntryMode(settings: DiceModeSettings, hasDice: boolean): DiceEntryMode {
  if (!hasDice) return settings.diceDialog ? 'classic' : 'auto';
  if (settings.diceDialog) return 'classic';
  return settings.dice3d ? '3d' : 'auto';
}
