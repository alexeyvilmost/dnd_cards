import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { featsApi } from '../api/client';
import { useEffectActionLoaders } from '../hooks/useEffectActionLoaders';
import type { CreateFeatRequest, UpdateFeatRequest, Feat, FeatCategory } from '../types';
import { FEAT_CATEGORY_OPTIONS, ABILITY_OPTIONS } from '../types';
import FeatPreview from '../components/FeatPreview';
import ImageUploader from '../components/ImageUploader';
import { FormattedTextarea } from '../components/FormattedTextarea';
import EntityRefSelector from '../components/EntityRefSelector';
import CreatorShell, { CreatorActions, CREATOR_INPUT_CLS, CREATOR_LABEL_CLS } from '../components/CreatorShell';

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

  const inputCls = CREATOR_INPUT_CLS;
  const labelCls = CREATOR_LABEL_CLS;

  return (
    <CreatorShell
      title={isEditMode ? 'Редактирование черты' : 'Создание черты'}
      onBack={() => navigate('/?type=feats')}
      loading={loadingFeat}
      error={error}
      previewTitle="Превью черты"
      preview={<FeatPreview feat={previewFeat} disableHover={true} />}
    >
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

        <CreatorActions
          loading={loading}
          submitLabel={isEditMode ? 'Сохранить изменения' : 'Создать черту'}
          onCancel={() => navigate('/?type=feats')}
        />
      </form>
    </CreatorShell>
  );
};

export default FeatCreator;
