// @vitest-environment jsdom

import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_UNAUTHORIZED_EVENT,
  readPersistedAuthTokenForRequest,
} from './authSession';

describe('authSession token sanitization', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null for malformed token and clears persisted auth state', async () => {
    const received = new Promise<void>((resolve) => {
      window.addEventListener(AUTH_UNAUTHORIZED_EVENT, () => resolve(), { once: true });
    });

    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'bad-token');

    const token = readPersistedAuthTokenForRequest();

    expect(token).toBeNull();
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();

    await received;
  });

  it('normalizes and preserves structurally valid JWT-shaped tokens', () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, ' eyJh.b25lLmRvbg.c2ln');

    const token = readPersistedAuthTokenForRequest();

    expect(token).toBe('eyJh.b25lLmRvbg.c2ln');
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('eyJh.b25lLmRvbg.c2ln');
  });
});
