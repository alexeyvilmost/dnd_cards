import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { featsApi } from '../api/client';
import { useEffectActionLoaders } from '../hooks/useEffectActionLoaders';
import type { CreateFeatRequest, UpdateFeatRequest, Feat, FeatCategory } from '../types';
import { FEAT_CATEGORY_OPTIONS, ABILITY_OPTIONS } from '../types';
import FeatPreview from '../components/FeatPreview';
import ImageUploader from '../components/ImageUploader';
import { FormattedTextarea } from '../components/FormattedTextarea';
import EntityRefSelector from '../components/EntityRefSelector';

type ScalarForm = {
  name: string;
  card_number: string;
  category: FeatCategory;
  prerequisite: string;
  repeatable: boolean;
  description: string;
  detailed_description: string;
  image_url: string;
  source: string;
};

const FeatCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<ScalarForm>({
    defaultValues: { category: 'general', repeatable: false },
  });

  const [abilityIncrease, setAbilityIncrease] = useState<string[]>([]);
  const [relatedEffects, setRelatedEffects] = useState<string[]>([]);
  const [relatedActions, setRelatedActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFeat, setLoadingFeat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    if (isEditMode && editId) {
      const load = async () => {
        try {
          setLoadingFeat(true);
          const feat = await featsApi.getFeat(editId);
          reset({
            name: feat.name,
            card_number: feat.card_number || '',
            category: feat.category || 'general',
            prerequisite: feat.prerequisite || '',
            repeatable: feat.repeatable,
            description: feat.description || '',
            detailed_description: feat.detailed_description || '',
            image_url: feat.image_url || '',
            source: feat.source || '',
          });
          setAbilityIncrease(feat.ability_increase || []);
          setRelatedEffects(feat.related_effects || []);
          setRelatedActions(feat.related_actions || []);
        } catch (err) {
          setError('Ошибка загрузки черты');
          console.error(err);
        } finally {
          setLoadingFeat(false);
        }
      };
      load();
    }
  }, [isEditMode, editId, reset]);

  const fd = watch();

  const previewFeat: Feat = {
    id: '',
    name: fd.name || 'Название черты',
    description: fd.description || 'Описание черты',
    detailed_description: fd.detailed_description || null,
    image_url: fd.image_url || '',
    rarity: 'common',
    card_number: '',
    category: fd.category || 'general',
    prerequisite: fd.prerequisite || null,
    ability_increase: abilityIncrease,
    repeatable: !!fd.repeatable,
    created_at: '',
    updated_at: '',
  };

  const toggleAbility = (v: string) =>
    setAbilityIncrease(abilityIncrease.includes(v) ? abilityIncrease.filter((x) => x !== v) : [...abilityIncrease, v]);

  const { loadEffects, loadActions } = useEffectActionLoaders();

  const onSubmit = async (data: ScalarForm) => {
    setLoading(true);
    setError(null);
    const payload: CreateFeatRequest & UpdateFeatRequest = {
      name: data.name,
      description: data.description,
      detailed_description: data.detailed_description || null,
      image_url: data.image_url || '',
      category: data.category,
      prerequisite: data.prerequisite || null,
      ability_increase: abilityIncrease,
      related_effects: relatedEffects.length ? relatedEffects : null,
      related_actions: relatedActions.length ? relatedActions : null,
      repeatable: !!data.repeatable,
      source: data.source || null,
    };
    try {
      if (isEditMode && editId) {
        await featsApi.updateFeat(editId, payload);
      } else {
        await featsApi.createFeat({ ...payload, card_number: data.card_number || undefined });
      }
      navigate('/?type=feats');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Ошибка сохранения черты');
      setLoading(false);
    }
  };

  if (loadingFeat) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-2';

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <button onClick={() => navigate('/?type=feats')} className="flex items-center space-x-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={18} /><span className="text-sm sm:text-base">Назад</span>
          </button>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
            {isEditMode ? 'Редактирование черты' : 'Создание черты'}
          </h1>
          <button onClick={() => setShowPreview(!showPreview)} className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm sm:text-base">
            {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}<span className="hidden sm:inline">{showPreview ? 'Скрыть' : 'Показать'}</span>
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4">
          <div className={showPreview ? 'lg:col-span-7' : 'lg:col-span-12'}>
            <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className={labelCls}>Название *</label>
                  <input {...register('name', { required: 'Название обязательно' })} className={inputCls} placeholder="Меткий стрелок" />
                  {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Категория *</label>
                    <select {...register('category')} className={inputCls}>
                      {FEAT_CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>ID черты</label>
                    <input {...register('card_number')} maxLength={30} disabled={isEditMode}
                      placeholder="sharpshooter"
                      className={`${inputCls} ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Требования</label>
                  <input {...register('prerequisite')} className={inputCls} placeholder="Уровень 4+, Ловкость 13+" />
                </div>

                <div>
                  <label className={labelCls}>Повышение характеристики</label>
                  <div className="flex flex-wrap gap-2">
                    {ABILITY_OPTIONS.map((o) => (
                      <button type="button" key={o.value} onClick={() => toggleAbility(o.value)}
                        className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                          abilityIncrease.includes(o.value)
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center space-x-2">
                  <input type="checkbox" {...register('repeatable')} className="w-4 h-4 text-indigo-600 rounded" />
                  <span className="text-sm text-gray-700">Повторяемая</span>
                </label>

                <div className="border-t pt-4 space-y-4">
                  <h3 className="text-md font-semibold text-gray-900">Способности (эффекты и действия)</h3>
                  <p className="text-sm text-gray-500">Привяжите созданные эффекты/действия с механикой — они применятся при получении черты (как у видов и классов).</p>
                  <EntityRefSelector
                    label="Эффекты"
                    value={relatedEffects}
                    onChange={setRelatedEffects}
                    loadItems={loadEffects}
                  />
                  <EntityRefSelector
                    label="Действия"
                    value={relatedActions}
                    onChange={setRelatedActions}
                    loadItems={loadActions}
                  />
                </div>

                <div>
                  <label className={labelCls}>Описание *</label>
                  <FormattedTextarea value={fd.description || ''} onChange={(v) => setValue('description', v)} rows={6}
                    placeholder="Преимущества черты. **жирный** для выделения." />
                  <input type="hidden" {...register('description', { required: 'Описание обязательно' })} />
                  {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>}
                </div>

                <div>
                  <label className={labelCls}>Дополнительное описание</label>
                  <textarea {...register('detailed_description')} rows={3} className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Изображение (иконка)</label>
                  <ImageUploader onImageUpload={(url) => setValue('image_url', url)} currentImageUrl={fd.image_url} />
                </div>

                <div>
                  <label className={labelCls}>Источник</label>
                  <input {...register('source')} className={inputCls} placeholder="PHB 2024" />
                </div>

                <div className="flex gap-4 pt-4 border-t border-gray-200">
                  <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400">
                    {loading ? 'Сохранение...' : isEditMode ? 'Сохранить изменения' : 'Создать черту'}
                  </button>
                  <button type="button" onClick={() => navigate('/?type=feats')} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Отмена</button>
                </div>
              </form>
            </div>
          </div>

          {showPreview && (
            <div className="lg:col-span-5">
              <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="text-lg font-medium text-gray-900 mb-8">Превью черты</h3>
                <div className="flex justify-center pt-4">
                  <FeatPreview feat={previewFeat} disableHover={true} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeatCreator;
