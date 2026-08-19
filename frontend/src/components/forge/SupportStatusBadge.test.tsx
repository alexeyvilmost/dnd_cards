/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import SupportStatusBadge from './SupportStatusBadge';

const entity = {
  support: {
    status: 'verified_mechanical' as const,
    certification_version: 'micro-mvp-l1-rules-core-v4',
    certified_at: '2026-08-18T00:00:00Z',
    content_hash: `sha256:${'a'.repeat(64)}`,
    test_coverage: {
      schema_version: 1 as const,
      scope: 'micro-mvp-l1' as const,
      required: 12,
      passed: 12,
      percent: 100,
    },
    mechanics_locked: true,
  },
};

describe('SupportStatusBadge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  it('shows exact coverage and the immutable-mechanics marker outside player mode', () => {
    act(() => root.render(<SupportStatusBadge entity={entity} />));
    expect(container.textContent).toContain('12/12 сценариев');
    expect(container.textContent).not.toContain('100%');
    expect(container.textContent).toContain('закреплено');
    expect(container.querySelector('[title]')?.getAttribute('title'))
      .toContain('Сценарии заявленного scope: 12/12');
  });

  it('renders no certification information in player mode', () => {
    localStorage.setItem('site-settings', JSON.stringify({ playerMode: true }));
    act(() => root.render(<SupportStatusBadge entity={entity} />));
    expect(container.innerHTML).toBe('');
  });
});
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
