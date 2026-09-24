import { cached } from './apiCache';
import { readPersistedAuthToken } from './authSession';

const identityChanged = Symbol('item-read-identity-changed');

// Card reads are permission-dependent, unlike the anonymous entity catalogs.
// Keep the URL prefix so existing mutation invalidation still reaches all users.
export async function cachedItemRead<T>(path: string, loader: () => Promise<T>): Promise<T> {
  const session = readPersistedAuthToken();
  try {
    return await cached(`${path}|identity:${session ?? 'guest'}`, 60_000, async () => {
      const value = await loader();
      // Never cache a response under a session that changed during the request.
      if (readPersistedAuthToken() !== session) throw identityChanged;
      return value;
    });
  } catch (error) {
    if (error === identityChanged) return cachedItemRead(path, loader);
    throw error;
  }
}
