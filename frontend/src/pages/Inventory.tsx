import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Package, Users, User, ArrowRight, Edit, Trash2 } from 'lucide-react';
import { inventoryApi } from '../api/inventoryApi';
import { useAuth } from '../contexts/AuthContext';
import type { Inventory, InventoryItem } from '../types';

const Inventory: React.FC = () => {
  const [inventories, setInventories] = useState<Inventory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    loadInventories();
  }, []);

  const loadInventories = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await inventoryApi.getInventories();
      setInventories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки инвентарей');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getTotalItems = (inventory: Inventory) => {
    return inventory.items.reduce((total, item) => total + item.quantity, 0);
  };

  const getTotalWeight = (inventory: Inventory) => {
    return inventory.items.reduce((total, item) => {
      const weight = item.card.weight || 0;
      return total + (weight * item.quantity);
    }, 0);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка инвентарей...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center">
          <div className="text-red-600">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Ошибка загрузки</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={loadInventories}
            className="text-sm bg-red-100 text-red-800 px-3 py-2 rounded-md hover:bg-red-200 transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Мои инвентари</h1>
          <p className="text-gray-600 mt-1">Управляйте предметами ваших персонажей и групп</p>
        </div>
        <Link
          to="/inventory/create"
          className="btn-primary bg-blue-600 hover:bg-blue-700 flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>Создать инвентарь</span>
        </Link>
      </div>

      {/* Inventories list */}
      {inventories.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">У вас пока нет инвентарей</h3>
          <p className="text-gray-600 mb-6">Создайте личный инвентарь или групповой инвентарь для ваших групп</p>
          <Link
            to="/inventory/create"
            className="btn-primary bg-blue-600 hover:bg-blue-700 inline-flex items-center space-x-2"
          >
            <Plus size={20} />
            <span>Создать инвентарь</span>
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {inventories.map((inventory) => (
            <div
              key={inventory.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
            >
              <div className="p-6">
                {/* Inventory header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      {inventory.type === 'personal' ? (
                        <User size={16} className="text-blue-600" />
                      ) : (
                        <Users size={16} className="text-green-600" />
                      )}
                      <h3 className="text-lg font-semibold text-gray-900">
                        {inventory.name}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-600">
                      {inventory.type === 'personal' ? 'Личный инвентарь' : 'Групповой инвентарь'}
                    </p>
                    {inventory.group && (
                      <p className="text-xs text-gray-500 mt-1">
                        Группа: {inventory.group.name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Inventory stats */}
                <div className="space-y-3 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Предметов:</span>
                    <span className="font-medium text-gray-900">{getTotalItems(inventory)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Общий вес:</span>
                    <span className="font-medium text-gray-900">
                      {getTotalWeight(inventory).toFixed(1)} фнт.
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Создан:</span>
                    <span className="font-medium text-gray-900">{formatDate(inventory.created_at)}</span>
                  </div>
                </div>

                {/* Recent items preview */}
                {inventory.items.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-gray-500 mb-2">Последние предметы:</p>
                    <div className="space-y-1">
                      {inventory.items.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-xs">
                          <span className="text-gray-700 truncate flex-1">
                            {item.card.name}
                          </span>
                          <span className="text-gray-500 ml-2">
                            x{item.quantity}
                          </span>
                        </div>
                      ))}
                      {inventory.items.length > 3 && (
                        <p className="text-xs text-gray-500">
                          и еще {inventory.items.length - 3} предметов...
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex space-x-2">
                  <Link
                    to={`/inventory/${inventory.id}`}
                    className="flex-1 btn-primary bg-blue-600 hover:bg-blue-700 flex items-center justify-center space-x-2"
                  >
                    <span>Открыть</span>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Inventory;
