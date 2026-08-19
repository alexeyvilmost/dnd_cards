import { apiClient } from '../api/client';
import type { Monster, MonsterInput, MonstersResponse } from './types';

export const monstersApi = {
  list: async (params?: { search?: string; page?: number; limit?: number }): Promise<MonstersResponse> => {
    const { data } = await apiClient.get<MonstersResponse>('/api/monsters', { params });
    return data;
  },
  get: async (id: string): Promise<Monster> => {
    const { data } = await apiClient.get<Monster>(`/api/monsters/${id}`);
    return data;
  },
  create: async (payload: MonsterInput): Promise<Monster> => {
    const { data } = await apiClient.post<Monster>('/api/monsters', payload);
    return data;
  },
  update: async (id: string, payload: MonsterInput): Promise<Monster> => {
    const { data } = await apiClient.put<Monster>(`/api/monsters/${id}`, payload);
    return data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/monsters/${id}`);
  },
};
