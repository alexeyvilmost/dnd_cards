import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Save, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { cardsApi } from '../api/client';
import { imagesApi } from '../api/imagesApi';
import type { CreateCardRequest, UpdateCardRequest, Properties, Effect } from '../types';
import CardPreview from '../components/CardPreview';
import ImageLibraryModal from '../components/ImageLibraryModal';
import { CardCreatorNavigation } from '../components/CardCreatorNavigation';
import { MainSection } from '../components/cardCreator/MainSection';
import { ImageSection } from '../components/cardCreator/ImageSection';
import { TextSection } from '../components/cardCreator/TextSection';
import { EquipmentSection } from '../components/cardCreator/EquipmentSection';
import EffectsSection from '../components/cardCreator/EffectsSection';
import { PrivacySection } from '../components/cardCreator/PrivacySection';
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
  const [activeSection, setActiveSection] = useState('main'); // Активная секция навигации
  const [effects, setEffects] = useState<Effect[]>([]); // Эффекты предмета

  // Определяем, находимся ли мы в режиме редактирования
  const isEditMode = !!id;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
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
      is_template: 'false',
      effects: []
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
          
          // Загружаем эффекты карты
          if (card.effects && card.effects.length > 0) {
            setEffects(card.effects);
          } else {
            setEffects([]);
          }
          
          // Заполняем форму данными карты через reset для полной синхронизации
          reset({
            name: card.name,
            rarity: card.rarity,
            properties: card.properties || [],
            description: card.description,
            detailed_description: card.detailed_description || null,
            price: card.price,
            weight: card.weight,
            bonus_type: card.bonus_type,
            bonus_value: card.bonus_value,
            damage_type: card.damage_type,
            defense_type: card.defense_type,
            text_alignment: card.text_alignment || null,
            text_font_size: card.text_font_size || null,
            show_detailed_description: card.show_detailed_description === true,
            detailed_description_alignment: card.detailed_description_alignment || null,
            detailed_description_font_size: card.detailed_description_font_size || null,
            is_extended: card.is_extended === true,
            author: card.author || 'Admin',
            source: card.source,
            type: card.type,
            weapon_type: card.weapon_type || null,
            related_cards: card.related_cards || [],
            related_actions: card.related_actions || [],
            related_effects: card.related_effects || [],
            attunement: card.attunement,
            tags: card.tags || [],
            slot: card.slot,
            is_template: card.is_template || 'false'
          });
          
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
  }, [id, isEditMode]);

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
        weapon_type: data.weapon_type || null,
        related_cards: data.related_cards || null,
        related_actions: data.related_actions || null,
        related_effects: data.related_effects || null,
        attunement: data.attunement || null,
        tags: data.tags && data.tags.length > 0 ? data.tags : null,
        slot: data.slot || null,
        is_template: data.is_template || 'false',
        image_prompt_extra: data.image_prompt_extra || null,
        effects: effects.length > 0 ? effects.filter(effect => 
          effect.targetType && 
          effect.targetSpecific && 
          effect.modifier && 
          effect.value > 0
        ) : null
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
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
      {/* Заголовок */}
        <div className="mb-4 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-2 sm:space-x-4">
          <button
            onClick={() => navigate('/')}
                className="flex items-center space-x-1 sm:space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
                <ArrowLeft size={18} className="sm:w-5 sm:h-5" />
                <span className="text-sm sm:text-base">Назад</span>
          </button>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
              {isEditMode ? 'Редактирование' : 'Создание'}
          </h1>
            <div className="flex items-center space-x-2 sm:space-x-4">
          <button
            onClick={() => setShowPreview(!showPreview)}
                className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm sm:text-base"
          >
                {showPreview ? <EyeOff size={16} className="sm:w-5 sm:h-5" /> : <Eye size={16} className="sm:w-5 sm:h-5" />}
                <span className="hidden sm:inline">{showPreview ? 'Скрыть' : 'Показать'}</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4">
        {/* Навигация */}
        <div className="lg:col-span-1">
          <CardCreatorNavigation 
            activeSection={activeSection}
            onSectionChange={(section) => {
              setActiveSection(section);
            }}
          />
        </div>

        {/* Форма */}
        <div className="lg:col-span-6">
          <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Рендер активной секции */}
              {activeSection === 'main' && (
                <MainSection 
                  register={register}
                  errors={errors}
                  setValue={setValue}
                  watch={watch}
                />
              )}
              
              {activeSection === 'image' && (
                <ImageSection 
                  register={register}
                  errors={errors}
                  setValue={setValue}
                  watch={watch}
                  onImageGenerated={setCardImage}
                  onCreateEntity={!id && !createdCardId ? handleCreateCardForGeneration : undefined}
                  entityId={id || createdCardId || ''}
                  showImageLibrary={showImageLibrary}
                  setShowImageLibrary={setShowImageLibrary}
                />
              )}
              
              {activeSection === 'text' && (
                <TextSection 
                  register={register}
                  errors={errors}
                  setValue={setValue}
                  watch={watch}
                />
              )}
              
              {activeSection === 'equipment' && (
                <EquipmentSection 
                  register={register}
                  errors={errors}
                  setValue={setValue}
                  watch={watch}
                />
              )}
              
              {activeSection === 'effects' && (
                <div>
                  <h2 className="text-xl font-bold mb-4">Секция эффектов</h2>
                  <EffectsSection 
                    effects={effects}
                    onEffectsChange={setEffects}
                    description={watchedValues.description}
                  />
                </div>
              )}
              
              {activeSection === 'privacy' && (
                <PrivacySection 
                  register={register}
                  errors={errors}
                />
              )}

            {/* Кнопки */}
              <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
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
        </div>

        {/* Превью */}
        {showPreview && (
          <div className="lg:col-span-5">
            <div className="bg-white rounded-lg shadow p-6 sticky top-6">
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
            </div>
          )}
      </div>

      {/* Модальное окно библиотеки изображений */}
      <ImageLibraryModal
        isOpen={showImageLibrary}
        onClose={() => setShowImageLibrary(false)}
        onSelectImage={handleSelectFromLibrary}
      />
      </div>
    </div>
  );
};

export default CardCreator;