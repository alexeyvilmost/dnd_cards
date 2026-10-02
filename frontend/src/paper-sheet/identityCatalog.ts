import { backgroundsApi, classesApi, racesApi } from '../api/client';
import { loadCatalogPages } from '../api/catalogPages';
import type { BackgroundsResponse, ClassesResponse, RacesResponse } from '../types';
import type { PaperIdentityKind, PaperIdentityOption } from './identity';

export async function loadPaperIdentityCatalog(kind: PaperIdentityKind, isCurrent: () => boolean = () => true): Promise<PaperIdentityOption[]> {
  const params = { limit: 100, fields: 'list' as const };
  if (kind === 'background') {
    const response = await loadCatalogPages<BackgroundsResponse>(page => backgroundsApi.getBackgrounds({ ...params, page }), 'backgrounds', true, isCurrent);
    return response.backgrounds.map(entity => ({ kind: 'background', id: entity.id, name: entity.name }));
  }
  if (kind === 'species' || kind === 'subspecies') {
    const response = await loadCatalogPages<RacesResponse>(page => racesApi.getRaces({ ...params, page }), 'races', true, isCurrent);
    return response.races.map(entity => ({
      kind: entity.is_subrace || entity.parent_race_id ? 'subspecies' : 'species',
      id: entity.id, name: entity.name, parentId: entity.parent_race_id ?? undefined,
    }));
  }
  const response = await loadCatalogPages<ClassesResponse>(page => classesApi.getClasses({ ...params, page }), 'classes', true, isCurrent);
  return response.classes.map(entity => ({
    kind: entity.is_subclass || entity.parent_class_id ? 'subclass' : 'class',
    id: entity.id, name: entity.name, parentId: entity.parent_class_id ?? undefined,
  }));
}

export function filterPaperIdentityCatalog(options: PaperIdentityOption[], kind: PaperIdentityKind, query: string, parentId?: string): PaperIdentityOption[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return options.filter(option => option.kind === kind
    && (kind !== 'subclass' && kind !== 'subspecies' || !!parentId && option.parentId === parentId)
    && (!needle || option.name.toLocaleLowerCase('ru').includes(needle)));
}

export function identityCatalogError(cause: unknown): string {
  const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined;
  if (status === 401) return 'Войдите в аккаунт, чтобы открыть каталог.';
  if (status === 403) return 'У вас нет доступа к этому каталогу.';
  return 'Не удалось загрузить каталог. Проверьте соединение и повторите попытку.';
}
