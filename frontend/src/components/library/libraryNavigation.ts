import { useCallback } from 'react';
import { useNavigate, useSearchParams, type NavigateOptions } from 'react-router-dom';
import { buildLibrarySearchParams as buildBase, parseLibrarySearchParams as parseBase, type LibraryFilters } from '../../utils/libraryUrlParams';

export const LIBRARY_PATH = '/library';
export function rarityValues(value: string): string[] {
  return [...new Set(value.split(',').map(part => part.trim()).filter(Boolean))];
}
export function parseLibrarySearchParams(params: URLSearchParams): LibraryFilters {
  const filters = parseBase(params);
  if (filters.contentType === 'cards') {
    filters.rarity = rarityValues([...params.getAll('rarity'), ...params.getAll('rarities')].join(',')).join(',');
  }
  return filters;
}
export function buildLibrarySearchParams(filters: LibraryFilters, existing?: URLSearchParams): URLSearchParams {
  const params = buildBase(filters, existing);
  params.delete('rarities');
  return params;
}
export function libraryLocation(params: URLSearchParams) {
  return { pathname: LIBRARY_PATH, search: params.size ? `?${params.toString()}` : '' };
}
export function useLibrarySearchParams() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setParams = useCallback((next: URLSearchParams | ((previous: URLSearchParams) => URLSearchParams), options?: NavigateOptions) => {
    navigate(libraryLocation(typeof next === 'function' ? next(params) : next), options);
  }, [navigate, params]);
  return [params, setParams] as const;
}
