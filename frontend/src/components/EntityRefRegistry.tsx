/**
 * Резолвер сущностей по (type, id/slug) для ссылок [[label|type:id]] и превью.
 * Единственное место, где id → объект сущности; результат кэшируется на модуль,
 * поэтому повторные наведения не перезапрашивают. Бэкенды принимают и UUID, и slug.
 */
import { useEffect, useState } from 'react';
import type { Card, Spell, Action, PassiveEffect, Concept, ResourceDefinition, Variable, Feat, Race, CharacterClass, Background } from '../types';
import { cardsApi, spellsApi, actionsApi, effectsApi, conceptsApi, resourcesApi, variablesApi, featsApi, racesApi, classesApi, backgroundsApi } from '../api/client';
import { subscribeApiCacheInvalidation } from '../api/apiCache';
import { REVIEW_STATUS_CHANGED, type ReviewStatusChange } from '../api/contentReview';

export type EntityRefType = 'card' | 'spell' | 'action' | 'effect' | 'concept' | 'resource' | 'variable' | 'feat' | 'race' | 'class' | 'background';
export type EntityData = Card | Spell | Action | PassiveEffect | Concept | ResourceDefinition | Variable | Feat | Race | CharacterClass | Background;

export const ENTITY_TYPE_LABEL: Record<EntityRefType, string> = {
  card: 'Предмет', spell: 'Заклинание', action: 'Действие', effect: 'Эффект', concept: 'Понятие',
  resource: 'Ресурс', variable: 'Переменная',
  feat: 'Черта', race: 'Вид', class: 'Класс', background: 'Предыстория',
};

const FETCHERS: Record<EntityRefType, (id: string) => Promise<EntityData>> = {
  card: (id) => cardsApi.getCard(id),
  spell: (id) => spellsApi.getSpell(id),
  action: (id) => actionsApi.getAction(id),
  effect: (id) => effectsApi.getEffect(id),
  concept: (id) => conceptsApi.getConcept(id),
  resource: (id) => resourcesApi.getResource(id),
  variable: (id) => variablesApi.getVariable(id),
  feat: (id) => featsApi.getFeat(id),
  race: (id) => racesApi.getRace(id),
  class: (id) => classesApi.getClass(id),
  background: (id) => backgroundsApi.getBackground(id),
};

type CacheEntry = {
  status: 'loading' | 'ok' | 'error';
  data?: EntityData;
  promise?: Promise<EntityData>;
  expires?: number;
  reviewChanges?: ReviewStatusChange[];
};
const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();
const keyOf = (type: EntityRefType, id: string) => `${type}:${id}`;
const ENTITY_CACHE_TTL_MS = 60_000;

const API_PREFIX_BY_TYPE: Record<EntityRefType, string> = {
  card: '/api/cards', spell: '/api/spells', action: '/api/actions', effect: '/api/effects',
  concept: '/api/concepts', resource: '/api/resources', variable: '/api/variables',
  feat: '/api/feats', race: '/api/races', class: '/api/classes', background: '/api/backgrounds',
};

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(key: string, listener: () => void): () => void {
  const keyListeners = listeners.get(key) ?? new Set<() => void>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (!keyListeners.size) listeners.delete(key);
  };
}

function deleteMatching(predicate: (type: EntityRefType) => boolean): void {
  for (const key of [...cache.keys()]) {
    const type = key.slice(0, key.indexOf(':')) as EntityRefType;
    if (!predicate(type)) continue;
    cache.delete(key);
    notify(key);
  }
}

subscribeApiCacheInvalidation(({ prefix }) => {
  if (prefix === null) {
    deleteMatching(() => true);
    return;
  }
  deleteMatching((type) => prefix.startsWith(API_PREFIX_BY_TYPE[type])
    || API_PREFIX_BY_TYPE[type].startsWith(prefix));
});

