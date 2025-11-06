import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { effectsApi } from '../api/client';
import type { CreatePassiveEffectRequest } from '../types';
import { RARITY_OPTIONS, PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';
import EffectPreview from '../components/EffectPreview';

const EffectCreator = () => {
  const navigate = useNavigate();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<CreatePassiveEffectRequest>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formData = watch();
  const previewEffect = {
    id: '',
    name: formData.name || 'Название эффекта',
    description: formData.description || 'Описание эффекта',
    detailed_description: formData.detailed_description || null,
    image_url: formData.image_url || '',
    rarity: formData.rarity || 'common',
    card_number: 'EFFECT-0000',
    effect_type: formData.effect_type || 'passive',
    condition_description: formData.condition_description || null,
    script: formData.script || null,
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

  const onSubmit = async (data: CreatePassiveEffectRequest) => {
    setLoading(true);
    setError(null);
    try {
      const created = await effectsApi.createEffect(data);
      navigate(`/effect/${created.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка создания эффекта');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Создание эффекта</h1>

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
                  placeholder="Название эффекта"
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
                  placeholder="Описание эффекта"
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
                  Тип эффекта *
                </label>
                <select
                  {...register('effect_type', { required: 'Тип эффекта обязателен' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PASSIVE_EFFECT_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {watch('effect_type') === 'conditional' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Описание условия
                  </label>
                  <textarea
                    {...register('condition_description')}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="При каких условиях эффект активен"
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
              {loading ? 'Создание...' : 'Создать эффект'}
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
            <h3 className="text-lg font-medium text-gray-900 mb-4">Превью эффекта</h3>
            <div className="flex justify-center">
              <EffectPreview effect={previewEffect} disableHover={true} />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default EffectCreator;
