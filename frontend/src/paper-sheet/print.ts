import { paperExtraSections } from './lssExchange';
import type { PaperSheetDocument } from './model';

export interface PrintSection { title: string; text: string }
const plain = (text: string) => text.replace(/\[\[([^\]|]+)\|(?:card|spell):[\w-]+\]\]/g, '$1');

/** Keep the four classic pages; put clipped/hidden content on explicit continuation pages. */
export function printSections(doc: PaperSheetDocument, clipped: string[]): PrintSection[] {
  const result = paperExtraSections(doc);
  for (const key of new Set([...clipped, 'goals', 'treasure'])) {
    const text = doc.sections[key]?.text;
    if (text) result.push({ title: doc.fields[`heading.${key}`] || key, text });
  }
  if (clipped.includes('inventory')) result.push({ title: 'Инвентарь — полный список', text: Object.entries(doc.fields).filter(([k, v]) => /^inventory\.\d+\.item$/.test(k) && v).map(([k, v]) => `${plain(v)} × ${doc.fields[k.replace(/item$/, 'quantity')] || '1'}`).join('\n') });
  if (clipped.includes('weapons')) result.push({ title: 'Оружие и боевые заговоры — полный список', text: Array.from({ length: doc.weaponRows }, (_, i) => ['name', 'bonus', 'damage', 'notes'].map(k => doc.fields[`weapon.${i}.${k}`]).filter(Boolean).join(' · ')).filter(Boolean).join('\n') });
  if (clipped.includes('spells')) result.push({ title: 'Заклинания — полный список', text: Array.from({ length: doc.spellRows }, (_, i) => {
    if (!doc.fields[`spellRow${i}Name`]) return '';
    const text = ['Level', 'Name', 'Time', 'Range', 'Notes'].map(k => doc.fields[`spellRow${i}${k}`]).filter(Boolean);
    for (const [key, name] of [['Concentration', 'концентрация'], ['Ritual', 'ритуал'], ['Material', 'материальный компонент']]) if (doc.checks[`spellRow${i}${key}`]) text.push(name);
    return text.join(' · ');
  }).filter(Boolean).join('\n') });
  return result.filter(s => s.text).map(s => ({ ...s, text: plain(s.text) }));
}

/** Split even a very long unbroken word: no ellipsis and no silently discarded tail. */
export function wrapPrintText(text: string, fits: (line: string) => boolean): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && !fits(line + char)) { result.push(line); line = ''; }
      line += char;
    }
    result.push(line);
  }
  return result;
}

export function buildPrintSnapshot(workspace: HTMLElement, doc: PaperSheetDocument): HTMLElement {
  const host = document.createElement('div');
  host.className = 'paper-sheet ps-print-snapshot';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  try {
    const clipped: string[] = [];
    for (const original of workspace.querySelectorAll<HTMLElement>('.paper-page')) {
      const page = original.cloneNode(true) as HTMLElement;
      page.style.transform = 'none';
      // Capture current input properties, not stale HTML defaultValue attributes.
      const sources = original.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
      page.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea').forEach((control, i) => {
        control.value = sources[i].value;
        if (control instanceof HTMLInputElement) { control.checked = (sources[i] as HTMLInputElement).checked; control.setAttribute('value', control.value); if (control.checked) control.setAttribute('checked', ''); else control.removeAttribute('checked'); }
        if (control instanceof HTMLSelectElement) {
          const source = sources[i] as HTMLSelectElement;
          const label = document.createElement('span');
          label.className = control.className;
          // foreignObject/canvas renderers do not reliably paint a selected <option>.
          const style = getComputedStyle(source);
          for (const property of style) label.style.setProperty(property, style.getPropertyValue(property));
          label.style.display = 'inline-block'; label.style.appearance = 'none';
          label.textContent = source.selectedOptions[0]?.textContent || '';
          control.replaceWith(label);
        }
      });
      host.append(page);
      for (const note of page.querySelectorAll<HTMLElement>('[data-note-section]')) {
        const body = note.querySelector<HTMLElement>('.ps-note-text');
        if (body && (body.scrollHeight > body.clientHeight + 2 || body.scrollWidth > body.clientWidth + 2)) clipped.push(note.dataset.noteSection!);
      }
      for (const [selector, key] of [['.ps-inventory-rows', 'inventory'], ['.ps-spell-table-body', 'spells'], ['.ps-right-block', 'weapons']]) {
        const el = page.querySelector<HTMLElement>(selector);
        if (el && el.scrollHeight > el.clientHeight + 2) clipped.push(key);
      }
      // Single-line fields also have finite space. Preserve their full values in the appendix.
      page.querySelectorAll<HTMLInputElement>('input:not([type=checkbox]):not([type=file]),textarea').forEach(input => {
        if (input.closest('.ps-note') || !input.value || input.scrollWidth <= input.clientWidth + 2) return;
        const key = `overflow.${input.getAttribute('aria-label') || input.name}`;
        clipped.push(key);
        doc = { ...doc, sections: { ...doc.sections, [key]: { text: input.value, fontSize: 11 } }, fields: { ...doc.fields, [`heading.${key}`]: input.getAttribute('aria-label') || 'Полное значение поля' } };
      });
    }
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '15px Arial';
    let appendix: HTMLElement | undefined;
    let count = 58;
    const addLine = (line: string, heading = false) => {
      if (count >= 58) {
        appendix = document.createElement('article'); appendix.className = 'paper-page ps-print-appendix';
        const title = document.createElement('h2'); title.textContent = `${doc.fields.name || 'Персонаж'} — приложение`; appendix.append(title);
        host.append(appendix); count = 0;
      }
      const p = document.createElement('p'); p.textContent = line || '\u00a0'; if (heading) p.className = 'ps-print-section-title'; appendix!.append(p); count++;
    };
    for (const section of printSections(doc, clipped)) {
      if (count > 54) count = 58;
      for (const line of wrapPrintText(section.title, line => context.measureText(line).width <= 750)) addLine(line, true);
      for (const line of wrapPrintText(section.text, line => context.measureText(line).width <= 780)) addLine(line);
      addLine('');
    }
    return host;
  } catch (error) { host.remove(); throw error; }
}

export async function downloadPaperPDF(snapshot: HTMLElement, name: string) {
  const [{ toPng, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  await document.fonts.ready;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const fontEmbedCSS = await getFontEmbedCSS(snapshot);
  const pages = snapshot.querySelectorAll<HTMLElement>('.paper-page');
  for (let i = 0; i < pages.length; i++) {
    const png = await toPng(pages[i], { pixelRatio: 2, width: 880, height: 1272, fontEmbedCSS, backgroundColor: '#ffffff' });
    if (i) pdf.addPage();
    // Preserve aspect ratio (the classic sheet is slightly narrower than A4).
    const width = 297 * 880 / 1272;
    pdf.addImage(png, 'PNG', (210 - width) / 2, 0, width, 297);
  }
  pdf.save(`${name.replace(/[<>:"/\\|?*]/g, '_')}.pdf`);
}
