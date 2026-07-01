import { apiClient } from '../api/client';
import type { ForgeCharacter, SaveForgeCharacterRequest } from './types';

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
};
