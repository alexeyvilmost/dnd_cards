// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewStatusEditor from './ReviewStatusEditor';
import ReviewStatusCorner from './ReviewStatusCorner';
import { EntityDetailContext } from '../contexts/entityDetail';
import { getSettings, setSetting } from '../settings';
import { REVIEW_STATUS_CHANGED } from '../api/contentReview';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), patchCache: vi.fn(), canEdit: true }));
vi.mock('../api/client', () => ({ apiClient: { patch: mocks.patch } }));
vi.mock('../api/apiCache', () => ({ patchCachedValues: mocks.patchCache }));
vi.mock('../hooks/useContentPermissions', () => ({ useContentPermissions: () => ({ canEdit: () => mocks.canEdit }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('review status preference, editor and preview', () => {
  let root: Root;
  let host: HTMLDivElement;
  const spell = { type: 'spell' as const, id: 'spell-one', support: { status: 'not_verified' as const } };
  const render = async (node: ReactNode) => { await act(async () => root.render(node)); };
  const choose = async (value: string) => {
    await act(async () => {
      const select = host.querySelector('select')!;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.canEdit = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('is off by default and persists the explicit switch across reads', async () => {
    expect(getSettings().showReviewStatus).toBe(false);
    await render(<><ReviewStatusEditor entity={spell} /><ReviewStatusCorner entity={spell} /></>);
    expect(host.textContent).toBe('');
    expect(host.querySelector('[data-review-status]')).toBeNull();
    await act(async () => setSetting('showReviewStatus', true));
    expect(getSettings().showReviewStatus).toBe(true);
    expect(host.querySelectorAll('option')).toHaveLength(7);
    expect(host.querySelector('[data-review-status]')?.getAttribute('data-review-status')).toBe('not_verified');
    expect(host.querySelector('[title]')).toBeNull();
  });

  it.each(['spell', 'resource'] as const)('saves %s status authoritatively and refreshes the open corner', async type => {
    setSetting('showReviewStatus', true);
    const entity = { ...spell, type, id: `${type}-one` };
    mocks.patch.mockResolvedValue({ data: { entity_type: type, entity_id: entity.id, support: { status: 'narrative' } } });
    await render(<><ReviewStatusEditor entity={entity} /><ReviewStatusCorner entity={entity} /></>);
    await choose('narrative');
    expect(mocks.patch).toHaveBeenCalledWith(`/api/content-review/${type}/${entity.id}`, { status: 'narrative' });
    expect(mocks.patchCache).toHaveBeenCalledWith(`/api/${type === 'spell' ? 'spells' : 'resources'}`, expect.any(Function));
    expect(host.querySelector('select')?.value).toBe('narrative');
    expect(host.querySelector('[data-review-status]')?.getAttribute('data-review-status')).toBe('narrative');
    expect(host.textContent).not.toMatch(/100%|evidence|закреплено/i);
  });

  it('keeps the old value after a rejected save without broadcasting a change', async () => {
    setSetting('showReviewStatus', true);
    mocks.patch.mockRejectedValue(new Error('Нет права изменять статус'));
    const onChange = vi.fn();
    window.addEventListener(REVIEW_STATUS_CHANGED, onChange);
    try {
      await render(<ReviewStatusEditor entity={spell} />);
      await choose('verified');
      expect(host.querySelector('select')?.value).toBe('not_verified');
      expect(host.querySelector('[role="alert"]')?.textContent).toBe('Нет права изменять статус');
      expect(onChange).not.toHaveBeenCalled();
    } finally { window.removeEventListener(REVIEW_STATUS_CHANGED, onChange); }
  });

  it('shows a readable status for users without edit permission and in inspection mode', async () => {
    setSetting('showReviewStatus', true);
    mocks.canEdit = false;
    await render(<ReviewStatusEditor entity={spell} />);
    expect(host.querySelector('select')).toBeNull();
    expect(host.textContent).toContain('Не проверено');
    mocks.canEdit = true;
    await render(<EntityDetailContext.Provider value={{ openEntity: () => {}, readOnly: true }}>
      <ReviewStatusEditor entity={spell} />
    </EntityDetailContext.Provider>);
    expect(host.querySelector('select')).toBeNull();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('does not confuse a passive key with another entity sharing the same slug', async () => {
    setSetting('showReviewStatus', true);
    const passive = { type: 'passive' as const, id: 'shared-key', support: { status: 'not_verified' as const } };
    const resource = { ...passive, type: 'resource' as const };
    mocks.patch.mockResolvedValue({ data: { entity_type: 'passive', entity_id: passive.id, support: { status: 'verified' } } });
    await render(<><ReviewStatusEditor entity={passive} /><ReviewStatusCorner entity={passive} entityType="passive" />
      <ReviewStatusCorner entity={resource} entityType="resource" /></>);
    await choose('verified');
    expect(Array.from(host.querySelectorAll('[data-review-status]')).map(node => node.getAttribute('data-review-status')))
      .toEqual(['verified', 'not_verified']);
  });
});
