import { apiClient } from './client';
import type { 
  Inventory, 
  InventoryItem, 
  CreateInventoryRequest, 
  AddItemToInventoryRequest, 
  UpdateInventoryItemRequest 
} from '../types';

export const inventoryApi = {
  // Создание инвентаря
  createInventory: async (data: CreateInventoryRequest): Promise<Inventory> => {
    const response = await apiClient.post<Inventory>('/api/inventories', data);
    return response.data;
  },

  // Получение списка инвентарей пользователя
  getInventories: async (): Promise<Inventory[]> => {
    const response = await apiClient.get<Inventory[]>('/api/inventories');
    return response.data;
  },

  // Получение информации об инвентаре
  getInventory: async (id: string): Promise<Inventory> => {
    const response = await apiClient.get<Inventory>(`/api/inventories/${id}`);
    return response.data;
  },

  // Добавление предмета в инвентарь
  addItemToInventory: async (inventoryId: string, data: AddItemToInventoryRequest): Promise<InventoryItem> => {
    const response = await apiClient.post<InventoryItem>(`/api/inventories/${inventoryId}/items`, data);
    return response.data;
  },

  // Обновление предмета в инвентаре
  updateInventoryItem: async (inventoryId: string, itemId: string, data: UpdateInventoryItemRequest): Promise<InventoryItem> => {
    const response = await apiClient.put<InventoryItem>(`/api/inventories/${inventoryId}/items/${itemId}`, data);
    return response.data;
  },

  // Удаление предмета из инвентаря
  removeItemFromInventory: async (inventoryId: string, itemId: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(`/api/inventories/${inventoryId}/items/${itemId}`);
    return response.data;
  },

  // Экипировка/снятие предмета
  equipItem: async (itemId: string, isEquipped: boolean): Promise<InventoryItem> => {
    console.log('API equipItem called:', { itemId, isEquipped });
    const requestData = { is_equipped: isEquipped };
    console.log('Request data:', requestData);
    
    const response = await apiClient.put<InventoryItem>(`/api/inventories/items/${itemId}/equip`, requestData);
    console.log('API response:', response.data);
    return response.data;
  },
};
