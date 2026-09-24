// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Layout from './Layout';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => { node = document.createElement('div'); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); });
async function render(path: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Layout><div data-entity>Unchanged entity</div></Layout></MemoryRouter>));
}
it.each(['/paper-sheet', '/paper-sheet/example-id'])('preserves the previous paper page frame at %s', async path => {
  await render(path);
  const frame = node.querySelector<HTMLElement>('.site-layout')!;
  expect(frame.classList.contains('site-layout-paper')).toBe(true);
  expect(frame.classList.contains('site-page-theme')).toBe(false);
  expect(frame.style.backgroundImage).toContain('groovepaper.png');
  expect(node.querySelector('[data-entity]')?.textContent).toBe('Unchanged entity');
});
it('uses shared chrome and marks Monsters as part of the Library', async () => {
  await render('/monsters');
  expect(node.querySelector('.site-page-theme')).not.toBeNull();
  expect(node.querySelector('nav a[href="/library"]')?.getAttribute('aria-current')).toBe('page');
  expect(node.querySelector('[title]')).toBeNull();
});
