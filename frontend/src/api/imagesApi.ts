import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

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

export const imagesApi = {
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
    }
  ): Promise<ImageGenerationResponse> => {
    const response = await apiClient.post<ImageGenerationResponse>('/api/images/generate', {
      entity_type: entityType,
      entity_id: entityId,
      prompt: prompt || '',
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
