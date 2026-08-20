// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ValueBreakdownTip from './ValueBreakdownTip';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ValueBreakdownTip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('portals a keyboard-accessible breakdown outside clipping ancestors', async () => {
    await act(async () => root.render(
      <div style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}>
        <ValueBreakdownTip
          label="Инициатива"
          breakdown={{
            value: 5,
            parts: [
              { value: 3, source: 'ЛОВ', reason: 'модификатор', kind: 'ability' },
              { value: 2, source: 'БМ', reason: 'Бдительный', kind: 'proficiency' },
            ],
          }}
        >
          <span>+5</span>
        </ValueBreakdownTip>
      </div>,
    ));

    const trigger = container.querySelector<HTMLElement>('.value-breakdown-wrap')!;
    await act(async () => trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));

    const tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(container.contains(tooltip)).toBe(false);
    expect(tooltip?.textContent).toContain('Инициатива');
    expect(tooltip?.textContent).toContain('Бдительный');
    expect(tooltip?.textContent).toContain('Итого5');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip?.id);

    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });
});
