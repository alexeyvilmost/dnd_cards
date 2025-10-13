import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Создаем экземпляр axios с базовой конфигурацией
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Интерцептор для добавления токена авторизации
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Интерцептор для обработки ошибок авторизации
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface ImageLibraryItem {
  id: string;
  cloudinary_id: string;
  cloudinary_url: string;
  original_name?: string;
  file_size?: number;
  card_name?: string;
  card_rarity?: string;
  generation_prompt?: string;
  generation_model?: string;
  generation_time_ms?: number;
  created_at: string;
  updated_at: string;
}

export interface ImageLibraryResponse {
  images: ImageLibraryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface ImageLibraryFilters {
  page?: number;
  limit?: number;
  search?: string;
  rarity?: string;
}

export interface AddToLibraryRequest {
  cloudinary_id: string;
  cloudinary_url: string;
  original_name?: string;
  file_size?: number;
  card_name?: string;
  card_rarity?: string;
  generation_prompt?: string;
  generation_model?: string;
  generation_time_ms?: number;
}

export interface UpdateImageLibraryRequest {
  card_name?: string;
  card_rarity?: string;
}

export interface RaritiesResponse {
  rarities: string[];
}

// Получить список изображений из библиотеки
export const getImageLibrary = async (filters: ImageLibraryFilters = {}): Promise<ImageLibraryResponse> => {
  const params = new URLSearchParams();
  
  if (filters.page) params.append('page', filters.page.toString());
  if (filters.limit) params.append('limit', filters.limit.toString());
  if (filters.search) params.append('search', filters.search);
  if (filters.rarity) params.append('rarity', filters.rarity);

  const response = await api.get(`/api/image-library?${params.toString()}`);
  return response.data;
};

// Добавить изображение в библиотеку
export const addToLibrary = async (data: AddToLibraryRequest): Promise<{ message: string; image: ImageLibraryItem }> => {
  const response = await api.post('/api/image-library', data);
  return response.data;
};

// Обновить метаданные изображения в библиотеке
export const updateImageLibrary = async (id: string, data: UpdateImageLibraryRequest): Promise<{ message: string; image: ImageLibraryItem }> => {
  const response = await api.put(`/api/image-library/${id}`, data);
  return response.data;
};

// Удалить изображение из библиотеки
export const deleteFromLibrary = async (id: string): Promise<{ message: string }> => {
  const response = await api.delete(`/api/image-library/${id}`);
  return response.data;
};

// Получить список доступных редкостей
export const getRarities = async (): Promise<RaritiesResponse> => {
  const response = await api.get('/api/image-library/rarities');
  return response.data;
};
