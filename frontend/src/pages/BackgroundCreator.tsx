import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { backgroundsApi } from '../api/client';
import type { CreateBackgroundRequest, UpdateBackgroundRequest, Background, BackgroundEquipmentOptions } from '../types';
import { ABILITY_OPTIONS, SKILL_OPTIONS } from '../types';
import ItemRefSelector from '../components/ItemRefSelector';
import BackgroundPreview from '../components/BackgroundPreview';
import ImageUploader from '../components/ImageUploader';
import { FormattedTextarea } from '../components/FormattedTextarea';

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
  const [showPreview, setShowPreview] = useState(true);

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

  if (loadingBg) {
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
          <button onClick={() => navigate('/?type=backgrounds')} className="flex items-center space-x-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={18} /><span className="text-sm sm:text-base">Назад</span>
          </button>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
            {isEditMode ? 'Редактирование предыстории' : 'Создание предыстории'}
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

                <div className="flex gap-4 pt-4 border-t border-gray-200">
                  <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400">
                    {loading ? 'Сохранение...' : isEditMode ? 'Сохранить изменения' : 'Создать предысторию'}
                  </button>
                  <button type="button" onClick={() => navigate('/?type=backgrounds')} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Отмена</button>
                </div>
              </form>
            </div>
          </div>

          {showPreview && (
            <div className="lg:col-span-5">
              <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="text-lg font-medium text-gray-900 mb-8">Превью предыстории</h3>
                <div className="flex justify-center pt-4">
                  <BackgroundPreview background={previewBg} disableHover={true} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BackgroundCreator;
