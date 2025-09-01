import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Save, Eye, EyeOff, Wand2, ArrowLeft, Copy } from 'lucide-react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { cardsApi } from '../api/client';
import type { CreateCardRequest, UpdateCardRequest } from '../types';
import { PROPERTIES_OPTIONS, BONUS_TYPE_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';
import RaritySelector from '../components/RaritySelector';
import ImageUploader from '../components/ImageUploader';
import { getWeaponCategoryLabel } from '../utils/propertyLabels';

const CardCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const [showPreview, setShowPreview] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<any>(null);
  const [cardImage, setCardImage] = useState<string>('');
  const [originalCard, setOriginalCard] = useState<any>(null);

  // Определяем, находимся ли мы в режиме редактирования
  const isEditMode = !!id;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateCardRequest>({
    defaultValues: {
      name: searchParams.get('name') || 'Название карты',
      rarity: 'common',
      properties: searchParams.get('properties') ? searchParams.get('properties')!.split(',') as Properties : [],
      description: searchParams.get('description') || 'Описание эффекта',
      price: searchParams.get('price') ? parseInt(searchParams.get('price')!) : null,
      weight: searchParams.get('weight') ? parseFloat(searchParams.get('weight')!) : null,
      bonus_type: searchParams.get('bonus_type') || null,
      bonus_value: searchParams.get('bonus_value') || null
    }
  });

  // Получаем damage_type из URL параметров
  const damageType = searchParams.get('damage_type');

  // Загрузка карты в режиме редактирования
  useEffect(() => {
    const loadCard = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        const loadedCard = await cardsApi.getCard(id);
        setOriginalCard(loadedCard);
        
        // Заполняем форму
        setValue('name', loadedCard.name);
        setValue('description', loadedCard.description);
        setValue('rarity', loadedCard.rarity);
        setValue('properties', loadedCard.properties);
        setValue('price', loadedCard.price);
        setValue('weight', loadedCard.weight);
        setValue('bonus_type', loadedCard.bonus_type);
        setValue('bonus_value', loadedCard.bonus_value);
        setValue('description_font_size', loadedCard.description_font_size);
        setValue('is_extended', loadedCard.is_extended);
        
        // Устанавливаем изображение
        setCardImage(loadedCard.image_url || '');
        
        setPreviewCard(loadedCard);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки карточки');
      } finally {
        setLoading(false);
      }
    };

    if (isEditMode) {
      loadCard();
    }
  }, [id, setValue, isEditMode]);

  // Если это создание из шаблона, генерируем описание автоматически
  useEffect(() => {
    if (!isEditMode) {
      const name = searchParams.get('name');
      const category = searchParams.get('category');
      if (name && category) {
        const generatedDescription = generateDescriptionFromTemplate(name, category);
        setValue('description', generatedDescription);
      }
    }
  }, [searchParams, setValue, isEditMode]);

  const watchedValues = watch();

  // Функция для генерации описания из шаблона
  const generateDescriptionFromTemplate = (name: string, category: string): string => {
    return `${name} - это ${getWeaponCategoryLabel(category)} оружие.`;
  };

  // Обновление предварительного просмотра
  const updatePreview = () => {
    if (isEditMode && originalCard) {
      // В режиме редактирования используем данные оригинальной карты
      setPreviewCard({
        ...originalCard,
        name: watchedValues.name || originalCard.name || '',
        description: watchedValues.description || originalCard.description || '',
        rarity: watchedValues.rarity || originalCard.rarity || 'common',
        properties: watchedValues.properties || originalCard.properties || [],
        image_url: cardImage || originalCard.image_url || null,
        price: watchedValues.price || originalCard.price || null,
        weight: watchedValues.weight || originalCard.weight || null,
        bonus_type: watchedValues.bonus_type || originalCard.bonus_type || null,
        bonus_value: watchedValues.bonus_value || originalCard.bonus_value || null,
        damage_type: originalCard.damage_type || damageType || null,
        description_font_size: watchedValues.description_font_size || originalCard.description_font_size || null,
      is_extended: watchedValues.is_extended !== undefined ? watchedValues.is_extended : originalCard.is_extended,
      });
    } else {
      // В режиме создания используем данные формы
      setPreviewCard({
        id: 'preview',
        name: watchedValues.name || 'Название карты',
        description: watchedValues.description || 'Описание эффекта',
        rarity: watchedValues.rarity || 'common',
        properties: watchedValues.properties || [],
        image_url: cardImage || null,
        price: watchedValues.price || null,
        weight: watchedValues.weight || null,
        bonus_type: watchedValues.bonus_type || null,
        bonus_value: watchedValues.bonus_value || null,
        damage_type: damageType || null,
        description_font_size: watchedValues.description_font_size || null,
        card_number: 'PREVIEW',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  };

  // Обработка отправки формы
  const onSubmit = async (data: CreateCardRequest | UpdateCardRequest) => {
    try {
      setLoading(true);
      setError(null);
      
      // Добавляем изображение к данным карточки и обрабатываем пустые свойства
      const cardData = {
        ...data,
        properties: data.properties && data.properties.length > 0 ? data.properties : null, // Массив свойств
        image_url: cardImage || '',
        price: data.price || null, // Добавляем цену
        weight: data.weight || null, // Добавляем вес
        bonus_type: data.bonus_type || null, // Добавляем тип бонуса
        bonus_value: data.bonus_value || null, // Добавляем значение бонуса
        damage_type: damageType || null, // Добавляем тип урона
        description_font_size: data.description_font_size || null, // Добавляем размер шрифта
      is_extended: data.is_extended || null
      };

      if (isEditMode && id) {
        // Режим редактирования
        await cardsApi.updateCard(id, cardData);
        navigate('/');
      } else {
        // Режим создания
        const newCard = await cardsApi.createCard(cardData);
        
        // Генерация изображения только если не загружено пользователем
        if (!cardImage) {
          try {
            await cardsApi.generateImage({ card_id: newCard.id });
          } catch (imageError) {
            console.warn('Ошибка генерации изображения:', imageError);
          }
        }
        
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Ошибка ${isEditMode ? 'обновления' : 'создания'} карточки`);
    } finally {
      setLoading(false);
    }
  };

  // Функция для создания новой карты на основе текущей
  const handleCreateAsNew = async (data: CreateCardRequest | UpdateCardRequest) => {
    try {
      setSaving(true);
      setError(null);
      
      // Создаем новую карту на основе текущих данных
      const cardData = {
        ...data,
        properties: data.properties && data.properties.length > 0 ? data.properties : null,
        image_url: cardImage || '',
        price: data.price || null,
        weight: data.weight || null,
        bonus_type: data.bonus_type || null,
        bonus_value: data.bonus_value || null,
        damage_type: damageType || null,
        description_font_size: data.description_font_size || null
      };

      const newCard = await cardsApi.createCard(cardData);
      
      // Генерация изображения только если не загружено пользователем
      if (!cardImage) {
        try {
          await cardsApi.generateImage({ card_id: newCard.id });
        } catch (imageError) {
          console.warn('Ошибка генерации изображения:', imageError);
        }
      }
      
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания новой карточки');
    } finally {
      setSaving(false);
    }
  };

  // Загружаем изображение из шаблона, если оно есть
  useEffect(() => {
    const imagePath = searchParams.get('image_path');
    if (imagePath && !cardImage) {
      setCardImage(imagePath);
    }
  }, [searchParams, cardImage]);

  // Обновляем предварительный просмотр при изменении значений
  useEffect(() => {
    updatePreview();
  }, [watchedValues.name, watchedValues.description, watchedValues.rarity, watchedValues.properties, watchedValues.price, watchedValues.weight, watchedValues.bonus_type, watchedValues.bonus_value, watchedValues.description_font_size, cardImage]);

  // Инициализируем предпросмотр при загрузке
  useEffect(() => {
    updatePreview();
  }, []);

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
            {isEditMode ? 'Редактировать карточку' : 'Создать карточку'}
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
                Свойства
              </label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto border border-gray-300 rounded-lg p-2">
                {PROPERTIES_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      value={option.value}
                      {...register('properties')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Выберите одно или несколько свойств (необязательно)
              </p>
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

            {/* Цена */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Цена (золотые монеты)
              </label>
              <input
                type="number"
                min="1"
                max="50000"
                placeholder="Например: 100"
                className="input-field"
                {...register('price', {
                  setValueAs: (value) => value ? parseInt(value) : null
                })}
              />
              <p className="mt-1 text-xs text-gray-500">
                Цена от 1 до 50000 золотых монет (необязательно)
              </p>
            </div>

            {/* Вес */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Вес (фунты)
              </label>
              <input
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                placeholder="Например: 2.5"
                className="input-field"
                {...register('weight', {
                  setValueAs: (value) => value ? parseFloat(value) : null
                })}
              />
              <p className="mt-1 text-xs text-gray-500">
                Вес от 0.01 до 1000 фунтов (необязательно)
              </p>
            </div>

            {/* Бонусы */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Тип бонуса
                </label>
                <select
                  className="input-field"
                  {...register('bonus_type')}
                >
                  <option value="">Выберите тип (необязательно)</option>
                  {BONUS_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Значение бонуса
                </label>
                <input
                  type="text"
                  placeholder="Например: +2, 1к4, advantage"
                  className="input-field"
                  {...register('bonus_value')}
                />
              </div>
            </div>

            {/* Размер шрифта описания */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Размер шрифта описания (необязательно)
              </label>
              <input
                type="number"
                min="6"
                max="20"
                placeholder="Автоматический размер"
                className="input-field"
                {...register('description_font_size', { 
                  valueAsNumber: true,
                  min: { value: 6, message: 'Минимум 6px' },
                  max: { value: 20, message: 'Максимум 20px' }
                })}
                onChange={(e) => {
                  const value = e.target.value ? parseInt(e.target.value) : null;
                  setValue('description_font_size', value, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                  // Немедленно обновляем предпросмотр
                  updatePreview();
                }}
              />
              <p className="mt-1 text-sm text-gray-500">
                Оставьте пустым для автоматического размера. Диапазон: 6-20px
              </p>
              {errors.description_font_size && (
                <p className="mt-1 text-sm text-red-600">{errors.description_font_size.message}</p>
              )}
            </div>

            {/* Расширенный формат карточки */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Расширенный формат карточки
              </label>
              <div className="flex items-center space-x-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="is_extended"
                    value="auto"
                    defaultChecked={true}
                    onChange={() => {
                      setValue('is_extended', null, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                      updatePreview();
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700">Автоматически (по длине описания)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="is_extended"
                    value="true"
                    onChange={() => {
                      setValue('is_extended', true, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                      updatePreview();
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700">Принудительно расширенный</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="is_extended"
                    value="false"
                    onChange={() => {
                      setValue('is_extended', false, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
                      updatePreview();
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700">Принудительно обычный</span>
                </label>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Расширенные карточки в два раза шире и подходят для длинных описаний
              </p>
            </div>

            {/* Изображение */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Изображение карточки
              </label>
              <ImageUploader
                onImageUpload={setCardImage}
                currentImageUrl={cardImage}
                className="min-h-[200px]"
              />
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
                disabled={loading || saving}
                className="btn-primary flex items-center space-x-2 disabled:opacity-50"
              >
                <Save size={18} />
                <span>
                  {loading || saving 
                    ? (isEditMode ? 'Сохранение...' : 'Создание...') 
                    : (isEditMode ? 'Сохранить изменения' : 'Создать карточку')
                  }
                </span>
              </button>
              
              {isEditMode && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSubmit(handleCreateAsNew)}
                  className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
                >
                  <Copy size={18} />
                  <span>{saving ? 'Создание...' : 'Создать как новую карту'}</span>
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Предварительный просмотр */}
        {showPreview && previewCard && (
          <div className="space-y-4">
                          <h2 className="text-xl font-fantasy font-semibold text-gray-900">Предварительный просмотр</h2>
            <div className="flex justify-center py-8">
              <CardPreview 
                card={previewCard} 
                className={`card-preview-large ${previewCard.description && previewCard.description.length > 100 ? 'card-preview-extended' : ''}`} 
              />
            </div>
            <div className="text-center text-sm text-gray-500">
              <p>Размер карточки: 78.75мм x 111.375мм (увеличенный предпросмотр)</p>
              <p>Печать: 52.5мм x 74.25мм, 16 карточек на А4 лист</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CardCreator;
