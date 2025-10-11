import apiClient from './client';
import type { AuthRequest, RegisterRequest, AuthResponse, User } from '../types';

export const authApi = {
  // Регистрация пользователя
  register: async (data: RegisterRequest): Promise<{ message: string; user: User }> => {
    const response = await apiClient.post<{ message: string; user: User }>('/api/auth/register', data);
    return response.data;
  },

  // Авторизация пользователя
  login: async (data: AuthRequest): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/api/auth/login', data);
    return response.data;
  },

  // Получение профиля пользователя
  getProfile: async (): Promise<User> => {
    const response = await apiClient.get<User>('/api/auth/profile');
    return response.data;
  },

  // Выход из системы
  logout: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/api/auth/logout');
    return response.data;
  },
};
