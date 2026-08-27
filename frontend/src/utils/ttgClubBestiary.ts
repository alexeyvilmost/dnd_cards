import { API_BASE_URL } from '../api/client';
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

export type TtgImportErrorKind = 'invalid_url' | 'upstream' | 'schema';

export class TtgImportError extends Error {
  constructor(readonly kind: TtgImportErrorKind, message: string) {
    super(message);
    this.name = 'TtgImportError';
  }
}

interface TtgBestiaryLocation {
  slug: string;
  sourceUrl: string;
}

interface AdapterAction {
  kind: 'action' | 'bonus_action' | 'reaction' | 'legendary_action';
  name: string;
  description: string[];
}

interface AdapterPayload {
  slug: string;
  source_url: string;
  name: string;
  ac: number;
  max_hp: number;
  initiative_bonus: number;
  actions: AdapterAction[];
  statblock: StatBlock;
}

const SUPPORTED_HOSTS = new Set(['new.ttg.club', 'ttg.club']);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

function invalidUrl(): never {
  throw new TtgImportError(
    'invalid_url',
    'Вставьте ссылку на существо с new.ttg.club/bestiary',
  );
}

export function parseTtgClubBestiaryUrl(url: string): TtgBestiaryLocation {
  const trimmed = url.trim();
  if (!trimmed) return invalidUrl();
  const normalized = /^(?:https?):\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return invalidUrl();
  }
  if (!SUPPORTED_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    return invalidUrl();
  }

  const pathMatch = parsed.pathname.match(/^\/bestiary\/([^/]+)\/?$/);
  const querySlug = parsed.pathname.replace(/\/+$/, '') === '/bestiary'
    ? parsed.searchParams.get('detail')
    : null;
  let slug: string;
  try {
    slug = decodeURIComponent(pathMatch?.[1] ?? querySlug ?? '').toLowerCase();
  } catch {
    return invalidUrl();
  }
  if (!SLUG_PATTERN.test(slug)) return invalidUrl();
  return {
    slug,
    sourceUrl: `https://new.ttg.club/bestiary?detail=${encodeURIComponent(slug)}`,
  };
}

export function isTtgClubBestiaryUrl(url: string): boolean {
  try {
    parseTtgClubBestiaryUrl(url);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new TtgImportError('schema', `Некорректное поле ${path} в ответе TTG`);
  }
  return value;
}

function requireInteger(value: unknown, path: string, positive = false): number {
  if (!Number.isInteger(value) || (positive && Number(value) <= 0)) {
    throw new TtgImportError('schema', `Некорректное поле ${path} в ответе TTG`);
  }
  return Number(value);
}

function parseAdapterAction(value: unknown, index: number): AdapterAction {
  if (!isRecord(value)) {
    throw new TtgImportError('schema', `Некорректное действие actions[${index}] в ответе TTG`);
  }
  const allowedKinds = new Set<AdapterAction['kind']>([
    'action', 'bonus_action', 'reaction', 'legendary_action',
  ]);
  const kind = requireString(value.kind, `actions[${index}].kind`) as AdapterAction['kind'];
  if (!allowedKinds.has(kind)) {
    throw new TtgImportError('schema', `Неизвестный тип действия ${kind} в ответе TTG`);
  }
  if (!Array.isArray(value.description)) {
    throw new TtgImportError('schema', `Некорректное поле actions[${index}].description в ответе TTG`);
  }
  return {
    kind,
    name: requireString(value.name, `actions[${index}].name`).trim(),
    description: value.description.map((description, descriptionIndex) => (
      requireString(description, `actions[${index}].description[${descriptionIndex}]`).trim()
    )),
  };
}

function parseStatBlock(value: unknown): StatBlock {
  if (!isRecord(value)) {
    throw new TtgImportError('schema', 'Некорректный статблок в ответе TTG');
  }
  const result: StatBlock = {};
  for (const key of [
    'speed', 'senses', 'languages', 'cr', 'vulnerabilities', 'resistances',
    'immunities', 'saves', 'skills',
  ] as const) {
    if (value[key] !== undefined) result[key] = requireString(value[key], `statblock.${key}`, true);
  }
  if (value.abilities !== undefined) {
    if (!isRecord(value.abilities)) {
      throw new TtgImportError('schema', 'Некорректные характеристики в ответе TTG');
    }
    const abilities: NonNullable<StatBlock['abilities']> = {};
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityKey[]) {
      const source = value.abilities[key];
      if (source === undefined) continue;
      if (!isRecord(source)) {
        throw new TtgImportError('schema', `Некорректная характеристика ${key} в ответе TTG`);
      }
      abilities[key] = {
        score: requireInteger(source.score, `statblock.abilities.${key}.score`),
        mod: requireInteger(source.mod, `statblock.abilities.${key}.mod`),
        save: requireInteger(source.save, `statblock.abilities.${key}.save`),
      };
    }
    result.abilities = abilities;
  }
  return result;
}

