import { describe, expect, it } from 'vitest';
import { diceEntryMode } from './diceMode';

describe('выбор режима броска', () => {
  it('при включённом диалоге сначала показывает компактное окно', () => {
    expect(diceEntryMode({ diceDialog: true, dice3d: true }, true)).toBe('classic');
    expect(diceEntryMode({ diceDialog: true, dice3d: false }, true)).toBe('classic');
  });

  it('автоматически открывает 3D, когда диалог выключен, а 3D включён', () => {
    expect(diceEntryMode({ diceDialog: false, dice3d: true }, true)).toBe('3d');
  });

  it('без обоих интерфейсов оставляет системный автобросок', () => {
    expect(diceEntryMode({ diceDialog: false, dice3d: false }, true)).toBe('auto');
  });

  it('не открывает 3D для действий без костей', () => {
    expect(diceEntryMode({ diceDialog: false, dice3d: true }, false)).toBe('auto');
  });
});
