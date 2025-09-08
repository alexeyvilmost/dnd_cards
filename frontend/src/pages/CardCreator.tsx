import React, { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Save, Eye, EyeOff, ArrowLeft, Library } from 'lucide-react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { cardsApi } from '../api/client';
import { imagesApi } from '../api/imagesApi';
import type { CreateCardRequest, UpdateCardRequest, Properties } from '../types';
import { PROPERTIES_OPTIONS, BONUS_TYPE_OPTIONS } from '../types';
import { ITEM_TYPE_OPTIONS } from '../constants/itemTypes';
import CardPreview from '../components/CardPreview';
import RaritySelector from '../components/RaritySelector';
import PropertySelector from '../components/PropertySelector';
import ImageUploader from '../components/ImageUploader';
import ImageGenerator from '../components/ImageGenerator';
import ImageLibraryModal from '../components/ImageLibraryModal';
import TagsInput from '../components/TagsInput';
import CollapsibleBlock from '../components/CollapsibleBlock';
import type { ImageLibraryItem } from '../api/imageLibraryApi';

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
  const [showImageLibrary, setShowImageLibrary] = useState(false);

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
      bonus_value: searchParams.get('bonus_value') || null,
      damage_type: searchParams.get('damage_type') || null,
      defense_type: null,
      is_extended: false,
      author: searchParams.get('author') || 'Admin',
      source: searchParams.get('source') || null,
      type: searchParams.get('type') || null,
      related_cards: [],
      related_actions: [],
      related_effects: [],
      attunement: null,
      tags: searchParams.get('tags') ? searchParams.get('tags')!.split(',') as Properties : []
    }
  });

  const watchedValues = watch();

  // Обрабатываем URL параметры для изображения
  useEffect(() => {
    const imageUrl = searchParams.get('image_url');
    if (imageUrl) {
      setCardImage(imageUrl);
    }
  }, [searchParams]);

  // Загружаем данные карты для редактирования
  useEffect(() => {
    if (isEditMode && id) {
    const loadCard = async () => {
      try {
        setLoading(true);
          const card = await cardsApi.getCard(id);
          setOriginalCard(card);
          
          // Заполняем форму данными карты
          setValue('name', card.name);
          setValue('rarity', card.rarity);
          setValue('properties', card.properties || []);
          setValue('description', card.description);
          setValue('price', card.price);
          setValue('weight', card.weight);
          setValue('bonus_type', card.bonus_type);
          setValue('bonus_value', card.bonus_value);
          setValue('damage_type', card.damage_type);
          setValue('defense_type', card.defense_type);
          setValue('is_extended', card.is_extended || false);
          setValue('author', card.author || 'Admin');
          setValue('source', card.source);
          setValue('type', card.type);
          setValue('related_cards', card.related_cards || []);
          setValue('related_actions', card.related_actions || []);
          setValue('related_effects', card.related_effects || []);
          setValue('attunement', card.attunement);
          setValue('tags', card.tags || []);
          
          if (card.image_url) {
            setCardImage(card.image_url);
          }
      } catch (err) {
          setError('Ошибка загрузки карты');
      } finally {
        setLoading(false);
      }
    };

      loadCard();
    }
  }, [id, isEditMode, setValue]);

  // Мемоизируем watchedValues для предотвращения бесконечных циклов
  const memoizedWatchedValues = useMemo(() => watchedValues, [
    watchedValues.name,
    watchedValues.rarity,
    watchedValues.description,
    watchedValues.properties,
    watchedValues.price,
    watchedValues.weight,
    watchedValues.bonus_type,
    watchedValues.bonus_value,
    watchedValues.damage_type,
    watchedValues.defense_type,
    watchedValues.is_extended,
    watchedValues.author,
    watchedValues.source,
    watchedValues.type,
    watchedValues.related_cards,
    watchedValues.related_actions,
    watchedValues.related_effects,
    watchedValues.attunement,
    watchedValues.tags
  ]);

  // Обновляем превью при изменении данных
  useEffect(() => {
    if (memoizedWatchedValues.name && memoizedWatchedValues.name !== 'Название карты') {
      setPreviewCard({
        ...memoizedWatchedValues,
        image_url: cardImage,
        card_number: originalCard?.card_number || '001',
        created_at: originalCard?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }, [memoizedWatchedValues, cardImage, originalCard]);

  // Обработка отправки формы
  const onSubmit = async (data: CreateCardRequest) => {
    try {
      setSaving(true);
      setError(null);
      
      // Подготавливаем данные карты
      const cardData: CreateCardRequest = {
        name: data.name || 'Название карты',
        description: data.description || 'Описание эффекта',
        rarity: data.rarity || 'common',
        properties: data.properties && data.properties.length > 0 ? data.properties : null,
        price: data.price || null,
        weight: data.weight || null,
        bonus_type: data.bonus_type || null,
        bonus_value: data.bonus_value || null,
        damage_type: data.damage_type || null,
        defense_type: data.defense_type || null,
        description_font_size: null,
        is_extended: data.is_extended || false,
        author: data.author || 'Admin',
        source: data.source || null,
        type: data.type || null,
        related_cards: data.related_cards || null,
        related_actions: data.related_actions || null,
        related_effects: data.related_effects || null,
        attunement: data.attunement || null,
        tags: data.tags && data.tags.length > 0 ? data.tags : null
      };

      let cardId: string;

      if (isEditMode && id) {
        // Режим редактирования
        await cardsApi.updateCard(id, cardData);
        cardId = id;
      } else {
        // Режим создания
      const newCard = await cardsApi.createCard(cardData);
        cardId = newCard.id;
      }

      // Загружаем изображение в облако, если оно есть
      if (cardImage && cardImage.startsWith('data:image/')) {
        try {
          const response = await fetch(cardImage);
          const blob = await response.blob();
          const file = new File([blob], 'card-image.png', { type: 'image/png' });

          await imagesApi.uploadImage('card', cardId, file);
        } catch (uploadError) {
          console.warn('Ошибка загрузки изображения в облако:', uploadError);
        }
      }

      // Перенаправляем на страницу библиотеки
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка сохранения карты');
    } finally {
      setSaving(false);
    }
  };

  // Функция для выбора изображения из библиотеки
  const handleSelectFromLibrary = (image: ImageLibraryItem) => {
    setCardImage(image.cloudinary_url);
    // Автоматически заполняем название и редкость, если они пустые
    if (!memoizedWatchedValues.name && image.card_name) {
      setValue('name', image.card_name);
    }
    if (!memoizedWatchedValues.rarity && image.card_rarity) {
      setValue('rarity', image.card_rarity);
    }
  };

  // Загружаем изображение из шаблона, если оно есть
  useEffect(() => {
    const imagePath = searchParams.get('image_path');
    if (imagePath && !cardImage) {
      setCardImage(imagePath);
    }
  }, [searchParams, cardImage]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
      {/* Заголовок */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/')}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
                <ArrowLeft size={20} />
                <span>Назад к библиотеке</span>
          </button>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">
              {isEditMode ? 'Редактирование карты' : 'Создание карты'}
          </h1>
            <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowPreview(!showPreview)}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
                {showPreview ? <EyeOff size={20} /> : <Eye size={20} />}
                <span>{showPreview ? 'Скрыть превью' : 'Показать превью'}</span>
          </button>
        </div>
      </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            {error}
          </div>
        )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Форма */}
          <div className="bg-white rounded-lg shadow p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Основная информация */}
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Основная информация</h2>
              
              {/* Название */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Название карты
                </label>
                <input
                  {...register('name', { required: 'Название обязательно' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Введите название карты"
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                )}
              </div>

              {/* Редкость */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Редкость
                </label>
                  <RaritySelector
                    value={memoizedWatchedValues.rarity}
                    onChange={(rarity) => setValue('rarity', rarity)}
                  />
              </div>

              {/* Описание */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Описание
                </label>
                <textarea
                    {...register('description', { required: 'Описание обязательно' })}
                  rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Введите описание эффекта"
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
                )}
              </div>

              {/* Цена и вес */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                      Цена (золото)
                  </label>
                  <input
                    type="number"
                    {...register('price', { valueAsNumber: true })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                      Вес (фунты)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    {...register('weight', { valueAsNumber: true })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.0"
                  />
                </div>
              </div>
            </div>

            {/* Блок "Изображение" */}
            <CollapsibleBlock title="Изображение" defaultOpen={true}>
              <div className="space-y-4">
                {/* Генератор изображений */}
                <ImageGenerator
                  entityType="card"
                  entityId={id || ''}
                  entityName={memoizedWatchedValues.name}
                  entityRarity={memoizedWatchedValues.rarity}
                  entityDescription={memoizedWatchedValues.description}
                  onImageGenerated={setCardImage}
                  disabled={!memoizedWatchedValues.name || memoizedWatchedValues.name === 'Название карты'}
                  className="mb-4"
                />

                {/* Кнопка выбора из библиотеки */}
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => setShowImageLibrary(true)}
                    className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center space-x-2"
                  >
                    <Library size={20} />
                    <span>Выбрать из библиотеки</span>
                  </button>
                </div>
                
                {/* Загрузчик изображений */}
                <ImageUploader
                  onImageUpload={setCardImage}
                  currentImageUrl={cardImage}
                  entityType="card"
                  entityId={id || ''}
                  enableCloudUpload={false}
                />
              </div>
            </CollapsibleBlock>

            {/* Блок "Дополнительно" */}
            <CollapsibleBlock title="Дополнительно">
              <div className="space-y-6">

            {/* Расширенная карта */}
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  {...register('is_extended')}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Расширенная карта</span>
              </label>
              <p className="text-xs text-gray-500 mt-1">
                Расширенная карта имеет больший размер и больше места для описания
              </p>
            </div>

            {/* Автор */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Автор
              </label>
              <input
                type="text"
                {...register('author')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Admin"
              />
            </div>

            {/* Источник */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Источник
              </label>
              <input
                type="text"
                {...register('source')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Player's Handbook"
              />
            </div>

            {/* Тип предмета */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Тип предмета
              </label>
              <select
                {...register('type')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Выберите тип</option>
                {ITEM_TYPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Настройка */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Настройка
              </label>
              <textarea
                {...register('attunement')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Описание настройки на артефакт..."
              />
            </div>

            {/* Теги */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Теги
              </label>
              <TagsInput
                value={memoizedWatchedValues.tags || []}
                onChange={(tags) => setValue('tags', tags)}
                placeholder="Короткий меч, Магическое, Одноручное"
              />
            </div>

                {/* Детальное описание */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                      Детальное описание
                  </label>
                  <textarea
                      {...register('detailed_description')}
                    rows={6}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Введите подробное описание (необязательно)"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Подробное описание будет отображаться в модальном окне с детальным просмотром карты
                  </p>
                </div>

                {/* Свойства */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Свойства
                  </label>
                  <PropertySelector
                    value={memoizedWatchedValues.properties || []}
                    onChange={(properties) => setValue('properties', properties)}
                  />
                </div>

              {/* Бонус */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Тип бонуса
                </label>
                <select
                  {...register('bonus_type')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="">Выберите тип</option>
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
                  {...register('bonus_value')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="+1"
                />
              </div>
            </div>

            {/* Тип урона - показывается только если выбран тип бонуса "Урон" */}
            {memoizedWatchedValues.bonus_type === 'damage' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Тип урона
                </label>
                <select
                  {...register('damage_type')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Выберите тип урона</option>
                  <option value="slashing">Рубящий</option>
                  <option value="piercing">Колющий</option>
                  <option value="bludgeoning">Дробящий</option>
                </select>
              </div>
            )}

            {/* Тип брони - показывается только если выбран тип бонуса "Защита" */}
            {memoizedWatchedValues.bonus_type === 'defense' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Тип брони
                </label>
                <select
                  {...register('defense_type')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Выберите тип брони</option>
                  <option value="light">Легкая</option>
                  <option value="medium">Средняя</option>
                  <option value="heavy">Тяжелая</option>
                </select>
              </div>
            )}
              </div>
            </CollapsibleBlock>

            {/* Кнопки */}
              <div className="flex justify-end space-x-4 pt-6">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save size={20} />
                  <span>{saving ? 'Сохранение...' : (isEditMode ? 'Сохранить' : 'Создать')}</span>
                </button>
            </div>
          </form>
        </div>

          {/* Превью */}
          {showPreview && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Превью карты</h3>
              {previewCard ? (
                <div className="flex justify-center">
                  <div className="transform scale-130 mt-16">
                    <CardPreview card={previewCard} disableHover={true} />
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  Заполните название карты для просмотра превью
            </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Модальное окно библиотеки изображений */}
      <ImageLibraryModal
        isOpen={showImageLibrary}
        onClose={() => setShowImageLibrary(false)}
        onSelectImage={handleSelectFromLibrary}
      />
    </div>
  );
};

export default CardCreator;