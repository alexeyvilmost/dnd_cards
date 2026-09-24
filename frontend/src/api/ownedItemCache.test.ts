import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bustPrefix, clearApiCache } from './apiCache';
import { cachedItemRead } from './ownedItemCache';

const identity = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('./authSession', () => ({ readPersistedAuthToken: () => identity.token }));

describe('item read cache permissions', () => {
  beforeEach(() => { clearApiCache(); identity.token = null; });

  it('separates guest, player and administrator responses and retains prefix invalidation', async () => {
    const loader = vi.fn(async () => identity.token ?? 'guest');
    for (const token of ['admin', 'player', null]) {
      identity.token = token;
      expect(await cachedItemRead('/api/cards?fields=list', loader)).toBe(token ?? 'guest');
      expect(await cachedItemRead('/api/cards?fields=list', loader)).toBe(token ?? 'guest');
    }
    expect(loader).toHaveBeenCalledTimes(3);
    bustPrefix('/api/cards');
    await cachedItemRead('/api/cards?fields=list', loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('discards an in-flight privileged detail after an identity change', async () => {
    identity.token = 'admin';
    let finish!: (value: string) => void;
    const loader = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce('player result');
    const pending = cachedItemRead('/api/cards/one', loader);
    identity.token = 'player';
    finish('administrator result');
    expect(await pending).toBe('player result');
    expect(await cachedItemRead('/api/cards/one', loader)).toBe('player result');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