if (typeof window !== 'undefined') window.addEventListener(REVIEW_STATUS_CHANGED, (event: Event) => {
  const change = (event as CustomEvent<ReviewStatusChange>).detail;
  if (!change) return;
  for (const [key, entry] of cache) {
    if (!key.startsWith(`${change.entity_type}:`)) continue;
    if (entry.promise) entry.reviewChanges?.push(change);
    if (entry.data?.id !== change.entity_id) continue;
    cache.set(key, { ...entry, data: { ...entry.data, support: change.support } });
    notify(key);
  }
});

/** Запросить сущность (с дедупликацией конкурентных запросов и кэшем). */
function fetchEntity(type: EntityRefType, id: string): Promise<EntityData> {
  const key = keyOf(type, id);
  const existing = cache.get(key);
  if (existing?.status === 'ok' && existing.data && (existing.expires ?? 0) > Date.now()) {
    return Promise.resolve(existing.data);
  }
  if (existing?.promise) return existing.promise;

  const reviewChanges: ReviewStatusChange[] = [];
  const promise = FETCHERS[type](id)
    .then((loaded) => {
      const data = reviewChanges.reduce((entity, change) => entity.id === change.entity_id
        ? { ...entity, support: change.support } : entity, loaded);
      // A mutation/eviction can replace this request while it is in flight.
      // Its caller may finish, but it must not restore either cache identity.
      if (cache.get(key)?.promise !== promise) return data;
      const entry = { status: 'ok' as const, data, expires: Date.now() + ENTITY_CACHE_TTL_MS };
      cache.set(key, entry);
      const canonicalId = typeof data.id === 'string' ? data.id : null;
      if (canonicalId) {
        const canonicalKey = keyOf(type, canonicalId);
        cache.set(canonicalKey, entry);
        notify(canonicalKey);
      }
      notify(key);
      return data;
    })
    .catch((e) => {
      if (cache.get(key)?.promise === promise) {
        cache.set(key, { status: 'error' });
        notify(key);
      }
      throw e;
    });
  cache.set(key, { status: 'loading', promise, reviewChanges });
  notify(key);
  return promise;
}

export function getCachedEntity(type: EntityRefType, id: string): EntityData | null {
  const entry = cache.get(keyOf(type, id));
  return entry?.status === 'ok' && (entry.expires ?? 0) > Date.now() ? entry.data ?? null : null;
}

/** Сбросить кэш сущности (после удаления/редактирования) — чтобы ссылки не показывали устаревшее. */
export function evictEntity(type: EntityRefType, id: string): void {
  const key = keyOf(type, id);
  cache.delete(key);
  notify(key);
}

export interface EntityRefState {
  entity: EntityData | null;
  loading: boolean;
  error: boolean;
}

/** Хук: сущность по ссылке. Отдаёт кэш сразу, иначе грузит. */
export function useEntityRef(type: EntityRefType, id: string): EntityRefState {
  const key = keyOf(type, id);
  const cached = cache.get(key);
  const cachedIsFresh = cached?.status === 'ok' && (cached.expires ?? 0) > Date.now();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<EntityRefState>(
    cachedIsFresh
      ? { entity: cached.data!, loading: false, error: false }
      : cached?.status === 'error'
        ? { entity: null, loading: false, error: true }
        : { entity: null, loading: true, error: false },
  );

  useEffect(() => subscribe(key, () => setRevision((current) => current + 1)), [key]);

  useEffect(() => {
    let alive = true;
    const c = cache.get(key);
    if (c?.status === 'ok' && c.data && (c.expires ?? 0) > Date.now()) {
      setState({ entity: c.data, loading: false, error: false });
      return;
    }
    setState({ entity: null, loading: true, error: false });
    fetchEntity(type, id)
      .then((data) => { if (alive && getCachedEntity(type, id) === data) setState({ entity: data, loading: false, error: false }); })
      .catch(() => { if (alive && cache.get(key)?.status === 'error') setState({ entity: null, loading: false, error: true }); });
    return () => { alive = false; };
  }, [type, id, key, revision]);

  return state;
}
