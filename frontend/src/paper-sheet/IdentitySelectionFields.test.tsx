// @vitest-environment jsdom
import { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentitySelectionFields } from './IdentitySelectionFields';
import { PaperSheetContext } from './controls';
import { calculateSheet, createPaperSheet, type PaperSheetDocument } from './model';
import { EntityDetailContext } from '../contexts/entityDetail';

const mocks = vi.hoisted(() => ({ races: vi.fn(), classes: vi.fn(), backgrounds: vi.fn(), preview: vi.fn(), openEntity: vi.fn() }));
vi.mock('../api/client', () => ({ racesApi: { getRaces: mocks.races }, classesApi: { getClasses: mocks.classes }, backgroundsApi: { getBackgrounds: mocks.backgrounds }, cardsApi: {}, spellsApi: {} }));
vi.mock('../components/EntityRefPreview', () => ({ default: (entity: { type: string; id: string }) => { mocks.preview(entity); return <div>Каноничное превью</div>; } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('paper identity autocomplete', () => {
  let root: Root;
  let host: HTMLDivElement;
  let current: PaperSheetDocument;
  const label = <T extends HTMLElement = HTMLInputElement>(name: string) => [...document.querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === name)! as T;
  const option = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent === name)!;
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === name)!;
  const focus = async (name: string) => { await act(async () => label(name).focus()); };
  const click = async (element: HTMLElement) => { await act(async () => element.click()); };
  const input = async (name: string, value: string) => { await act(async () => {
    const element = label(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }); };
  const key = async (name: string, value: string) => { await act(async () => label(name).dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))); };
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.classes.mockResolvedValue({ classes: [
      { id: 'class-a', name: 'Класс А' }, { id: 'class-b', name: 'Класс Б' },
      { id: 'sub-a', name: 'Подкласс А', is_subclass: true, parent_class_id: 'class-a' },
      { id: 'sub-b', name: 'Подкласс Б', is_subclass: true, parent_class_id: 'class-b' },
    ], total: 4 });
    mocks.races.mockResolvedValue({ races: [
      { id: 'species-a', name: 'Вид А' }, { id: 'species-b', name: 'Вид Б' },
      { id: 'subspecies-a', name: 'Подвид А', is_subrace: true, parent_race_id: 'species-a' },
      { id: 'subspecies-b', name: 'Подвид Б', is_subrace: true, parent_race_id: 'species-b' },
    ], total: 4 });
    mocks.backgrounds.mockResolvedValue({ backgrounds: [{ id: 'background-a', name: 'Предыстория А' }], total: 1 });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    function Harness() {
      const [doc, setDoc] = useState(() => { const initial = createPaperSheet(); initial.sections.features = { text: 'Мои записи', fontSize: 12 }; return initial; });
      current = doc;
      const calculations = useMemo(() => calculateSheet(doc), [doc]);
      return <EntityDetailContext.Provider value={{ openEntity: mocks.openEntity, readOnly: true }}><PaperSheetContext.Provider value={{ doc, setDoc, calculations, setField: (key, value) => setDoc(previous => ({ ...previous, fields: { ...previous.fields, [key]: value } })) }}><IdentitySelectionFields /></PaperSheetContext.Provider></EntityDetailContext.Provider>;
    }
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('loads catalog on focus and filters subclasses by the selected parent, including keyboard selection', async () => {
    await focus('Класс');
    expect(mocks.classes).toHaveBeenCalledWith({ page: 1, limit: 100, fields: 'list' });
    expect(option('Подкласс А')).toBeUndefined();
    await key('Класс', 'ArrowDown');
    await key('Класс', 'Enter');
    expect(current.identity?.classId).toBe('class-b');
    await focus('Подкласс');
    expect(option('Подкласс Б')).toBeTruthy();
    expect(option('Подкласс А')).toBeUndefined();
    await click(option('Подкласс Б'));
    expect(current.identity?.subclassId).toBe('sub-b');
    await click(label('Открыть карточку: Подкласс Б'));
    expect(mocks.openEntity).toHaveBeenCalledWith('class', 'sub-b');
    await input('Класс', 'Свой класс');
    expect(current.identity?.classId).toBeUndefined();
    expect(current.identity?.subclassId).toBeUndefined();
    expect(current.fields.class).toBe('Свой класс');
    expect(current.sections.features.text).toBe('Мои записи');
  });

  it('offers only matching subspecies in an accessible dialog and keeps canonical references', async () => {
    await focus('Вид');
    await click(option('Вид А'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(button('Подвид А')).toBeTruthy();
    expect(button('Подвид Б')).toBeUndefined();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await click(button('Подвид А'));
    expect(current.identity).toMatchObject({ speciesId: 'species-a', subspeciesId: 'subspecies-a' });
    expect(label('Вид').value).toBe('Вид А (Подвид А)');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(label('Вид'));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await click(label('Открыть подвид: Подвид А'));
    expect(mocks.openEntity).toHaveBeenCalledWith('race', 'subspecies-a');
    await click(label('Выбрать из каталога: Вид'));
    await click(option('Вид А'));
    await click(button('Без подвида'));
    expect(current.identity?.subspeciesId).toBeUndefined();
    expect(current.fields.subspecies).toBe('');
    expect(label('Вид').value).toBe('Вид А');
  });

  it('allows declining a subspecies and preserves manual entry while catalog errors are retried', async () => {
    await focus('Вид'); await click(option('Вид Б')); await click(button('Без подвида'));
    expect(current.identity?.speciesId).toBe('species-b');
    expect(current.identity?.subspeciesId).toBeUndefined();
    mocks.backgrounds.mockRejectedValueOnce(new Error('Network Error'));
    await focus('Предыстория');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить каталог');
    await input('Предыстория', 'Моя история');
    expect(current.fields.background).toBe('Моя история');
    expect(current.identity?.backgroundId).toBeUndefined();
    await click(button('Повторить загрузку'));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(current.fields.background).toBe('Моя история');
    await key('Предыстория', 'Escape');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('loads every server page before offering child choices and ignores late results after dismissal', async () => {
    mocks.races.mockImplementation(({ page }: { page: number }) => Promise.resolve(page === 1
      ? { races: [{ id: 'species-c', name: 'Вид В' }], total: 2 }
      : { races: [{ id: 'subspecies-c', name: 'Подвид В', parent_race_id: 'species-c' }], total: 2 }));
    await focus('Вид');
    expect(mocks.races).toHaveBeenCalledTimes(2);
    await click(option('Вид В'));
    expect(button('Подвид В')).toBeTruthy();
    await click(button('Без подвида'));
    let resolve!: (value: unknown) => void;
    mocks.classes.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await focus('Класс');
    await key('Класс', 'Escape');
    await act(async () => resolve({ classes: [{ id: 'late', name: 'Поздний ответ' }], total: 1 }));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(current.identity?.classId).toBeUndefined();
  });
});
