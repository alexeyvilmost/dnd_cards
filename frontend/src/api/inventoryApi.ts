import apiClient from './client';
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
    const response = await apiClient.post<Inventory>('/inventories', data);
    return response.data;
  },

  // Получение списка инвентарей пользователя
  getInventories: async (): Promise<Inventory[]> => {
    const response = await apiClient.get<Inventory[]>('/inventories');
    return response.data;
  },

  // Получение информации об инвентаре
  getInventory: async (id: string): Promise<Inventory> => {
    const response = await apiClient.get<Inventory>(`/inventories/${id}`);
    return response.data;
  },

  // Добавление предмета в инвентарь
  addItemToInventory: async (inventoryId: string, data: AddItemToInventoryRequest): Promise<InventoryItem> => {
    const response = await apiClient.post<InventoryItem>(`/inventories/${inventoryId}/items`, data);
    return response.data;
  },

  // Обновление предмета в инвентаре
  updateInventoryItem: async (inventoryId: string, itemId: string, data: UpdateInventoryItemRequest): Promise<InventoryItem> => {
    const response = await apiClient.put<InventoryItem>(`/inventories/${inventoryId}/items/${itemId}`, data);
    return response.data;
  },

  // Удаление предмета из инвентаря
  removeItemFromInventory: async (inventoryId: string, itemId: string): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(`/inventories/${inventoryId}/items/${itemId}`);
    return response.data;
  },
};
