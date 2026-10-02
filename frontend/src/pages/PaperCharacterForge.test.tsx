// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CharacterForgeProps, PaperForgeSaveInput, PaperForgeSession } from './CharacterForge';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { createPaperSheet, type PaperSheetDocument } from '../paper-sheet/model';
import { paperDocumentApi, type SavedPaperDocument } from '../paper-sheet/documentApi';
import { forgeCharacterToPaper } from '../paper-sheet/characterConversion';
import PaperCharacterForge, { paperForgeDraftKey } from './PaperCharacterForge';

const state = vi.hoisted(() => ({ auth: { isAuthenticated: false, isLoading: false }, session: null as PaperForgeSession | null }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../paper-sheet/documentApi', () => ({
  paperDocumentApi: { get: vi.fn(), create: vi.fn(), save: vi.fn() },
  paperDocumentError: (reason: unknown) => reason instanceof Error ? reason.message : 'Ошибка сохранения',
}));
vi.mock('../paper-sheet/characterConversion', () => ({ forgeCharacterToPaper: vi.fn() }));
vi.mock('./CharacterForge', () => ({ default: ({ paperMode, paperSession }: CharacterForgeProps) => {
  state.session = paperSession ?? null;
  return <div data-testid="forge" data-mode={paperMode ? 'paper' : 'interactive'}>{paperSession?.draft.name}</div>;
} }));

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); state.auth.isAuthenticated = false; state.auth.isLoading = false; state.session = null;
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
function NavigationProbe() { const navigate = useNavigate(); return <button onClick={() => navigate('/paper-sheet/other/forge')}>Другой лист</button>; }
const render = async (path = '/paper-sheet/create') => {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><NavigationProbe /><Routes>
    <Route path="/paper-sheet/create" element={<PaperCharacterForge />} />
    <Route path="/paper-sheet/:id/forge" element={<PaperCharacterForge />} />
    <Route path="/paper-sheet/:id/level-up" element={<PaperCharacterForge levelUp />} />
    <Route path="/paper-sheet/:id" element={<p>Бумажный лист открыт</p>} />
  </Routes></MemoryRouter>));
};
const draft = (): CharacterDraft => ({ ...emptyDraft(), name: 'Мира', raceId: 'elf', classId: 'wizard', backgroundId: 'sage', level: 2,
  classLevels: { wizard: 2 }, abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 10, cha: 10 },
  resolvedChoices: { spellbook: ['one', 'two'], prepared: ['one'] }, manualSpellIds: ['extra'] });
const saved = (build = draft(), id = 'saved'): SavedPaperDocument => ({ id, anonymous: true, revision: 7, document: {
  ...createPaperSheet(), fields: { ...createPaperSheet().fields, name: build.name, level: String(build.level), ...Object.fromEntries(Object.entries(build.abilities).map(([key, value]) => [key, String(value)])) },
  identity: { speciesId: build.raceId!, classId: build.classId!, backgroundId: build.backgroundId! }, progression: { draft: build },
} });
const saveInput = (build = draft()): PaperForgeSaveInput => ({ draft: build, payload: { name: build.name }, assembled: {} as PaperForgeSaveInput['assembled'], ruleState: {} as PaperForgeSaveInput['ruleState'] });

it('opens without creating a character or document and creates an anonymous paper document only after save', async () => {
  const projected = createPaperSheet(); vi.mocked(forgeCharacterToPaper).mockResolvedValue(projected);
  vi.mocked(paperDocumentApi.create).mockResolvedValue({ ...saved(), id: 'new-paper', document: projected });
  await render();
  expect(node.querySelector('[data-mode="paper"]')).not.toBeNull();
  expect(paperDocumentApi.get).not.toHaveBeenCalled(); expect(paperDocumentApi.create).not.toHaveBeenCalled();
  const input = saveInput();
  await act(async () => state.session!.onSave(input));
  expect(forgeCharacterToPaper).toHaveBeenCalledWith({ ...input, existing: undefined });
  expect(paperDocumentApi.create).toHaveBeenCalledWith(projected, true);
  expect(node.textContent).toContain('Бумажный лист открыт');
});

it('preserves the existing document and uses its revision for a CAS save', async () => {
  state.auth.isAuthenticated = true;
  const existing = saved(); existing.document.sections.notes1 = { text: 'Личная запись', fontSize: 13 };
  vi.mocked(paperDocumentApi.get).mockResolvedValue(existing);
  const output: PaperSheetDocument = { ...existing.document, fields: { ...existing.document.fields, name: 'Новое имя' } };
  vi.mocked(forgeCharacterToPaper).mockResolvedValue(output); vi.mocked(paperDocumentApi.save).mockResolvedValue(8);
  await render('/paper-sheet/saved/forge');
  expect(state.session!.draft.resolvedChoices).toEqual(existing.document.progression!.draft.resolvedChoices);
  expect(state.session!.draft.id).toBeUndefined();
  await act(async () => state.session!.onSave(saveInput()));
  expect(forgeCharacterToPaper).toHaveBeenCalledWith(expect.objectContaining({ existing: existing.document }));
  expect(paperDocumentApi.save).toHaveBeenCalledWith('saved', output, 7);
  expect(paperDocumentApi.create).not.toHaveBeenCalled();
});

