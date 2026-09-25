// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Layout from './Layout';
import { WORKSPACE_EXPANDED_KEY, WorkspaceExpandButton } from './WorkspaceNavigation';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => { sessionStorage.clear(); node = document.createElement('div'); root = createRoot(node); });
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

it.each(['/characters-v3/hero', '/characters-v3/hero/combat'])('toggles navigation at %s without remounting or changing the workspace', async path => {
 const mounted = vi.fn();
 function Editor() {
   const [count, setCount] = useState(0);
   useEffect(() => { mounted(); }, []);
   return <><button data-action onClick={() => setCount(value => value + 1)}>{count}</button><WorkspaceExpandButton /></>;
 }
 await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Layout workspace><Editor /></Layout></MemoryRouter>));
 const navigation = node.querySelector<HTMLElement>('#site-navigation')!;
 expect(navigation.hidden).toBe(false);
 expect(node.querySelector('nav a[href="/characters-forge"]')?.getAttribute('aria-current')).toBe('page');
 await act(async () => node.querySelector<HTMLButtonElement>('[data-action]')!.click());
 await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Развернуть"]')!.click());
 expect(navigation.hidden).toBe(true);
 expect(sessionStorage.getItem(WORKSPACE_EXPANDED_KEY)).toBe('true');
 expect(node.querySelector('[aria-label="Свернуть"]')?.getAttribute('aria-pressed')).toBe('true');
 expect(node.querySelector('[data-action]')?.textContent).toBe('1');
 await act(async () => node.querySelector<HTMLButtonElement>('[aria-label="Свернуть"]')!.click());
 expect(navigation.hidden).toBe(false);
 expect(mounted).toHaveBeenCalledTimes(1);
});

it('remembers expanded workspace but never hides navigation on the character list', async () => {
 sessionStorage.setItem(WORKSPACE_EXPANDED_KEY, 'true');
 function Page() {
   const location = useLocation();
   return <Layout workspace={location.pathname !== '/characters-forge'}><WorkspaceExpandButton /><Link data-roster to="/characters-forge">К списку</Link></Layout>;
 }
 await act(async () => root.render(<MemoryRouter initialEntries={['/characters-v3/hero']}><Page /></MemoryRouter>));
 expect(node.querySelector<HTMLElement>('#site-navigation')!.hidden).toBe(true);
 await act(async () => node.querySelector<HTMLAnchorElement>('[data-roster]')!.click());
 expect(node.querySelector<HTMLElement>('#site-navigation')!.hidden).toBe(false);
 expect(node.querySelector('[aria-label="Развернуть"], [aria-label="Свернуть"]')).toBeNull();
});
