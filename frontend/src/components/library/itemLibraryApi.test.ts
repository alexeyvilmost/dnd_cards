// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { itemLibraryApi } from './itemLibraryApi';
import { apiClient } from '../../api/client';
import { AUTH_TOKEN_STORAGE_KEY } from '../../api/authSession';

vi.mock('../../api/client', () => ({ apiClient: { get: vi.fn() } }));

describe('item library identity isolation', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  it('never reuses an administrator list or detail for a player or guest', async () => {
    const get = vi.mocked(apiClient.get);
    for (const identity of ['admin-token', 'player-token', null]) {
      if (identity) localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, identity);
      else localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      const data = { identity };
      get.mockResolvedValue({ data });
      expect(await itemLibraryApi.list({ rarity: 'common,rare' })).toEqual(data);
      expect(await itemLibraryApi.detail('same-id')).toEqual(data);
      expect(get).toHaveBeenLastCalledWith('/api/cards/same-id', { headers: identity ? { Authorization: `Bearer ${identity}` } : {} });
    }
    expect(get).toHaveBeenCalledTimes(6);
  });
});
