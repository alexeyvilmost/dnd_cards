import { apiClient } from '../api/client';
import type { EngineEvent } from '../mvp/contracts';
import type { ForgeCharacter, SaveForgeCharacterRequest } from './types';

export interface CharacterEventRow {
  id: string;
  character_id: string;
  ts: string;
  type: string;
  payload: EngineEvent;
  created_at?: string;
}

export interface CreateCharacterEventItem {
  ts?: string;
  type: string;
  payload: EngineEvent;
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
    const { data } = await apiClient.post<CharacterEventRow[]>(`/api/characters-v3/${characterId}/events`, { events });
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
