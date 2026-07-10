import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { effectsApi } from '../api/client';
import type { CreatePassiveEffectRequest, UpdatePassiveEffectRequest, PassiveEffect } from '../types';
import { PASSIVE_EFFECT_TYPE_OPTIONS } from '../types';
import EffectPreview from '../components/EffectPreview';
import { FormattedTextarea } from '../components/FormattedTextarea';
import ImageUploader from '../components/ImageUploader';
import { EffectCreatorNavigation } from '../components/EffectCreatorNavigation';
import { PropertiesSection } from '../components/effectCreator/PropertiesSection';
import MechanicsBuilder from '../components/mechanics/MechanicsBuilder';
import { registryItems, useResourceOptions } from '../utils/resources';
import { validateMechanics } from '../engine/validateMechanics';

const EffectCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);
  // «Использовать как шаблон»: грузим эффект-источник в форму, но остаёмся в режиме создания.
  const templateId = searchParams.get('template_id');
  const sourceId = editId || templateId;
  const asTemplate = !editId && !!templateId;

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
  const [knownTypes, setKnownTypes] = useState<string[]>([]);
  const resourceOptions = useResourceOptions();

  // Существующие пользовательские типы эффектов — для подсказки-datalist.
  useEffect(() => {
    effectsApi.getEffects({ limit: 500 }).then((res) => {
      const types = [...new Set((res.effects || []).map((e) => e.type).filter((t): t is string => !!t))].sort();
      setKnownTypes(types);
    }).catch(() => setKnownTypes([]));
  }, []);

  // Загрузка эффекта для редактирования
  useEffect(() => {
    if (sourceId) {
      const loadEffect = async () => {
        try {
          setLoadingEffect(true);
          const effect = await effectsApi.getEffect(sourceId);
          
          // Заполняем форму данными эффекта
          console.log('[EffectCreator] Загружен эффект с бэкенда:', effect);
          console.log('[EffectCreator] Script из эффекта:', effect.script);
          
          reset({
            name: effect.name,
            description: effect.description,
            detailed_description: effect.detailed_description || null,
            image_url: effect.image_url || '',
            rarity: effect.rarity || 'common',
            card_number: asTemplate ? '' : (effect.card_number || ''),
            effect_type: effect.effect_type || 'passive',
            type: effect.type || null,
            condition_description: effect.condition_description || null,
            is_extended: effect.is_extended || false,
            description_font_size: effect.description_font_size || null,
            text_alignment: effect.text_alignment || null,
            text_font_size: effect.text_font_size || null,
            show_detailed_description: effect.show_detailed_description || false,
            detailed_description_alignment: effect.detailed_description_alignment || null,
            detailed_description_font_size: effect.detailed_description_font_size || null,
            script: effect.script || null,
            mechanics: effect.mechanics || null,
            properties: effect.properties || null,
          });
          
          console.log('[EffectCreator] Форма заполнена, script установлен:', effect.script);
        } catch (err) {
          setError('Ошибка загрузки эффекта');
          console.error('Error loading effect:', err);
        } finally {
          setLoadingEffect(false);
        }
      };
      
      loadEffect();
    }
  }, [sourceId, asTemplate, reset]);

  const formData = watch();
  const previewEffect: PassiveEffect = {
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

    if (data.mechanics && typeof data.mechanics === 'object') {
      const check = validateMechanics(data.mechanics as Record<string, unknown>, {
        id: data.card_number || 'draft-effect',
        name: data.name || 'effect',
        kind: 'passive_effect',
      });
      if (!check.valid) {
        setError(`Ошибка схемы механики: ${check.errors.slice(0, 4).join('; ')}`);
        setLoading(false);
        return;
      }
    }

    try {
      if (isEditMode && editId) {
        // Обновление существующего эффекта
        console.log('[EffectCreator] Отправляем данные на обновление:', data);
        console.log('[EffectCreator] Script в данных:', data.script);
        
        const updateData: UpdatePassiveEffectRequest = {
          name: data.name,
          description: data.description,
          detailed_description: data.detailed_description,
          image_url: data.image_url,
          rarity: 'common', // Всегда common для эффектов
          effect_type: data.effect_type,
          type: data.type || null,
          condition_description: data.condition_description,
          script: data.script || null,
          mechanics: data.mechanics ?? null,
          is_extended: data.is_extended,
          description_font_size: data.description_font_size,
          text_alignment: data.text_alignment,
          text_font_size: data.text_font_size,
          show_detailed_description: data.show_detailed_description,
          detailed_description_alignment: data.detailed_description_alignment,
          detailed_description_font_size: data.detailed_description_font_size,
          properties: data.properties,
        };
        
        console.log('[EffectCreator] Данные для обновления:', updateData);
        await effectsApi.updateEffect(editId, updateData);
      } else {
        // Создание нового эффекта
        console.log('[EffectCreator] Отправляем данные на создание:', data);
        console.log('[EffectCreator] Script в данных:', data.script);
        
        const createData: CreatePassiveEffectRequest = {
          ...data,
          rarity: 'common', // Всегда common для эффектов
        };
        
        console.log('[EffectCreator] Данные для создания:', createData);
        await effectsApi.createEffect(createData);
      }
      navigate('/?type=effects');
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
                onClick={() => navigate('/?type=effects')}
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
                <FormattedTextarea
                  value={watch('description') || ''}
                  onChange={(v) => setValue('description', v, { shouldValidate: true })}
                  rows={4}
                  placeholder="Описание эффекта (разметка, иконки, цвета, ссылки на сущности)"
                />
                <input type="hidden" {...register('description', { required: 'Описание обязательно' })} />
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Категория (тип)
                </label>
                <input
                  {...register('type')}
                  list="effect-type-list"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Напр. «Дар договора», «Мистическое воззвание»"
                />
                <datalist id="effect-type-list">
                  {knownTypes.map((t) => <option key={t} value={t} />)}
                </datalist>
                <p className="text-xs text-gray-500 mt-1">
                  Свободная категория для группировки. Эффект можно выбрать через механику
                  <code className="mx-1">choice(source: "effect_type")</code> — например все Дары договора.
                </p>
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

                {activeSection === 'mechanics' && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-gray-900">Механика (унифицированная)</h2>
                    <p className="text-sm text-gray-500">
                      Соберите способность из блоков. JSON сохраняется в поле mechanics.
                    </p>
                    <MechanicsBuilder
                      value={(watch('mechanics') as Record<string, unknown>) || null}
                      onChange={(m) => setValue('mechanics', m)}
                      resourceOptions={registryItems(resourceOptions)}
                      aiContext={{ kind: 'passive_effect', name: watch('name') || '', description: [watch('description'), watch('condition_description')].filter(Boolean).join(' ') }}
                    />
                  </div>
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
                    onClick={() => navigate('/?type=effects')}
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
