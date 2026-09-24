// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { useSavedPaperDocument } from './useSavedPaperDocument';
import { createPaperSheet } from './model';
import { paperDocumentApi, type SavedPaperDocument } from './documentApi';
vi.mock('./documentApi', () => ({ paperDocumentApi: { save: vi.fn() }, paperDocumentError: () => 'Conflict' }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, session: ReturnType<typeof useSavedPaperDocument>;
const saved: SavedPaperDocument = { id: 'session-test', document: createPaperSheet(), revision: 1, anonymous: true };
function Probe() { session = useSavedPaperDocument(saved); return <p>{session.status}</p>; }
beforeEach(async () => { vi.useFakeTimers(); localStorage.clear(); root = createRoot(document.createElement('div')); await act(async () => root.render(<Probe />)); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.resetAllMocks(); });
it('serializes edits made during a pending save using the acknowledged revision', async () => {
 let resolve!: (revision: number) => void;
 vi.mocked(paperDocumentApi.save).mockReturnValueOnce(new Promise<number>(done => { resolve = done; })).mockResolvedValueOnce(3);
 const first = { ...createPaperSheet(), fields: { name: 'Первый' } };
 const second = { ...createPaperSheet(), fields: { name: 'Второй' } };
 await act(async () => { session.onDocumentChange(first); await vi.advanceTimersByTimeAsync(600); });
 await act(async () => { session.onDocumentChange(second); await vi.advanceTimersByTimeAsync(600); });
 expect(paperDocumentApi.save).toHaveBeenCalledTimes(1);
 await act(async () => { resolve(2); await Promise.resolve(); await vi.advanceTimersByTimeAsync(500); });
 expect(paperDocumentApi.save).toHaveBeenNthCalledWith(2, 'session-test', second, 2);
 expect(session.status).toBe('Сохранено на сервере');
});
it('preserves the draft and stops automatic writes after a revision conflict', async () => {
 vi.mocked(paperDocumentApi.save).mockRejectedValue({ response: { status: 409 } });
 const edited = { ...createPaperSheet(), fields: { name: 'Несохранённый герой' } };
 await act(async () => { session.onDocumentChange(edited); await vi.advanceTimersByTimeAsync(600); });
 expect(session.conflict).toBe(true);
 expect(JSON.parse(localStorage.getItem('bagofholding.paper-sheet.draft.session-test')!).document.fields.name).toBe('Несохранённый герой');
 await act(async () => { await vi.advanceTimersByTimeAsync(10000); session.retry(); });
 expect(paperDocumentApi.save).toHaveBeenCalledTimes(1);
});
