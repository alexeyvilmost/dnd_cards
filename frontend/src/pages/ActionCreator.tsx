import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { actionsApi } from '../api/client';
import type { CreateActionRequest } from '../types';
import { RARITY_OPTIONS, ACTION_RESOURCE_OPTIONS, ACTION_RECHARGE_OPTIONS, ACTION_TYPE_OPTIONS } from '../types';
import ActionPreview from '../components/ActionPreview';

const ActionCreator = () => {
  const navigate = useNavigate();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<CreateActionRequest>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formData = watch();
  const previewAction = {
    id: '',
    name: formData.name || 'Название действия',
    description: formData.description || 'Описание действия',
    detailed_description: formData.detailed_description || null,
    image_url: formData.image_url || '',
    rarity: formData.rarity || 'common',
    card_number: 'ACTION-0000',
    resource: formData.resource || 'action',
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

  const onSubmit = async (data: CreateActionRequest) => {
    setLoading(true);
    setError(null);
    try {
      const created = await actionsApi.createAction(data);
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
                  Ресурс *
                </label>
                <select
                  {...register('resource', { required: 'Ресурс обязателен' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ACTION_RESOURCE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
                  URL изображения
                </label>
                <input
                  {...register('image_url')}
                  type="url"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com/image.png"
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

