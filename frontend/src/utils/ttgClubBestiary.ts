export interface TtgClubBestiaryImport {
  name: string;
  ac: number;
  maxHp: number;
  description: string;
  sourceUrl: string;
}

const SUPPORTED_HOSTS = new Set(['new.ttg.club', 'ttg.club']);

export function isTtgClubBestiaryUrl(url: string): boolean {
  try {
    const parsed = normalizeTtgClubUrl(url);
    const { hostname, pathname } = new URL(parsed);
    return SUPPORTED_HOSTS.has(hostname) && /\/bestiary\/[^/]+/.test(pathname);
  } catch {
    return false;
  }
}

export function normalizeTtgClubUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('Укажите ссылку');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

function resolveProxyPath(url: string): string {
  const normalized = normalizeTtgClubUrl(url);
  return `/proxy/ttg-club-import?url=${encodeURIComponent(normalized)}`;
}

export async function fetchTtgClubBestiaryHtml(url: string): Promise<string> {
  const normalized = normalizeTtgClubUrl(url);
  const response = await fetch(resolveProxyPath(normalized), {
    headers: { Accept: 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить страницу (${response.status})`);
  }
  return response.text();
}

function parseName(doc: Document): string {
  const h2 = doc.querySelector('h2')?.textContent?.trim();
  if (h2) return h2;

  const title = doc.querySelector('title')?.textContent?.split('|')[0]?.trim();
  if (title) return title;

  return 'Без имени';
}

function parseStatValue(doc: Document, label: string): number | null {
  const items = Array.from(doc.querySelectorAll('span'));
  for (const nameSpan of items) {
    if (!nameSpan.textContent?.trim().startsWith(`${label}:`)) continue;
    const valueSpan = nameSpan.nextElementSibling;
    const raw = valueSpan?.textContent?.trim() ?? '';
    const match = raw.match(/^(\d+)/);
    if (match) return parseInt(match[1], 10);
  }

  const text = doc.body.textContent ?? '';
  const regex = new RegExp(`${label}:\\s*(\\d+)`, 'i');
  const fallback = text.match(regex);
  return fallback ? parseInt(fallback[1], 10) : null;
}

function cleanTtgMarkup(text: string): string {
  return text
    .replace(/\{@i\s*([^}]+)\}/g, '$1')
    .replace(/\{@b\s*([^}]+)\}/g, '$1')
    .replace(/\{@roll[^}]*\}/g, '')
    .replace(/\{@item[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseActionsFromJson(html: string): { name: string; text: string }[] {
  const pattern = /\{"rus":\d+\},"([^"]+)",\[\d+\],"((?:\\.|[^"\\])*)"/g;
  const actions: { name: string; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = match[1].trim();
    const text = cleanTtgMarkup(match[2]);
    if (!name || !text) continue;
    if (actions.some((a) => a.name === name)) continue;
    actions.push({ name, text });
  }
  return actions;
}

function parseActionsFromDom(doc: Document, html: string): string {
  const headings = Array.from(doc.querySelectorAll('h4'));
  const actionsHeading = headings.find((h) => h.textContent?.trim() === 'Действия');
  const jsonActions = parseActionsFromJson(html);

  if (jsonActions.length > 0) {
    return jsonActions
      .map((a) => `${a.name}\n${a.text}`)
      .join('\n\n');
  }

  if (!actionsHeading) return '';

  const section = actionsHeading.closest('[data-slot="root"]') ?? actionsHeading.parentElement;
  const names = Array.from(section?.querySelectorAll('h5') ?? [])
    .map((h) => h.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean) as string[];

  return names.map((name) => name.replace(/\.\s*$/, '')).join('\n');
}

export function parseTtgClubBestiaryHtml(html: string, sourceUrl: string): TtgClubBestiaryImport {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const name = parseName(doc);
  const ac = parseStatValue(doc, 'КД');
  const maxHp = parseStatValue(doc, 'Хиты');

  if (ac === null) throw new Error('Не найден класс доспеха (КД) на странице');
  if (maxHp === null) throw new Error('Не найдены хиты на странице');

  const description = parseActionsFromDom(doc, html);

  return { name, ac, maxHp, description, sourceUrl };
}

export async function importFromTtgClubUrl(url: string): Promise<TtgClubBestiaryImport> {
  const normalized = normalizeTtgClubUrl(url);
  const html = await fetchTtgClubBestiaryHtml(normalized);
  return parseTtgClubBestiaryHtml(html, normalized);
}
