// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useResourceOptions } from './resources';
import { REVIEW_STATUS_CHANGED } from '../api/contentReview';

const mocks = vi.hoisted(() => ({ getResources: vi.fn() }));
vi.mock('../api/client', () => ({ resourcesApi: mocks }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false,true])('patches canonical resource support without another GET (initial read pending=%s)', async pending => {
  const rows = [
    { id: 'resource-a', resource_id: 'test-review-a', name: 'A', support: { status: 'not_verified' } },
    { id: 'resource-b', resource_id: 'test-review-b', name: 'B', support: { status: 'not_tested' } },
  ];
  let releaseStale!: (value: { resources: typeof rows }) => void;
  mocks.getResources.mockReset();
  if (pending) mocks.getResources.mockImplementationOnce(() => new Promise(resolve => { releaseStale = resolve; }));
  else mocks.getResources.mockResolvedValueOnce({ resources: rows });
  const host = document.createElement('div');
  const root = createRoot(host);
  function CurrentResources() {
    const resources = useResourceOptions();
    return <p>{resources.filter(row => row.id.startsWith('test-review')).map(row => `${row.entityId}:${row.support?.status}`).join(',')}</p>;
  }
  const review = (status: string) => window.dispatchEvent(new CustomEvent(REVIEW_STATUS_CHANGED, {
    detail: { entity_type: 'resource', entity_id: 'resource-a', support: { status } },
  }));
  try {
    await act(async () => root.render(<CurrentResources />));
    if (!pending) expect(host.textContent).toBe('resource-a:not_verified,resource-b:not_tested');
    await act(async () => { review('verified'); });
    if (!pending) expect(host.textContent).toBe('resource-a:verified,resource-b:not_tested');
    await act(async () => { review('narrative'); });
    if (pending) await act(async () => { releaseStale({ resources: rows }); });
    expect(host.textContent).toBe('resource-a:narrative,resource-b:not_tested');
    expect(mocks.getResources).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});
