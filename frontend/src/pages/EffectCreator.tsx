import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { effectsApi } from '../api/client';
import type { CreatePassiveEffectRequest, UpdatePassiveEffectRequest, PassiveEffect } from '../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';
import EffectPreview from '../components/EffectPreview';
import ImageUploader from '../components/ImageUploader';
import { EffectCreatorNavigation } from '../components/EffectCreatorNavigation';
import { PropertiesSection } from '../components/effectCreator/PropertiesSection';

const EffectCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<CreatePassiveEffectRequest>({
    defaultValues: {
      rarity: 'common', // Всегда common для эффектов
      is_extended: false,
    }
  });
  const [loading, setLoading] = useState(false);
  const [loadingEffect, setLoadingEffect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('main');
  const [showPreview, setShowPreview] = useState(true);

  // Загрузка эффекта для редактирования
  useEffect(() => {
    if (isEditMode && editId) {
      const loadEffect = async () => {
        try {
          setLoadingEffect(true);
          const effect = await effectsApi.getEffect(editId);
          
          // Заполняем форму данными эффекта
          reset({
            name: effect.name,
            description: effect.description,
            detailed_description: effect.detailed_description || null,
            image_url: effect.image_url || '',
            rarity: effect.rarity || 'common',
            card_number: effect.card_number || '',
            effect_type: effect.effect_type || 'passive',
            condition_description: effect.condition_description || null,
            is_extended: effect.is_extended || false,
            description_font_size: effect.description_font_size || null,
            text_alignment: effect.text_alignment || null,
            text_font_size: effect.text_font_size || null,
            show_detailed_description: effect.show_detailed_description || false,
            detailed_description_alignment: effect.detailed_description_alignment || null,
            detailed_description_font_size: effect.detailed_description_font_size || null,
            script: effect.script || null,
            properties: effect.properties || null,
          });
        } catch (err) {
          setError('Ошибка загрузки эффекта');
          console.error('Error loading effect:', err);
        } finally {
          setLoadingEffect(false);
        }
      };
      
      loadEffect();
    }
  }, [isEditMode, editId, reset]);

  const formData = watch();
  const previewEffect = {
    id: '',
    name: formData.name || 'Название эффекта',
    description: formData.description || 'Описание эффекта',
    detailed_description: formData.detailed_description || null,
    image_url: formData.image_url || '',
    rarity: 'common', // Всегда common для эффектов
    card_number: '', // Не отображаем номер
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

  // Проверка уникальности ID (проверяем по card_number через API)
  const checkIdUniqueness = async (id: string): Promise<boolean> => {
    if (!id || id.trim() === '') return true; // Пустой ID допустим
    try {
      // Проверяем через список эффектов с фильтром по card_number
      const response = await effectsApi.getEffects({ search: id, limit: 100 });
      // Ищем точное совпадение card_number
      const exists = response.effects.some(effect => effect.card_number === id);
      return !exists; // Возвращаем true если не найден
    } catch (error: any) {
      console.error('Ошибка проверки уникальности ID:', error);
      return false; // Ошибка при проверке
    }
  };

  const onSubmit = async (data: CreatePassiveEffectRequest) => {
    setLoading(true);
    setError(null);
    setIdError(null);

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
        setIdError('Эффект с таким ID уже существует');
        setLoading(false);
        return;
      }
    }

    try {
      if (isEditMode && editId) {
        // Обновление существующего эффекта
        const updateData: UpdatePassiveEffectRequest = {
          name: data.name,
          description: data.description,
          detailed_description: data.detailed_description,
          image_url: data.image_url,
          rarity: 'common', // Всегда common для эффектов
          effect_type: data.effect_type,
          condition_description: data.condition_description,
          is_extended: data.is_extended,
          description_font_size: data.description_font_size,
          text_alignment: data.text_alignment,
          text_font_size: data.text_font_size,
          show_detailed_description: data.show_detailed_description,
          detailed_description_alignment: data.detailed_description_alignment,
          detailed_description_font_size: data.detailed_description_font_size,
          properties: data.properties,
        };
        await effectsApi.updateEffect(editId, updateData);
      } else {
        // Создание нового эффекта
        await effectsApi.createEffect({
          ...data,
          rarity: 'common', // Всегда common для эффектов
        });
      }
      // Перенаправляем на библиотеку карт
      navigate('/');
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || (isEditMode ? 'Ошибка обновления эффекта' : 'Ошибка создания эффекта');
      setError(errorMessage);
      setLoading(false);
      // Не выходим из редактора при ошибке - остаемся на странице
    }
  };

  if (loadingEffect) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
              {isEditMode ? 'Редактирование эффекта' : 'Создание эффекта'}
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4">
          {/* Навигация */}
          <div className="lg:col-span-1">
            <EffectCreatorNavigation 
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
                {activeSection === 'main' && (
                  <>
                    {/* Основная информация */}
                    <div>
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
                  ID эффекта
                </label>
                <input
                  {...register('card_number')}
                  type="text"
                  placeholder="effect_id_123"
                  maxLength={30}
                  disabled={isEditMode}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {isEditMode ? 'ID эффекта нельзя изменить' : 'Латинские буквы, цифры, дефисы и подчеркивания, до 30 символов'}
                </p>
                {idError && <p className="text-red-500 text-sm mt-1">{idError}</p>}
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
                  Изображение
                </label>
                <ImageUploader
                  onImageUpload={(imageUrl) => setValue('image_url', imageUrl)}
                  currentImageUrl={formData.image_url}
                />
              </div>

              <div>
                <label className="flex items-center space-x-2">
                  <input
                    {...register('is_extended')}
                    type="checkbox"
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Расширенная карта
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Размер шрифта описания
                  </label>
                  <input
                    {...register('description_font_size', { valueAsNumber: true })}
                    type="number"
                    min="8"
                    max="20"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="10"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Размер шрифта текста
                  </label>
                  <input
                    {...register('text_font_size', { valueAsNumber: true })}
                    type="number"
                    min="8"
                    max="20"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="12"
                  />
                </div>
              </div>
            </div>
                    </div>
                  </>
                )}

                {activeSection === 'properties' && (
                  <PropertiesSection setValue={setValue} watch={watch} />
                )}

                {/* Кнопки */}
                <div className="flex gap-4 pt-4 border-t border-gray-200">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {loading ? (isEditMode ? 'Сохранение...' : 'Создание...') : (isEditMode ? 'Сохранить изменения' : 'Создать эффект')}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Правая колонка - превью */}
          {showPreview && (
            <div className="lg:col-span-5">
              <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Превью эффекта</h3>
                <div className="flex justify-center">
                  <EffectPreview effect={previewEffect} disableHover={true} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EffectCreator;
