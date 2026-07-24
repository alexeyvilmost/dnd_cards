import axios from 'axios';
import { API_BASE_URL } from './client';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
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
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    
    if (error.response?.data?.error) {
      throw new Error(error.response.data.error);
    }
    throw new Error('Произошла ошибка при выполнении запроса');
  }
);

// Стиль генерации изображения:
// fantasy — официальный D&D-арт с акварельным фоном (по умолчанию), game — видеоигровая иконка
export type ImageGenerationStyle = 'game' | 'fantasy';

// Качество генерации изображения (gpt-image-1)
export type ImageGenerationQuality = 'low' | 'medium' | 'high';

export interface ImageUploadResponse {
  success: boolean;
  image_url: string;
  cloudinary_id: string;
  message: string;
}

export interface ImageGenerationResponse {
  success: boolean;
  image_url: string;
  cloudinary_id: string;
  generation_time_ms: number;
  message: string;
}

export interface ImageStatusResponse {
  yandex_storage: string;
  bucket?: string;
  region?: string;
  message: string;
}

export interface StandaloneImageRequest {
  subject?: string;
  element?: string;
  extra?: string;
  prompt?: string;
  style?: string;
  quality?: ImageGenerationQuality;
}

export interface StandaloneImageResponse {
  success: boolean;
  image_url: string;
  prompt: string;
  generation_time_ms: number;
}

export const imagesApi = {
  // Standalone-генерация изображения (без привязки к сущности) — вкладка «Генерация»
  generateStandalone: async (req: StandaloneImageRequest): Promise<StandaloneImageResponse> => {
    const response = await apiClient.post<StandaloneImageResponse>(
      '/api/images/generate-standalone',
      req,
      { timeout: 180000 }
    );
    return response.data;
  },

  // Загрузка изображения
  uploadImage: async (
    entityType: 'card' | 'weapon_template',
    entityId: string,
    imageFile: File
  ): Promise<ImageUploadResponse> => {
    const formData = new FormData();
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);
    formData.append('image', imageFile);

    const response = await apiClient.post<ImageUploadResponse>('/api/images/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Генерация изображения
  generateImage: async (
    entityType: 'card' | 'weapon_template',
    entityId: string,
    prompt?: string,
    entityData?: {
      name?: string;
      description?: string;
      rarity?: string;
      image_prompt_extra?: string;
      type?: string;
      weapon_type?: string;
      slot?: string;
      properties?: string[];
    },
    style: ImageGenerationStyle = 'fantasy',
    quality: ImageGenerationQuality = 'high'
  ): Promise<ImageGenerationResponse> => {
    const response = await apiClient.post<ImageGenerationResponse>('/api/images/generate', {
      entity_type: entityType,
      entity_id: entityId,
      prompt: prompt || '',
      style,
      quality,
      entity_data: entityData,
    });
    return response.data;
  },

  // Удаление изображения
  deleteImage: async (
    entityType: 'card' | 'weapon_template',
    entityId: string
  ): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.delete(`/api/images/${entityType}/${entityId}`);
    return response.data;
  },

  // Проверка статуса Yandex Storage
  getStatus: async (): Promise<ImageStatusResponse> => {
    const response = await apiClient.get<ImageStatusResponse>('/api/images/status');
    return response.data;
  },

  // Настройка CORS
  setupCORS: async (): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post('/api/images/setup-cors');
    return response.data;
  },
};
