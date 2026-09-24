// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import PaperSheetEntry from './PaperSheetEntry';
import { paperDocumentApi } from '../paper-sheet/documentApi';
import { createPaperSheet } from '../paper-sheet/model';
const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../paper-sheet/documentApi', () => ({ paperDocumentApi: { get: vi.fn(), list: vi.fn(async () => []), create: vi.fn(), save: vi.fn() }, paperDocumentError: () => 'Ошибка' }));
vi.mock('../paper-sheet/controls', () => ({ Dialog: () => null }));
vi.mock('./PaperCharacterSheet', () => ({ default: () => <div data-testid="editor">Редактор</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => { auth.isAuthenticated = false; localStorage.clear(); node = document.createElement('div'); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); });
const render = async (path = '/paper-sheet') => { await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/paper-sheet/:id?" element={<PaperSheetEntry />} /></Routes></MemoryRouter>); }); };
it('shows a guest gate and never opens the editor before an explicit choice', async () => {
 await render();
 expect(node.querySelector('[data-testid="editor"]')).toBeNull();
 expect(node.textContent).toContain('Сохраните его ID');
 expect(node.querySelector('[href="/login"]')?.textContent).toContain('Авторизоваться');
 expect([...node.querySelectorAll('button')].some(button => button.textContent === 'Создать анонимный')).toBe(true);
 expect(paperDocumentApi.create).not.toHaveBeenCalled();
});
it('creates an anonymous server document only on click and opens its specific URL', async () => {
 const saved = { id: 'test-id', document: createPaperSheet(), revision: 1, anonymous: true };
 vi.mocked(paperDocumentApi.create).mockResolvedValue(saved); vi.mocked(paperDocumentApi.get).mockResolvedValue(saved);
 await render();
 await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === 'Создать анонимный')!.click());
 expect(paperDocumentApi.create).toHaveBeenCalledWith(createPaperSheet(), true);
 expect(paperDocumentApi.get).toHaveBeenCalledWith('test-id');
 expect(node.querySelector('[data-testid="editor"]')).not.toBeNull();
});
it('lists owned sheets after login without silently creating a new one', async () => {
 auth.isAuthenticated = true;
 vi.mocked(paperDocumentApi.list).mockResolvedValue([{ id: 'owned', name: 'Тестовый герой', updated_at: '2026-09-24T10:00:00Z' }]);
 await render();
 expect(node.querySelector('[href="/paper-sheet/owned"]')?.textContent).toContain('Тестовый герой');
 expect(paperDocumentApi.create).not.toHaveBeenCalled();
});
