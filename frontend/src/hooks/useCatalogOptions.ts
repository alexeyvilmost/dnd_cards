import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CatalogOptionPage<T> {
  items: T[];
  total: number;
}

interface UseCatalogOptionsInput<T extends { id: string }> {
  query: string;
  selectedIds: string[];
  fetchPage: (input: { page: number; limit: number; search?: string }) => Promise<CatalogOptionPage<T>>;
  fetchOne: (id: string) => Promise<T>;
  pageSize?: number;
  debounceMs?: number;
}

function mergeUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * Race-safe server-side option search with pagination and selected-reference
 * resolution. The previous page remains visible while a new query is loading.
 */
export function useCatalogOptions<T extends { id: string }>({
  query,
  selectedIds,
  fetchPage,
  fetchOne,
  pageSize = 80,
  debounceMs = 250,
}: UseCatalogOptionsInput<T>) {
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const selectedKey = useMemo(() => [...new Set(selectedIds)].sort().join('\u0000'), [selectedIds]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), debounceMs);
    return () => window.clearTimeout(timer);
  }, [debounceMs, query]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    void fetchPage({ page: 1, limit: pageSize, ...(debouncedQuery ? { search: debouncedQuery } : {}) })
      .then((result) => {
        if (requestSequence.current !== sequence) return;
        setItems(result.items);
        setPage(1);
        setTotal(result.total);
      })
      .catch((reason) => {
        if (requestSequence.current !== sequence) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить варианты');
      })
      .finally(() => {
        if (requestSequence.current === sequence) setLoading(false);
      });
  }, [debouncedQuery, fetchPage, pageSize]);

  useEffect(() => {
    const wanted = selectedKey ? selectedKey.split('\u0000') : [];
    const known = new Set(items.map((item) => item.id));
    const missing = wanted.filter((id) => !known.has(id));
    if (!missing.length) {
      setReferenceError(null);
      return undefined;
    }
    let active = true;
    const referenceRequests: Array<Promise<T | null>> = missing.map(async (id) => {
      try {
        return await fetchOne(id);
      } catch {
        return null;
      }
    });
    void Promise.all(referenceRequests)
      .then((resolved) => {
        if (!active) return;
        // Promise.all unwraps generic T to Awaited<T>; fetchOne's contract still
        // guarantees every non-null value is the requested catalog item.
        const found = resolved.filter((item) => item !== null) as T[];
        const failedCount = resolved.length - found.length;
        setReferenceError(failedCount
          ? `Не удалось разрешить выбранные ссылки: ${failedCount}`
          : null);
        if (found.length) setItems((current) => mergeUnique(current, found));
      });
    return () => { active = false; };
  }, [fetchOne, items, selectedKey]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || page * pageSize >= total) return;
    const nextPage = page + 1;
    const sequence = requestSequence.current;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await fetchPage({
        page: nextPage,
        limit: pageSize,
        ...(debouncedQuery ? { search: debouncedQuery } : {}),
      });
      if (requestSequence.current !== sequence) return;
      setItems((current) => mergeUnique(current, result.items));
      setPage(nextPage);
      setTotal(result.total);
    } catch (reason) {
      if (requestSequence.current === sequence) {
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить следующую страницу');
      }
    } finally {
      if (requestSequence.current === sequence) setLoadingMore(false);
    }
  }, [debouncedQuery, fetchPage, loading, loadingMore, page, pageSize, total]);

  return {
    items,
    total,
    loading,
    loadingMore,
    error: error ?? referenceError,
    hasMore: page * pageSize < total,
    loadMore,
  };
}
