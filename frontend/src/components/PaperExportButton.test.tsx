// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PaperExportButton from './PaperExportButton';
import { charactersV3Api } from '../character/api';
import { paperDocumentApi } from '../paper-sheet/documentApi';
import { exportInteractiveCharacterToPaper } from '../paper-sheet/characterConversion';
import { createPaperSheet } from '../paper-sheet/model';
import type { ForgeCharacter } from '../character/types';
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../character/api', () => ({ charactersV3Api: { get: vi.fn(), update: vi.fn(), patchRuntime: vi.fn() } }));
vi.mock('../paper-sheet/documentApi', () => ({ paperDocumentApi: { create: vi.fn() }, paperDocumentError: (cause: Error) => cause.message }));
vi.mock('../paper-sheet/characterConversion', () => ({ exportInteractiveCharacterToPaper: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
function Probe() { const location = useLocation(); return <><PaperExportButton characterId="source" /><p data-path>{location.pathname}</p></>; }
beforeEach(async () => { node = document.createElement('div'); root = createRoot(node); await act(async () => root.render(<MemoryRouter><Probe /></MemoryRouter>)); });
afterEach(async () => { await act(async () => root.unmount()); vi.resetAllMocks(); });
it('exports a fresh current snapshot once and navigates to a separate paper document', async () => {
 let finish!: (character: ForgeCharacter) => void;
 vi.mocked(charactersV3Api.get).mockReturnValueOnce(new Promise(done => { finish = done; }));
 const current = { id: 'source', current_hp: 7 } as ForgeCharacter;
 const converted = createPaperSheet();
 vi.mocked(exportInteractiveCharacterToPaper).mockResolvedValue(converted);
 vi.mocked(paperDocumentApi.create).mockResolvedValue({ id: 'paper-copy', document: converted, revision: 1, anonymous: false });
 await act(async () => { node.querySelector('button')!.click(); node.querySelector('button')!.click(); });
 expect(charactersV3Api.get).toHaveBeenCalledOnce();
 await act(async () => finish(current));
 expect(exportInteractiveCharacterToPaper).toHaveBeenCalledWith(current);
 expect(paperDocumentApi.create).toHaveBeenCalledWith(converted, false);
 expect(charactersV3Api.update).not.toHaveBeenCalled();
 expect(charactersV3Api.patchRuntime).not.toHaveBeenCalled();
 expect(node.querySelector('[data-path]')!.textContent).toBe('/paper-sheet/paper-copy');
});
it('keeps the source open and allows retry after a failed conversion', async () => {
 vi.mocked(charactersV3Api.get).mockResolvedValue({ id: 'source' } as ForgeCharacter);
 vi.mocked(exportInteractiveCharacterToPaper).mockRejectedValue(new Error('Каталог не загрузился'));
 await act(async () => node.querySelector('button')!.click());
 expect(node.querySelector('[role="alert"]')!.textContent).toBe('Каталог не загрузился');
 expect(paperDocumentApi.create).not.toHaveBeenCalled();
 expect(node.querySelector('button')!.disabled).toBe(false);
 expect(node.querySelector('[data-path]')!.textContent).toBe('/');
});
it('does not create a copy after the user has left the source sheet', async () => {
 let finish!: (character: ForgeCharacter) => void;
 vi.mocked(charactersV3Api.get).mockReturnValueOnce(new Promise(done => { finish = done; }));
 await act(async () => node.querySelector('button')!.click());
 await act(async () => root.render(<p>Другой экран</p>));
 await act(async () => finish({ id: 'source' } as ForgeCharacter));
 expect(exportInteractiveCharacterToPaper).not.toHaveBeenCalled();
 expect(paperDocumentApi.create).not.toHaveBeenCalled();
 expect(node.textContent).toBe('Другой экран');
});
