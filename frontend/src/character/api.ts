import { ApiRequestError, apiClient } from '../api/client';
import { cached } from '../api/apiCache';
import type { EngineEvent } from '../mvp/contracts';
import type { ForgeCharacter, SaveForgeCharacterRequest } from './types';

export const CHARACTER_V3_ACCESS_ERROR_EVENT = 'dnd-cards:character-v3-access-error';

export type CharacterV3Operation =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'read_events'
  | 'write_events'
  | 'runtime'
  | 'runtime_command';

export interface CharacterV3AccessErrorDetail {
  status: 401 | 403;
  operation: CharacterV3Operation;
  message: string;
}

export class CharacterV3AccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly operation: CharacterV3Operation,
  ) {
    super(message);
    this.name = 'CharacterV3AccessError';
  }
}

const FORBIDDEN_MESSAGES: Readonly<Record<CharacterV3Operation, string>> = {
  list: 'Нет доступа к списку персонажей.',
  get: 'Нет доступа к этому персонажу.',
  create: 'Нет прав на создание персонажа.',
  update: 'Нет прав на изменение этого персонажа.',
  delete: 'Нет прав на удаление этого персонажа.',
  read_events: 'Нет доступа к журналу этого персонажа.',
  write_events: 'Нет прав на изменение журнала этого персонажа.',
  runtime: 'Нет прав на изменение состояния этого персонажа.',
  runtime_command: 'Нет прав на атомарную команду состояния.',
};

function requestStatus(error: unknown): number | undefined {
  if (error instanceof ApiRequestError) return error.status;
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === 'number') return candidate.status;
  return typeof candidate.response?.status === 'number'
    ? candidate.response.status
    : undefined;
}

function notifyAccessError(error: CharacterV3AccessError): void {
  if (typeof window === 'undefined') return;
  const detail: CharacterV3AccessErrorDetail = {
    status: error.status,
    operation: error.operation,
    message: error.message,
  };
  window.dispatchEvent(new CustomEvent<CharacterV3AccessErrorDetail>(
    CHARACTER_V3_ACCESS_ERROR_EVENT,
    { detail },
  ));
}

async function characterV3Request<T>(
  operation: CharacterV3Operation,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const status = requestStatus(error);
    if (status !== 401 && status !== 403) throw error;
    const accessError = new CharacterV3AccessError(
      status === 401
        ? 'Сессия истекла. Войдите снова и повторите действие.'
        : FORBIDDEN_MESSAGES[operation],
      status,
      operation,
    );
    notifyAccessError(accessError);
    throw accessError;
  }
}

/** Friendly inline text for screens that already own an error region. */
export function characterV3ErrorMessage(error: unknown, fallback: string): string {
  return error instanceof CharacterV3AccessError ? error.message : fallback;
}

export interface CharacterEventRow {
  id: string;
  character_id: string;
  client_event_id?: string;
  ts: string;
  type: string;
  payload: EngineEvent;
  created_at?: string;
}

export interface CreateCharacterEventItem {
  client_event_id?: string;
  ts?: string;
  type: string;
  payload: EngineEvent;
}

export function withClientEventIds(events: CreateCharacterEventItem[]): CreateCharacterEventItem[] {
  return events.map((event) => ({
    ...event,
    client_event_id: event.client_event_id ?? createClientEventId(),
  }));
}

function createClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // UUID v4-compatible fallback for older WebViews. Randomness is sufficient
  // for an idempotency key; the database remains the final uniqueness guard.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

