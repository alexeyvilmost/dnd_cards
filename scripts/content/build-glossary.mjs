// Convert https://next.dnd.su/glossary/ into the project's editable concept seed.
// Usage: node scripts/content/build-glossary.mjs path/to/glossary.html
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const source = process.argv[2];
if (!source) throw new Error('Pass the saved glossary HTML file');
const document = new JSDOM(fs.readFileSync(source, 'utf8')).window.document;
const entries = [...document.querySelectorAll('.glossary__entry[data-uri]')]
  .filter((element) => element.querySelector('.card__body'));

const slug = (value) => value.toLowerCase().replaceAll('-', '_');
const entryId = (element) => element.dataset.title === 'Приключение'
  ? 'adventure' // The source accidentally uses data-uri="encounter" for both articles.
  : slug(element.dataset.uri);
const known = new Set(entries.map(entryId));
const parentRefs = {
  'three-quarters-cover': 'cover',
  'full-cover': 'cover',
  'total-cover': 'cover',
  'size.tiny': 'size',
  'size.small': 'size',
  'size.medium': 'size',
  'size.large': 'size',
  'size.huge': 'size',
  'size.gargantuan': 'size',
};
const clean = (value) => value.replace(/\s+/g, ' ')
  .replace(/(?<![А-Яа-яЁё])КЗ(?![А-Яа-яЁё])/g, 'КД')
  .replace(/Класс Защиты/g, 'КД')
  .replace(/Следующая таблица/g, 'Следующий перечень')
  .replace(/следующей таблице/g, 'следующем перечне')
  .replace(/расположенной ниже таблице/g, 'перечне ниже')
  .trim();

function inline(node) {
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const content = [...node.childNodes].map(inline).join('');
  if (tag === 'a') {
    const url = new URL(node.getAttribute('href') || '', 'https://next.dnd.su');
    const path = url.pathname.match(/^\/glossary\/([^/]+)\/?$/);
    const target = path && (parentRefs[path[1]] || slug(path[1]));
    if (target && known.has(target)) return `[[${clean(content)}|concept:${target}]]`;
    return content;
  }
  if (tag === 'strong' || tag === 'b' || node.classList.contains('article-body__feature-name')) {
    return `**${content.trim()}**`;
  }
  if (tag === 'em' || tag === 'i') return `*${content.trim()}*`;
  if (tag === 'br') return '\n';
  return content;
}

function table(element) {
  const rows = [...element.querySelectorAll('tr')].map((row) =>
    [...row.children].filter((cell) => /^(TD|TH)$/.test(cell.tagName))
      .map((cell) => clean([...cell.childNodes].map(inline).join(''))));
  const header = rows[0].some((cell) => /<th\b/i.test(element.querySelector('tr')?.innerHTML || ''))
    || (rows.length > 1 && rows[0].length <= 3 &&
      rows[0].every((cell) => !cell.includes('[[') && cell.length < 35));
  const columns = header ? rows.shift() : null;
  return rows.flatMap((cells) => {
    if (!columns && cells.length > 2) return cells.map((cell) => `• ${cell}`);
    if (columns && cells.length > 2) {
      return [`• **${cells[0]}** — ${cells.slice(1).map((cell, i) => `${columns[i + 1]}: ${cell}`).join('; ')}`];
    }
    if (cells.length === 2) return [`• **${cells[0]}** — ${cells[1]}`];
    return cells.map((cell) => `• ${cell}`);
  }).join('\n');
}

function block(element) {
  if (element.tagName === 'TABLE') return table(element);
  if (element.tagName === 'UL') return [...element.children]
    .map((item) => `• ${clean([...item.childNodes].map(inline).join(''))}`).join('\n');
  return clean([...element.childNodes].map(inline).join(''));
}

const concepts = entries.map((element, sort_order) => {
  const heading = [...element.querySelector('h4').childNodes]
    .filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
  const match = heading.match(/^(.*?)\s*\[(.*?)\]$/);
  if (!match) throw new Error(`Unexpected heading: ${heading}`);
  const body = element.querySelector('.card__body');
  const description = [...body.children].map(block).filter(Boolean).join('\n\n')
    .replace(/ +([.,;:!?])/g, '$1').replace(/\*\*\./g, '.**');
  return {
    concept_id: entryId(element),
    name: clean(match[1]),
    name_en: match[2],
    description,
    sort_order,
  };
});
const ids = concepts.map((entry) => entry.concept_id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate concept ID');
const broken = concepts.flatMap((entry) => [...entry.description.matchAll(/\|concept:([^\]]+)\]\]/g)]
  .filter((match) => !known.has(match[1])).map((match) => `${entry.concept_id} -> ${match[1]}`));
if (broken.length) throw new Error(`Broken concept links: ${broken.join(', ')}`);
const output = new URL('../../backend/migrations/glossary_257.json', import.meta.url);
fs.writeFileSync(output, `${JSON.stringify(concepts, null, 2)}\n`);
console.log(`${concepts.length} concepts, ${concepts.reduce((n, entry) => n + [...entry.description.matchAll(/\|concept:/g)].length, 0)} links`);
