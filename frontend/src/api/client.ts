import axios from 'axios';
import type { 
  Card, 
  CreateCardRequest, 
  UpdateCardRequest, 
  CardsResponse,
  GenerateImageRequest,
  ExportCardsRequest,
  Action,
  CreateActionRequest,
  UpdateActionRequest,
  ActionsResponse,
  PassiveEffect,
  CreatePassiveEffectRequest,
  UpdatePassiveEffectRequest,
  PassiveEffectsResponse,
  ActiveEffect,
  ApiError 
} from '../types';
import type { CharacterV3 } from '../utils/characterCalculationsV3';

// Railway production URL по умолчанию, можно переопределить через VITE_API_URL
// Для локальной разработки установите: VITE_API_URL=http://localhost:8080
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://backend-production-41c3.up.railway.app';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Интерцептор для добавления токена авторизации
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Интерцептор для обработки ошибок
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Токен недействителен, удаляем его из localStorage
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      // Перенаправляем на страницу входа
      window.location.href = '/login';
    }
    
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error);
    }
    throw new Error('Произошла ошибка при выполнении запроса');
  }
);

export const cardsApi = {
  // Получение списка карточек
  getCards: async (params?: {
    page?: number;
    limit?: number;
    rarity?: string;
    properties?: string;
    search?: string;
  }): Promise<CardsResponse> => {
    const response = await apiClient.get<CardsResponse>('/api/cards', { params });
    return response.data;
  },

  // Получение карточки по ID
  getCard: async (id: string): Promise<Card> => {
    const response = await apiClient.get<Card>(`/api/cards/${id}`);
    return response.data;
  },

  // Создание новой карточки
  createCard: async (data: CreateCardRequest): Promise<Card> => {
    const response = await apiClient.post<Card>('/api/cards', data);
    return response.data;
  },

  // Обновление карточки
  updateCard: async (id: string, data: UpdateCardRequest): Promise<Card> => {
    const response = await apiClient.put<Card>(`/api/cards/${id}`, data);
    return response.data;
  },

  // Удаление карточки
  deleteCard: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/cards/${id}`);
  },

  // Генерация изображения
  generateImage: async (data: GenerateImageRequest): Promise<{ image_url: string; message: string }> => {
    const response = await apiClient.post<{ image_url: string; message: string }>('/api/cards/generate-image', data);
    return response.data;
  },

  // Экспорт карточек
  exportCards: async (data: ExportCardsRequest): Promise<{ cards: Card[]; message: string }> => {
    const response = await apiClient.post<{ cards: Card[]; message: string }>('/api/cards/export', data);
    return response.data;
  },
};

export const actionsApi = {
  // Получение списка действий
  getActions: async (params?: {
    page?: number;
    limit?: number;
    rarity?: string;
    resource?: string;
    action_type?: string;
    search?: string;
  }): Promise<ActionsResponse> => {
    const response = await apiClient.get<ActionsResponse>('/api/actions', { params });
    return response.data;
  },

  // Получение действия по ID
  getAction: async (id: string): Promise<Action> => {
    const response = await apiClient.get<Action>(`/api/actions/${id}`);
    return response.data;
  },

  // Создание нового действия
  createAction: async (data: CreateActionRequest): Promise<Action> => {
    const response = await apiClient.post<Action>('/api/actions', data);
    return response.data;
  },

  // Обновление действия
  updateAction: async (id: string, data: UpdateActionRequest): Promise<Action> => {
    const response = await apiClient.put<Action>(`/api/actions/${id}`, data);
    return response.data;
  },

  // Удаление действия
  deleteAction: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/actions/${id}`);
  },
};

export const effectsApi = {
  // Получение списка эффектов
  getEffects: async (params?: {
    page?: number;
    limit?: number;
    rarity?: string;
    effect_type?: string;
    search?: string;
  }): Promise<PassiveEffectsResponse> => {
    const response = await apiClient.get<PassiveEffectsResponse>('/api/effects', { params });
    return response.data;
  },

  // Получение эффекта по ID
  getEffect: async (id: string): Promise<PassiveEffect> => {
    const response = await apiClient.get<PassiveEffect>(`/api/effects/${id}`);
    return response.data;
  },

  // Получение эффекта по card_number
  getEffectByCardNumber: async (cardNumber: string): Promise<PassiveEffect | null> => {
    try {
      // Используем прямой вызов API, чтобы избежать циклической зависимости
      const response = await apiClient.get<PassiveEffectsResponse>('/api/effects', { 
        params: { search: cardNumber, limit: 100 } 
      });
      const effect = response.data.effects.find(e => e.card_number === cardNumber);
      return effect || null;
    } catch (error) {
      console.error(`Ошибка поиска эффекта по card_number ${cardNumber}:`, error);
      return null;
    }
  },

  // Создание нового эффекта
  createEffect: async (data: CreatePassiveEffectRequest): Promise<PassiveEffect> => {
    const response = await apiClient.post<PassiveEffect>('/api/effects', data);
    return response.data;
  },

  // Обновление эффекта
  updateEffect: async (id: string, data: UpdatePassiveEffectRequest): Promise<PassiveEffect> => {
    const response = await apiClient.put<PassiveEffect>(`/api/effects/${id}`, data);
    return response.data;
  },

  // Удаление эффекта
  deleteEffect: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/effects/${id}`);
  },
};

export const shopsApi = {
  createShop: async (): Promise<{ slug: string; vendors: Record<string, Card[]>; created: string }> => {
    const response = await apiClient.post('/api/shops');
    return response.data;
  },
  getShop: async (slug: string): Promise<{ slug: string; vendors: Record<string, Card[]>; created: string }> => {
    const response = await apiClient.get(`/api/shops/${slug}`);
    return response.data;
  }
};

export const charactersV2Api = {
  // Использование действия
  useAction: async (characterId: string, actionId: string): Promise<CharacterV3> => {
    const response = await apiClient.post<CharacterV3>(`/api/characters-v2/${characterId}/actions/${actionId}/use`);
    return response.data;
  },
  
  // Завершение эффекта
  endEffect: async (characterId: string, effectId: string): Promise<CharacterV3> => {
    const response = await apiClient.post<CharacterV3>(`/api/characters-v2/${characterId}/effects/${effectId}/end`);
    return response.data;
  },
  
  // Конец хода
  processTurnEnd: async (characterId: string): Promise<CharacterV3> => {
    const response = await apiClient.post<CharacterV3>(`/api/characters-v2/${characterId}/turn-end`);
    return response.data;
  },
  
  // Длинный отдых
  processLongRest: async (characterId: string): Promise<CharacterV3> => {
    const response = await apiClient.post<CharacterV3>(`/api/characters-v2/${characterId}/long-rest`);
    return response.data;
  },
  
  // Получение активных эффектов
  getActiveEffects: async (characterId: string): Promise<{ active_effects: ActiveEffect[] }> => {
    const response = await apiClient.get<{ active_effects: ActiveEffect[] }>(`/api/characters-v2/${characterId}/active-effects`);
    return response.data;
  },
};

export default apiClient;
