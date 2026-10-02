// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { buildPrintSnapshot, printSections } from './print';
import { createPaperSheet } from './model';
import { paperIdentitySourceKey } from './identity';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('captures current controls and full clipped linked names without mutating the document', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (s: string) => ({ width: s.length * 7 }) } as never);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(30);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('ps-entity-name') ? 300 : 30; });
  const workspace = document.createElement('div');
  workspace.innerHTML = '<article class="paper-page"><select class="ps-inventory-equip"><option>Надеть</option></select><select><option>d6</option><option>d10</option></select><input aria-label="Хиты" value="5"><input type="checkbox"><div data-paper-field="inventory.0.item" data-paper-label="Предмет 1"><button class="ps-entity-name">Длинное имя</button></div></article>';
  document.body.append(workspace);
  workspace.querySelectorAll('select')[1].value = 'd10';
  workspace.querySelector<HTMLInputElement>('input')!.value = '12';
  workspace.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked = true;
  const doc = createPaperSheet();
  doc.fields['inventory.0.item'] = '[[Длинное имя без потерь|card:11111111-1111-4111-8111-111111111111]]';
  const original = JSON.stringify(doc);
  const snapshot = buildPrintSnapshot(workspace, doc);
  expect(snapshot.querySelectorAll('select')).toHaveLength(0);
  expect(snapshot.querySelector('span.ps-inventory-equip')?.textContent).toBe('Надеть');
  expect(snapshot.textContent).toContain('d10');
  expect(snapshot.querySelector('input')?.getAttribute('value')).toBe('12');
  expect(snapshot.querySelector('input[type=checkbox]')?.hasAttribute('checked')).toBe(true);
  expect(snapshot.querySelector('.ps-print-appendix')?.textContent).toContain('Длинное имя без потерь');
  expect(snapshot.querySelector('.ps-print-appendix')?.textContent).not.toContain('card:');
  expect(JSON.stringify(doc)).toBe(original);
  expect(workspace.querySelectorAll('select')).toHaveLength(2);
});

it('prints the formatted note preview instead of an active multiline editor', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (s: string) => ({ width: s.length * 7 }) } as never);
  const workspace = document.createElement('div');
  workspace.innerHTML = '<article class="paper-page"><section class="ps-note ps-note-editing" data-note-section="features"><div class="ps-note-text">Текст для печати</div><textarea class="ps-inline-textarea">Сырой текст</textarea><div class="ps-inline-tools">Готово</div></section></article>';
  document.body.append(workspace);
  const snapshot = buildPrintSnapshot(workspace, createPaperSheet());
  expect(snapshot.querySelector('.ps-note-editing')).toBeNull();
  expect(snapshot.querySelector('.ps-inline-textarea')).toBeNull();
  expect(snapshot.querySelector('.ps-inline-tools')).toBeNull();
  expect(snapshot.querySelector('.ps-note-text')?.textContent).toBe('Текст для печати');
});

it('preserves clipped generated abilities and hidden origin feats together with manual notes', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (s: string) => ({ width: s.length * 7 }) } as never);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(30);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this: HTMLElement) { return this.classList.contains('ps-note-generated') ? 300 : 30; });
  const workspace = document.createElement('div');
  workspace.innerHTML = '<article class="paper-page"><section class="ps-note" data-note-section="features"><div class="ps-note-generated">Действие класса</div><div class="ps-note-text">Моя заметка</div></section></article>';
  document.body.append(workspace);
  const doc = createPaperSheet();
  doc.identity = { classId: 'class-one', backgroundId: 'background-one' };
  doc.identityFeatures = { key: paperIdentitySourceKey(doc), abilities: [{ type: 'action', id: 'action-one', name: 'Действие класса' }, { type: 'effect', id: 'effect-one', name: 'Особенность подкласса' }], traits: [{ type: 'feat', id: 'feat-one', name: 'Черта предыстории' }] };
  doc.sections.features = { text: 'Моя заметка', fontSize: 11 };
  doc.hiddenBlocks = ['traits'];
  const original = JSON.stringify(doc);
  const appendix = buildPrintSnapshot(workspace, doc).querySelector('.ps-print-appendix');
  for (const text of ['Действие класса', 'Особенность подкласса', 'Моя заметка', 'Черта предыстории']) expect(appendix?.textContent).toContain(text);
  expect(appendix?.textContent).not.toMatch(/\[\[|(?:action|effect|feat):/);
  expect(JSON.stringify(doc)).toBe(original);
});

it('exports hidden filled tables into the print appendix even when no DOM is clipped', () => {
  const doc = createPaperSheet();
  doc.hiddenBlocks = ['inventory', 'weapons', 'prepared-spells'];
  Object.assign(doc.fields, { 'inventory.0.item': '[[Свеча|card:candle]]', 'inventory.0.quantity': '5', 'weapon.0.name': 'Кинжал', 'weapon.0.damage': '1d4 колющий', spellRow0Name: 'Свет', spellRow0Range: 'Касание' });
  const text = printSections(doc, []).map(section => section.text).join('\n');
  expect(text).toContain('Свеча × 5');
  expect(text).toContain('Кинжал · 1d4 колющий');
  expect(text).toContain('Свет · Касание');
});
