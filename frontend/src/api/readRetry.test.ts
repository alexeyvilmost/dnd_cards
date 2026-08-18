import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ApiRequestError, apiClient } from './client';
import {
  isSafeReadMethod,
  isTransientReadFailure,
  SAFE_READ_MAX_ATTEMPTS,
} from './readRetry';

describe('safe read retry policy', () => {
  it('permits only a bounded number of idempotent read attempts', () => {
    expect(SAFE_READ_MAX_ATTEMPTS).toBe(3);
    expect(isSafeReadMethod(undefined)).toBe(true);
    expect(isSafeReadMethod('GET')).toBe(true);
    expect(isSafeReadMethod('head')).toBe(true);
    expect(isSafeReadMethod('post')).toBe(false);
    expect(isSafeReadMethod('PATCH')).toBe(false);
  });

  it('retries transport/throttle/server failures but not client errors or writes', () => {
    expect(isTransientReadFailure('get', undefined)).toBe(true);
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isTransientReadFailure('get', status)).toBe(true);
    }
    expect(isTransientReadFailure('get', 404)).toBe(false);
    expect(isTransientReadFailure('post', 503)).toBe(false);
  });

  it('retries a GET transport failure exactly twice and then succeeds', async () => {
    let attempts = 0;
    const response = await apiClient.get<{ ok: boolean }>('/retry-contract', {
      adapter: async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
        attempts += 1;
        if (attempts < SAFE_READ_MAX_ATTEMPTS) {
          throw new AxiosError('transient transport failure', 'ERR_NETWORK', config);
        }
        return {
          data: { ok: true },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    expect(response.data).toEqual({ ok: true });
    expect(attempts).toBe(SAFE_READ_MAX_ATTEMPTS);
  });

  it('never retries a write transport failure', async () => {
    let attempts = 0;
    await expect(apiClient.post('/retry-contract', { value: 1 }, {
      adapter: async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
        attempts += 1;
        throw new AxiosError('write transport failure', 'ERR_NETWORK', config);
      },
    })).rejects.toBeInstanceOf(ApiRequestError);
    expect(attempts).toBe(1);
  });
});
