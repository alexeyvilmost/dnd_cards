// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import PaperCharacterSheet from './PaperCharacterSheet';
import { importSheetJSON } from '../paper-sheet/lssExchange';
import customWizard from '../paper-sheet/fixtures/lss-custom-spell-2024.json';
import grimoire from '../paper-sheet/fixtures/lss-grimoire.json';
import type { PaperSheetDocument } from '../paper-sheet/model';

vi.mock('../paper-sheet/SecondaryPages', () => ({ StoryPage: () => null, NotesPage: () => null, SpellPage: () => null }));
vi.mock('../paper-sheet/IdentitySelectionFields', async () => {
  const { Field } = await import('../paper-sheet/controls');
  return { IdentitySelectionFields: () => <Field field="name" label="Имя персонажа" /> };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('keeps edits made while the selected grimoire file is still being read', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const initial = importSheetJSON(JSON.stringify(customWizard)).document;
  let latest: PaperSheetDocument = initial;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<PaperCharacterSheet initialDocument={initial} onDocumentChange={doc => { latest = doc; }} />));
    let resolve!: (text: string) => void;
    const file = { text: () => new Promise<string>(done => { resolve = done; }) };
    const upload = host.querySelector<HTMLInputElement>('[aria-label="Импорт гримуара LSS"]')!;
    Object.defineProperty(upload, 'files', { value: [file], configurable: true });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    const name = host.querySelector<HTMLInputElement>('[aria-label="Имя персонажа"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Правка во время чтения');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest.fields.name).toBe('Правка во время чтения');
    await act(async () => { resolve(JSON.stringify(grimoire)); });
    expect(latest.fields.name).toBe('Правка во время чтения');
    expect(latest.exchange?.spells).toContain(grimoire[0]._id);
    expect(host.textContent).toContain('Гримуар загружен');
  } finally { await act(async () => root.unmount()); }
});
