import { cached } from './apiCache';
import { readPersistedAuthToken } from './authSession';

const identityChanged = Symbol('catalog-read-identity-changed');

// Catalog reference metadata depends on identity: even a public effect may have
// private item sources visible only to an administrator. Keep the URL prefix so
// existing mutation invalidation still reaches every identity.
export async function cachedCatalogRead<T>(path: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const session = readPersistedAuthToken();
  try {
    return await cached(`${path}|identity:${session ?? 'guest'}`, ttlMs, async () => {
      const value = await loader();
      // Never cache a response under a session that changed during the request.
      if (readPersistedAuthToken() !== session) throw identityChanged;
      return value;
    });
  } catch (error) {
    if (error === identityChanged) return cachedCatalogRead(path, ttlMs, loader);
    throw error;
  }
}

export function cachedItemRead<T>(path: string, loader: () => Promise<T>): Promise<T> {
  return cachedCatalogRead(path, 60_000, loader);
}
