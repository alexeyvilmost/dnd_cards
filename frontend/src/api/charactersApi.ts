import apiClient from './client';
import type { 
  Character, 
  CreateCharacterRequest, 
  UpdateCharacterRequest, 
  ImportCharacterRequest, 
  ExportCharacterResponse,
  Inventory
} from '../types';

export const charactersApi = {
  // Получение списка персонажей
  getCharacters: async (params?: {
    group_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    characters: Character[];
    total: number;
    limit: number;
    offset: number;
  }> => {
    const searchParams = new URLSearchParams();
    if (params?.group_id) searchParams.append('group_id', params.group_id);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const response = await apiClient.get(`/api/characters?${searchParams.toString()}`);
    return response.data;
  },

  // Получение персонажа по ID
  getCharacter: async (id: string): Promise<Character> => {
    const response = await apiClient.get(`/api/characters/${id}`);
    return response.data;
  },

  // Создание персонажа
  createCharacter: async (data: CreateCharacterRequest): Promise<Character> => {
    const response = await apiClient.post('/api/characters', data);
    return response.data;
  },

  // Обновление персонажа
  updateCharacter: async (id: string, data: UpdateCharacterRequest): Promise<Character> => {
    const response = await apiClient.put(`/api/characters/${id}`, data);
    return response.data;
  },

  // Удаление персонажа
  deleteCharacter: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/characters/${id}`);
  },

  // Импорт персонажа из JSON
  importCharacter: async (data: ImportCharacterRequest): Promise<Character> => {
    const response = await apiClient.post('/api/characters/import', data);
    return response.data;
  },

  // Экспорт персонажа в JSON
  exportCharacter: async (id: string): Promise<ExportCharacterResponse> => {
    const response = await apiClient.get(`/api/characters/${id}/export`);
    return response.data;
  },

  // Получение инвентарей персонажа
  getCharacterInventories: async (characterId: string): Promise<Inventory[]> => {
    const response = await apiClient.get(`/api/characters/${characterId}/inventories`);
    return response.data;
  },

  // Обновление характеристики персонажа
  updateCharacterStat: async (characterId: string, statName: string, newValue: number): Promise<Character> => {
    const response = await apiClient.patch(`/api/characters/${characterId}/stats/${statName}`, {
      value: newValue
    });
    return response.data;
  },
};
