export interface DndSuBestiaryImport {
  name: string;
  ac: number;
  maxHp: number;
  description: string;
  sourceUrl: string;
}

const SUPPORTED_HOSTS = new Set(['next.dnd.su', 'dnd.su', '5e14.dnd.su']);

export function isDndSuBestiaryUrl(url: string): boolean {
  try {
    const parsed = normalizeDndSuUrl(url);
    const host = new URL(parsed).hostname;
    return SUPPORTED_HOSTS.has(host) && /\/bestiary\/\d+/.test(new URL(parsed).pathname);
  } catch {
    return false;
  }
}

export function normalizeDndSuUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('Укажите ссылку');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

function resolveProxyPath(url: string): string {
  const normalized = normalizeDndSuUrl(url);
  return `/proxy/dnd-su-import?url=${encodeURIComponent(normalized)}`;
}

export async function fetchDndSuBestiaryHtml(url: string): Promise<string> {
  const normalized = normalizeDndSuUrl(url);
  const proxyPath = resolveProxyPath(normalized);
  const response = await fetch(proxyPath, {
    headers: { Accept: 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить страницу (${response.status})`);
  }
  return response.text();
}

function parseName(doc: Document): string {
  const copySpan = doc.querySelector('.card-title [data-copy]');
  const raw = copySpan?.getAttribute('data-copy')
    ?? copySpan?.textContent
    ?? doc.querySelector('.card-title')?.textContent
    ?? doc.querySelector('title')?.textContent?.split('/')[0]?.trim()
    ?? 'Без имени';

  const bracket = raw.indexOf('[');
  return (bracket > 0 ? raw.slice(0, bracket) : raw).trim();
}

function parseAc(doc: Document): number {
  const acBlock = doc.querySelector('.subsection-ac');
  const sources = [
    acBlock?.textContent ?? '',
    doc.body.textContent ?? '',
  ];
  for (const text of sources) {
    const match = text.match(/Класс\s+Защиты\s*(\d+)/i);
    if (match) return parseInt(match[1], 10);
  }
  throw new Error('Не найден класс доспеха на странице');
}

function parseMaxHp(doc: Document): number {
  const hpLi = Array.from(doc.querySelectorAll('li')).find((li) => li.textContent?.includes('Хиты'));
  const middle = hpLi?.querySelector('[data-type="middle"]')?.textContent?.trim();
  if (middle) {
    const value = parseInt(middle, 10);
    if (!Number.isNaN(value)) return value;
  }

  const text = hpLi?.textContent ?? '';
  const match = text.match(/Хиты\s*(\d+)/i);
  if (!match) throw new Error('Не найдены хиты на странице');
  return parseInt(match[1], 10);
}

function elementToPlainText(element: Element): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    'script, style, svg, .card-menu, .icon-dice, .rolled-hits, .source-plaque, sup, .svg'
  ).forEach((el) => el.remove());

  clone.querySelectorAll('h3, h5, li, p, tr, table').forEach((el) => {
    el.insertAdjacentText('beforebegin', '\n');
  });

  return clone.textContent
    ?.replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() ?? '';
}

function buildDescription(doc: Document): string {
  const body = doc.querySelector('.card__body.new-article')
    ?? doc.querySelector('.card__body')
    ?? doc.querySelector('.card__article-body');

  if (!body) return '';

  const parts: string[] = [];
  const headerNote = doc.querySelector('.card-title')?.textContent?.replace(/\s+/g, ' ').trim();
  if (headerNote) parts.push(headerNote);

  const bodyText = elementToPlainText(body);
  if (bodyText) parts.push(bodyText);

  return parts.join('\n\n');
}

export function parseDndSuBestiaryHtml(html: string, sourceUrl: string): DndSuBestiaryImport {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const name = parseName(doc);
  const ac = parseAc(doc);
  const maxHp = parseMaxHp(doc);
  const description = buildDescription(doc);

  return { name, ac, maxHp, description, sourceUrl };
}

export async function importFromDndSuUrl(url: string): Promise<DndSuBestiaryImport> {
  const normalized = normalizeDndSuUrl(url);
  const html = await fetchDndSuBestiaryHtml(normalized);
  return parseDndSuBestiaryHtml(html, normalized);
}
