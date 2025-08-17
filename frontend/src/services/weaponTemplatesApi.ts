import axios from 'axios';
import { WeaponTemplate } from '../types';

const API_BASE_URL = 'http://localhost:8080/api';

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
