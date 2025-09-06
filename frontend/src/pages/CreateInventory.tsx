import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Users, User, AlertCircle } from 'lucide-react';
import { inventoryApi } from '../api/inventoryApi';
import { groupsApi } from '../api/groupsApi';
import { useAuth } from '../contexts/AuthContext';
import type { Group, InventoryType } from '../types';

const CreateInventory: React.FC = () => {
  const [formData, setFormData] = useState({
    type: 'personal' as InventoryType,
    name: '',
    group_id: '',
  });
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const navigate = useNavigate();

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setIsLoadingGroups(true);
      const data = await groupsApi.getGroups();
      setGroups(data);
    } catch (err) {
      console.error('Ошибка загрузки групп:', err);
    } finally {
      setIsLoadingGroups(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const requestData = {
        type: formData.type,
        name: formData.name,
        group_id: formData.type === 'group' ? formData.group_id : undefined,
      };

      await inventoryApi.createInventory(requestData);
      navigate('/inventory');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания инвентаря');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleTypeChange = (type: InventoryType) => {
    setFormData(prev => ({
      ...prev,
      type,
      group_id: type === 'personal' ? '' : prev.group_id
    }));
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/inventory')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft size={20} className="mr-2" />
          Назад к инвентарям
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Создать новый инвентарь</h1>
        <p className="text-gray-600 mt-1">Создайте личный или групповой инвентарь</p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Inventory type selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Тип инвентаря *
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => handleTypeChange('personal')}
                className={`p-4 border-2 rounded-lg text-left transition-colors ${
                  formData.type === 'personal'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <User className={`h-6 w-6 ${formData.type === 'personal' ? 'text-blue-600' : 'text-gray-400'}`} />
                  <div>
                    <h3 className="font-medium text-gray-900">Личный инвентарь</h3>
                    <p className="text-sm text-gray-600">Для вашего персонажа</p>
                  </div>
                </div>
              </button>
              
              <button
                type="button"
                onClick={() => handleTypeChange('group')}
                className={`p-4 border-2 rounded-lg text-left transition-colors ${
                  formData.type === 'group'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Users className={`h-6 w-6 ${formData.type === 'group' ? 'text-green-600' : 'text-gray-400'}`} />
                  <div>
                    <h3 className="font-medium text-gray-900">Групповой инвентарь</h3>
                    <p className="text-sm text-gray-600">Для группы игроков</p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Group selection (only for group inventory) */}
          {formData.type === 'group' && (
            <div>
              <label htmlFor="group_id" className="block text-sm font-medium text-gray-700 mb-2">
                Группа *
              </label>
              <select
                id="group_id"
                name="group_id"
                required
                value={formData.group_id}
                onChange={handleChange}
                className="input-field"
                disabled={isLoadingGroups}
              >
                <option value="">Выберите группу</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              {isLoadingGroups && (
                <p className="text-xs text-gray-500 mt-1">Загрузка групп...</p>
              )}
              {groups.length === 0 && !isLoadingGroups && (
                <p className="text-xs text-gray-500 mt-1">
                  У вас нет групп. <a href="/groups/create" className="text-blue-600 hover:underline">Создайте группу</a>
                </p>
              )}
            </div>
          )}

          {/* Inventory name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Название инвентаря *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Package className="h-5 w-5 text-gray-400" />
              </div>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={100}
                value={formData.name}
                onChange={handleChange}
                className="input-field pl-10"
                placeholder="Введите название инвентаря"
              />
            </div>
          </div>

          {/* Info box */}
          <div className={`border rounded-lg p-4 ${
            formData.type === 'personal' 
              ? 'bg-blue-50 border-blue-200' 
              : 'bg-green-50 border-green-200'
          }`}>
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className={`h-5 w-5 ${formData.type === 'personal' ? 'text-blue-400' : 'text-green-400'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className={`text-sm font-medium ${formData.type === 'personal' ? 'text-blue-800' : 'text-green-800'}`}>
                  {formData.type === 'personal' ? 'Личный инвентарь' : 'Групповой инвентарь'}
                </h3>
                <p className={`text-sm mt-1 ${formData.type === 'personal' ? 'text-blue-700' : 'text-green-700'}`}>
                  {formData.type === 'personal' 
                    ? 'Личный инвентарь доступен только вам. Вы можете добавлять предметы из библиотеки карточек.'
                    : 'Групповой инвентарь доступен всем участникам группы. Только ДМ может создавать групповые инвентари.'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Submit button */}
          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/inventory')}
              className="btn-secondary border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isLoading || !formData.name.trim() || (formData.type === 'group' && !formData.group_id)}
              className="btn-primary bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Создание...
                </div>
              ) : (
                'Создать инвентарь'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateInventory;
