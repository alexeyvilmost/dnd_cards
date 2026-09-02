import { useEffect, useState } from 'react';
import { actionsApi } from '../api/client';
import type { Action } from '../types';

/**
 * Базовые боевые действия (Безоружный удар, Атака оружием и т.п.) — обычные
 * сущности Action с type='basic'. Владелец правит их текст/иконку/механику через
 * редактор действий, без перевыкатки. Здесь только загрузка (кэш на модуль).
 */
let cache: Promise<Action[]> | null = null;
export const BASIC_ACTION_CATALOG_LIMIT = 1000;

export function fetchBasicActions(): Promise<Action[]> {
  if (!cache) {
    cache = actionsApi
      // Basic actions are a shared catalog, not a single API page. A limit of
      // 50 silently hid older valid actions once the catalog grew beyond it
      // (Divine Inspiration was the first production casualty).
      .getActions({ type: 'basic', limit: BASIC_ACTION_CATALOG_LIMIT, fields: 'runtime' })
      // Защита от старого бэкенда без ?type-фильтра: берём только реально basic.
      .then((r) => (r.actions ?? []).filter((a) => a.type === 'basic'))
      .catch(() => {
        cache = null; // сеть упала — дать шанс повторить при следующем вызове
        return [];
      });
  }
  return cache;
}

/** React-хук: список базовых действий из библиотеки (пустой до загрузки). */
export function useBasicActions(): Action[] {
  const [list, setList] = useState<Action[]>([]);
  useEffect(() => {
    let alive = true;
    fetchBasicActions().then((a) => {
      if (alive) setList(a);
    });
    return () => {
      alive = false;
    };
  }, []);
  return list;
}
