import { apiClient } from '../api/client';
import type { Monster, MonsterInput, MonstersResponse } from './types';
import { readWithReviewUpdates } from '../api/contentReview';
import { withoutEntityReferences } from '../api/entityReferences';

export const monstersApi = {
  list: async (params?: { search?: string; page?: number; limit?: number;tag?:string }): Promise<MonstersResponse> => {
    return readWithReviewUpdates('monster', async () => (await apiClient.get<MonstersResponse>('/api/monsters', { params })).data);
  },
  get: async (id: string): Promise<Monster> => {
    return readWithReviewUpdates('monster', async () => (await apiClient.get<Monster>(`/api/monsters/${id}`)).data);
  },
  create: async (payload: MonsterInput): Promise<Monster> => {
    const { data } = await apiClient.post<Monster>('/api/monsters', withoutEntityReferences(payload));
    return data;
  },
  update: async (id: string, payload: MonsterInput): Promise<Monster> => {
    const { data } = await apiClient.put<Monster>(`/api/monsters/${id}`, withoutEntityReferences(payload));
    return data;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/monsters/${id}`);
  },
};
