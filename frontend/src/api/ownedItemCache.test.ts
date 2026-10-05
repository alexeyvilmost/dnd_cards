import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bustPrefix, clearApiCache } from './apiCache';
import { cachedCatalogRead, cachedItemRead } from './ownedItemCache';

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
    expect(loader).toHaveBeenCalledTimes(6);
    bustPrefix('/api/cards');
    await cachedItemRead('/api/cards?fields=list', loader);
    expect(loader).toHaveBeenCalledTimes(7);
  });

  it('coalesces concurrent item reads but rechecks same-token revocation on the next read', async () => {
    identity.token = 'player';
    let finish!: (value: string) => void;
    const loader = vi.fn<() => Promise<string>>().mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}))
      .mockRejectedValueOnce(new Error('item no longer available'));
    const first = cachedItemRead('/api/cards/private', loader), second = cachedItemRead('/api/cards/private', loader);
    finish('owned'); expect(await first).toBe('owned'); expect(await second).toBe('owned'); expect(loader).toHaveBeenCalledOnce();
    await expect(cachedItemRead('/api/cards/private', loader)).rejects.toThrow('item no longer available');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('refreshes review membership and counts on every request', async () => {
    const loader = vi.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after');
    const path = '/api/actions?page=1&review_summary=true&review_status=verified';
    expect(await cachedCatalogRead(path, 60_000, loader)).toBe('before');
    expect(await cachedCatalogRead(path, 60_000, loader)).toBe('after');
  });

  it.each(['/api/cards/one', '/api/effects/one', '/api/classes/one', '/api/cards?review_summary=true'])('discards an in-flight privileged detail after an identity change: %s', async path => {
    identity.token = 'admin';
    let finish!: (value: string) => void;
    const loader = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce('player result');
    const pending = cachedCatalogRead(path, 60_000, loader);
    identity.token = 'player';
    finish('administrator result');
    expect(await pending).toBe('player result');
    if (!path.includes('review_summary')) {
      expect(await cachedCatalogRead(path, 60_000, loader)).toBe('player result');
    }
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
