import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings } from './settings';

describe('настройка ручного добавления в лист', () => {
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('включена по умолчанию, включая старый localStorage без нового поля', () => {
    expect(getSettings().allowSheetEntityAdditions).toBe(true);
    stored = JSON.stringify({ diceDialog: false });
    expect(getSettings().allowSheetEntityAdditions).toBe(true);
  });

  it('уважает явное отключение', () => {
    stored = JSON.stringify({ allowSheetEntityAdditions: false });
    expect(getSettings().allowSheetEntityAdditions).toBe(false);
  });
});