// API новой системы персонажей (characters_v3). Весь surface защищён строгой
// JWT-аутентификацией; 403 означает отсутствие ownership/write-доступа.
export const charactersV3Api = {
  list: (): Promise<ForgeCharacter[]> => cached(
    '/api/characters-v3',
    0,
    () => characterV3Request('list', async () => {
      const { data } = await apiClient.get<ForgeCharacter[]>('/api/characters-v3');
      return data ?? [];
    }),
  ),
  get: (id: string): Promise<ForgeCharacter> => characterV3Request('get', async () => {
    const { data } = await apiClient.get<ForgeCharacter>(`/api/characters-v3/${id}`);
    return data;
  }),
  create: (payload: SaveForgeCharacterRequest): Promise<ForgeCharacter> => characterV3Request('create', async () => {
    const { data } = await apiClient.post<ForgeCharacter>('/api/characters-v3', payload);
    return data;
  }),
  update: (id: string, payload: SaveForgeCharacterRequest): Promise<ForgeCharacter> => characterV3Request('update', async () => {
    const { data } = await apiClient.put<ForgeCharacter>(`/api/characters-v3/${id}`, payload);
    return data;
  }),
  remove: (id: string): Promise<void> => characterV3Request('delete', async () => {
    await apiClient.delete(`/api/characters-v3/${id}`);
  }),
  getEvents: (characterId: string): Promise<CharacterEventRow[]> => characterV3Request('read_events', async () => {
    const { data } = await apiClient.get<CharacterEventRow[]>(`/api/characters-v3/${characterId}/events`);
    return data ?? [];
  }),
  postEvents: (characterId: string, events: CreateCharacterEventItem[]): Promise<CharacterEventRow[]> => characterV3Request('write_events', async () => {
    const payload = { events: withClientEventIds(events) };
    const { data } = await apiClient.post<CharacterEventRow[]>(`/api/characters-v3/${characterId}/events`, payload);
    return data ?? [];
  }),
  patchRuntime: (characterId: string, payload: PatchCharacterRuntimeRequest): Promise<ForgeCharacter> => characterV3Request('runtime', async () => {
    const { data } = await apiClient.patch<ForgeCharacter>(`/api/characters-v3/${characterId}/runtime`, payload);
    return data;
  }),
  postRuntimeCommand: (
    payload: CharacterRuntimeCommandRequest,
  ): Promise<CharacterRuntimeCommandResponse> => characterV3Request('runtime_command', async () => {
    const { data } = await apiClient.post<CharacterRuntimeCommandResponse>(
      '/api/characters-v3/runtime-commands',
      payload,
    );
    return data;
  }),
  uploadAvatar: (characterId: string, file: File): Promise<string> => characterV3Request('update', async () => {
    const body = new FormData();
    body.append('image', file);
    const { data } = await apiClient.post<{ success: boolean; image_url: string }>(
      `/api/characters-v3/${characterId}/avatar`,
      body,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data.image_url;
  }),
};

export interface PatchCharacterRuntimeRequest {
  expected_runtime_revision?: number;
  current_hp?: number;
  max_hp?: number;
  equipment?: Record<string, string | null>;
  inventory_items?: Array<{ card_id: string; qty: number; container_id?: string }>;
  resources?: Record<string, number>;
  max_resources?: Record<string, number>;
  active_effects?: unknown[];
  turn_state?: Record<string, unknown>;
  currency?: Record<string, number>;
}

export interface CharacterRuntimeCommandRulesetRef {
  system_id: string;
  release_id: string;
  content_hash: string;
  errata_version: string;
}

export type CharacterRuntimeCommandPatch = Pick<
  PatchCharacterRuntimeRequest,
  | 'current_hp'
  | 'inventory_items'
  | 'resources'
  | 'max_resources'
  | 'active_effects'
  | 'turn_state'
  | 'currency'
>;

export interface CharacterRuntimeCommandParticipant {
  character_id: string;
  expected_runtime_revision: number;
  patch: CharacterRuntimeCommandPatch;
}

export interface CharacterRuntimeCommandEvent {
  character_id: string;
  type: EngineEvent['type'];
  payload: EngineEvent;
}

export interface CharacterRuntimeCommandRequest {
  command_id: string;
  ruleset_ref: CharacterRuntimeCommandRulesetRef;
  participants: CharacterRuntimeCommandParticipant[];
  events: CharacterRuntimeCommandEvent[];
}

export interface CharacterRuntimeCommandResponse {
  command_id: string;
  replayed: boolean;
  participants: Array<{
    character_id: string;
    runtime_revision: number;
    character: ForgeCharacter;
  }>;
}
