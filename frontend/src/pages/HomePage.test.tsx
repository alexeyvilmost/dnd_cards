// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import HomePage from './HomePage';
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('offers four illustrated destinations publicly and removes secondary game tools from the header', async () => {
 const node = document.createElement('div'); const root = createRoot(node);
 await act(async () => { root.render(<MemoryRouter><HomePage /></MemoryRouter>); });
 expect(node.querySelectorAll('.home-tile')).toHaveLength(4);
 expect(node.querySelectorAll('.home-tile-art')).toHaveLength(4);
 expect(node.querySelector('.home-catalog-links [href="/monsters"]')).not.toBeNull();
 for (const path of ['/monsters','/encounters','/shop/new','/initiative','/image-generator','/docs/engine']) expect(node.querySelector(`header a[href="${path}"]`)).toBeNull();
 expect(node.querySelector('header a[href="/library"]')).not.toBeNull();
 expect(node.querySelector('header a[href="/login"]')).not.toBeNull();
 await act(async () => root.unmount());
});
it.each(['/?type=spells', '/?card=old-item-id', '/?spellSchool=evocation', '/?rarity=common,rare'])('keeps old root catalog bookmark %s working', async (bookmark) => {
 const node = document.createElement('div'); const root = createRoot(node);
 await act(async () => { root.render(<MemoryRouter initialEntries={[bookmark]}><Routes><Route path="/" element={<HomePage />} /><Route path="/library" element={<p>Каталог</p>} /></Routes></MemoryRouter>); });
 expect(node.textContent).toBe('Каталог');
 await act(async () => root.unmount());
});
