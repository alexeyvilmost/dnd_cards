// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ValueBreakdownPanel from '../components/ValueBreakdownPanel';
import { DiceDialogProvider, useDiceDialog } from './DiceDialogContext';

vi.mock('../dice/Dice3DOverlay', () => ({ default: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DiceDialog breakdown preview', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useDiceDialog>;

  function Harness() {
    const current = useDiceDialog();
    useEffect(() => { api = current; }, [current]);
    return null;
  }

  beforeEach(async () => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <DiceDialogProvider><Harness /></DiceDialogProvider>,
    ));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it('shows skill/save sources and total beside the roll controls', async () => {
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = api.request(
        [{ sides: 20, label: 'Проверка (Восприятие)' }],
        'Проверка (Восприятие)',
        <ValueBreakdownPanel
          label="Проверка (Восприятие)"
          breakdown={{
            value: 5,
            parts: [
              { value: 3, source: 'МДР', reason: 'модификатор характеристики' },
              { value: 2, source: 'БМ', reason: 'владение', kind: 'proficiency' },
            ],
          }}
        />,
      );
    });

    const preview = container.querySelector<HTMLElement>('.dice-dialog-preview');
    expect(preview?.textContent).toContain('Проверка (Восприятие)');
    expect(preview?.textContent).toContain('модификатор характеристики');
    expect(preview?.textContent).toContain('владение');
    expect(preview?.textContent).toContain('Итого5');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.dice-dialog-btn.ghost')!.click();
      await pending;
    });
  });
});
