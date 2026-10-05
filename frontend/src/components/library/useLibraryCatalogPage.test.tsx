// @vitest-environment jsdom
import { act, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITY_SUPPORT_STATUSES, type EntityReviewStatus } from '../../content/supportStatus';
import { mergeCatalogRows, useLibraryCatalogPage, type LibraryCatalogPage } from './useLibraryCatalogPage';

type Row = { id: string; name: string };
const summary = (status: EntityReviewStatus, total: number) => ({ total,
  counts: Object.fromEntries(ENTITY_SUPPORT_STATUSES.map(value => [value, value === status ? total : 0])) as Record<EntityReviewStatus, number> });
const response = (rows: Row[], total = rows.length, status: EntityReviewStatus = 'not_verified'): LibraryCatalogPage<Row> =>
  ({ rows, total, review_summary: summary(status, total) });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('shared catalog page orchestration', () => {
  let root: Root, container: HTMLDivElement;
  let state: ReturnType<typeof useLibraryCatalogPage> & { rows: Row[]; setRows: Dispatch<SetStateAction<Row[]>> };
  function Harness() {
    const page = useLibraryCatalogPage(true), [rows, setRows] = useState<Row[]>([]);
    useLayoutEffect(() => { state = { ...page, rows, setRows }; });
    return <section>{rows.map(row => <p key={row.id}>{row.name}</p>)}</section>;
  }
  beforeEach(async () => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => { await act(async () => { state.invalidate(); root.unmount(); }); container.remove(); });

  it.each(['spell', 'resource'])('loads and appends %s data through the same cursor, deduplicating IDs without mutating sources', async kind => {
    const first = Array.from({ length: 50 }, (_, index) => ({ id: `${kind}-${index}`, name: `${kind} ${index}` }));
    const next = [...first.slice(-1), { id: `${kind}-50`, name: 'next' }];
    const before = structuredClone([first, next]);
    const request = vi.fn().mockResolvedValueOnce(response(first, 51)).mockResolvedValueOnce(response(next, 51));
    await act(async () => state.load(request, state.setRows));
    expect(state.hasMore).toBe(true); expect(state.currentPage).toBe(1);
    await act(async () => state.load(request, state.setRows, 2, true));
    expect(request.mock.calls).toEqual([[1, 50], [2, 50]]);
    expect(state.rows).toHaveLength(51); expect(state.currentPage).toBe(2); expect(state.hasMore).toBe(false);
    expect([first, next]).toEqual(before);
    expect(mergeCatalogRows([], [first[0], first[0]], false)).toEqual([first[0]]);
  });

  it.each(['success', 'failure'])('ignores the previous identity/filter request after a newer page (%s)', async outcome => {
    const old = deferred<LibraryCatalogPage<Row>>(); let pending!: Promise<void>;
    await act(async () => { pending = state.load(() => old.promise, state.setRows); });
    await act(async () => { state.reset(); await state.load(async () => response([{ id: 'new', name: 'current' }]), state.setRows); });
    await act(async () => { if (outcome === 'success') old.resolve(response([{ id: 'old', name: 'private' }])); else old.reject(new Error('obsolete failure')); await pending; });
    expect(state.rows.map(row => row.id)).toEqual(['new']); expect(state.error).toBeNull(); expect(state.loading).toBe(false);
  });

  it('does not replace rows, cursor, DOM or scroll when refreshing complete server counts', async () => {
    await act(async () => state.load(async () => response([{ id: 'second-page', name: 'selected' }], 90), state.setRows, 2, true));
    const row = container.querySelector('p'); container.scrollTop = 125;
    const request = vi.fn(async () => response([{ id: 'metadata-only', name: 'never render' }], 89, 'verified'));
    await act(async () => state.refreshSummary(request));
    expect(request).toHaveBeenCalledExactlyOnceWith(1, 1);
    expect(container.querySelector('p')).toBe(row); expect(container.scrollTop).toBe(125);
    expect(state.currentPage).toBe(2); expect(state.rows.map(value => value.id)).toEqual(['second-page']);
    expect(state.total).toBe(89); expect(state.reviewSummary?.counts.verified).toBe(89);
    expect(state.loading).toBe(false); expect(state.loadingMore).toBe(false);
  });

  it('keeps the post-save server summary when an older page request finishes later', async () => {
    const old = deferred<LibraryCatalogPage<Row>>(); let pending!: Promise<void>;
    await act(async () => { pending = state.load(() => old.promise, state.setRows); });
    await act(async () => state.refreshSummary(async () => response([], 2, 'verified')));
    await act(async () => { old.resolve(response([{ id: 'row', name: 'loaded' }], 3)); await pending; });
    expect(state.rows).toHaveLength(1); expect(state.total).toBe(2); expect(state.reviewSummary?.counts.verified).toBe(2);
  });

  it('re-reads one boundary page after filtered membership changes, so an offset shift cannot lose a row', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ id: String(index), name: `row ${index}` }));
    const request = vi.fn(async (page: number, limit: number) => response(rows.slice((page - 1) * limit, page * limit), rows.length));
    await act(async () => state.load(request, state.setRows));
    rows.shift(); // A saved status no longer matches the active server filter.
    await act(async () => { state.setRows(previous => previous.filter(row => row.id !== '0')); await state.refreshSummary(request, true); });
    const retained = container.querySelector('p');
    await act(async () => state.load(request, state.setRows, state.currentPage + 1, true));
    expect(container.querySelector('p')).toBe(retained);
    expect(state.rows.map(row => row.id)).toEqual(rows.slice(0, 50).map(row => row.id));
    await act(async () => state.load(request, state.setRows, state.currentPage + 1, true));
    expect(state.rows.map(row => row.id)).toEqual(rows.slice(0, 100).map(row => row.id));
    expect(request.mock.calls).toEqual([[1, 50], [1, 1], [1, 50], [2, 50]]);
  });

  it('rejects missing required summary before accepting a page', async () => {
    await act(async () => state.load(async () => ({ rows: [{ id: 'untrusted', name: 'not accepted' }], total: 1 }), state.setRows));
    expect(state.rows).toEqual([]); expect(state.error).toMatch(/Статистика проверки недоступна/);
    expect(state.loading).toBe(false);
  });

  it('reports summary failure without hiding existing rows or claiming stale counts', async () => {
    await act(async () => state.load(async () => response([{ id: 'row', name: 'keep' }]), state.setRows));
    const row = container.querySelector('p');
    await act(async () => state.refreshSummary(async () => { throw new Error('metadata offline'); }));
    expect(container.querySelector('p')).toBe(row); expect(state.reviewSummary).toBeUndefined();
    expect(state.reviewError).toBe('metadata offline'); expect(state.error).toBeNull();
  });

  it('ignores a metadata response from an obsolete filter', async () => {
    const old = deferred<LibraryCatalogPage<Row>>(); let pending!: Promise<void>;
    await act(async () => { pending = state.refreshSummary(() => old.promise); });
    await act(async () => { state.reset(); await state.load(async () => response([], 0), state.setRows); });
    await act(async () => { old.resolve(response([], 200, 'verified')); await pending; });
    expect(state.total).toBe(0); expect(state.reviewSummary?.total).toBe(0);
  });
});
