// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { buildPrintSnapshot } from './print';
import { createPaperSheet } from './model';

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
