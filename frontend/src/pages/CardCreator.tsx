import React, { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Save, Eye, EyeOff, ArrowLeft, Library, Wand2 } from 'lucide-react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { cardsApi } from '../api/client';
import { imagesApi } from '../api/imagesApi';
import type { CreateCardRequest, UpdateCardRequest, Properties } from '../types';
import { PROPERTIES_OPTIONS, BONUS_TYPE_OPTIONS, EQUIPMENT_SLOTS } from '../types';
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
  const [createdCardId, setCreatedCardId] = useState<string | null>(null); // ID карты, созданной при генерации изображения
  const [isPollingImage, setIsPollingImage] = useState(false); // Флаг активного polling'а

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
      tags: searchParams.get('tags') ? searchParams.get('tags')!.split(',') as Properties : [],
      slot: null,
      is_template: 'false'
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
          setValue('detailed_description', card.detailed_description || null);
          setValue('price', card.price);
          setValue('weight', card.weight);
          setValue('bonus_type', card.bonus_type);
          setValue('bonus_value', card.bonus_value);
          setValue('damage_type', card.damage_type);
          setValue('defense_type', card.defense_type);
          setValue('text_alignment', card.text_alignment || null);
          setValue('text_font_size', card.text_font_size || null);
          setValue('show_detailed_description', card.show_detailed_description === true);
          setValue('detailed_description_alignment', card.detailed_description_alignment || null);
          setValue('detailed_description_font_size', card.detailed_description_font_size || null);
          setValue('is_extended', card.is_extended === true);
          setValue('author', card.author || 'Admin');
          setValue('source', card.source);
          setValue('type', card.type);
          setValue('related_cards', card.related_cards || []);
          setValue('related_actions', card.related_actions || []);
          setValue('related_effects', card.related_effects || []);
          setValue('attunement', card.attunement);
          setValue('tags', card.tags || []);
          setValue('slot', card.slot);
          setValue('is_template', card.is_template);
          
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

  // Загружаем данные шаблона для создания карты
  useEffect(() => {
    const templateId = searchParams.get('template_id');
    if (templateId && !isEditMode) {
      const loadTemplate = async () => {
        try {
          setLoading(true);
          const template = await cardsApi.getCard(templateId);
          
          // Заполняем форму данными шаблона
          setValue('name', template.name);
          setValue('rarity', template.rarity);
          setValue('properties', template.properties || []);
          setValue('description', template.description);
          setValue('detailed_description', template.detailed_description || null);
          setValue('price', template.price);
          setValue('weight', template.weight);
          setValue('bonus_type', template.bonus_type);
          setValue('bonus_value', template.bonus_value);
          setValue('damage_type', template.damage_type);
          setValue('defense_type', template.defense_type);
          setValue('text_alignment', template.text_alignment || null);
          setValue('text_font_size', template.text_font_size || null);
          setValue('show_detailed_description', template.show_detailed_description === true);
          setValue('detailed_description_alignment', template.detailed_description_alignment || null);
          setValue('detailed_description_font_size', template.detailed_description_font_size || null);
          setValue('is_extended', template.is_extended === true);
          setValue('author', template.author || 'Admin');
          setValue('source', template.source);
          setValue('type', template.type);
          setValue('related_cards', template.related_cards || []);
          setValue('related_actions', template.related_actions || []);
          setValue('related_effects', template.related_effects || []);
          setValue('attunement', template.attunement);
          setValue('tags', template.tags || []);
          setValue('slot', template.slot);
          setValue('is_template', 'false'); // Новая карта не является шаблоном
          
          if (template.image_url) {
            setCardImage(template.image_url);
          }
        } catch (err) {
          setError('Ошибка загрузки шаблона');
        } finally {
          setLoading(false);
        }
      };

      loadTemplate();
    }
  }, [searchParams, isEditMode, setValue]);

  // Мемоизируем watchedValues для предотвращения бесконечных циклов
  const memoizedWatchedValues = useMemo(() => watchedValues, [
    watchedValues.name,
    watchedValues.rarity,
    watchedValues.description,
    watchedValues.detailed_description,
    watchedValues.properties,
    watchedValues.price,
    watchedValues.weight,
    watchedValues.bonus_type,
    watchedValues.bonus_value,
    watchedValues.damage_type,
    watchedValues.defense_type,
    watchedValues.is_extended,
    watchedValues.text_alignment,
    watchedValues.text_font_size,
    watchedValues.show_detailed_description,
    watchedValues.detailed_description_alignment,
    watchedValues.detailed_description_font_size,
    watchedValues.author,
    watchedValues.source,
    watchedValues.type,
    watchedValues.related_cards,
    watchedValues.related_actions,
    watchedValues.related_effects,
    watchedValues.attunement,
    watchedValues.tags,
    watchedValues.slot,
    watchedValues.is_template
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
        detailed_description: data.detailed_description || null,
        rarity: data.rarity || 'common',
        properties: data.properties && data.properties.length > 0 ? data.properties : null,
        price: data.price || null,
        weight: data.weight || null,
        bonus_type: data.bonus_type || null,
        bonus_value: data.bonus_value || null,
        damage_type: data.damage_type || null,
        defense_type: data.defense_type || null,
        description_font_size: null,
        text_alignment: data.text_alignment || null,
        text_font_size: data.text_font_size || null,
        show_detailed_description: data.show_detailed_description === true,
        detailed_description_alignment: data.detailed_description_alignment || null,
        detailed_description_font_size: data.detailed_description_font_size || null,
        is_extended: data.is_extended === true,
        author: data.author || 'Admin',
        source: data.source || null,
        type: data.type || null,
        related_cards: data.related_cards || null,
        related_actions: data.related_actions || null,
        related_effects: data.related_effects || null,
        attunement: data.attunement || null,
        tags: data.tags && data.tags.length > 0 ? data.tags : null,
        slot: data.slot || null,
        is_template: data.is_template || 'false',
        image_prompt_extra: data.image_prompt_extra || null
      };

      let cardId: string;

      if (isEditMode && id) {
        // Режим редактирования
        await cardsApi.updateCard(id, cardData);
        cardId = id;
      } else if (createdCardId) {
        // Карта уже была создана при генерации изображения - обновляем её
        await cardsApi.updateCard(createdCardId, cardData);
        cardId = createdCardId;
      } else {
        // Режим создания - создаём новую карту
        const newCard = await cardsApi.createCard(cardData);
        cardId = newCard.id;
      }

      // Загружаем изображение в облако, если оно есть
      if (cardImage) {
        try {
          if (cardImage.startsWith('data:image/')) {
            // Base64 изображение - конвертируем в файл и загружаем
            const response = await fetch(cardImage);
            const blob = await response.blob();
            const file = new File([blob], 'card-image.png', { type: 'image/png' });
            await imagesApi.uploadImage('card', cardId, file);
          } else if (cardImage.startsWith('http')) {
            // URL изображение из библиотеки - обновляем карту с этим URL
            await cardsApi.updateCard(cardId, { image_url: cardImage });
          }
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

  // Функция для создания карты перед генерацией изображения
  const handleCreateCardForGeneration = async (): Promise<string> => {
    const formData = watch();
    
    // Подготавливаем данные карты
    const cardData: CreateCardRequest = {
      name: formData.name || 'Название карты',
      description: formData.description || 'Описание эффекта',
      detailed_description: formData.detailed_description || null,
      rarity: formData.rarity || 'common',
      properties: formData.properties && formData.properties.length > 0 ? formData.properties : null,
      price: formData.price || null,
      weight: formData.weight || null,
      bonus_type: formData.bonus_type || null,
      bonus_value: formData.bonus_value || null,
      damage_type: formData.damage_type || null,
      defense_type: formData.defense_type || null,
      description_font_size: null,
      text_alignment: formData.text_alignment || null,
      text_font_size: formData.text_font_size || null,
      show_detailed_description: formData.show_detailed_description === true,
      detailed_description_alignment: formData.detailed_description_alignment || null,
      detailed_description_font_size: formData.detailed_description_font_size || null,
      is_extended: formData.is_extended === true,
      author: formData.author || 'Admin',
      source: formData.source || null,
      type: formData.type || null,
      related_cards: formData.related_cards || null,
      related_actions: formData.related_actions || null,
      related_effects: formData.related_effects || null,
      attunement: formData.attunement || null,
      tags: formData.tags && formData.tags.length > 0 ? formData.tags : null,
      slot: formData.slot || null,
      is_template: formData.is_template || 'false',
      image_prompt_extra: formData.image_prompt_extra || null
    };

    // Создаем карту
    const newCard = await cardsApi.createCard(cardData);
    
    // Сохраняем ID созданной карты
    setCreatedCardId(newCard.id);
    
    // Запускаем polling для проверки появления изображения
    startImagePolling(newCard.id);
    
    return newCard.id;
  };

  // Polling для проверки появления изображения
  const startImagePolling = (cardId: string) => {
    setIsPollingImage(true);
    
    const pollInterval = setInterval(async () => {
      try {
        const card = await cardsApi.getCard(cardId);
        
        if (card.image_url) {
          // Изображение появилось - обновляем превью
          setCardImage(card.image_url);
          setIsPollingImage(false);
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Ошибка polling изображения:', error);
      }
    }, 2000); // Проверяем каждые 2 секунды

    // Останавливаем polling через 30 секунд
    setTimeout(() => {
      clearInterval(pollInterval);
      setIsPollingImage(false);
    }, 30000);
  };

  // Функция для создания карты и генерации изображения (старая функция - оставим для совместимости)
  const handleCreateAndGenerate = async () => {
    const formData = watch();
    
    try {
      setSaving(true);
      setError(null);
      
      // Подготавливаем данные карты
      const cardData: CreateCardRequest = {
        name: formData.name || 'Название карты',
        description: formData.description || 'Описание эффекта',
        detailed_description: formData.detailed_description || null,
        rarity: formData.rarity || 'common',
        properties: formData.properties && formData.properties.length > 0 ? formData.properties : null,
        price: formData.price || null,
        weight: formData.weight || null,
        bonus_type: formData.bonus_type || null,
        bonus_value: formData.bonus_value || null,
        damage_type: formData.damage_type || null,
        defense_type: formData.defense_type || null,
        description_font_size: null,
        text_alignment: formData.text_alignment || null,
        text_font_size: formData.text_font_size || null,
        detailed_description_alignment: formData.detailed_description_alignment || null,
        detailed_description_font_size: formData.detailed_description_font_size || null,
        is_extended: formData.is_extended === true,
        author: formData.author || 'Admin',
        source: formData.source || null,
        type: formData.type || null,
        related_cards: formData.related_cards || null,
        related_actions: formData.related_actions || null,
        related_effects: formData.related_effects || null,
        attunement: formData.attunement || null,
        tags: formData.tags && formData.tags.length > 0 ? formData.tags : null,
        slot: formData.slot || null,
        is_template: formData.is_template || 'false',
        image_prompt_extra: formData.image_prompt_extra || null
      };

      // Создаем карту
      const newCard = await cardsApi.createCard(cardData);
      
      // Генерируем изображение
      try {
        const response = await imagesApi.generateImage('card', newCard.id, undefined, {
          name: newCard.name,
          description: newCard.description,
          rarity: newCard.rarity,
          image_prompt_extra: newCard.image_prompt_extra || undefined,
        });
        
        if (response.success) {
          // Обновляем карту с URL изображения
          await cardsApi.updateCard(newCard.id, { image_url: response.image_url });
        }
      } catch (generateError) {
        console.warn('Ошибка генерации изображения:', generateError);
        // Продолжаем, даже если генерация не удалась
      }

      // Перенаправляем на страницу библиотеки
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка создания карты');
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

        {isPollingImage && (
          <div className="mb-6 p-4 bg-blue-100 border border-blue-400 text-blue-700 rounded-lg flex items-center space-x-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-700"></div>
            <span>Генерируется изображение для карты... Это может занять 10-15 секунд.</span>
          </div>
        )}

        {createdCardId && !isEditMode && (
          <div className="mb-6 p-4 bg-green-100 border border-green-400 text-green-700 rounded-lg">
            ✓ Карта создана. Продолжайте редактирование или нажмите "Сохранить" для применения изменений.
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
                  entityId={id || createdCardId || ''}
                  entityName={memoizedWatchedValues.name}
                  entityRarity={memoizedWatchedValues.rarity}
                  entityDescription={memoizedWatchedValues.description}
                  entityPromptExtra={memoizedWatchedValues.image_prompt_extra}
                  onImageGenerated={setCardImage}
                  onCreateEntity={!id && !createdCardId ? handleCreateCardForGeneration : undefined}
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

            {/* Настройки текста */}
            <div className="space-y-4 border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700">Настройки текста описания</h3>
              
              {/* Выравнивание текста */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Выравнивание текста
                </label>
                <select
                  {...register('text_alignment')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">По умолчанию (по центру)</option>
                  <option value="left">Влево</option>
                  <option value="center">По центру</option>
                  <option value="right">Вправо</option>
                </select>
              </div>

              {/* Размер шрифта */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Размер шрифта (8-24)
                </label>
                <input
                  type="number"
                  min="8"
                  max="24"
                  {...register('text_font_size', { valueAsNumber: true })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="14 (по умолчанию)"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Оставьте пустым для автоматического размера
                </p>
              </div>
            </div>

            {/* Переключатель детального описания */}
            <div className="space-y-4 border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700">Настройки отображения</h3>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    {...register('show_detailed_description')}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Показывать детальное описание вместо свойств
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  В расширенных картах под картинкой будет показано детальное описание вместо списка свойств
                </p>
              </div>
            </div>

            {/* Настройки детального описания */}
            <div className="space-y-4 border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700">Настройки детального описания</h3>
              
              {/* Выравнивание детального описания */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Выравнивание детального описания
                </label>
                <select
                  {...register('detailed_description_alignment')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">По умолчанию (влево)</option>
                  <option value="left">Влево</option>
                  <option value="center">По центру</option>
                  <option value="right">Вправо</option>
                </select>
              </div>

              {/* Размер шрифта детального описания */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Размер шрифта детального описания (8-24)
                </label>
                <input
                  type="number"
                  min="8"
                  max="24"
                  {...register('detailed_description_font_size', { valueAsNumber: true })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="12 (по умолчанию)"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Оставьте пустым для автоматического размера
                </p>
              </div>
            </div>

            {/* Тип шаблона */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Тип шаблона
              </label>
              <select
                {...register('is_template')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="false">Обычная карта</option>
                <option value="template">Карта и шаблон</option>
                <option value="only_template">Только шаблон</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Шаблоны используются для быстрого создания новых карт
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

            {/* Слот экипировки */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Слот экипировки
              </label>
              <select
                {...register('slot')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Не экипируется</option>
                {EQUIPMENT_SLOTS.map(option => (
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

                {/* Дополнительная информация к промпту для генерации изображения */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Дополнительная информация для генерации изображения
                  </label>
                  <textarea
                    {...register('image_prompt_extra')}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Опишите особые пожелания к внешнему виду предмета (необязательно)"
                  />
                  <p className="mt-1 text-sm text-gray-500">
                    Например: "с золотыми украшениями", "в стиле эльфийского оружия", "с рунами на лезвии"
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
                {!isEditMode && (
                  <button
                    type="button"
                    onClick={handleCreateAndGenerate}
                    disabled={saving || !memoizedWatchedValues.name || memoizedWatchedValues.name === 'Название карты'}
                    className="flex items-center space-x-2 px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Wand2 size={20} />
                    <span>{saving ? 'Создание...' : 'Создать и сгенерировать изображение'}</span>
                  </button>
                )}
            </div>
          </form>
        </div>

          {/* Превью */}
          {showPreview && (
            <div className="bg-white rounded-lg shadow p-6 lg:sticky lg:top-6 self-start">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Превью карты</h3>
              {previewCard ? (
                <div className="flex justify-center">
                  <div className="transform scale-130 mt-16">
                    <CardPreview card={previewCard} disableHover={false} />
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