/** REST-клиент онлайн-боёв + аутентифицированный SSE поверх fetch streaming. */
import { API_BASE_URL, apiClient } from '../api/client';
import { readPersistedAuthToken, signalUnauthorized } from '../api/authSession';
import type { Encounter, EncounterState, Combatant, EncounterEvent, BattleLogEntry } from './encounterTypes';

export interface ApplyOp {
  patches?: { actor_id: string; set?: Record<string, unknown> }[];
  add?: Combatant[];
  remove?: string[];
  round?: number;
  active_index?: number;
  events?: unknown[];
  /** Структурированный журнал: строки боя + адресные записи в журналы персонажей. */
  log?: BattleLogEntry[];
}

export interface EncounterApplyResult {
  seq: number;
  state: EncounterState;
}

/** Bound command writer supplied by useEncounterStream. expectedSeq must be
 * the version of the state snapshot from which the caller built the command. */
export type EncounterApply = (op: ApplyOp, expectedSeq: number) => Promise<EncounterApplyResult>;

export class EncounterStreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EncounterStreamError';
  }
}

export interface EncounterStreamOptions {
  signal: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: EncounterEvent) => void;
}

export interface EncounterInvite {
  token: string;
  expires_at: string;
}

export function encounterInviteUrl(encounterId: string, token: string, origin = globalThis.location?.origin ?? ''): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/encounter/${encodeURIComponent(encounterId)}#invite=${encodeURIComponent(token)}`;
}

export function encounterInviteTokenFromHash(hash = globalThis.location?.hash ?? ''): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get('invite')?.trim() ?? '';
  return token || null;
}

/**
 * Parses only complete SSE frames and returns the unfinished suffix. Exported
 * to keep chunk-boundary/replay behaviour under deterministic unit tests.
 */
export function parseEncounterSSEFrames(input: string): { events: EncounterEvent[]; remainder: string } {
  const events: EncounterEvent[] = [];
  const separator = /\r?\n\r?\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(input)) !== null) {
    const frame = input.slice(cursor, match.index);
    cursor = separator.lastIndex;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line === 'data') data.push('');
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue; // comment/keepalive frame
    try {
      const event = JSON.parse(data.join('\n')) as EncounterEvent;
      if (typeof event.seq === 'number') events.push(event);
    } catch {
      // One malformed server frame must not corrupt the next complete frame.
    }
  }
  return { events, remainder: input.slice(cursor) };
}

async function streamEncounter(id: string, since: number, options: EncounterStreamOptions): Promise<void> {
  const token = readPersistedAuthToken();
  if (!token) {
    signalUnauthorized();
    throw new EncounterStreamError('Требуется авторизация для подключения к бою', 401);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/encounters/${encodeURIComponent(id)}/stream?since=${Math.max(0, Math.trunc(since))}`,
    {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: options.signal,
    },
  );
  if (response.status === 401) signalUnauthorized();
  if (!response.ok) {
    throw new EncounterStreamError(
      response.status === 403 ? 'Нет доступа к этому бою' : 'Не удалось подключиться к потоку боя',
      response.status,
    );
  }
  if (!response.body || !(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
    throw new EncounterStreamError('Сервер не открыл поток событий боя', response.status);
  }

  options.onOpen?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    let streamDone = false;
    while (!streamDone) {
      const next = await reader.read();
      streamDone = next.done;
      if (streamDone) break;
      const value = next.value;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) {
        throw new EncounterStreamError('Поток боя превысил допустимый размер кадра');
      }
      const parsed = parseEncounterSSEFrames(buffer);
      buffer = parsed.remainder;
      for (const event of parsed.events) options.onEvent(event);
    }
    buffer += decoder.decode();
    const parsed = parseEncounterSSEFrames(buffer);
    for (const event of parsed.events) options.onEvent(event);
  } finally {
    reader.releaseLock();
  }
}

export const encountersApi = {
  async list(): Promise<Encounter[]> {
    const r = await apiClient.get<{ encounters: Encounter[] }>('/api/encounters');
    return r.data.encounters ?? [];
  },
  async create(name: string): Promise<Encounter> {
    const r = await apiClient.post<Encounter>('/api/encounters', { name });
    return r.data;
  },
  async get(id: string): Promise<Encounter> {
    const r = await apiClient.get<Encounter>(`/api/encounters/${id}`);
    return r.data;
  },
  /** Owner-only teardown; the server atomically clears CharacterV3 links. */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/api/encounters/${id}`);
  },
  /** Последние события боя (общий журнал) для бэкскролла на доске — хронологический порядок. */
  async getEvents(id: string, limit = 100): Promise<EncounterEvent[]> {
    const r = await apiClient.get<{ events: { seq: number; payload?: EncounterEvent }[] }>(`/api/encounters/${id}/events?limit=${limit}`);
    // Сервер отдаёт EncounterEvent-строки {seq, payload}; разворачиваем payload в плоское событие.
    return (r.data.events ?? []).map((e) => ({ ...(e.payload ?? {}), seq: e.seq } as EncounterEvent));
  },
  async issueInvite(id: string): Promise<EncounterInvite> {
    const r = await apiClient.post<EncounterInvite>(`/api/encounters/${id}/invite`, {});
    return r.data;
  },
  async join(id: string, inviteToken?: string): Promise<Encounter> {
    const r = await apiClient.post<Encounter>(`/api/encounters/${id}/join`, inviteToken ? { invite_token: inviteToken } : {});
    return r.data;
  },
  /** Применить операцию — сервер бампит seq, персистит и рассылает подписчикам. */
  async apply(id: string, expectedSeq: number, op: ApplyOp): Promise<EncounterApplyResult> {
    if (!Number.isSafeInteger(expectedSeq) || expectedSeq < 0) {
      throw new RangeError('expectedSeq must be a non-negative safe integer');
    }
    const r = await apiClient.post<EncounterApplyResult>(`/api/encounters/${id}/apply`, {
      ...op,
      expected_seq: expectedSeq,
    });
    return r.data;
  },
  /** Один authenticated SSE-сеанс; reconnect с актуальным since делает hook. */
  stream(id: string, since: number, options: EncounterStreamOptions): Promise<void> {
    return streamEncounter(id, since, options);
  },
};