function parseAdapterPayload(value: unknown): AdapterPayload {
  if (!isRecord(value) || !Array.isArray(value.actions)) {
    throw new TtgImportError('schema', 'TTG вернул данные неизвестного формата');
  }
  return {
    slug: requireString(value.slug, 'slug'),
    source_url: requireString(value.source_url, 'source_url'),
    name: requireString(value.name, 'name').trim(),
    ac: requireInteger(value.ac, 'ac', true),
    max_hp: requireInteger(value.max_hp, 'max_hp', true),
    initiative_bonus: requireInteger(value.initiative_bonus, 'initiative_bonus'),
    actions: value.actions.map(parseAdapterAction),
    statblock: parseStatBlock(value.statblock),
  };
}

/**
 * Разворачивает разметку ttg.club / 5etools вида {@tag содержимое} в читаемый текст.
 * Броски, ссылки и значения урона сохраняются, а не удаляются вместе с тегами.
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
      case 'h':
        return '';
      case 'hit':
      case 'atkr':
        return /^-/.test(first) ? first : first.replace(/^\+?/, '+');
      case 'dc':
      case 'roll':
      case 'dice':
      case 'damage':
        return first;
      default:
        return (parts.length > 2 ? parts[parts.length - 1] : first).trim();
    }
  };

  let output = text;
  for (let guard = 0; /\{@/.test(output) && guard < 5; guard += 1) {
    const next = output.replace(tagPattern, resolveTag);
    if (next === output) break;
    output = next;
  }
  return output.replace(/\s+/g, ' ').trim();
}

function actionsDescription(actions: AdapterAction[]): string {
  const labels: Partial<Record<AdapterAction['kind'], string>> = {
    bonus_action: 'Бонусное действие',
    reaction: 'Реакция',
    legendary_action: 'Легендарное действие',
  };
  return actions.map((action) => {
    const label = labels[action.kind];
    const heading = label ? `${label}: ${action.name}` : action.name;
    const body = action.description.map(cleanTtgMarkup).filter(Boolean);
    return [heading, ...body].join('\n');
  }).join('\n\n');
}

async function errorPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export async function importFromTtgClubUrl(url: string): Promise<TtgClubBestiaryImport> {
  const location = parseTtgClubBestiaryUrl(url);
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/integrations/ttg/bestiary/${encodeURIComponent(location.slug)}`,
      { headers: { Accept: 'application/json' } },
    );
  } catch {
    throw new TtgImportError('upstream', 'Не удалось связаться с TTG');
  }
  if (!response.ok) {
    const body = await errorPayload(response);
    const code = typeof body.code === 'string' ? body.code : '';
    if (code === 'ttg_schema_invalid') {
      throw new TtgImportError('schema', 'TTG изменил формат статблока; импорт временно недоступен');
    }
    if (code === 'ttg_not_found') {
      throw new TtgImportError('upstream', 'Существо не найдено в TTG');
    }
    throw new TtgImportError('upstream', 'TTG временно недоступен');
  }

  let raw: unknown;
  try {
    raw = await response.json() as unknown;
  } catch {
    throw new TtgImportError('schema', 'TTG вернул данные неизвестного формата');
  }
  const payload = parseAdapterPayload(raw);
  if (payload.slug !== location.slug) {
    throw new TtgImportError('schema', 'TTG вернул статблок другого существа');
  }
  return {
    name: payload.name,
    ac: payload.ac,
    maxHp: payload.max_hp,
    initiativeBonus: payload.initiative_bonus,
    description: actionsDescription(payload.actions),
    sourceUrl: payload.source_url || location.sourceUrl,
    statblock: payload.statblock,
  };
}
