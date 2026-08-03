import { apiClient } from '../api/client';
import type { EngineEvent } from '../mvp/contracts';
import type { ForgeCharacter, SaveForgeCharacterRequest } from './types';

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

// API новой системы персонажей (characters_v3). Доступ без авторизации:
// бэкенд подставляет общего пользователя "public", если токена нет.
export const charactersV3Api = {
  list: async (): Promise<ForgeCharacter[]> => {
    const { data } = await apiClient.get<ForgeCharacter[]>('/api/characters-v3');
    return data ?? [];
  },
  get: async (id: string): Promise<ForgeCharacter> => {
    const { data } = await apiClient.get<ForgeCharacter>(`/api/characters-v3/${id}`);
    return data;
  },
  create: async (payload: SaveForgeCharacterRequest): Promise<ForgeCharacter> => {
    const { data } = await apiClient.post<ForgeCharacter>('/api/characters-v3', payload);
    return data;
  },
  update: async (id: string, payload: SaveForgeCharacterRequest): Promise<ForgeCharacter> => {
    const { data } = await apiClient.put<ForgeCharacter>(`/api/characters-v3/${id}`, payload);
    return data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/characters-v3/${id}`);
  },
  getEvents: async (characterId: string): Promise<CharacterEventRow[]> => {
    const { data } = await apiClient.get<CharacterEventRow[]>(`/api/characters-v3/${characterId}/events`);
    return data ?? [];
  },
  postEvents: async (characterId: string, events: CreateCharacterEventItem[]): Promise<CharacterEventRow[]> => {
	const payload = { events: withClientEventIds(events) };
	const { data } = await apiClient.post<CharacterEventRow[]>(`/api/characters-v3/${characterId}/events`, payload);
    return data ?? [];
  },
  patchRuntime: async (characterId: string, payload: PatchCharacterRuntimeRequest): Promise<ForgeCharacter> => {
    const { data } = await apiClient.patch<ForgeCharacter>(`/api/characters-v3/${characterId}/runtime`, payload);
    return data;
  },
};

export interface PatchCharacterRuntimeRequest {
  current_hp?: number;
  max_hp?: number;
  equipment?: Record<string, string | null>;
  inventory_items?: Array<{ card_id: string; qty: number }>;
  resources?: Record<string, number>;
  max_resources?: Record<string, number>;
  active_effects?: unknown[];
  turn_state?: Record<string, unknown>;
  currency?: Record<string, number>;
}