it('restores a multiclass upgrade without increasing the level twice or losing replacement baselines', async () => {
  const from = { ...draft(), level: 3, classLevels: { wizard: 2, fighter: 1 } };
  const next = { ...from, level: 4, classLevels: { wizard: 2, fighter: 2 }, resolvedChoices: { ...from.resolvedChoices, prepared: ['two'] } };
  vi.mocked(paperDocumentApi.get).mockResolvedValue(saved(from));
  localStorage.setItem(paperForgeDraftKey('saved', true), JSON.stringify({ revision: 7, draft: next, levelUpFrom: from }));
  await render('/paper-sheet/saved/level-up');
  expect(state.session!.draft).toEqual(next);
  expect(state.session!.levelUpFrom?.resolvedChoices.prepared).toEqual(['one']);
  expect(node.textContent).toContain('Восстановлен');
  state.session!.onDraftChange({ ...next, name: 'После перезагрузки' });
  const cached = JSON.parse(localStorage.getItem(paperForgeDraftKey('saved', true))!);
  expect(cached.draft.level).toBe(4); expect(cached.levelUpFrom.level).toBe(3);
  expect(localStorage.getItem('forge-draft')).toBeNull();
});

it('keeps a recoverable draft when a revision conflict rejects saving', async () => {
  const existing = saved(); vi.mocked(paperDocumentApi.get).mockResolvedValue(existing);
  vi.mocked(forgeCharacterToPaper).mockResolvedValue(existing.document);
  vi.mocked(paperDocumentApi.save).mockRejectedValue(new Error('Лист изменён в другом окне'));
  await render('/paper-sheet/saved/forge');
  state.session!.onDraftChange(draft());
  await expect(state.session!.onSave(saveInput())).rejects.toThrow('Лист изменён в другом окне');
  expect(localStorage.getItem(paperForgeDraftKey('saved', false))).not.toBeNull();
  expect(node.querySelector('[data-testid="forge"]')).not.toBeNull();
  expect(paperDocumentApi.create).not.toHaveBeenCalled();
});

it('does not apply an outdated local draft over a newer document revision', async () => {
  vi.mocked(paperDocumentApi.get).mockResolvedValue(saved());
  const previous = { revision: 6, draft: { ...draft(), name: 'Устаревший' } };
  localStorage.setItem(paperForgeDraftKey('saved', false), JSON.stringify(previous));
  await render('/paper-sheet/saved/forge');
  expect(state.session!.draft.name).toBe('Мира'); expect(node.textContent).toContain('Лист изменён');
  state.session!.onDraftChange({ ...draft(), name: 'Новый' });
  expect(JSON.parse(localStorage.getItem(paperForgeDraftKey('saved', false))!)).toEqual(previous);
});

it('requires reviewing a legacy manual sheet before a constrained level-up', async () => {
  const existing = saved(); delete existing.document.progression;
  vi.mocked(paperDocumentApi.get).mockResolvedValue(existing);
  await render('/paper-sheet/saved/level-up');
  expect(node.querySelector('[data-testid="forge"]')).toBeNull();
  expect(node.querySelector('[href="/paper-sheet/saved/forge"]')).not.toBeNull();
  expect(paperDocumentApi.save).not.toHaveBeenCalled();
});

it('ignores a late document response after navigating to another paper sheet', async () => {
  let resolveFirst!: (value: SavedPaperDocument) => void;
  vi.mocked(paperDocumentApi.get).mockImplementation(id => id === 'first'
    ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(saved({ ...draft(), name: 'Другой' }, 'other')));
  await render('/paper-sheet/first/forge');
  await act(async () => node.querySelector('button')!.click());
  expect(state.session!.documentId).toBe('other');
  await act(async () => resolveFirst(saved({ ...draft(), name: 'Старый' }, 'first')));
  expect(state.session!.documentId).toBe('other'); expect(node.textContent).not.toContain('Старый');
});

it('retries a failed load and never saves before the sheet is available', async () => {
  vi.mocked(paperDocumentApi.get).mockRejectedValueOnce(new Error('Нет соединения')).mockResolvedValueOnce(saved());
  await render('/paper-sheet/saved/forge');
  expect(node.querySelector('[role="alert"]')?.textContent).toBe('Нет соединения');
  await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === 'Повторить')!.click());
  expect(node.querySelector('[data-testid="forge"]')).not.toBeNull(); expect(paperDocumentApi.save).not.toHaveBeenCalled();
});
