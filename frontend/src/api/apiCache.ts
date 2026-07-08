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

const store = new Map<string, Entry>();

/** Вернуть из кэша (если свежо) или загрузить и закэшировать на ttlMs. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await loader();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Сбросить все записи, чей ключ начинается с prefix (напр. '/api/cards'). */
export function bustPrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Полный сброс (напр. при разлогине — на будущее). */
export function clearApiCache(): void {
  store.clear();
}
