import { afterEach, describe, expect, it, vi } from 'vitest';
import { bustPrefix, cached, clearApiCache, patchCachedValues } from './apiCache';

afterEach(() => {
  clearApiCache();
});

describe('apiCache', () => {
  it('coalesces zero-TTL reads without retaining completed private values', async () => {
    let finish!: (value: string) => void;
    const loader = vi.fn<() => Promise<string>>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce('fresh');
    const first = cached('/api/cards/private', 0, loader);
    const second = cached('/api/cards/private', 0, loader);
    finish('private');
    expect(await Promise.all([first, second])).toEqual(['private', 'private']);
    expect(loader).toHaveBeenCalledOnce();
    const patch = vi.fn(value => value);
    patchCachedValues('/api/cards', patch);
    expect(patch).not.toHaveBeenCalled();
    expect(await cached('/api/cards/private', 0, loader)).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an older positive-TTL value when the caller requires a fresh read', async () => {
    await cached('/api/cards/private', 60_000, async () => 'old');
    expect(await cached('/api/cards/private', 0, async () => 'fresh')).toBe('fresh');
    const patch = vi.fn(value => value);
    patchCachedValues('/api/cards', patch);
    expect(patch).not.toHaveBeenCalled();
  });

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

  it('keeps unrelated in-flight catalog reads deduplicated after a runtime mutation', async () => {
    let resolveClass!: (value: string) => void;
    const classLoader = vi.fn(() => new Promise<string>((done) => { resolveClass = done; }));
    const first = cached('/api/classes/one', 60_000, classLoader);

    bustPrefix('/api/characters-v3');
    const second = cached('/api/classes/one', 60_000, classLoader);

    expect(classLoader).toHaveBeenCalledTimes(1);
    resolveClass('warrior');
    await expect(Promise.all([first, second])).resolves.toEqual(['warrior', 'warrior']);
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
