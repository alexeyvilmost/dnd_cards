// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SheetActionLine from './SheetActionLine';
import { PinModeProvider } from '../hooks/usePinMode';
vi.mock('../utils/resources', async original => ({ ...await original<typeof import('../utils/resources')>(), useResourceOptions: () => [] }));
vi.mock('../utils/mastery', () => ({ useMasteryEffects: () => [], findMastery: () => undefined }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps a centred preview stationary, allows pinning, and closes with Escape', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const dimensions = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1200);
  const height = vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(900);
  try {
    await act(async () => root.render(<PinModeProvider><SheetActionLine name="Test action" description="Inspect me" variant="icon" onActivate={() => {}} /></PinModeProvider>));
    const trigger = host.querySelector('button')!;
    trigger.getBoundingClientRect = () => ({ left: 100, top: 200, width: 48, height: 48 }) as DOMRect;
    trigger.firstElementChild!.getBoundingClientRect = trigger.getBoundingClientRect;
    await act(async () => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 102, clientY: 202 })));
    const preview = document.querySelector<HTMLElement>('.forge-effect-popover')!;
    expect(preview.style.left).toBe('136px'); expect(preview.style.top).toBe('236px');
    await act(async () => trigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 145, clientY: 246 })));
    expect(preview.style.left).toBe('136px'); expect(preview.style.top).toBe('236px');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't' })));
    await act(async () => trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('.forge-effect-popover')).toBe(preview);
    expect(preview.style.pointerEvents).toBe('auto');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })));
    expect(document.querySelector('.forge-effect-popover')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); dimensions.mockRestore(); height.mockRestore(); }
});
