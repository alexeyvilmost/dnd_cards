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
type InFlight = { promise: Promise<unknown>; generation: number };

const store = new Map<string, Entry>();
const inFlight = new Map<string, InFlight>();
let generation = 0;

/** Вернуть из кэша (если свежо) или загрузить и закэшировать на ttlMs. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const pending = inFlight.get(key);
  if (pending && pending.generation === generation) return pending.promise as Promise<T>;

  const startedAtGeneration = generation;
  const promise = loader().then((value) => {
    // A mutation that happened while this GET was running makes the response
    // unsuitable for the shared cache, even though its original caller may
    // still consume the response it requested.
    if (generation === startedAtGeneration) {
      store.set(key, { value, expires: Date.now() + ttlMs });
    }
    return value;
  }).finally(() => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  });
  inFlight.set(key, { promise, generation: startedAtGeneration });
  return promise;
}

/** Сбросить все записи, чей ключ начинается с prefix (напр. '/api/cards'). */
export function bustPrefix(prefix: string): void {
  generation += 1;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** Полный сброс (напр. при разлогине — на будущее). */
export function clearApiCache(): void {
  generation += 1;
  store.clear();
  inFlight.clear();
}
