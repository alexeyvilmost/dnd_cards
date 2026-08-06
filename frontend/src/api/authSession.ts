import type { User } from '../types';

export const AUTH_TOKEN_STORAGE_KEY = 'auth_token';
export const AUTH_USER_STORAGE_KEY = 'user';
export const AUTH_UNAUTHORIZED_EVENT = 'dnd-cards:auth-unauthorized';

function getStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

const JWT_SEGMENT = /^[A-Za-z0-9_-]+=*$/;

function isLikelyJwtToken(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3
    && parts.every((part) => part.length > 0 && JWT_SEGMENT.test(part));
}

export function readPersistedAuthToken(): string | null {
  return getStorage()?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
}

export function readPersistedAuthTokenForRequest(): string | null {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!raw) return null;

  const token = raw.trim();
  if (!token || !isLikelyJwtToken(token)) {
    storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    storage.removeItem(AUTH_USER_STORAGE_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    return null;
  }

  if (token !== raw) {
    storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  }

  return token;
}

export function persistAuthSession(token: string, user: User): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  storage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearPersistedAuthSession(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  storage.removeItem(AUTH_USER_STORAGE_KEY);
}

/**
 * Invalidates authentication for every mounted consumer.  This deliberately
 * does not navigate: several concurrent 401 responses remain an idempotent
 * state transition instead of creating redirect/reload loops.
 */
export function signalUnauthorized(): void {
  clearPersistedAuthSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  }
}
