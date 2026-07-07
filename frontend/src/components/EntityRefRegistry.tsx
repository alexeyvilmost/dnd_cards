/**
 * Резолвер сущностей по (type, id/slug) для ссылок [[label|type:id]] и превью.
 * Единственное место, где id → объект сущности; результат кэшируется на модуль,
 * поэтому повторные наведения не перезапрашивают. Бэкенды принимают и UUID, и slug.
 */
import { useEffect, useState } from 'react';
import type { Card, Spell, Action, PassiveEffect, Concept } from '../types';
import { cardsApi, spellsApi, actionsApi, effectsApi, conceptsApi } from '../api/client';

export type EntityRefType = 'card' | 'spell' | 'action' | 'effect' | 'concept';
export type EntityData = Card | Spell | Action | PassiveEffect | Concept;

export const ENTITY_TYPE_LABEL: Record<EntityRefType, string> = {
  card: 'Предмет', spell: 'Заклинание', action: 'Действие', effect: 'Эффект', concept: 'Понятие',
};

const FETCHERS: Record<EntityRefType, (id: string) => Promise<EntityData>> = {
  card: (id) => cardsApi.getCard(id),
  spell: (id) => spellsApi.getSpell(id),
  action: (id) => actionsApi.getAction(id),
  effect: (id) => effectsApi.getEffect(id),
  concept: (id) => conceptsApi.getConcept(id),
};

type CacheEntry = { status: 'loading' | 'ok' | 'error'; data?: EntityData; promise?: Promise<EntityData> };
const cache = new Map<string, CacheEntry>();
const keyOf = (type: EntityRefType, id: string) => `${type}:${id}`;

/** Запросить сущность (с дедупликацией конкурентных запросов и кэшем). */
function fetchEntity(type: EntityRefType, id: string): Promise<EntityData> {
  const key = keyOf(type, id);
  const existing = cache.get(key);
  if (existing?.status === 'ok' && existing.data) return Promise.resolve(existing.data);
  if (existing?.promise) return existing.promise;

  const promise = FETCHERS[type](id)
    .then((data) => { cache.set(key, { status: 'ok', data }); return data; })
    .catch((e) => { cache.set(key, { status: 'error' }); throw e; });
  cache.set(key, { status: 'loading', promise });
  return promise;
}

export function getCachedEntity(type: EntityRefType, id: string): EntityData | null {
  return cache.get(keyOf(type, id))?.data ?? null;
}

/** Сбросить кэш сущности (после удаления/редактирования) — чтобы ссылки не показывали устаревшее. */
export function evictEntity(type: EntityRefType, id: string): void {
  cache.delete(keyOf(type, id));
}

export interface EntityRefState {
  entity: EntityData | null;
  loading: boolean;
  error: boolean;
}

/** Хук: сущность по ссылке. Отдаёт кэш сразу, иначе грузит. */
export function useEntityRef(type: EntityRefType, id: string): EntityRefState {
  const cached = cache.get(keyOf(type, id));
  const [state, setState] = useState<EntityRefState>(
    cached?.status === 'ok'
      ? { entity: cached.data!, loading: false, error: false }
      : cached?.status === 'error'
        ? { entity: null, loading: false, error: true }
        : { entity: null, loading: true, error: false },
  );

  useEffect(() => {
    let alive = true;
    const c = cache.get(keyOf(type, id));
    if (c?.status === 'ok' && c.data) {
      setState({ entity: c.data, loading: false, error: false });
      return;
    }
    setState({ entity: null, loading: true, error: false });
    fetchEntity(type, id)
      .then((data) => { if (alive) setState({ entity: data, loading: false, error: false }); })
      .catch(() => { if (alive) setState({ entity: null, loading: false, error: true }); });
    return () => { alive = false; };
  }, [type, id]);

  return state;
}
