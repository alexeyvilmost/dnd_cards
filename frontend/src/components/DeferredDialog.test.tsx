// @vitest-environment jsdom
import { act, lazy, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DeferredDialog from './DeferredDialog';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('cancels a pending chunk and never mounts its late dialog', async () => {
  const mounted = vi.fn(), cancelled = vi.fn();
  let deliver!: (value: { default: () => React.JSX.Element }) => void;
  const Dialog = lazy(() => new Promise<{ default: () => React.JSX.Element }>(resolve => { deliver = resolve; }));
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <DeferredDialog label="Выбор" onCancel={() => { cancelled(); setOpen(false); }}><Dialog /></DeferredDialog> : <p>Закрыто</p>;
  }
  await act(async () => root.render(<Harness />));
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Открываем окно…');
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => deliver({ default: () => { mounted(); return <button>Применить</button>; } }));
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(mounted).not.toHaveBeenCalled();
  expect(host.textContent).toBe('Закрыто');
});
