// @vitest-environment jsdom

import { act, useMemo, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityDetailContext } from '../contexts/entityDetail';
import { EntityField } from './EntityField';
import { Note, PaperSheetContext } from './controls';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet, loadPaperSheet, savePaperSheet, type PaperSheetDocument } from './model';
import { paperEntityToken, parsePaperEntityToken, type PaperEntityType, type PaperLibraryEntity } from './references';

const { previewCalls } = vi.hoisted(() => ({ previewCalls: vi.fn() }));

// Keep the real HoverCard portal and event handling; probe the canonical preview
// boundary without importing the entire remote catalogue into this focused suite.
vi.mock('../components/EntityRefPreview', () => ({
  default: ({ type, id }: { type: string; id: string }) => {
    previewCalls(type, id);
    return <article data-canonical-preview={`${type}:${id}`}>Каноничное превью: {type === 'card' ? 'предмет' : 'заклинание'} {id}</article>;
  },
}));

vi.mock('./LibraryPicker', () => ({
  LibraryPicker: ({ initialType, onSelect, onClose }: {
    initialType?: PaperEntityType; onSelect: (entity: PaperLibraryEntity) => void; onClose: () => void;
  }) => <div role="dialog" aria-label="Каталог для проверки" data-initial-type={initialType}>
    {ENTITIES.map(entity => <button key={entity.id} type="button" onClick={() => onSelect(entity)}>Выбрать {entity.name}</button>)}
    <button type="button" onClick={onClose}>Отмена выбора</button>
  </div>,
}));

