// @vitest-environment jsdom

import { act, StrictMode, useMemo, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Field, Note, PaperSheetContext } from './controls';
import {
  PAPER_SHEET_STORAGE_KEY, calculateSheet, createPaperSheet, exportPaperSheet,
  importPaperSheet, loadPaperSheet, savePaperSheet, type PaperSheetDocument,
} from './model';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('editable paper sheet controls', () => {
  let container: HTMLDivElement;
  let root: Root;
  let currentDocument: PaperSheetDocument;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() { this.setAttribute('open', ''); },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function controls(children: ReactNode, initial = createPaperSheet()) {
    function Harness() {
      const [doc, setDoc] = useState(initial);
      currentDocument = doc;
      const calculations = useMemo(() => calculateSheet(doc), [doc]);
      const setField = (key: string, value: string) => setDoc(current => ({ ...current, fields: { ...current.fields, [key]: value } }));
      return <PaperSheetContext.Provider value={{ doc, setDoc, setField, calculations }}>{children}</PaperSheetContext.Provider>;
    }
    await act(async () => root.render(<Harness />));
  }

  function labelled<T extends HTMLElement = HTMLInputElement>(label: string): T {
    const element = [...container.querySelectorAll<HTMLElement>('[aria-label]')].find(item => item.getAttribute('aria-label') === label);
    expect(element, `Missing control: ${label}`).toBeTruthy();
    return element as T;
  }

  function button(text: string): HTMLButtonElement {
    const element = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === text);
    expect(element, `Missing button: ${text}`).toBeTruthy();
    return element!;
  }

  async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click());
  }

  async function importFile(content: string) {
    const file = new File([content], 'персонаж.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => content });
    const control = labelled('Импорт листа JSON');
    Object.defineProperty(control, 'files', { configurable: true, value: [file] });
    await act(async () => control.dispatchEvent(new Event('change', { bubbles: true })));
  }

  async function renderPage(strict = false) {
    const { default: PaperCharacterSheet } = await import('../pages/PaperCharacterSheet');
    await act(async () => root.render(strict ? <StrictMode><PaperCharacterSheet /></StrictMode> : <PaperCharacterSheet />));
  }

  it('edits the original formula on focus, displays the result on blur and updates dependent fields', async () => {
    const sheet = createPaperSheet();
    sheet.fields.ac = '=10 + [DEX]';
    await controls(<><Field field="dex" label="Ловкость" /><Field field="ac" label="КД" /><Field field="initiative" label="Инициатива" signed /></>, sheet);
    expect(labelled('КД').value).toBe('10');
    await act(async () => labelled('КД').focus());
    expect(labelled('КД').value).toBe('=10 + [DEX]');
    await input(labelled('КД'), '=12 + min([DEX], 2)');
    await act(async () => labelled('КД').blur());
    expect(labelled('КД').value).toBe('12');
    await input(labelled('Ловкость'), '18');
    expect(labelled('КД').value).toBe('14');
    expect(labelled('Инициатива').value).toBe('+4');
    expect(currentDocument.fields.ac).toBe('=12 + min([DEX], 2)');
    expect(importPaperSheet(exportPaperSheet(currentDocument)).fields.ac).toBe('=12 + min([DEX], 2)');
  });

  it('associates a formula error with the focused input and preserves the invalid input for correction', async () => {
    await controls(<Field field="ac" label="КД" />);
    const ac = labelled('КД');
    await act(async () => ac.focus());
    await input(ac, '=10 / 0');
    expect(ac.getAttribute('aria-invalid')).toBe('true');
    const errorId = ac.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)?.textContent).toMatch(/конечным числом/);
    await act(async () => ac.blur());
    expect(ac.value).toBe('=10 / 0');
    expect(currentDocument.fields.ac).toBe('=10 / 0');
    await act(async () => ac.focus());
    await input(ac, '=10 + [DEX]');
    expect(ac.getAttribute('aria-invalid')).toBe('false');
    expect(ac.hasAttribute('aria-describedby')).toBe(false);
    await act(async () => ac.blur());
    expect(ac.value).toBe('10');
  });

  it('stores note source text, renders inline formulas and keeps authored HTML inert', async () => {
    await controls(<><Field field="wis" label="Мудрость" /><Note section="features" heading="Умения" /></>);
    await click(labelled<HTMLButtonElement>('Редактировать: Умения'));
    const text = 'СЛ {{8 + [PROF] + [WIS]}}\n<img src=x onerror=alert(1)>';
    await input(labelled<HTMLTextAreaElement>('Текст: Умения, строка 1'), text);
    await click(button('Готово'));
    expect(container.querySelector('.ps-inline-formula')?.textContent).toBe('10');
    expect(container.querySelector('.ps-note-text')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('.ps-note-text img')).toBeNull();
    await input(labelled('Мудрость'), '18');
    expect(container.querySelector('.ps-inline-formula')?.textContent).toBe('14');
    expect(currentDocument.sections.features.text).toBe(text);
    expect(savePaperSheet(currentDocument)).toEqual({});
    expect(loadPaperSheet().document.sections.features.text).toBe(text);
  });

  it('edits a note inside its paper block, saves every change before finishing and returns to preview on Escape or outside focus', async () => {
    await renderPage();
    const preview = labelled<HTMLElement>('Умения и способности');
    const block = preview.closest('.ps-note')!;
    await click(preview);
    let editor = labelled<HTMLTextAreaElement>('Текст: Умения и способности, строка 1');
    expect(editor.closest('.ps-note-body')).toBe(preview.parentElement);
    expect(block.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Редактирование: Умения и способности');
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(editor);
    const text = 'Записано сразу. СЛ {{8 + [PROF] + [WIS]}}\n[[Клинок|card:silver-blade]] {{ресурс:Заряды|2|3}}';
    await input(editor, text);
    expect(loadPaperSheet().document.sections.features.text).toBe(text);
    editor = block.querySelector<HTMLTextAreaElement>('textarea')!;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => editor.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(block.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(preview);
    expect(block.querySelector('.ps-inline-formula')?.textContent).toBe('10');
    expect(block.querySelector('.ps-entity-name strong')?.textContent).toBe('Клинок');
    expect(block.querySelector('.ps-resource')?.textContent).toContain('2 / 3');
    expect(loadPaperSheet().document.sections.features.text).toBe(text);
    await act(async () => preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    editor = block.querySelector<HTMLTextAreaElement>('textarea')!;
    const sourceLine = Number(editor.getAttribute('aria-label')!.match(/строка (\d+)$/)![1]) - 1;
    await input(editor, `${editor.value} дополнено`);
    const expected = text.split('\n').map((line, index) => index === sourceLine ? `${line} дополнено` : line).join('\n');
    await act(async () => labelled('Имя персонажа').focus());
    expect(block.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(labelled('Имя персонажа'));
    expect(loadPaperSheet().document.sections.features.text).toBe(expected);
  });

  it('switches between two inline notes and finishes on an outside pointer click without changing either note', async () => {
    await controls(<><Note section="first" heading="Первая заметка" /><Note section="second" heading="Вторая заметка" /><div data-outside-note>За пределами заметок</div></>);
    await click(labelled<HTMLButtonElement>('Редактировать: Первая заметка'));
    const firstEditor = labelled<HTMLTextAreaElement>('Текст: Первая заметка, строка 1');
    await input(firstEditor, 'Первый текст');
    const secondPreview = labelled<HTMLElement>('Вторая заметка');
    await act(async () => secondPreview.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    await click(secondPreview);
    expect(container.querySelector('[aria-label^="Текст: Первая заметка,"]')).toBeNull();
    const secondEditor = labelled<HTMLTextAreaElement>('Текст: Вторая заметка, строка 1');
    expect(secondEditor.closest('.ps-note-body')).toBe(secondPreview.parentElement);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.activeElement).toBe(secondEditor);
    await input(secondEditor, 'Второй текст');
    const outside = container.querySelector<HTMLElement>('[data-outside-note]')!;
    await act(async () => outside.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    await click(outside);
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    expect(currentDocument.sections.first.text).toBe('Первый текст');
    expect(currentDocument.sections.second.text).toBe('Второй текст');
    expect(labelled<HTMLElement>('Первая заметка').textContent).toBe('Первый текст');
    expect(labelled<HTMLElement>('Вторая заметка').textContent).toBe('Второй текст');
  });

  it('shows raw text only on the active line while other lines retain working formulas, links and resources', async () => {
    const sheet = createPaperSheet();
    const source = 'Первая строка\nСЛ {{8 + [PROF] + [WIS]}}\n[[Клинок|card:silver-blade]]\n{{ресурс:Заряды|2|3}}';
    sheet.sections.features = { text: source, fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    const lines = () => [...container.querySelectorAll<HTMLElement>('.ps-note-line')];
    expect(lines()).toHaveLength(4);
    await click(lines()[0]);
    const editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    expect(editor.value).toBe('Первая строка');
    expect(container.querySelectorAll('.ps-inline-textarea')).toHaveLength(1);
    expect(lines()[0].querySelector('.ps-note-line-print')).not.toBeNull();
    expect(lines()[1].querySelector('.ps-inline-formula')?.textContent).toBe('10');
    expect(lines()[2].querySelector('.ps-entity-name strong')?.textContent).toBe('Клинок');
    expect(lines()[3].querySelector('.ps-resource')?.textContent).toContain('2 / 3');
    expect(container.querySelector('.ps-inline-tools')?.parentElement).toBe(container.querySelector('.ps-note-text')?.parentElement);
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    await input(editor, 'Первая строка изменена');
    await click(labelled<HTMLButtonElement>('Потратить: Заряды'));
    expect(currentDocument.sections.features.text).toBe(source.replace('Первая строка', 'Первая строка изменена').replace('|2|3', '|1|3'));
    expect(labelled<HTMLTextAreaElement>('Текст: Умения, строка 1').value).toBe('Первая строка изменена');
    expect(container.querySelectorAll('.ps-note-line-active')).toHaveLength(1);
    await click(lines()[1]);
    expect(labelled<HTMLTextAreaElement>('Текст: Умения, строка 2').value).toBe('СЛ {{8 + [PROF] + [WIS]}}');
    expect(lines()[0].querySelector('textarea')).toBeNull();
    expect(lines()[0].textContent).toBe('Первая строка изменена');
  });

  it('navigates logical lines and preserves text and caret through split, merge and a trailing blank line', async () => {
    const sheet = createPaperSheet();
    sheet.sections.features = { text: 'abcd\nxy\nlast', fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    const line = (index: number) => container.querySelectorAll<HTMLElement>('.ps-note-line')[index];
    const key = async (editor: HTMLTextAreaElement, value: string) => {
      await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
    };
    await click(line(0));
    let editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    editor.setSelectionRange(3, 3);
    await key(editor, 'ArrowDown');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 2');
    expect(editor.value).toBe('xy');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 2]);
    editor.setSelectionRange(1, 1);
    await key(editor, 'ArrowUp');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 1]);
    editor.setSelectionRange(2, 3);
    await key(editor, 'Enter');
    expect(currentDocument.sections.features.text).toBe('ab\nd\nxy\nlast');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 2');
    expect(editor.value).toBe('d');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 0]);
    await key(editor, 'Backspace');
    expect(currentDocument.sections.features.text).toBe('abd\nxy\nlast');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 2]);
    editor.setSelectionRange(3, 3);
    await key(editor, 'Delete');
    expect(currentDocument.sections.features.text).toBe('abdxy\nlast');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 3]);
    await click(line(1));
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 2');
    editor.setSelectionRange(editor.value.length, editor.value.length);
    await key(editor, 'Enter');
    expect(currentDocument.sections.features.text).toBe('abdxy\nlast\n');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 3');
    expect(editor.value).toBe('');
    await key(editor, 'Escape');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelectorAll('.ps-note-line')).toHaveLength(3);
    expect(currentDocument.sections.features.text).toBe('abdxy\nlast\n');
  });

  it('formats only selected note text with toolbar and keyboard shortcuts while preserving safe source markup', async () => {
    await controls(<Note section="features" heading="Умения" />);
    await click(labelled<HTMLButtonElement>('Редактировать: Умения'));
    const editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    expect(editor.closest('.ps-note-body')).not.toBeNull();
    expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
    await input(editor, 'Смелый тихий забытый <img src=x onerror=alert(1)>');
    editor.setSelectionRange(0, 'Смелый'.length);
    const bold = labelled<HTMLButtonElement>('Полужирный текст');
    await act(async () => bold.focus());
    expect(labelled<HTMLTextAreaElement>('Текст: Умения, строка 1')).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 6]);
    await click(bold);
    expect(editor.value).toBe('**Смелый** тихий забытый <img src=x onerror=alert(1)>');
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([10, 10]);
    const italicStart = editor.value.indexOf('тихий');
    editor.setSelectionRange(italicStart, italicStart + 'тихий'.length);
    const shortcut = new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => editor.dispatchEvent(shortcut));
    expect(shortcut.defaultPrevented).toBe(true);
    expect(editor.value).toContain('**Смелый** _тихий_ забытый');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([italicStart + 7, italicStart + 7]);
    const strikeStart = editor.value.indexOf('забытый');
    editor.setSelectionRange(strikeStart, strikeStart + 'забытый'.length);
    await click(labelled<HTMLButtonElement>('Зачёркнутый текст'));
    const formatted = '**Смелый** _тихий_ ~~забытый~~ <img src=x onerror=alert(1)>';
    expect(editor.value).toBe(formatted);
    await click(button('Готово'));
    const note = container.querySelector('.ps-note-text')!;
    expect(note.querySelector('strong')?.textContent).toBe('Смелый');
    expect(note.querySelector('em')?.textContent).toBe('тихий');
    expect(note.querySelector('s')?.textContent).toBe('забытый');
    expect(note.querySelector('img')).toBeNull();
    expect(note.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(currentDocument.sections.features.text).toBe(formatted);
    expect(savePaperSheet(currentDocument)).toEqual({});
    expect(loadPaperSheet().document.sections.features.text).toBe(formatted);
  });

  it('formats a selection on a later line and pastes multiple lines without losing the surrounding source', async () => {
    const sheet = createPaperSheet();
    sheet.sections.features = { text: 'Верх {{8 + [PROF] + [WIS]}}\nДо слово после\nНиз {{ресурс:Кости|2|3}}', fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    await click(container.querySelectorAll<HTMLElement>('.ps-note-line')[1]);
    let editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 2');
    editor.setSelectionRange(3, 8);
    await click(labelled<HTMLButtonElement>('Полужирный текст'));
    expect(editor.value).toBe('До **слово** после');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([12, 12]);
    expect(currentDocument.sections.features.text).toBe('Верх {{8 + [PROF] + [WIS]}}\nДо **слово** после\nНиз {{ресурс:Кости|2|3}}');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, 'До **слово**\nновая строка после');
      const caret = 'До **слово**\nновая строка'.length;
      editor.setSelectionRange(caret, caret);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentDocument.sections.features.text).toBe('Верх {{8 + [PROF] + [WIS]}}\nДо **слово**\nновая строка после\nНиз {{ресурс:Кости|2|3}}');
    editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 3');
    expect(editor.value).toBe('новая строка после');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual(['новая строка'.length, 'новая строка'.length]);
    expect(container.querySelector('.ps-inline-formula')?.textContent).toBe('10');
    expect(container.querySelector('.ps-resource')?.textContent).toContain('2 / 3');
  });

  it('restores the caret after replacing a formula with the same token and does not move it again on the next keystroke', async () => {
    const token = '{{8 + [PROF] + [WIS]}}';
    const source = `До ${token} после`;
    const sheet = createPaperSheet();
    sheet.sections.features = { text: source, fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    await click(labelled<HTMLButtonElement>('Редактировать: Умения'));
    const editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    const end = 3 + token.length;
    editor.setSelectionRange(3, end);
    const formula = button('ƒ Формула');
    await act(async () => formula.focus());
    await click(formula);
    expect(editor.value).toBe(source);
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([end, end]);
    const next = `${source.slice(0, end)}!${source.slice(end)}`;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, next);
      editor.setSelectionRange(end + 1, end + 1);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentDocument.sections.features.text).toBe(next);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([end + 1, end + 1]);
  });

  it('reactivates the same first line from the pencil without leaving a stale caret for the next edit', async () => {
    const sheet = createPaperSheet();
    sheet.sections.features = { text: 'До после', fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    const pencil = labelled<HTMLButtonElement>('Редактировать: Умения');
    await click(pencil);
    const editor = labelled<HTMLTextAreaElement>('Текст: Умения, строка 1');
    editor.setSelectionRange(3, 3);
    await act(async () => pencil.focus());
    await click(pencil);
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 3]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, 'До !после');
      editor.setSelectionRange(4, 4);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(currentDocument.sections.features.text).toBe('До !после');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 4]);
  });

  it('changes the chosen note resource within its bounds and preserves the other resource through save/reload', async () => {
    const sheet = createPaperSheet();
    sheet.sections.features = { text: '{{ресурс:Ярость|2|2}} и {{ресурс:Кости|1|4}}', fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    await click(labelled<HTMLButtonElement>('Потратить: Ярость'));
    await click(labelled<HTMLButtonElement>('Потратить: Ярость'));
    await click(labelled<HTMLButtonElement>('Потратить: Ярость'));
    expect(currentDocument.sections.features.text).toBe('{{ресурс:Ярость|0|2}} и {{ресурс:Кости|1|4}}');
    await click(labelled<HTMLButtonElement>('Добавить: Кости'));
    expect(currentDocument.sections.features.text).toBe('{{ресурс:Ярость|0|2}} и {{ресурс:Кости|2|4}}');
    expect(container.querySelector('dialog')).toBeNull();
    savePaperSheet(currentDocument);
    expect(loadPaperSheet().document.sections.features.text).toBe(currentDocument.sections.features.text);
  });

  it('lets keyboard activation reach a nested resource button without opening the note editor', async () => {
    const sheet = createPaperSheet();
    sheet.sections.features = { text: '{{ресурс:Ярость|2|2}}', fontSize: 12 };
    await controls(<Note section="features" heading="Умения" />, sheet);
    const spend = labelled<HTMLButtonElement>('Потратить: Ярость');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => { spend.focus(); spend.dispatchEvent(enter); });
    expect(enter.defaultPrevented).toBe(false);
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('renders four document pages and persists training changes with calculated skill bonuses', async () => {
    await renderPage();
    expect(container.querySelectorAll('article.paper-page')).toHaveLength(4);
    expect(labelled('Сила').value).toBe('10');
    expect(labelled('Бонус: Атлетика').value).toBe('+0');
    await click(labelled<HTMLButtonElement>('Владение: Атлетика'));
    expect(labelled('Бонус: Атлетика').value).toBe('+2');
    await click(labelled<HTMLButtonElement>('Владение: Атлетика'));
    expect(labelled('Бонус: Атлетика').value).toBe('+4');
    expect(loadPaperSheet().document.training.athletics).toBe(2);
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(labelled('Бонус: Атлетика').value).toBe('+4');
    await click(labelled<HTMLButtonElement>('Владение: Атлетика'));
    expect(labelled('Бонус: Атлетика').value).toBe('+0');
  });

  it('never overwrites an unreadable saved document during StrictMode effect replay', async () => {
    const original = '{this is a recoverable backup';
    localStorage.setItem(PAPER_SHEET_STORAGE_KEY, original);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await renderPage(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Не удалось загрузить/);
    expect(localStorage.getItem(PAPER_SHEET_STORAGE_KEY)).toBe(original);
    expect(writes).not.toHaveBeenCalled();
  });

  it('keeps edits visible and the previous persisted document intact when browser storage is full', async () => {
    const sheet = createPaperSheet();
    sheet.fields.name = 'До изменения';
    savePaperSheet(sheet);
    const original = localStorage.getItem(PAPER_SHEET_STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    await renderPage();
    await input(labelled('Имя персонажа'), 'Новое имя');
    expect(labelled('Имя персонажа').value).toBe('Новое имя');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Скачать копию');
    expect(localStorage.getItem(PAPER_SHEET_STORAGE_KEY)).toBe(original);
  });

  it('validates imported JSON before offering replacement, and commits only after confirmation', async () => {
    const current = createPaperSheet();
    current.fields.name = 'Текущий';
    savePaperSheet(current);
    await renderPage();
    await importFile('{"version":1,"fields":{"level":false}}');
    expect(labelled('Имя персонажа').value).toBe('Текущий');
    expect(loadPaperSheet().document.fields.name).toBe('Текущий');
    expect(container.querySelector('dialog')).toBeNull();
    const imported = createPaperSheet();
    imported.fields.name = 'Импортированный';
    imported.fields.ac = '=10 + [DEX]';
    await importFile(exportPaperSheet(imported));
    expect(container.querySelector('dialog')?.textContent).toContain('Импортированный');
    expect(loadPaperSheet().document.fields.name).toBe('Текущий');
    await click(labelled<HTMLButtonElement>('Закрыть окно'));
    expect(labelled('Имя персонажа').value).toBe('Текущий');
    await importFile(exportPaperSheet(imported));
    await click(button('Загрузить'));
    expect(labelled('Имя персонажа').value).toBe('Импортированный');
    expect(loadPaperSheet().document.fields.ac).toBe('=10 + [DEX]');
  });

  it('prints all pages plus full overflowing notes without changing the sheet or selected tab', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (s: string) => ({ width: s.length * 7 }) } as never);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('ps-note-text') ? 200 : 100; });
    const print = vi.spyOn(window, 'print').mockImplementation(() => { window.dispatchEvent(new Event('beforeprint')); });
    const sheet = createPaperSheet();
    sheet.sections.features = { text: 'Длинная заметка, которая не помещается в печатный блок.', fontSize: 12 };
    savePaperSheet(sheet);
    const original = localStorage.getItem(PAPER_SHEET_STORAGE_KEY);
    await renderPage();
    await click(container.querySelectorAll<HTMLButtonElement>('.ps-page-tabs button')[1]);
    expect(container.querySelectorAll('.ps-page-hidden')).toHaveLength(3);
    await click(button('Печать'));
    expect(container.querySelectorAll('.ps-page-hidden')).toHaveLength(3);
    expect(print).not.toHaveBeenCalled();
    expect(container.querySelector('dialog')).toBeNull();
    await act(async () => frames.shift()!(performance.now()));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.ps-print-snapshot .paper-page')).toHaveLength(5);
    expect(document.querySelector('.ps-print-appendix')?.textContent).toContain(sheet.sections.features.text);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('.ps-print-snapshot')).toBeNull();
    expect(localStorage.getItem(PAPER_SHEET_STORAGE_KEY)).toBe(original);
  });
});
