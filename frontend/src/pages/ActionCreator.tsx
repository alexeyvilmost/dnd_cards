import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { actionsApi } from '../api/client';
import type { CreateActionRequest, UpdateActionRequest } from '../types';
import { RARITY_OPTIONS, ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import { getAllCharges } from '../utils/charges';
import ActionPreview from '../components/ActionPreview';
import ImageUploader from '../components/ImageUploader';

const ActionCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);
  
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<CreateActionRequest>({
    defaultValues: {
      rarity: 'common',
      is_extended: false,
    }
  });
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
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

  // Загрузка действия для редактирования
  useEffect(() => {
    if (isEditMode && editId) {
      const loadAction = async () => {
        try {
          setLoadingAction(true);
          const action = await actionsApi.getAction(editId);
          
          // Заполняем форму данными действия
          console.log('[ActionCreator] Загружено действие с бэкенда:', action);
          
          // Преобразуем resources из массива в массив строк для selectedResources
          const resourcesArray = action.resources && Array.isArray(action.resources) 
            ? action.resources 
            : [];
          
          setSelectedResources(resourcesArray);
          
          reset({
            name: action.name,
            description: action.description,
            detailed_description: action.detailed_description || null,
            image_url: action.image_url || '',
            rarity: action.rarity || 'common',
            card_number: action.card_number || '',
            resources: resourcesArray,
            distance: action.distance || null,
            recharge: action.recharge || null,
            recharge_custom: action.recharge_custom || null,
            script: action.script || null,
            action_type: action.action_type || 'base_action',
            type: action.type || null,
            author: action.author || 'Admin',
            source: action.source || null,
            tags: action.tags || null,
            price: action.price || null,
            weight: action.weight || null,
            properties: action.properties || null,
            is_extended: action.is_extended || false,
            description_font_size: action.description_font_size || null,
            text_alignment: action.text_alignment || null,
            text_font_size: action.text_font_size || null,
            show_detailed_description: action.show_detailed_description || false,
            detailed_description_alignment: action.detailed_description_alignment || null,
            detailed_description_font_size: action.detailed_description_font_size || null,
          });
          
          console.log('[ActionCreator] Форма заполнена, resources установлены:', resourcesArray);
        } catch (err) {
          setError('Ошибка загрузки действия');
          console.error('Error loading action:', err);
        } finally {
          setLoadingAction(false);
        }
      };
      
      loadAction();
    }
  }, [isEditMode, editId, reset]);

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

    // Проверка уникальности ID, если он указан (только при создании)
    if (!isEditMode && data.card_number && data.card_number.trim() !== '') {
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
      if (isEditMode && editId) {
        // Обновление существующего действия
        console.log('[ActionCreator] Отправляем данные на обновление:', data);
        
        const updateData: UpdateActionRequest = {
          name: data.name,
          description: data.description,
          detailed_description: data.detailed_description,
          image_url: data.image_url,
          rarity: data.rarity,
          resources: selectedResources.length > 0 ? selectedResources : null,
          distance: data.distance || null,
          recharge: data.recharge || null,
          recharge_custom: data.recharge_custom || null,
          script: data.script || null,
          action_type: data.action_type,
          type: data.type || null,
          author: data.author || 'Admin',
          source: data.source || null,
          tags: data.tags || null,
          price: data.price || null,
          weight: data.weight || null,
          properties: data.properties || null,
          is_extended: data.is_extended || false,
          description_font_size: data.description_font_size || null,
          text_alignment: data.text_alignment || null,
          text_font_size: data.text_font_size || null,
          show_detailed_description: data.show_detailed_description || false,
          detailed_description_alignment: data.detailed_description_alignment || null,
          detailed_description_font_size: data.detailed_description_font_size || null,
        };
        
        console.log('[ActionCreator] Данные для обновления:', updateData);
        await actionsApi.updateAction(editId, updateData);
        navigate('/');
      } else {
        // Создание нового действия
        console.log('[ActionCreator] Отправляем данные на создание:', data);
        
        // Добавляем resources в данные перед отправкой
        const submitData = {
          ...data,
          resources: selectedResources.length > 0 ? selectedResources : null,
        };
        await actionsApi.createAction(submitData);
        navigate('/');
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || (isEditMode ? 'Ошибка обновления действия' : 'Ошибка создания действия');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (loadingAction) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">
        {isEditMode ? 'Редактирование действия' : 'Создание действия'}
      </h1>

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
                  disabled={isEditMode}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {isEditMode ? 'ID действия нельзя изменить' : 'Уникальный идентификатор действия (латинские буквы, цифры, дефисы и подчеркивания, до 30 символов). Если не указан, будет сгенерирован автоматически.'}
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
                  entityId={isEditMode && editId ? editId : (watch('card_number') || 'new')}
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
              {loading ? (isEditMode ? 'Сохранение...' : 'Создание...') : (isEditMode ? 'Сохранить изменения' : 'Создать действие')}
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






