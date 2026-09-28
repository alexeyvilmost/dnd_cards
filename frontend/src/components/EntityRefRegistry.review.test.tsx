// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bustPrefix, clearApiCache } from '../api/apiCache';
import { updateReviewStatus } from '../api/contentReview';
import { getCachedEntity, useEntityRef, type EntityRefType } from './EntityRefRegistry';

const mocks = vi.hoisted(() => ({ read: vi.fn(), patch: vi.fn() }));
vi.mock('../api/client', () => ({
  apiClient: { patch: mocks.patch },
  cardsApi: { getCard: mocks.read }, spellsApi: { getSpell: mocks.read },
  actionsApi: { getAction: mocks.read }, effectsApi: { getEffect: mocks.read },
  conceptsApi: { getConcept: mocks.read }, resourcesApi: { getResource: mocks.read },
  variablesApi: { getVariable: mocks.read },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function NestedReference({ type, id }: { type: EntityRefType; id: string }) {
  const { entity, loading, error } = useEntityRef(type, id);
  return <p>{loading ? 'loading' : error ? 'error' : entity?.support?.status}</p>;
}

describe('entity reference cache after a successful review update', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    clearApiCache();
    vi.clearAllMocks();
    host = document.createElement('div');
    root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); });

  it.each([false,true])('patches a nested preview without loading again (read pending=%s)', async pending => {
    const stale = { id: 'resource-one', support: { status: 'not_verified' } };
    let finish!: (value: typeof stale) => void;
    if (pending) mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    else mocks.read.mockResolvedValue(stale);
    mocks.patch.mockResolvedValue({ data: { entity_type: 'resource', entity_id: stale.id, support: {status:'verified'} } });
    await act(async () => root.render(<NestedReference type="resource" id="resource-slug" />));
    const node=host.querySelector('p');
    await act(async () => { await updateReviewStatus('resource',stale.id,'verified'); });
    if (pending) await act(async () => { finish(stale); });
    expect(host.textContent).toBe('verified');
    expect(host.querySelector('p')).toBe(node);
    await act(async () => root.render(null));
    await act(async () => root.render(<NestedReference type="resource" id={stale.id} />));
    expect(host.textContent).toBe('verified');
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it.each(['response', 'rejection'] as const)('ignores an old %s after refresh, including the canonical identity on remount', async outcome => {
    const stale = { id: 'canonical-resource-id', name: 'Ресурс', support: { status: 'not_verified' } };
    const fresh = { ...stale, support: { status: 'verified' } };
    let resolveOld!: (value: typeof stale) => void;
    let rejectOld!: (reason: Error) => void;
    mocks.read.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockResolvedValue(fresh);
    mocks.patch.mockResolvedValue({ data: { entity_type: 'resource', entity_id: stale.id, support: fresh.support } });

    await act(async () => root.render(<NestedReference type="resource" id="resource-slug" />));
    expect(host.textContent).toBe('loading');
    await act(async () => root.render(null));
    await act(async () => { bustPrefix('/api/resources'); await updateReviewStatus('resource', stale.id, 'verified'); });
    await act(async () => root.render(<NestedReference type="resource" id="resource-slug" />));
    expect(host.textContent).toBe('verified');
    await act(async () => {
      if (outcome === 'response') resolveOld(stale);
      else rejectOld(new Error('obsolete read failed'));
    });
    expect(getCachedEntity('resource', 'resource-slug')).toBe(fresh);
    expect(getCachedEntity('resource', stale.id)).toBe(fresh);

    for (const id of ['resource-slug', stale.id]) {
      await act(async () => root.render(null));
      await act(async () => root.render(<NestedReference type="resource" id={id} />));
      expect(host.textContent).toBe('verified');
    }
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.patch).toHaveBeenCalledWith(`/api/content-review/resource/${stale.id}`, { status: 'verified' });
  });
});
