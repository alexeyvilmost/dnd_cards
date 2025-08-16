import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Save, Eye, EyeOff, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { CreateCardRequest } from '../types';
import { PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import RaritySelector from '../components/RaritySelector';

const CardCreator = () => {
  const navigate = useNavigate();
  const [showPreview, setShowPreview] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<any>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateCardRequest>({
    defaultValues: {
      name: 'Название карты',
      rarity: 'common',
      properties: '',
      description: 'Описание эффекта'
    }
  });

  const watchedValues = watch();

  // Обновление предварительного просмотра
  const updatePreview = () => {
    // Обновляем предпросмотр даже если не все поля заполнены
    setPreviewCard({
      id: 'preview',
      name: watchedValues.name || 'Название карты',
      description: watchedValues.description || 'Описание эффекта',
      rarity: watchedValues.rarity || 'common',
      properties: watchedValues.properties || '',
      card_number: 'PREVIEW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  };

  // Обработка отправки формы
  const onSubmit = async (data: CreateCardRequest) => {
    try {
      setLoading(true);
      setError(null);
      
      const newCard = await cardsApi.createCard(data);
      
      // Генерация изображения
      try {
        await cardsApi.generateImage({ card_id: newCard.id });
      } catch (imageError) {
        console.warn('Ошибка генерации изображения:', imageError);
      }
      
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания карточки');
    } finally {
      setLoading(false);
    }
  };

  // Обновляем предварительный просмотр при изменении значений
  useEffect(() => {
    updatePreview();
  }, [watchedValues.name, watchedValues.description, watchedValues.rarity, watchedValues.properties]);

  // Инициализируем предпросмотр при загрузке
  useEffect(() => {
    updatePreview();
  }, []);

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-fantasy font-bold text-gray-900">
          Создать карточку
        </h1>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="btn-secondary flex items-center space-x-2"
          >
            {showPreview ? <EyeOff size={18} /> : <Eye size={18} />}
            <span>{showPreview ? 'Скрыть' : 'Показать'} предпросмотр</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Форма */}
        <div className="space-y-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Название */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Название зелья *
              </label>
              <input
                type="text"
                {...register('name', { required: 'Название обязательно' })}
                className="input-field"
                placeholder="Например: Зелье лечения"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            {/* Редкость */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Редкость *
              </label>
              <RaritySelector
                value={watchedValues.rarity || ''}
                onChange={(value) => {
                  setValue('rarity', value, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                  // Немедленно обновляем предпросмотр
                  updatePreview();
                }}
                error={errors.rarity?.message}
              />
            </div>

            {/* Свойства */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Свойства *
              </label>
              <select
                {...register('properties', { required: 'Выберите свойства' })}
                className="input-field"
              >
                <option value="">Выберите свойства</option>
                {PROPERTIES_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.properties && (
                <p className="mt-1 text-sm text-red-600">{errors.properties.message}</p>
              )}
            </div>

            {/* Описание */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Описание эффекта *
              </label>
              <textarea
                {...register('description', { 
                  required: 'Описание обязательно',
                  minLength: { value: 10, message: 'Описание должно содержать минимум 10 символов' }
                })}
                rows={4}
                className="input-field resize-none"
                placeholder="Опишите эффект зелья..."
                defaultValue="Описание эффекта"
              />
              {errors.description && (
                <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
              )}
            </div>

            {/* Сообщение об ошибке */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700">{error}</p>
              </div>
            )}

            {/* Кнопки */}
            <div className="flex space-x-4">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50"
              >
                <Save size={18} />
                <span>{loading ? 'Создание...' : 'Создать карточку'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Предварительный просмотр */}
        {showPreview && previewCard && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">Предварительный просмотр</h2>
            <div className="flex justify-center">
              <CardPreview card={previewCard} />
            </div>
            <div className="text-center text-sm text-gray-500">
              <p>Размер карточки: 52.5мм x 74.25мм</p>
              <p>16 карточек на А4 лист</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CardCreator;
