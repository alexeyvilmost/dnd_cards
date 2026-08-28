// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastContext';

vi.mock('../components/Toast', () => ({
  default: ({ id, title }: { id: string; title: string }) => (
    <div data-toast-id={id}>{title}</div>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('ToastProvider identity', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useToast>;

  function Harness() {
    const current = useToast();
    useEffect(() => { api = current; }, [current]);
    return null;
  }

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <ToastProvider><Harness /></ToastProvider>,
    ));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('assigns unique provider-local IDs when deterministic tests fix the RNG', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await act(async () => {
      api.showToast({ type: 'success', title: 'First transition' });
      api.showToast({ type: 'info', title: 'Second transition' });
    });

    const ids = [...container.querySelectorAll<HTMLElement>('[data-toast-id]')]
      .map((toast) => toast.dataset.toastId);
    expect(ids).toEqual(['toast-1', 'toast-2']);
    expect(new Set(ids).size).toBe(2);
    expect(random).not.toHaveBeenCalled();
  });
});
