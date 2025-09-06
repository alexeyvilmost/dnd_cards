import apiClient from './client';
import type { Group, GroupMember, CreateGroupRequest, JoinGroupRequest } from '../types';

export const groupsApi = {
  // Создание группы
  createGroup: async (data: CreateGroupRequest): Promise<Group> => {
    const response = await apiClient.post<Group>('/groups', data);
    return response.data;
  },

  // Получение списка групп пользователя
  getGroups: async (): Promise<Group[]> => {
    const response = await apiClient.get<Group[]>('/groups');
    return response.data;
  },

  // Получение информации о группе
  getGroup: async (id: string): Promise<Group> => {
    const response = await apiClient.get<Group>(`/groups/${id}`);
    return response.data;
  },

  // Присоединение к группе
  joinGroup: async (data: JoinGroupRequest): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/groups/join', data);
    return response.data;
  },

  // Покидание группы
  leaveGroup: async (id: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(`/groups/${id}/leave`);
    return response.data;
  },

  // Получение участников группы
  getGroupMembers: async (id: string): Promise<GroupMember[]> => {
    const response = await apiClient.get<GroupMember[]>(`/groups/${id}/members`);
    return response.data;
  },
};
