import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { backgroundsApi } from '../api/client';
import type { CreateBackgroundRequest, UpdateBackgroundRequest, Background, BackgroundEquipmentOptions } from '../types';
import { ABILITY_OPTIONS, SKILL_OPTIONS } from '../types';
import ItemRefSelector from '../components/ItemRefSelector';
import BackgroundPreview from '../components/BackgroundPreview';
import ImageUploader from '../components/ImageUploader';
import { FormattedTextarea } from '../components/FormattedTextarea';
import CreatorShell, { CreatorActions, CREATOR_INPUT_CLS, CREATOR_LABEL_CLS } from '../components/CreatorShell';

type ScalarForm = {
  name: string;
  card_number: string;
  origin_feat: string;
  tool_proficiency: string;
  equipment: string;
  description: string;
  detailed_description: string;
  image_url: string;
  source: string;
};

const BackgroundCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<ScalarForm>();

  const [abilityScores, setAbilityScores] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const defaultEquipmentOptions: BackgroundEquipmentOptions = {
    option_a: { items: [], gold: 0 },
    option_b: { items: [], gold: 50 },
  };
  const [equipmentOptions, setEquipmentOptions] = useState<BackgroundEquipmentOptions>(defaultEquipmentOptions);
  const [loading, setLoading] = useState(false);
  const [loadingBg, setLoadingBg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isEditMode && editId) {
      const load = async () => {
        try {
          setLoadingBg(true);
          const bg = await backgroundsApi.getBackground(editId);
          reset({
            name: bg.name,
            card_number: bg.card_number || '',
            origin_feat: bg.origin_feat || '',
            tool_proficiency: bg.tool_proficiency || '',
            equipment: bg.equipment || '',
            description: bg.description || '',
            detailed_description: bg.detailed_description || '',
            image_url: bg.image_url || '',
            source: bg.source || '',
          });
          setAbilityScores(bg.ability_scores || []);
          setSkills(bg.skill_proficiencies || []);
          if (bg.equipment_options) {
            setEquipmentOptions({
              option_a: bg.equipment_options.option_a || { items: [], gold: 0 },
              option_b: bg.equipment_options.option_b || { items: [], gold: 50 },
            });
          }
        } catch (err) {
          setError('Ошибка загрузки предыстории');
          console.error(err);
        } finally {
          setLoadingBg(false);
        }
      };
      load();
    }
  }, [isEditMode, editId, reset]);

  const fd = watch();

  const previewBg: Background = {
    id: '',
    name: fd.name || 'Название предыстории',
    description: fd.description || 'Описание предыстории',
    detailed_description: fd.detailed_description || null,
    image_url: fd.image_url || '',
    rarity: 'common',
    card_number: '',
    ability_scores: abilityScores,
    origin_feat: fd.origin_feat || null,
    skill_proficiencies: skills,
    tool_proficiency: fd.tool_proficiency || null,
    equipment: fd.equipment || null,
    equipment_options: equipmentOptions,
    created_at: '',
    updated_at: '',
  };

  const toggle = (v: string, list: string[], setter: (x: string[]) => void) =>
    setter(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const setOpt = (key: 'option_a' | 'option_b', patch: Partial<{ items: any[]; gold: number }>) =>
    setEquipmentOptions((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const onSubmit = async (data: ScalarForm) => {
    setLoading(true);
    setError(null);
    const payload: CreateBackgroundRequest & UpdateBackgroundRequest = {
      name: data.name,
      description: data.description,
      detailed_description: data.detailed_description || null,
      image_url: data.image_url || '',
      ability_scores: abilityScores,
      origin_feat: data.origin_feat || null,
      skill_proficiencies: skills,
      tool_proficiency: data.tool_proficiency || null,
      equipment: data.equipment || null,
      equipment_options: equipmentOptions,
      source: data.source || null,
    };
    try {
      if (isEditMode && editId) {
        await backgroundsApi.updateBackground(editId, payload);
      } else {
        await backgroundsApi.createBackground({ ...payload, card_number: data.card_number || undefined });
      }
      navigate('/?type=backgrounds');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Ошибка сохранения предыстории');
      setLoading(false);
    }
  };

  const inputCls = CREATOR_INPUT_CLS;
  const labelCls = CREATOR_LABEL_CLS;

  return (
    <CreatorShell
      title={isEditMode ? 'Редактирование предыстории' : 'Создание предыстории'}
      onBack={() => navigate('/?type=backgrounds')}
      loading={loadingBg}
      error={error}
      previewTitle="Превью предыстории"
      preview={<BackgroundPreview background={previewBg} disableHover={true} />}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Название *</label>
            <input {...register('name', { required: 'Название обязательно' })} className={inputCls} placeholder="Артист" />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className={labelCls}>ID предыстории</label>
            <input {...register('card_number')} maxLength={30} disabled={isEditMode}
              placeholder="entertainer"
              className={`${inputCls} ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Характеристики (обычно 3)</label>
          <div className="flex flex-wrap gap-2">
            {ABILITY_OPTIONS.map((o) => (
              <button type="button" key={o.value} onClick={() => toggle(o.value, abilityScores, setAbilityScores)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  abilityScores.includes(o.value)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Черта происхождения</label>
          <input {...register('origin_feat')} className={inputCls} placeholder="Музыкант" />
        </div>

        <div>
          <label className={labelCls}>Владение навыками</label>
          <div className="flex flex-wrap gap-2">
            {SKILL_OPTIONS.map((s) => (
              <button type="button" key={s} onClick={() => toggle(s, skills, setSkills)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  skills.includes(s)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Владение инструментами</label>
          <input {...register('tool_proficiency')} className={inputCls} placeholder="Один вид музыкальных инструментов" />
        </div>

        <div>
          <label className={labelCls}>Снаряжение (текстом, опционально)</label>
          <textarea {...register('equipment')} rows={2} className={inputCls} placeholder="Свободное описание снаряжения" />
        </div>

        {/* Варианты снаряжения А/Б с предметами и золотом */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-800">Вариант А</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0}
                  value={equipmentOptions.option_a.gold}
                  onChange={(e) => setOpt('option_a', { gold: parseInt(e.target.value || '0', 10) })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                />
                <span className="text-sm text-yellow-600">ЗМ</span>
              </div>
            </div>
            <ItemRefSelector
              value={equipmentOptions.option_a.items}
              onChange={(items) => setOpt('option_a', { items })}
            />
          </div>

          <div className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-800">Вариант Б</span>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0}
                  value={equipmentOptions.option_b.gold}
                  onChange={(e) => setOpt('option_b', { gold: parseInt(e.target.value || '0', 10) })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                />
                <span className="text-sm text-yellow-600">ЗМ</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-2">Обычно только золото, но можно добавить предметы.</p>
            <ItemRefSelector
              value={equipmentOptions.option_b.items}
              onChange={(items) => setOpt('option_b', { items })}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Описание *</label>
          <FormattedTextarea value={fd.description || ''} onChange={(v) => setValue('description', v)} rows={5}
            placeholder="Описание предыстории. **жирный** для выделения." />
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
          submitLabel={isEditMode ? 'Сохранить изменения' : 'Создать предысторию'}
          onCancel={() => navigate('/?type=backgrounds')}
        />
      </form>
    </CreatorShell>
  );
};

export default BackgroundCreator;
