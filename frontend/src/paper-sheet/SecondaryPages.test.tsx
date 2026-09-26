// @vitest-environment jsdom

import { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpellPage, StoryPage } from './SecondaryPages';
import { PaperSheetContext } from './controls';
import { calculateSheet, createPaperSheet, exportPaperSheet, importPaperSheet, type PaperSheetDocument } from './model';
import { EntityDetailContext } from '../contexts/entityDetail';
import { parsePaperEntityToken, type PaperLibraryEntity } from './references';
import { MAX_ATTUNED } from '../character/attunement';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), getCard: vi.fn(), openEntity: vi.fn() }));
vi.mock('../api/client', () => ({ cardsApi: { getCard: mocks.getCard }, spellsApi: {} }));
vi.mock('../components/EntityRefPreview', () => ({ default: (entity: { type: string; id: string }) => { mocks.preview(entity); return <div>Каноничное превью</div>; } }));
vi.mock('./LibraryPicker', () => ({ LibraryPicker: ({ onSelect }: { onSelect: (entity: PaperLibraryEntity) => void }) => <div role="dialog"><button type="button" onClick={() => onSelect({ type: 'card', id: 'sword', name: 'Клинок' })}>Выбрать клинок</button><button type="button" onClick={() => onSelect({ type: 'card', id: 'helm', name: 'Шлем' })}>Выбрать шлем</button><button type="button" onClick={() => onSelect({ type: 'spell', id: 'light', name: 'Свет' })}>Выбрать заклинание</button></div> }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('paper sheet inventory, equipment, and spell pages', () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: PaperSheetDocument;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCard.mockImplementation(async (id: string) => ({ id, name: id === 'sword' ? 'Клинок' : 'Шлем', type: id === 'sword' ? 'weapon' : 'helmet', slot: id === 'sword' ? 'one_hand' : 'head', properties: [] }));
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const label = <T extends HTMLElement = HTMLButtonElement>(name: string) => [...container.querySelectorAll<HTMLElement>('[aria-label]')].find(element => element.getAttribute('aria-label') === name)! as T;
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === name)!;
  const click = async (element: HTMLElement) => { await act(async () => element.click()); };
  const input = async (element: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
  const select = async (element: HTMLSelectElement, value: string) => { await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }); };
  async function render(initial = createPaperSheet(), Page = StoryPage) {
    function Harness() {
      const [doc, setDoc] = useState(initial); current = doc;
      const calculations = useMemo(() => calculateSheet(doc), [doc]);
      return <EntityDetailContext.Provider value={{ openEntity: mocks.openEntity, readOnly: true }}><PaperSheetContext.Provider value={{ doc, setDoc, calculations, setField: (key, value) => setDoc(previous => ({ ...previous, fields: { ...previous.fields, [key]: value } })) }}><Page /></PaperSheetContext.Provider></EntityDetailContext.Provider>;
    }
    await act(async () => root.render(<Harness />));
  }

  it('shows the nine equipment slots above the other notes and keeps old replaced-section notes accessible', async () => {
    const doc = createPaperSheet();
    doc.sections.goals = { text: 'Старые цели', fontSize: 12 };
    doc.sections.treasure = { text: 'Старые сокровища', fontSize: 12 };
    await render(doc);
    expect(container.querySelectorAll('.ps-equipment-slot')).toHaveLength(9);
    expect(container.querySelectorAll('.ps-inventory-row')).toHaveLength(28);
    for (const slot of ['Голова', 'Тело', 'Плащ', 'Руки', 'Ноги', 'Рука 1', 'Рука 2', 'Ожерелье', 'Кольцо']) expect(label(`Снаряжение: ${slot}`)).toBeTruthy();
    expect([...container.querySelectorAll('.ps-previous-notes summary')].map(element => element.textContent)).toEqual(['Прежние записи: Цели и задачи', 'Прежние записи: Сокровища']);
    expect(current.sections).toEqual(doc.sections);
  });

  it('promotes the next story block in each column without removing inventory or equipment data', async () => {
    const doc = createPaperSheet();
    doc.hiddenBlocks = ['portrait', 'equipped-items'];
    doc.fields['equipment.head'] = 'Шлем';
    doc.fields['inventory.0.item'] = 'Зелье';
    doc.sections.allies = { text: 'Гильдия', fontSize: 12 };
    await render(doc);
    expect([...container.querySelectorAll('.ps-story-left [data-paper-block]')].map(node => node.getAttribute('data-paper-block'))).toEqual(['inventory']);
    expect([...container.querySelectorAll('.ps-story-right [data-paper-block]')].map(node => node.getAttribute('data-paper-block'))).toEqual(['allies', 'additional']);
    expect(current.fields['equipment.head']).toBe('Шлем');
    expect(current.fields['inventory.0.item']).toBe('Зелье');
    expect(current.sections.allies.text).toBe('Гильдия');
  });

  it('keeps movement fields visible when spell-statistic and slot blocks are hidden', async () => {
    const doc = createPaperSheet();
    doc.hiddenBlocks = ['spell-statistics', 'spell-slots', 'appearance'];
    doc.fields.size = 'large';
    await render(doc, SpellPage);
    expect(label<HTMLSelectElement>('Размер персонажа').value).toBe('large');
    expect(container.querySelector('.ps-spells-top-right .ps-movement-stats')).not.toBeNull();
    expect(container.querySelector('.ps-spell-statistics')).toBeNull();
    expect(container.querySelector('.ps-spell-slots')).toBeNull();
    expect(container.querySelector('.ps-spells-right [data-note-section]')?.getAttribute('data-note-section')).toBe('backstory');
  });

  it('selects canonical inventory items, normalizes quantity, and preserves stable links through export/import', async () => {
    await render();
    await click(label('Из библиотеки: Инвентарь, предмет 1'));
    await click(button('Выбрать клинок'));
    expect(parsePaperEntityToken(current.fields['inventory.0.item'])?.id).toBe('sword');
    expect(current.fields['inventory.0.quantity']).toBe('1');
    await input(label<HTMLInputElement>('Инвентарь, количество 1'), '3.8');
    expect(current.fields['inventory.0.quantity']).toBe('3');
    const item = label('Открыть карточку: Клинок');
    await act(async () => item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(mocks.preview).toHaveBeenCalledWith({ type: 'card', id: 'sword' });
    await click(item);
    expect(mocks.openEntity).toHaveBeenCalledWith('card', 'sword');
    expect(importPaperSheet(exportPaperSheet(current)).fields['inventory.0.item']).toBe(current.fields['inventory.0.item']);
    await input(label<HTMLInputElement>('Инвентарь, количество 1'), '-2');
    expect(current.fields['inventory.0.quantity']).toBe('0');
    expect(label<HTMLSelectElement>('Надеть предмет из строки 1').disabled).toBe(true);
  });

  it('moves inventory quantity into a canonical slot and returns it when removed', async () => {
    await render();
    await click(label('Из библиотеки: Инвентарь, предмет 1'));
    await click(button('Выбрать клинок'));
    await input(label<HTMLInputElement>('Инвентарь, количество 1'), '2');
    await select(label<HTMLSelectElement>('Надеть предмет из строки 1'), 'main_hand');
    expect(current.fields['inventory.0.quantity']).toBe('1');
    expect(parsePaperEntityToken(current.fields['equipment.main_hand'])?.id).toBe('sword');
    await click(label('Снять предмет: Рука 1'));
    expect(current.fields['inventory.0.quantity']).toBe('2');
    expect(current.fields['equipment.main_hand']).toBe('');
  });

  it('returns equipment through the shared unlink control before allowing manual text editing', async () => {
    await render();
    await click(label('Из библиотеки: Снаряжение: Голова'));
    await click(button('Выбрать шлем'));
    expect(parsePaperEntityToken(current.fields['equipment.head'])?.id).toBe('helm');
    await click(label('Убрать ссылку: Снаряжение: Голова'));
    expect(current.fields['equipment.head']).toBe('');
    expect(parsePaperEntityToken(current.fields['inventory.0.item'])?.id).toBe('helm');
    expect(current.fields['inventory.0.quantity']).toBe('1');
    await input(label<HTMLInputElement>('Снаряжение: Голова'), 'Запись от руки');
    expect(current.fields['inventory.0.quantity']).toBe('1');
    expect(parsePaperEntityToken(current.fields['inventory.0.item'])?.id).toBe('helm');
  });

  it('rejects spell selections, prevents removal of occupied rows, and persists added empty rows', async () => {
    const doc = createPaperSheet(); doc.fields.inventoryRows = '1';
    await render(doc);
    await click(label('Из библиотеки: Инвентарь, предмет 1'));
    await click(button('Выбрать шлем'));
    expect(label<HTMLButtonElement>('Убрать пустую строку инвентаря').disabled).toBe(true);
    await click(label('Из библиотеки: Инвентарь, предмет 1'));
    await click(button('Выбрать заклинание'));
    expect(parsePaperEntityToken(current.fields['inventory.0.item'])?.id).toBe('helm');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('выберите предмет');
    await click(label('Добавить строку инвентаря'));
    expect(current.fields.inventoryRows).toBe('2');
    await click(label('Убрать пустую строку инвентаря'));
    expect(current.fields.inventoryRows).toBe('1');
    expect(importPaperSheet(exportPaperSheet(current)).fields.inventoryRows).toBe('1');
  });

  it('caps added attunement slots at the shared character limit', async () => {
    await render(createPaperSheet(), SpellPage);
    for (let index = 1; index < MAX_ATTUNED; index += 1) await click(label('Добавить место настройки'));
    expect(container.querySelectorAll('.ps-attunement-row')).toHaveLength(MAX_ATTUNED);
    expect(current.fields.attunementSlots).toBe(String(MAX_ATTUNED));
    expect(label<HTMLButtonElement>('Добавить место настройки').disabled).toBe(true);
    await click(label('Добавить место настройки'));
    expect(current.fields.attunementSlots).toBe(String(MAX_ATTUNED));
    await click(label('Убрать место настройки'));
    expect(label<HTMLButtonElement>('Добавить место настройки').disabled).toBe(false);
  });

  it('limits legacy attunement display without rewriting saved extra slots or fields', async () => {
    const doc = createPaperSheet();
    doc.fields.attunementSlots = '12';
    doc.fields.attunementName11 = 'Старая запись о предмете';
    doc.checks.attunement11 = true;
    await render(doc, SpellPage);
    expect(container.querySelectorAll('.ps-attunement-row')).toHaveLength(MAX_ATTUNED);
    expect(label<HTMLButtonElement>('Добавить место настройки').disabled).toBe(true);
    expect(current.fields).toEqual(doc.fields);
    expect(current.checks).toEqual(doc.checks);
    const restored = importPaperSheet(exportPaperSheet(current));
    expect(restored.fields.attunementSlots).toBe('12');
    expect(restored.fields.attunementName11).toBe('Старая запись о предмете');
    expect(restored.checks.attunement11).toBe(true);
  });
});
