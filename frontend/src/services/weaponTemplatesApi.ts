import axios from 'axios';
import { WeaponTemplate } from '../types';

// Railway production URL по умолчанию, можно переопределить через VITE_API_URL
// Для локальной разработки установите: VITE_API_URL=http://localhost:8080
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://backend-production-41c3.up.railway.app';

export const weaponTemplatesApi = {
  // Получить все шаблоны оружия
  async getWeaponTemplates(category?: string): Promise<WeaponTemplate[]> {
    const params = category ? { category } : {};
    const response = await axios.get(`${API_BASE_URL}/weapon-templates`, { params });
    return response.data;
  },

  // Получить конкретный шаблон оружия
  async getWeaponTemplate(id: number): Promise<WeaponTemplate> {
    const response = await axios.get(`${API_BASE_URL}/weapon-templates/${id}`);
    return response.data;
  }
};
