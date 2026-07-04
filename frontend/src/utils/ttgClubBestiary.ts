import type { AbilityKey, StatBlock } from '../types/initiative';

export interface TtgClubBestiaryImport {
  name: string;
  ac: number;
  maxHp: number;
  /** Бонус к инициативе (например +1). 0, если не найден. */
  initiativeBonus: number;
  description: string;
  sourceUrl: string;
  statblock: StatBlock;
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

/** «Инициатива: +1 (11)» → 1. Знак учитывается, число в скобках (пассивная) игнорируется. */
function parseInitiativeBonus(doc: Document): number {
  const text = doc.body.textContent ?? '';
  const match = text.match(/Инициатива:\s*([+-]?\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/** Значение поля «Метка: значение» из статблока (Скорость, Иммунитеты, ПО …). */
function parseLabeledText(doc: Document, label: string): string | undefined {
  const spans = Array.from(doc.querySelectorAll('span'));
  for (const span of spans) {
    if (span.textContent?.trim() !== `${label}:`) continue;
    let el = span.nextElementSibling;
    while (el && !(el.textContent ?? '').trim()) el = el.nextElementSibling;
    const value = el?.textContent?.trim().replace(/\s+/g, ' ');
    if (value) return value;
  }
  return undefined;
}

/** Характеристики вида «Сил 16+3+3 Лов 8-1-1 …» из текста статблока. */
function parseAbilities(doc: Document): StatBlock['abilities'] {
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ');
  const map: [AbilityKey, string][] = [
    ['str', 'Сил'], ['dex', 'Лов'], ['con', 'Тел'],
    ['int', 'Инт'], ['wis', 'Мдр'], ['cha', 'Хар'],
  ];
  const abilities: NonNullable<StatBlock['abilities']> = {};
  for (const [key, ru] of map) {
    const m = text.match(new RegExp(`${ru}\\s+(\\d+)([+-]\\d+)([+-]\\d+)`));
    if (m) abilities[key] = { score: +m[1], mod: +m[2], save: +m[3] };
  }
  return Object.keys(abilities).length ? abilities : undefined;
}

function parseStatBlock(doc: Document): StatBlock {
  return {
    speed: parseLabeledText(doc, 'Скорость'),
    senses: parseLabeledText(doc, 'Чувства'),
    languages: parseLabeledText(doc, 'Языки'),
    cr: parseLabeledText(doc, 'ПО'),
    vulnerabilities: parseLabeledText(doc, 'Уязвимости'),
    resistances: parseLabeledText(doc, 'Сопротивления'),
    immunities: parseLabeledText(doc, 'Иммунитеты'),
    saves: parseLabeledText(doc, 'Спасброски'),
    skills: parseLabeledText(doc, 'Навыки'),
    abilities: parseAbilities(doc),
  };
}

/** Убирает знак «+» перед числом внутри скобок, чтобы «Инициатива: +1» → +1, а не +1 дважды. */
function signed(value: string): string {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed) && !trimmed.startsWith('-')) return `+${trimmed}`;
  return trimmed;
}

/**
 * Разворачивает разметку ttg.club / 5etools вида {@tag содержимое} в читаемый текст.
 * Раньше {@roll ...} и {@item ...} удалялись целиком вместе со значениями урона и
 * бонусами — из-за этого описание «ломалось» (пустые скобки, пропавшие цифры).
 */
export function cleanTtgMarkup(text: string): string {
  const tagPattern = /\{@(\w+)(?:\s+([^{}]*))?\}/g;

  const resolveTag = (_match: string, tag: string, content = ''): string => {
    const parts = content.split('|');
    const first = (parts[0] ?? '').trim();
    switch (tag) {
      case 'i':
      case 'b':
      case 'italic':
      case 'bold':
      case 'note':
        return content.trim();
      case 'h': // {@h} → «Попадание:» в англ. источнике; на ru-страницах текст уже есть
        return '';
      case 'hit':
      case 'atkr':
        return signed(first);
      case 'dc':
        return first;
      case 'roll':
      case 'dice':
      case 'damage':
        return first; // «+5» из «+5|notation:1d20+5» или «1к6 + 3»
      default:
        // Ссылки: {@item Название|url:...}, {@spell Название|...}, {@creature Название|...}
        // Отображаем текст ссылки (последняя часть, если задана) либо название.
        return (parts.length > 2 ? parts[parts.length - 1] : first).trim();
    }
  };

  let out = text;
  let guard = 0;
  while (/\{@/.test(out) && guard < 5) {
    const next = out.replace(tagPattern, resolveTag);
    if (next === out) break;
    out = next;
    guard += 1;
  }

  return out.replace(/\s+/g, ' ').trim();
}

/** Снимает JSON-экранирование строкового тела действия (\n, \", & и т.п.). */
function unescapeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
}

function parseActionsFromJson(html: string): { name: string; text: string }[] {
  const pattern = /\{"rus":\d+\},"([^"]+)",\[\d+\],"((?:\\.|[^"\\])*)"/g;
  const actions: { name: string; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = unescapeJsonString(match[1]).trim();
    const text = cleanTtgMarkup(unescapeJsonString(match[2]));
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

  const initiativeBonus = parseInitiativeBonus(doc);
  const description = parseActionsFromDom(doc, html);
  const statblock = parseStatBlock(doc);

  return { name, ac, maxHp, initiativeBonus, description, sourceUrl, statblock };
}

export async function importFromTtgClubUrl(url: string): Promise<TtgClubBestiaryImport> {
  const normalized = normalizeTtgClubUrl(url);
  const html = await fetchTtgClubBestiaryHtml(normalized);
  return parseTtgClubBestiaryHtml(html, normalized);
}
