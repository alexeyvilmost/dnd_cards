// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalogOptions } from './useCatalogOptions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Item { id: string; name: string }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('useCatalogOptions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps the newest debounced response when older requests finish later', async () => {
    const oldRequest = deferred<{ items: Item[]; total: number }>();
    const newRequest = deferred<{ items: Item[]; total: number }>();
    const fetchPage = vi.fn(({ search }: { search?: string }) => (
      search === 'new' ? newRequest.promise : oldRequest.promise
    ));
    const fetchOne = vi.fn<() => Promise<Item>>();
    function Harness({ query }: { query: string }) {
      const latest = useCatalogOptions({ query, selectedIds: [], fetchPage, fetchOne, debounceMs: 250 });
      return <span>{latest.items.map((item) => item.id).join(',')}</span>;
    }

    await act(async () => root.render(<Harness query="old" />));
    await act(async () => root.render(<Harness query="new" />));
    await act(async () => { vi.advanceTimersByTime(250); });
    await act(async () => { newRequest.resolve({ items: [{ id: 'new', name: 'Новый' }], total: 1 }); });
    expect(container.textContent).toBe('new');

    await act(async () => { oldRequest.resolve({ items: [{ id: 'old', name: 'Старый' }], total: 1 }); });
    expect(container.textContent).toBe('new');
  });
});
