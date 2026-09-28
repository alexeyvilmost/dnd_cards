// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { loadPassiveCatalog, usePassiveCatalog, passivePresentationEffect } from './passiveCatalog';
import { REVIEW_STATUS_CHANGED } from '../api/contentReview';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api/client', () => ({ apiClient: mocks }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps a saved passive review during a pending stale catalog read and fetches a fresh snapshot', async () => {
  const row = { key: 'shared-policy', name: 'Политика', description: '', image_url: '', enabled_description: '', disabled_description: '', version: 1, support: { status: 'not_verified' as const } };
  const reviewed = { ...row, support: { status: 'verified' as const } };
  const initial = { data: { passives: [row], can_manage: true } };
  let releaseStale!: (value: typeof initial) => void;
  mocks.get.mockResolvedValueOnce(initial)
    .mockImplementationOnce(() => new Promise(resolve => { releaseStale = resolve; }))
    .mockResolvedValueOnce({ data: { passives: [reviewed], can_manage: true } });
  await loadPassiveCatalog();
  const host = document.createElement('div');
  const root = createRoot(host);
  function CurrentStatus() {
    const catalog = usePassiveCatalog();
    return <p>{catalog.passives.map(passive => passivePresentationEffect(passive).support?.status).join(',')}</p>;
  }
  try {
    await act(async () => root.render(<CurrentStatus />));
    const pending = loadPassiveCatalog(true);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(REVIEW_STATUS_CHANGED, { detail: { entity_type: 'resource', entity_id: row.key, support: reviewed.support } }));
    });
    expect(host.textContent).toBe('not_verified');
    await act(async () => {
      window.dispatchEvent(new CustomEvent(REVIEW_STATUS_CHANGED, { detail: { entity_type: 'passive', entity_id: row.key, support: reviewed.support } }));
    });
    expect(host.textContent).toBe('verified');
    await act(async () => { releaseStale(initial); await pending; });
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(host.textContent).toBe('verified');
  } finally { await act(async () => root.unmount()); }
});
