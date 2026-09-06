/**
 * B7: маленький in-memory кэш GET-ответов справочных сущностей по ключу-URL.
 *
 * Зачем: кузница/лист многократно грузят одни и те же сущности по id (смена
 * уровня перезапускает loadBundle; экипировка — те же карты). Кэш с TTL убирает
 * повторные запросы. Инвалидация — централизованно в response-интерцепторе
 * client.ts: любой успешный не-GET к /api/<entity>/... сбрасывает его префикс,
 * поэтому правки сущностей сразу видны (безопасно для редакторского приложения).
 */
type Entry = { value: unknown; expires: number };
type InFlight = { promise: Promise<unknown>; version: number; epoch: number };
export type ApiCacheInvalidation = { prefix: string | null };

const store = new Map<string, Entry>();
const inFlight = new Map<string, InFlight>();
const versions = new Map<string, number>();
const invalidationListeners = new Set<(event: ApiCacheInvalidation) => void>();
let epoch = 0;

function versionOf(key: string): number {
  return versions.get(key) ?? 0;
}

function notifyInvalidation(prefix: string | null): void {
  for (const listener of invalidationListeners) listener({ prefix });
}

/** Subscribe reference projections to mutations without coupling them to Axios. */
export function subscribeApiCacheInvalidation(
  listener: (event: ApiCacheInvalidation) => void,
): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

/** Вернуть из кэша (если свежо) или загрузить и закэшировать на ttlMs. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const pending = inFlight.get(key);
  const version = versionOf(key);
  if (pending && pending.version === version && pending.epoch === epoch) {
    return pending.promise as Promise<T>;
  }

  const startedAtEpoch = epoch;
  const startedAtVersion = version;
  const promise = loader().then((value) => {
    // A mutation that happened while this GET was running makes the response
    // unsuitable for the shared cache, even though its original caller may
    // still consume the response it requested.
    if (epoch === startedAtEpoch && versionOf(key) === startedAtVersion) {
      store.set(key, { value, expires: Date.now() + ttlMs });
    }
    return value;
  }).finally(() => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  });
  inFlight.set(key, { promise, version: startedAtVersion, epoch: startedAtEpoch });
  return promise;
}

/** Сбросить все записи, чей ключ начинается с prefix (напр. '/api/cards'). */
export function bustPrefix(prefix: string): void {
  const affectedKeys = new Set([...store.keys(), ...inFlight.keys()]);
  for (const key of affectedKeys) {
    if (!key.startsWith(prefix)) continue;
    versions.set(key, versionOf(key) + 1);
    store.delete(key);
    inFlight.delete(key);
  }
  notifyInvalidation(prefix);
}

/** Полный сброс (напр. при разлогине — на будущее). */
export function clearApiCache(): void {
  epoch += 1;
  store.clear();
  inFlight.clear();
  versions.clear();
  notifyInvalidation(null);
}
