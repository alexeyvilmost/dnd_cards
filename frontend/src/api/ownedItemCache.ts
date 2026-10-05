import { cached } from './apiCache';
import { readPersistedAuthToken } from './authSession';

const identityChanged = Symbol('catalog-read-identity-changed');

// Catalog reference metadata depends on identity: even a public effect may have
// private item sources visible only to an administrator. Keep the URL prefix so
// existing mutation invalidation still reaches every identity.
export async function cachedCatalogRead<T>(path: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  // Review changes can alter membership outside the current page. Such pages
  // and aggregates are read fresh; ordinary entity caches still receive their
  // narrow authoritative metadata patch after a review.
  const session = readPersistedAuthToken();
  try {
    const readForSession = async () => {
      const value = await loader();
      // Never cache a response under a session that changed during the request.
      if (readPersistedAuthToken() !== session) throw identityChanged;
      return value;
    };
    return await (/[?&]review_(?:status|summary)=/.test(path)
      ? readForSession() : cached(`${path}|identity:${session ?? 'guest'}`, ttlMs, readForSession));
  } catch (error) {
    if (error === identityChanged) return cachedCatalogRead(path, ttlMs, loader);
    throw error;
  }
}

export function cachedItemRead<T>(path: string, loader: () => Promise<T>): Promise<T> {
  // Item visibility can be revoked by another session. Without a server-owned
  // rights revision a positive TTL is not proof of current access. Coalesce
  // concurrent reads only; the next caller goes through backend authorization.
  return cachedCatalogRead(path, 0, loader);
}
