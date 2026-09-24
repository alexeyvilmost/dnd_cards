import { apiClient } from './client';
import type { AuthRequest, RegisterRequest, AuthResponse, User } from '../types';
import type { OAuthLoginResponse, OAuthProviderStatus } from '../auth/oauth';

export const authApi = {
  oauthProviders: async (): Promise<{ providers: OAuthProviderStatus[] }> => {
    const response = await apiClient.get<{ providers: OAuthProviderStatus[] }>('/api/auth/oauth/providers');
    return response.data;
  },

  exchangeOAuth: async (code: string, verifier: string): Promise<OAuthLoginResponse> => {
    const response = await apiClient.post<OAuthLoginResponse>('/api/auth/oauth/exchange', { code, verifier });
    return response.data;
  },

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
