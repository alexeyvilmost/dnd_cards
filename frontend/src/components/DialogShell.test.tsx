// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DialogShell from './DialogShell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DialogShell', () => {
  let container: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    opener = document.createElement('button');
    opener.textContent = 'Открыть';
    document.body.append(opener);
    opener.focus();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    opener.remove();
  });

  it('focuses content, traps Tab, closes on Escape, and restores focus', async () => {
    const onCancel = vi.fn();
    await act(async () => root.render(
      <DialogShell label="Проверка" onCancel={onCancel}>
        <button type="button">Первый</button>
        <button type="button">Последний</button>
      </DialogShell>,
    ));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.dice-dialog button')];
    expect(document.activeElement).toBe(buttons[0]);

    buttons[1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
  });
});
