import { afterEach, describe, expect, it, vi } from 'vitest';
import { bustPrefix, cached, clearApiCache } from './apiCache';

afterEach(() => {
  clearApiCache();
});

describe('apiCache', () => {
  it('coalesces concurrent misses for the same detail URL', async () => {
    let resolve!: (value: { id: string }) => void;
    const loader = vi.fn(() => new Promise<{ id: string }>((done) => { resolve = done; }));

    const first = cached('/api/spells/one', 60_000, loader);
    const second = cached('/api/spells/one', 60_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve({ id: 'one' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 'one' }, { id: 'one' }]);
    await cached('/api/spells/one', 60_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not publish an in-flight value after the entity prefix is invalidated', async () => {
    let resolveOld!: (value: string) => void;
    const old = cached('/api/cards/one', 60_000, () => new Promise<string>((done) => { resolveOld = done; }));
    bustPrefix('/api/cards');
    resolveOld('old');
    await expect(old).resolves.toBe('old');

    const freshLoader = vi.fn(async () => 'fresh');
    await expect(cached('/api/cards/one', 60_000, freshLoader)).resolves.toBe('fresh');
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a rejected shared loader', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('ok');
    await expect(cached('/api/classes/one', 60_000, loader)).rejects.toThrow('temporary');
    await expect(cached('/api/classes/one', 60_000, loader)).resolves.toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
