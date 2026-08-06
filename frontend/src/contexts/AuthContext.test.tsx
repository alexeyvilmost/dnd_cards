// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiClient } from '../api/client';
import { authApi } from '../api/authApi';
import type { User } from '../types';
import { AuthProvider, useAuth } from './AuthContext';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cachedUser: User = {
  id: 'cached-user',
  username: 'cached-name',
  email: 'cached@example.test',
  display_name: 'Cached identity',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const serverUser: User = {
  id: 'server-user',
  username: 'server-name',
  email: 'server@example.test',
  display_name: 'Server identity',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-08-05T00:00:00Z',
};

function AuthProbe() {
  const auth = useAuth();
  return (
    <output
      data-testid="auth-state"
      data-loading={String(auth.isLoading)}
      data-authenticated={String(auth.isAuthenticated)}
      data-user-id={auth.user?.id ?? ''}
      data-token={auth.token ?? ''}
    >
      {auth.user?.display_name ?? 'anonymous'}
    </output>
  );
}

describe('AuthProvider server-validated session lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.replaceChildren();
  });

  const probe = (): HTMLOutputElement => {
    const element = container.querySelector<HTMLOutputElement>('[data-testid="auth-state"]');
    if (!element) throw new Error('Auth probe was not rendered');
    return element;
  };

  const mount = async (): Promise<void> => {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>,
      );
      await Promise.resolve();
    });
  };

  it('keeps saved auth unauthenticated until profile validation and persists the server identity', async () => {
    localStorage.setItem('auth_token', 'valid-token');
    localStorage.setItem('user', JSON.stringify(cachedUser));

    let resolveProfile!: (user: User) => void;
    vi.spyOn(authApi, 'getProfile').mockReturnValue(new Promise((resolve) => {
      resolveProfile = resolve;
    }));

    await mount();

    expect(authApi.getProfile).toHaveBeenCalledTimes(1);
    expect(probe().dataset.loading).toBe('true');
    expect(probe().dataset.authenticated).toBe('false');
    expect(probe().dataset.userId).toBe('');

    await act(async () => {
      resolveProfile(serverUser);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(probe().dataset.loading).toBe('false'));
    expect(probe().dataset.authenticated).toBe('true');
    expect(probe().dataset.userId).toBe(serverUser.id);
    expect(probe().dataset.token).toBe('valid-token');
    expect(JSON.parse(localStorage.getItem('user') ?? 'null')).toEqual(serverUser);
  });

  it('clears an expired saved session when profile bootstrap fails with 401', async () => {
    localStorage.setItem('auth_token', 'expired-token');
    localStorage.setItem('user', JSON.stringify(cachedUser));
    vi.spyOn(authApi, 'getProfile').mockRejectedValue({
      response: { status: 401, data: { error: 'Token has expired' } },
    });

    await mount();

    await vi.waitFor(() => expect(probe().dataset.loading).toBe('false'));
    expect(probe().dataset.authenticated).toBe('false');
    expect(probe().dataset.userId).toBe('');
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('clears mounted auth state immediately when the API interceptor receives a runtime 401', async () => {
    localStorage.setItem('auth_token', 'initially-valid-token');
    localStorage.setItem('user', JSON.stringify(cachedUser));
    vi.spyOn(authApi, 'getProfile').mockResolvedValue(serverUser);

    await mount();
    await vi.waitFor(() => expect(probe().dataset.authenticated).toBe('true'));

    let requestError: unknown;
    await act(async () => {
      await apiClient.get('/api/runtime-auth-check', {
        adapter: async (config) => Promise.reject({
          config,
          response: {
            status: 401,
            data: { error: 'Token has expired' },
          },
        }),
      }).catch((error: unknown) => {
        requestError = error;
      });
    });

    expect(requestError).toBeInstanceOf(ApiRequestError);
    expect(requestError).toMatchObject({
      name: 'ApiRequestError',
      message: 'Token has expired',
      status: 401,
    });
    expect(probe().dataset.loading).toBe('false');
    expect(probe().dataset.authenticated).toBe('false');
    expect(probe().dataset.userId).toBe('');
    expect(probe().dataset.token).toBe('');
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
