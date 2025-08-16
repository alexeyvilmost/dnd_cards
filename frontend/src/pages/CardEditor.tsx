import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, Eye, EyeOff, Wand2, ArrowLeft } from 'lucide-react';
import { cardsApi } from '../api/client';
import type { UpdateCardRequest } from '../types';
import { PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import RaritySelector from '../components/RaritySelector';

const CardEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showPreview, setShowPreview] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<any>(null);
  const [previewCard, setPreviewCard] = useState<any>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UpdateCardRequest>();

  const watchedValues = watch();

  // Загрузка карточки
  useEffect(() => {
    const loadCard = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        const loadedCard = await cardsApi.getCard(id);
        setCard(loadedCard);
        
        // Заполняем форму
        setValue('name', loadedCard.name);
        setValue('description', loadedCard.description);
        setValue('rarity', loadedCard.rarity);
        setValue('properties', loadedCard.properties);
        
        setPreviewCard(loadedCard);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки карточки');
      } finally {
        setLoading(false);
      }
    };

    loadCard();
  }, [id, setValue]);

  // Обновление предварительного просмотра
  const updatePreview = () => {
    if (watchedValues.name && watchedValues.description && watchedValues.rarity && watchedValues.properties) {
      setPreviewCard({
        ...card,
        name: watchedValues.name,
        description: watchedValues.description,
        rarity: watchedValues.rarity,
        properties: watchedValues.properties,
      });
    }
  };

  useEffect(() => {
    updatePreview();
  }, [watchedValues.name, watchedValues.description, watchedValues.rarity, watchedValues.properties]);

  // Обработка отправки формы
  const onSubmit = async (data: UpdateCardRequest) => {
    if (!id) return;
    
    try {
      setSaving(true);
      setError(null);
      
      await cardsApi.updateCard(id, data);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления карточки');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="btn-secondary mt-4"
        >
          Вернуться в библиотеку
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/')}
            className="btn-secondary flex items-center space-x-2"
          >
            <ArrowLeft size={18} />
            <span>Назад</span>
          </button>
          <h1 className="text-3xl font-fantasy font-bold text-gray-900">
            Редактировать карточку
          </h1>
        </div>
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
            <RaritySelector
              value={watchedValues.rarity || ''}
              onChange={(value) => {
                setValue('rarity', value, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                // Немедленно обновляем предпросмотр
                updatePreview();
              }}
              error={errors.rarity?.message}
            />

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
                Описание *
              </label>
              <textarea
                {...register('description', { required: 'Описание обязательно' })}
                className="input-field"
                rows={4}
                placeholder="Опишите эффект зелья..."
              />
              {errors.description && (
                <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
              )}
            </div>

            {/* Кнопки */}
            <div className="flex space-x-4">
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex items-center space-x-2"
              >
                <Save size={18} />
                <span>{saving ? 'Сохранение...' : 'Сохранить изменения'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Предварительный просмотр */}
        {showPreview && previewCard && (
          <div className="flex justify-center">
            <CardPreview card={previewCard} />
          </div>
        )}
      </div>
    </div>
  );
};

export default CardEditor;
