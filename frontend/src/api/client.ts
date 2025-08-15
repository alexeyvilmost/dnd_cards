import axios from 'axios';
import type { 
  Card, 
  CreateCardRequest, 
  UpdateCardRequest, 
  CardsResponse,
  GenerateImageRequest,
  ExportCardsRequest,
  ApiError 
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Интерцептор для обработки ошибок
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
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
    const response = await apiClient.get<CardsResponse>('/cards', { params });
    return response.data;
  },

  // Получение карточки по ID
  getCard: async (id: string): Promise<Card> => {
    const response = await apiClient.get<Card>(`/cards/${id}`);
    return response.data;
  },

  // Создание новой карточки
  createCard: async (data: CreateCardRequest): Promise<Card> => {
    const response = await apiClient.post<Card>('/cards', data);
    return response.data;
  },

  // Обновление карточки
  updateCard: async (id: string, data: UpdateCardRequest): Promise<Card> => {
    const response = await apiClient.put<Card>(`/cards/${id}`, data);
    return response.data;
  },

  // Удаление карточки
  deleteCard: async (id: string): Promise<void> => {
    await apiClient.delete(`/cards/${id}`);
  },

  // Генерация изображения
  generateImage: async (data: GenerateImageRequest): Promise<{ image_url: string; message: string }> => {
    const response = await apiClient.post<{ image_url: string; message: string }>('/cards/generate-image', data);
    return response.data;
  },

  // Экспорт карточек
  exportCards: async (data: ExportCardsRequest): Promise<{ cards: Card[]; message: string }> => {
    const response = await apiClient.post<{ cards: Card[]; message: string }>('/cards/export', data);
    return response.data;
  },
};

export default apiClient;
