import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Package, User, Users, Edit, Trash2, Weight, Coins } from 'lucide-react';
import { inventoryApi } from '../api/inventoryApi';
import { useAuth } from '../contexts/AuthContext';
import type { Inventory, InventoryItem } from '../types';
import { getRarityColor } from '../utils/rarityColors';

const InventoryDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editForm, setEditForm] = useState({ quantity: 0, notes: '' });

  useEffect(() => {
    if (id) {
      loadInventory();
    }
  }, [id]);

  const loadInventory = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await inventoryApi.getInventory(id!);
      setInventory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки инвентаря');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setEditForm({ quantity: item.quantity, notes: item.notes });
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !inventory) return;

    try {
      await inventoryApi.updateInventoryItem(inventory.id, editingItem.id, editForm);
      await loadInventory();
      setEditingItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления предмета');
    }
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!inventory || !window.confirm('Удалить предмет из инвентаря?')) return;

    try {
      await inventoryApi.removeItemFromInventory(inventory.id, item.id);
      await loadInventory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления предмета');
    }
  };

  const getTotalWeight = () => {
    if (!inventory) return 0;
    return inventory.items.reduce((total, item) => {
      const weight = item.card.weight || 0;
      return total + (weight * item.quantity);
    }, 0);
  };

  const getTotalValue = () => {
    if (!inventory) return 0;
    return inventory.items.reduce((total, item) => {
      const price = item.card.price || 0;
      return total + (price * item.quantity);
    }, 0);
  };

  const formatWeight = (weight: number) => {
    return `${weight.toFixed(1)} фнт.`;
  };

  const formatPrice = (price: number) => {
    return `${price} зм.`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка инвентаря...</p>
        </div>
      </div>
    );
  }

  if (error || !inventory) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => navigate('/inventory')}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} className="mr-2" />
            Назад к инвентарям
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <div className="text-red-600">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Ошибка загрузки</h3>
              <p className="text-sm text-red-700 mt-1">{error || 'Инвентарь не найден'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/inventory')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft size={20} className="mr-2" />
          Назад к инвентарям
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              {inventory.type === 'personal' ? (
                <User size={24} className="text-blue-600" />
              ) : (
                <Users size={24} className="text-green-600" />
              )}
              <h1 className="text-3xl font-bold text-gray-900">{inventory.name}</h1>
            </div>
            <p className="text-gray-600 text-lg">
              {inventory.type === 'personal' ? 'Личный инвентарь' : 'Групповой инвентарь'}
            </p>
            {inventory.group && (
              <p className="text-sm text-gray-500 mt-1">
                Группа: {inventory.group.name}
              </p>
            )}
          </div>
          <Link
            to={`/inventory/${inventory.id}/add-item`}
            className="btn-primary bg-blue-600 hover:bg-blue-700 flex items-center space-x-2"
          >
            <Plus size={20} />
            <span>Добавить предмет</span>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-6 md:grid-cols-3 mb-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <Package className="h-8 w-8 text-blue-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Всего предметов</p>
              <p className="text-2xl font-bold text-gray-900">
                {inventory.items.reduce((total, item) => total + item.quantity, 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <Weight className="h-8 w-8 text-green-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Общий вес</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatWeight(getTotalWeight())}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <Coins className="h-8 w-8 text-yellow-600" />
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Общая стоимость</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatPrice(getTotalValue())}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Items list */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Предметы</h2>
        </div>
        
        {inventory.items.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Инвентарь пуст</h3>
            <p className="text-gray-600 mb-6">Добавьте предметы из библиотеки карточек</p>
            <Link
              to={`/inventory/${inventory.id}/add-item`}
              className="btn-primary bg-blue-600 hover:bg-blue-700 inline-flex items-center space-x-2"
            >
              <Plus size={20} />
              <span>Добавить предмет</span>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {inventory.items.map((item) => (
              <div key={item.id} className="p-6">
                {editingItem?.id === item.id ? (
                  // Edit mode
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900">{item.card.name}</h3>
                      <p className="text-sm text-gray-600">{item.card.description}</p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Количество</label>
                        <input
                          type="number"
                          min="0"
                          value={editForm.quantity}
                          onChange={(e) => setEditForm(prev => ({ ...prev, quantity: parseInt(e.target.value) || 0 }))}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Заметки</label>
                        <input
                          type="text"
                          value={editForm.notes}
                          onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                          className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Заметки"
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={handleSaveEdit}
                          className="btn-primary bg-green-600 hover:bg-green-700 text-sm px-3 py-1"
                        >
                          Сохранить
                        </button>
                        <button
                          onClick={() => setEditingItem(null)}
                          className="btn-secondary border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="flex items-center justify-between">
                                      <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className={`text-lg font-medium ${getRarityColor(item.card.rarity)}`}>{item.card.name}</h3>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        x{item.quantity}
                      </span>
                    </div>
                      <p className="text-sm text-gray-600 mt-1">{item.card.description}</p>
                      {item.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">Заметки: {item.notes}</p>
                      )}
                      <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                        {item.card.weight && (
                          <span>Вес: {formatWeight(item.card.weight * item.quantity)}</span>
                        )}
                        {item.card.price && (
                          <span>Стоимость: {formatPrice(item.card.price * item.quantity)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEditItem(item)}
                        className="btn-secondary border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center space-x-1"
                      >
                        <Edit size={16} />
                        <span>Изменить</span>
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item)}
                        className="btn-secondary border-red-300 text-red-700 hover:bg-red-50 flex items-center space-x-1"
                      >
                        <Trash2 size={16} />
                        <span>Удалить</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryDetail;
