import { cached } from './apiCache';
import { readPersistedAuthToken } from './authSession';

const identityChanged = Symbol('catalog-read-identity-changed');
class BatchReadFailure {
  constructor(readonly cause: unknown) {}
}

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
    // A strict batch may include an unavailable sibling. An individual reader
    // must retry its own authorized detail, rather than inherit that failure.
    if (error instanceof BatchReadFailure) return cachedCatalogRead(path, ttlMs, loader);
    throw error;
  }
}

export function cachedItemRead<T>(path: string, loader: () => Promise<T>): Promise<T> {
  // Item visibility can be revoked by another session. Without a server-owned
  // rights revision a positive TTL is not proof of current access. Coalesce
  // concurrent reads only; the next caller goes through backend authorization.
  return cachedCatalogRead(path, 0, loader);
}

// Display batches and individual details have the same projection. Share only
// pending, identity-scoped reads; completed values never prove current rights.
export async function cachedItemBatch<T>(paths: readonly string[], loader: (missing: string[]) => Promise<T[]>): Promise<T[]> {
  const session = readPersistedAuthToken();
  const missing: string[] = [];
  let batch: Promise<T[]> | undefined;
  try {
    const values = await Promise.all(paths.map(path => cached(`${path}|identity:${session ?? 'guest'}`, 0, async () => {
      const index = missing.push(path) - 1;
      // Collect all uncached paths before making the bounded backend request.
      batch ??= Promise.resolve().then(() => loader(missing));
      const rows = await batch.catch(error => { throw new BatchReadFailure(error); });
      if (readPersistedAuthToken() !== session) throw identityChanged;
      if (rows.length !== missing.length) throw Error('Каталог не вернул все необходимые предметы');
      return rows[index];
    })));
    if (readPersistedAuthToken() !== session) throw identityChanged;
    return values;
  } catch (error) {
    if (error === identityChanged) return cachedItemBatch(paths, loader);
    if (error instanceof BatchReadFailure) throw error.cause;
    throw error;
  }
}
