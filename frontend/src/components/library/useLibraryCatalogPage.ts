import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { requiredReviewSummary, type CatalogReviewResponse, type CatalogReviewSummary } from '../../api/catalogReview';

export const LIBRARY_PAGE_SIZE = 50;
export interface LibraryCatalogPage<T> extends CatalogReviewResponse { rows: T[]; total: number }
export type LibraryPageRequest<T> = (page: number, limit: number) => Promise<LibraryCatalogPage<T>>;

export function mergeCatalogRows<T extends { id: string }>(previous: T[], incoming: T[], append: boolean): T[] {
  const result = append ? [...previous] : [];
  const seen = new Set(result.map(row => row.id));
  for (const row of incoming) {
    if (!seen.has(row.id)) { result.push(row); seen.add(row.id); }
  }
  return result;
}

/** Owns transport/page state only; entity rendering and rule data stay with their canonical components. */
export function useLibraryCatalogPage(reviewEnabled: boolean) {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<CatalogReviewSummary>();
  const generation = useRef(0);
  const rowRequest = useRef(0);
  const summaryRequest = useRef(0);
  const boundaryDirty = useRef(false);

  const invalidate = () => { generation.current++; rowRequest.current++; summaryRequest.current++; };
  const reset = () => {
    invalidate();
    boundaryDirty.current = false;
    setLoading(false); setLoadingMore(false); setError(null); setReviewError(null);
    setCurrentPage(1); setTotal(0); setHasMore(false); setReviewSummary(undefined);
  };

  async function load<T extends { id: string }>(
    request: LibraryPageRequest<T>, setRows: Dispatch<SetStateAction<T[]>>,
    page = 1, append = false, onLoaded?: () => void,
  ) {
    const epoch = generation.current, revision = ++rowRequest.current, summaryRevision = summaryRequest.current;
    // A status edit can remove a row ahead of the offset. Re-read the boundary
    // page once on the next scroll so the shifted next row is not lost.
    const requestedPage = append && boundaryDirty.current ? Math.max(1, page - 1) : page;
    const current = () => epoch === generation.current && revision === rowRequest.current;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const response = await request(requestedPage, LIBRARY_PAGE_SIZE);
      if (!current()) return;
      const summary = requiredReviewSummary(response, reviewEnabled);
      setRows(previous => mergeCatalogRows(previous, response.rows, append));
      onLoaded?.();
      setCurrentPage(requestedPage);
      setHasMore(response.rows.length === LIBRARY_PAGE_SIZE && requestedPage * LIBRARY_PAGE_SIZE < response.total);
      // A status save may finish during a page request. Its newer server summary wins.
      if (summaryRevision === summaryRequest.current) {
        boundaryDirty.current = false;
        setTotal(response.total); setReviewSummary(summary); setReviewError(null);
      }
      setError(null);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить каталог');
    } finally {
      if (current()) { setLoading(false); setLoadingMore(false); }
    }
  }

  async function refreshSummary(request: LibraryPageRequest<{ id: string }>, membershipMayChange = false) {
    if (!reviewEnabled) return;
    if (membershipMayChange) boundaryDirty.current = true;
    const epoch = generation.current, revision = ++summaryRequest.current;
    const current = () => epoch === generation.current && revision === summaryRequest.current;
    try {
      // No traversal and no replacement of already loaded rows or an open detail dialog.
      const response = await request(1, 1);
      if (!current()) return;
      const summary = requiredReviewSummary(response, true);
      setReviewSummary(summary); setTotal(response.total); setReviewError(null);
    } catch (cause) {
      if (!current()) return;
      setReviewSummary(undefined);
      setReviewError(cause instanceof Error ? cause.message : 'Не удалось обновить статистику проверки');
    }
  }

  return { loading, loadingMore, error, reviewError, currentPage, total, hasMore, reviewSummary,
    load, refreshSummary, invalidate, reset, setError };
}