const ENTITIES: PaperLibraryEntity[] = [
  { type: 'card', id: 'silver-blade', name: 'Серебряный клинок' },
  { type: 'spell', id: 'guiding-light', name: 'Путеводный свет' },
];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('paper sheet library references', () => {
  let container: HTMLDivElement;
  let root: Root;
  let currentDocument: PaperSheetDocument;
  const openEntity = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    openEntity.mockClear();
    previewCalls.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value() { this.setAttribute('open', ''); },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(children: ReactNode, initial = createPaperSheet()) {
    function Harness() {
      const [doc, setDoc] = useState(initial);
      currentDocument = doc;
      const calculations = useMemo(() => calculateSheet(doc), [doc]);
      const setField = (key: string, value: string) => setDoc(current => ({ ...current, fields: { ...current.fields, [key]: value } }));
      return <EntityDetailContext.Provider value={{ openEntity }}><PaperSheetContext.Provider value={{ doc, setDoc, setField, calculations }}>{children}</PaperSheetContext.Provider></EntityDetailContext.Provider>;
    }
    await act(async () => root.render(<Harness />));
  }

  function labelled<T extends HTMLElement = HTMLButtonElement>(label: string): T {
    const found = [...container.querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === label);
    expect(found, `Missing control: ${label}`).toBeTruthy();
    return found as T;
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(element => element.textContent?.trim() === label);
    expect(found, `Missing button: ${label}`).toBeTruthy();
    return found!;
  }

  async function click(element: HTMLElement) { await act(async () => element.click()); }

  async function input(element: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it.each(ENTITIES)('preserves the stable $type identity and name through export/import and local reload', async entity => {
    const token = paperEntityToken(entity);
    expect(parsePaperEntityToken(token)).toEqual(entity);
    const doc = createPaperSheet();
    doc.fields['weapon.0.name'] = token;
    doc.sections.equipment = { text: `До\n${token}\nПосле {{ресурс:Заряды|2|3}}`, fontSize: 13 };
    const imported = importPaperSheet(exportPaperSheet(doc));
    expect(parsePaperEntityToken(imported.fields['weapon.0.name'])).toEqual(entity);
    expect(imported.sections.equipment).toEqual(doc.sections.equipment);
    expect(savePaperSheet(imported)).toEqual({});
    const restored = loadPaperSheet().document;
    expect(parsePaperEntityToken(restored.fields['weapon.0.name'])).toEqual(entity);
    expect(restored.sections.equipment.text).toBe(doc.sections.equipment.text);
    await render(<><EntityField field="weapon.0.name" label="Название оружия 1" /><Note section="equipment" heading="Снаряжение" /></>, restored);
    const restoredNames = [...container.querySelectorAll('.ps-entity-name strong')].map(element => element.textContent);
    expect(restoredNames).toEqual([entity.name, entity.name]);
    expect(container.querySelector('.ps-resource')?.textContent).toContain('2 / 3');
  });

  it('escapes reference delimiters in name snapshots and does not parse malformed or unsupported references', () => {
    const token = paperEntityToken({ type: 'card', id: 'safe-id', name: 'Клинок [лунный] | особый\nредкий' });
    expect(parsePaperEntityToken(token)).toEqual({ type: 'card', id: 'safe-id', name: 'Клинок лунный особый редкий' });
    for (const raw of ['[[Имя|card:]]', '[[Имя|action:ability]]', 'prefix [[Имя|spell:spell-id]]', '[[Имя|card:id]] tail', '[[Имя|spell:javascript:alert(1)]]']) {
      expect(parsePaperEntityToken(raw), raw).toBeNull();
    }
  });

  it.each(ENTITIES)('shows $type names in bold, uses the canonical hover preview and opens canonical detail without editing the note', async entity => {
    const doc = createPaperSheet();
    doc.sections.equipment = { text: `Описание: ${paperEntityToken(entity)}`, fontSize: 12 };
    await render(<Note section="equipment" heading="Снаряжение" />, doc);
    const name = labelled(`Открыть карточку: ${entity.name}`);
    expect(name.tagName).toBe('BUTTON');
    expect(name.querySelector('strong')?.textContent).toBe(entity.name);
    expect(name.hasAttribute('title')).toBe(false);
    expect(previewCalls).not.toHaveBeenCalled();
    await act(async () => name.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(previewCalls).toHaveBeenCalledWith(entity.type, entity.id);
    const preview = document.body.querySelector(`[data-canonical-preview="${entity.type}:${entity.id}"]`);
    expect(preview?.textContent).toContain('Каноничное превью');
    expect(container.contains(preview)).toBe(false);
    await click(name);
    expect(openEntity).toHaveBeenCalledExactlyOnceWith(entity.type, entity.id);
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('dialog')).toBeNull();
    expect(currentDocument.sections.equipment.text).toBe(doc.sections.equipment.text);
  });

  it.each(['Enter', ' '])('keeps native %s activation available on an entity button inside a note', async key => {
    const entity = ENTITIES[1];
    const doc = createPaperSheet();
    doc.sections.attacks = { text: paperEntityToken(entity), fontSize: 12 };
    await render(<Note section="attacks" heading="Заклинания" />, doc);
    const name = labelled(`Открыть карточку: ${entity.name}`);
    expect(name.tabIndex).toBe(0);
    const keyboard = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => { name.focus(); name.dispatchEvent(keyboard); });
    expect(document.activeElement).toBe(name);
    expect(keyboard.defaultPrevented).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
    // jsdom does not synthesize native keyboard clicks; exercise that default action.
    await click(name);
    expect(openEntity).toHaveBeenCalledExactlyOnceWith(entity.type, entity.id);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it.each(ENTITIES)('selects a $type for a name field, preserves other row data, then detaches to editable plain text', async entity => {
    const doc = createPaperSheet();
    doc.fields['weapon.0.damage'] = '1d8 + [STR]';
    await render(<EntityField field="weapon.0.name" label="Название оружия 1" initialType={entity.type} />, doc);
    await click(labelled('Из библиотеки: Название оружия 1'));
    expect(labelled('Каталог для проверки').getAttribute('data-initial-type')).toBe(entity.type);
    await click(button(`Выбрать ${entity.name}`));
    expect(container.querySelector('[aria-label="Каталог для проверки"]')).toBeNull();
    expect(currentDocument.fields['weapon.0.name']).toBe(paperEntityToken(entity));
    expect(currentDocument.fields['weapon.0.damage']).toBe('1d8 + [STR]');
    expect(labelled(`Открыть карточку: ${entity.name}`).querySelector('strong')?.textContent).toBe(entity.name);
    await click(labelled('Убрать ссылку: Название оружия 1'));
    const name = labelled<HTMLInputElement>('Название оружия 1');
    expect(name.value).toBe(entity.name);
    expect(currentDocument.fields['weapon.0.name']).toBe(entity.name);
    await input(name, 'Моё название');
    expect(currentDocument.fields['weapon.0.name']).toBe('Моё название');
    expect(currentDocument.fields['weapon.0.damage']).toBe('1d8 + [STR]');
  });

  it('appends an entity from a note header and replaces only the editor selection while preserving text and resource counters', async () => {
    const original = 'До {{ресурс:Заряды|2|3}} ЗАМЕНИТЬ после';
    const doc = createPaperSheet();
    doc.sections.equipment = { text: original, fontSize: 14 };
    await render(<Note section="equipment" heading="Снаряжение" />, doc);
    await click(labelled('Добавить из библиотеки: Снаряжение'));
    await click(button(`Выбрать ${ENTITIES[0].name}`));
    const appended = `${original}\n${paperEntityToken(ENTITIES[0])}`;
    expect(currentDocument.sections.equipment).toEqual({ text: appended, fontSize: 14 });
    expect(container.querySelector('textarea')).toBeNull();
    await click(labelled('Редактировать: Снаряжение'));
    const editor = labelled<HTMLTextAreaElement>('Текст: Снаряжение');
    const noteBody = editor.closest('.ps-note-body');
    expect(noteBody).not.toBeNull();
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    const start = editor.value.indexOf('ЗАМЕНИТЬ');
    editor.setSelectionRange(start, start + 'ЗАМЕНИТЬ'.length);
    await click(button('Из библиотеки'));
    expect(container.querySelector('textarea')).toBeNull();
    await click(button(`Выбрать ${ENTITIES[1].name}`));
    const replaced = appended.replace('ЗАМЕНИТЬ', paperEntityToken(ENTITIES[1]));
    const returnedEditor = labelled<HTMLTextAreaElement>('Текст: Снаряжение');
    expect(returnedEditor.value).toBe(replaced);
    expect(returnedEditor.closest('.ps-note-body')).toBe(noteBody);
    expect(document.activeElement).toBe(returnedEditor);
    const caret = start + paperEntityToken(ENTITIES[1]).length;
    expect([returnedEditor.selectionStart, returnedEditor.selectionEnd]).toEqual([caret, caret]);
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    expect(currentDocument.sections.equipment).toEqual({ text: replaced, fontSize: 14 });
    await click(button('Готово'));
    await click(labelled('Потратить: Заряды'));
    expect(currentDocument.sections.equipment.text).toBe(replaced.replace('|2|3', '|1|3'));
    expect(container.querySelectorAll('.ps-entity-name')).toHaveLength(2);
    expect(savePaperSheet(currentDocument)).toEqual({});
    expect(loadPaperSheet().document.sections.equipment.text).toBe(currentDocument.sections.equipment.text);
  });

  it('cancels library selection without changing note text and returns to the editor', async () => {
    const doc = createPaperSheet();
    const original = `Записано ${paperEntityToken(ENTITIES[0])} {{ресурс:Кости|3|4}}`;
    doc.sections.features = { text: original, fontSize: 12 };
    await render(<Note section="features" heading="Умения" />, doc);
    await click(labelled('Редактировать: Умения'));
    const editor = labelled<HTMLTextAreaElement>('Текст: Умения');
    const noteBody = editor.closest('.ps-note-body');
    editor.setSelectionRange(2, 7);
    await click(button('Из библиотеки'));
    await click(button('Отмена выбора'));
    const returnedEditor = labelled<HTMLTextAreaElement>('Текст: Умения');
    expect(returnedEditor.value).toBe(original);
    expect(returnedEditor.closest('.ps-note-body')).toBe(noteBody);
    expect(document.activeElement).toBe(returnedEditor);
    expect([returnedEditor.selectionStart, returnedEditor.selectionEnd]).toEqual([2, 7]);
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    expect(currentDocument.sections.features.text).toBe(original);
    expect(openEntity).not.toHaveBeenCalled();
  });

  it('uses the active inline caret when the note header opens the library', async () => {
    const doc = createPaperSheet();
    doc.sections.features = { text: 'Заголовок\nДо место после\n{{ресурс:Кости|3|4}}', fontSize: 12 };
    await render(<Note section="features" heading="Умения" />, doc);
    await click(container.querySelectorAll<HTMLElement>('.ps-note-line')[1]);
    const editor = labelled<HTMLTextAreaElement>('Текст: Умения');
    const selectedAt = editor.value.indexOf('место');
    editor.setSelectionRange(selectedAt, selectedAt + 5);
    const headerLibrary = labelled('Добавить из библиотеки: Умения');
    await act(async () => headerLibrary.focus());
    expect(container.querySelector('textarea')).toBe(editor);
    await click(headerLibrary);
    expect(container.querySelector('textarea')).toBeNull();
    await click(button(`Выбрать ${ENTITIES[0].name}`));
    const expected = `Заголовок\nДо ${paperEntityToken(ENTITIES[0])} после\n{{ресурс:Кости|3|4}}`;
    const returnedEditor = labelled<HTMLTextAreaElement>('Текст: Умения');
    expect(returnedEditor.value).toBe(expected);
    const caret = selectedAt + paperEntityToken(ENTITIES[0]).length;
    expect([returnedEditor.selectionStart, returnedEditor.selectionEnd]).toEqual([caret, caret]);
    expect(currentDocument.sections.features.text).toBe(expected);
    expect(returnedEditor.closest('.ps-note-body')).not.toBeNull();
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
  });
});
