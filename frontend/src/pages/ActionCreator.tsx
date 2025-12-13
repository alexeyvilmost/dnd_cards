import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { actionsApi } from '../api/client';
import type { CreateActionRequest } from '../types';
import { RARITY_OPTIONS, ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import { getAllCharges } from '../utils/charges';
import ActionPreview from '../components/ActionPreview';
import ImageUploader from '../components/ImageUploader';

const ActionCreator = () => {
  const navigate = useNavigate();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CreateActionRequest>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);

  const charges = getAllCharges();
  const formData = watch();

  // Обновляем selectedResources при изменении formData.resources
  useEffect(() => {
    if (formData.resources && Array.isArray(formData.resources)) {
      setSelectedResources(formData.resources);
    }
  }, [formData.resources]);

  const previewAction = {
    id: '',
    name: formData.name || 'Название действия',
    description: formData.description || 'Описание действия',
    detailed_description: formData.detailed_description || null,
    image_url: formData.image_url || '',
    rarity: formData.rarity || 'common',
    card_number: formData.card_number || '',
    resource: formData.resource || 'action',
    resources: selectedResources.length > 0 ? selectedResources : null,
    distance: formData.distance || null,
    recharge: formData.recharge || null,
    recharge_custom: formData.recharge_custom || null,
    script: formData.script || null,
    action_type: formData.action_type || 'base_action',
    type: formData.type || null,
    author: formData.author || 'Admin',
    source: formData.source || null,
    tags: formData.tags || null,
    price: formData.price || null,
    weight: formData.weight || null,
    properties: formData.properties || null,
    is_extended: formData.is_extended || false,
    description_font_size: formData.description_font_size || null,
    text_alignment: formData.text_alignment || null,
    text_font_size: formData.text_font_size || null,
    show_detailed_description: formData.show_detailed_description || false,
    detailed_description_alignment: formData.detailed_description_alignment || null,
    detailed_description_font_size: formData.detailed_description_font_size || null,
    created_at: '',
    updated_at: '',
  };

  const toggleResource = (resourceId: string) => {
    const newResources = selectedResources.includes(resourceId)
      ? selectedResources.filter(id => id !== resourceId)
      : [...selectedResources, resourceId];
    setSelectedResources(newResources);
    setValue('resources', newResources.length > 0 ? newResources : null);
  };

  // Проверка уникальности ID (проверяем по card_number через API)
  const checkIdUniqueness = async (id: string): Promise<boolean> => {
    if (!id || id.trim() === '') return true; // Пустой ID допустим
    try {
      // Проверяем через список действий с фильтром по card_number
      const response = await actionsApi.getActions({ search: id, limit: 100 });
      // Ищем точное совпадение card_number
      const exists = response.actions.some(action => action.card_number === id);
      return !exists; // Возвращаем true если не найден
    } catch (error: any) {
      console.error('Ошибка проверки уникальности ID:', error);
      return false; // Ошибка при проверке
    }
  };

  const onSubmit = async (data: CreateActionRequest) => {
    setLoading(true);
    setError(null);
    setIdError(null);

    // Проверка выбора ресурсов
    if (selectedResources.length === 0) {
      setError('Выберите хотя бы один ресурс');
      setLoading(false);
      return;
    }

    // Проверка уникальности ID, если он указан
    if (data.card_number && data.card_number.trim() !== '') {
      const idRegex = /^[a-zA-Z0-9_-]{1,30}$/;
      if (!idRegex.test(data.card_number)) {
        setIdError('ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов');
        setLoading(false);
        return;
      }

      const isUnique = await checkIdUniqueness(data.card_number);
      if (!isUnique) {
        setIdError('Действие с таким ID уже существует');
        setLoading(false);
        return;
      }
    }

    try {
      // Добавляем resources в данные перед отправкой
      const submitData = {
        ...data,
        resources: selectedResources.length > 0 ? selectedResources : null,
      };
      const created = await actionsApi.createAction(submitData);
      navigate(`/action/${created.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка создания действия');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Создание действия</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Левая колонка - форма */}
        <div className="space-y-6">
          {/* Основная информация */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Основная информация</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Название *
                </label>
                <input
                  {...register('name', { required: 'Название обязательно' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Название действия"
                />
                {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Описание *
                </label>
                <textarea
                  {...register('description', { required: 'Описание обязательно' })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Описание действия"
                />
                {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Редкость *
                </label>
                <select
                  {...register('rarity', { required: 'Редкость обязательна' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {RARITY_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ресурсы (можно выбрать несколько) *
                </label>
                <div className="space-y-2 border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto">
                  {charges.map((charge) => {
                    const isSelected = selectedResources.includes(charge.id);
                    return (
                      <label
                        key={charge.id}
                        className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleResource(charge.id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="flex items-center space-x-2 flex-1">
                          <img 
                            src={`/charges/${charge.image}`} 
                            alt={charge.russian_name}
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                            }}
                          />
                          <div>
                            <div className="text-sm font-medium text-gray-900">{charge.russian_name}</div>
                            <div className="text-xs text-gray-500">{charge.description}</div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {selectedResources.length === 0 && (
                  <p className="text-red-500 text-sm mt-1">Выберите хотя бы один ресурс</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Дальность
                </label>
                <input
                  {...register('distance')}
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Например: 30 фт., касание, 60 фт."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Тип действия *
                </label>
                <select
                  {...register('action_type', { required: 'Тип действия обязателен' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ACTION_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Перезарядка
                </label>
                <select
                  {...register('recharge')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Без перезарядки</option>
                  {ACTION_RECHARGE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {watch('recharge') === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Произвольная перезарядка
                  </label>
                  <input
                    {...register('recharge_custom')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Например: 1 раз в день"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ID действия
                </label>
                <input
                  {...register('card_number')}
                  type="text"
                  placeholder="action_id_123"
                  maxLength={30}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Уникальный идентификатор действия (латинские буквы, цифры, дефисы и подчеркивания, до 30 символов). Если не указан, будет сгенерирован автоматически.
                </p>
                {idError && <p className="text-red-500 text-sm mt-1">{idError}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Изображение
                </label>
                <ImageUploader
                  onImageUpload={(imageUrl) => setValue('image_url', imageUrl)}
                  currentImageUrl={watch('image_url') || ''}
                  entityType="action"
                  entityId={watch('card_number') || 'new'}
                />
              </div>
            </div>
          </div>

          {/* Кнопки */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? 'Создание...' : 'Создать действие'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/create')}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Отмена
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700">{error}</p>
            </div>
          )}
          
          {idError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-700">{idError}</p>
            </div>
          )}
        </div>

        {/* Правая колонка - превью */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Превью действия</h3>
            <div className="flex justify-center">
              <ActionPreview action={previewAction} disableHover={true} />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ActionCreator;






