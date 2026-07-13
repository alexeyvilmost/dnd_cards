import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Eye, EyeOff, Plus, X } from 'lucide-react';
import { racesApi } from '../api/client';
import { useEffectActionLoaders } from '../hooks/useEffectActionLoaders';
import type { CreateRaceRequest, UpdateRaceRequest, Race, RaceTrait, LevelProgression } from '../types';
import { CREATURE_TYPE_OPTIONS, RACE_SIZE_OPTIONS } from '../types';
import RacePreview from '../components/RacePreview';
import ImageUploader from '../components/ImageUploader';
import { FormattedTextarea } from '../components/FormattedTextarea';
import EntityRefSelector from '../components/EntityRefSelector';
import LevelProgressionEditor from '../components/LevelProgressionEditor';

type ScalarForm = {
  name: string;
  card_number: string;
  creature_type: string;
  size: string;
  speed: number | null;
  extra_speeds: string;
  darkvision: number | null;
  description: string;
  detailed_description: string;
  image_url: string;
  source: string;
};

// Редактор списка особенностей (название + описание)
const TraitEditor = ({ title, items, onChange, namePlaceholder }: {
  title: string; items: RaceTrait[]; onChange: (v: RaceTrait[]) => void; namePlaceholder: string;
}) => {
  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const set = (i: number, patch: Partial<RaceTrait>) =>
    onChange(items.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{title}</label>
      <div className="space-y-3">
        {items.map((t, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={t.name} onChange={(e) => set(i, { name: e.target.value })} className={inputCls} placeholder={namePlaceholder} />
              <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="p-2 text-gray-400 hover:text-red-500" title="Удалить">
                <X size={18} />
              </button>
            </div>
            <textarea value={t.description} onChange={(e) => set(i, { description: e.target.value })} rows={2} className={inputCls} placeholder="Описание особенности" />
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...items, { name: '', description: '' }])}
        className="mt-2 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
        <Plus size={16} /> Добавить
      </button>
    </div>
  );
};

const RaceCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<ScalarForm>({
    defaultValues: { creature_type: 'Гуманоид', size: 'Средний', speed: 30, darkvision: 0 },
  });

  const [traits, setTraits] = useState<RaceTrait[]>([]);
  const [lineages, setLineages] = useState<RaceTrait[]>([]);
  const [isSubrace, setIsSubrace] = useState(false);
  const [parentRaceId, setParentRaceId] = useState('');
  const [subraceLevel, setSubraceLevel] = useState(1);
  const [allRaces, setAllRaces] = useState<Race[]>([]);
  const [relatedEffects, setRelatedEffects] = useState<string[]>([]);
  const [relatedActions, setRelatedActions] = useState<string[]>([]);
  const [levelProgression, setLevelProgression] = useState<LevelProgression>({});
  const [loading, setLoading] = useState(false);
  const [loadingRace, setLoadingRace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    racesApi.getRaces({ limit: 100 }).then((res) => setAllRaces(res.races || [])).catch(() => {});
  }, []);

  const { loadEffects, loadActions, resolveEffects, resolveActions } = useEffectActionLoaders();

  useEffect(() => {
    if (isEditMode && editId) {
      const load = async () => {
        try {
          setLoadingRace(true);
          const r = await racesApi.getRace(editId);
          reset({
            name: r.name, card_number: r.card_number || '',
            creature_type: r.creature_type || 'Гуманоид', size: r.size || 'Средний',
            speed: r.speed ?? 30, extra_speeds: r.extra_speeds || '', darkvision: r.darkvision ?? 0,
            description: r.description || '', detailed_description: r.detailed_description || '',
            image_url: r.image_url || '', source: r.source || '',
          });
          setTraits(r.traits || []);
          setLineages(r.lineages || []);
          setIsSubrace(!!r.is_subrace);
          setParentRaceId(r.parent_race_id || '');
          setSubraceLevel(r.subrace_level ?? 1);
          setRelatedEffects(r.related_effects || []);
          setRelatedActions(r.related_actions || []);
          setLevelProgression(r.level_progression || {});
        } catch (err) {
          setError('Ошибка загрузки вида');
        } finally {
          setLoadingRace(false);
        }
      };
      load();
    }
  }, [isEditMode, editId, reset]);

  const fd = watch();

  const cleanTraits = (arr: RaceTrait[]) => arr.filter((t) => t.name.trim() || t.description.trim());

  const parentRace = isSubrace && parentRaceId
    ? allRaces.find((r) => r.id === parentRaceId)
    : undefined;

  const previewRace: Race = {
    id: '', name: fd.name || 'Название вида', description: fd.description || 'Описание вида',
    detailed_description: fd.detailed_description || null, image_url: fd.image_url || '',
    rarity: 'common', card_number: '',
    is_subrace: isSubrace,
    parent_race_id: isSubrace ? parentRaceId || null : null,
    creature_type: isSubrace ? null : (fd.creature_type || null),
    size: isSubrace ? null : (fd.size || null),
    speed: isSubrace ? null : (fd.speed ?? null),
    extra_speeds: isSubrace ? null : (fd.extra_speeds || null),
    darkvision: fd.darkvision ?? null,
    traits: cleanTraits(traits), lineages: cleanTraits(lineages), level_progression: levelProgression,
    created_at: '', updated_at: '',
  };

  const onSubmit = async (data: ScalarForm) => {
    setLoading(true);
    setError(null);
    const payload: CreateRaceRequest & UpdateRaceRequest = {
      name: data.name,
      description: data.description,
      detailed_description: data.detailed_description || null,
      image_url: data.image_url || '',
      creature_type: isSubrace ? null : (data.creature_type || null),
      size: isSubrace ? null : (data.size || null),
      speed: isSubrace ? null : (data.speed ? Number(data.speed) : null),
      extra_speeds: isSubrace ? null : (data.extra_speeds || null),
      darkvision: data.darkvision != null ? Number(data.darkvision) : null,
      traits: cleanTraits(traits),
      lineages: cleanTraits(lineages),
      is_subrace: isSubrace,
      parent_race_id: isSubrace ? (parentRaceId || null) : null,
      subrace_level: isSubrace ? 1 : Math.max(1, Number(subraceLevel) || 1),
      related_effects: relatedEffects.length ? relatedEffects : null,
      related_actions: relatedActions.length ? relatedActions : null,
      level_progression: Object.keys(levelProgression).length ? levelProgression : null,
      source: data.source || null,
    };
    try {
      if (isEditMode && editId) {
        await racesApi.updateRace(editId, payload);
      } else {
        await racesApi.createRace({ ...payload, card_number: data.card_number || undefined });
      }
      navigate('/?type=races');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Ошибка сохранения вида');
      setLoading(false);
    }
  };

  if (loadingRace) {
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
          <button onClick={() => navigate('/?type=races')} className="flex items-center space-x-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={18} /><span className="text-sm sm:text-base">Назад</span>
          </button>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
            {isEditMode ? 'Редактирование вида' : 'Создание вида'}
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
                    <input {...register('name', { required: 'Название обязательно' })} className={inputCls} placeholder="Эльф" />
                    {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>ID вида</label>
                    <input {...register('card_number')} maxLength={30} disabled={isEditMode}
                      placeholder="elf"
                      className={`${inputCls} ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input type="checkbox" checked={isSubrace} onChange={(e) => setIsSubrace(e.target.checked)} />
                    Это подвид другого вида
                  </label>
                  {isSubrace && (
                    <div>
                      <label className={labelCls}>Родительский вид</label>
                      <select value={parentRaceId} onChange={(e) => setParentRaceId(e.target.value)} className={inputCls}>
                        <option value="">— выберите вид —</option>
                        {allRaces
                          .filter((r) => !r.is_subrace && r.id !== editId)
                          .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Подвид работает как вид: его эффекты добавляются персонажу. В создании персонажа он
                        появится под выбором родительского вида.
                      </p>
                    </div>
                  )}
                  {!isSubrace && (
                    <div>
                      <label className={labelCls}>Уровень выбора подвида</label>
                      <input type="number" min={1} max={20} value={subraceLevel}
                        onChange={(e) => setSubraceLevel(Math.max(1, parseInt(e.target.value || '1', 10)))}
                        className={inputCls} />
                      <p className="text-xs text-gray-500 mt-1">
                        На каком уровне персонаж выбирает подвид (по умолчанию 1; у Аасимара — 3).
                      </p>
                    </div>
                  )}
                </div>

                {!isSubrace && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Тип существа</label>
                        <select {...register('creature_type')} className={inputCls}>
                          {CREATURE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Размер</label>
                        <select {...register('size')} className={inputCls}>
                          {RACE_SIZE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className={labelCls}>Скорость (фт)</label>
                        <input type="number" {...register('speed', { valueAsNumber: true })} className={inputCls} placeholder="30" />
                      </div>
                      <div>
                        <label className={labelCls}>Тёмное зрение (фт)</label>
                        <input type="number" {...register('darkvision', { valueAsNumber: true })} className={inputCls} placeholder="0" />
                      </div>
                      <div>
                        <label className={labelCls}>Доп. скорости</label>
                        <input {...register('extra_speeds')} className={inputCls} placeholder="Плавание 30 фт" />
                      </div>
                    </div>
                  </>
                )}

                {isSubrace && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Тёмное зрение (фт)</label>
                      <input type="number" {...register('darkvision', { valueAsNumber: true })} className={inputCls} placeholder="0" />
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelCls}>Изображение</label>
                  <ImageUploader onImageUpload={(url) => setValue('image_url', url)} currentImageUrl={fd.image_url} />
                </div>

                <div>
                  <label className={labelCls}>Описание *</label>
                  <FormattedTextarea value={fd.description || ''} onChange={(v) => setValue('description', v)} rows={4}
                    placeholder="Краткое описание вида. **жирный** для выделения." />
                </div>

                <TraitEditor title="Видовые особенности" items={traits} onChange={setTraits} namePlaceholder="Тёмное зрение / Происхождение фей / ..." />

                <TraitEditor title="Происхождения / подвиды (опционально)" items={lineages} onChange={setLineages} namePlaceholder="Высший эльф / Дроу / Лесной эльф" />

                <div className="border-t pt-4 space-y-4">
                  <h3 className="text-md font-semibold text-gray-900">Способности (эффекты и действия)</h3>
                  <p className="text-sm text-gray-500">Привяжите созданные эффекты/действия с механикой. Текстовые особенности выше — для отображения.</p>
                  <EntityRefSelector
                    label="Эффекты"
                    value={relatedEffects}
                    onChange={setRelatedEffects}
                    loadItems={loadEffects}
                    resolveItems={resolveEffects}
                  />
                  <EntityRefSelector
                    label="Действия"
                    value={relatedActions}
                    onChange={setRelatedActions}
                    loadItems={loadActions}
                    resolveItems={resolveActions}
                  />
                </div>

                <div className="border-t pt-4 space-y-4">
                  <h3 className="text-md font-semibold text-gray-900">Способности по уровням</h3>
                  <p className="text-sm text-gray-500">Для видов, которые получают дополнительные эффекты или действия на определённых уровнях.</p>
                  <LevelProgressionEditor
                    value={levelProgression}
                    onChange={setLevelProgression}
                    loadEffects={loadEffects}
                    loadActions={loadActions}
                    resolveEffects={resolveEffects}
                    resolveActions={resolveActions}
                  />
                </div>

                <div>
                  <label className={labelCls}>Дополнительное описание</label>
                  <FormattedTextarea value={fd.detailed_description || ''} onChange={(v) => setValue('detailed_description', v)} rows={3}
                    placeholder="Лор, детали…" />
                </div>

                <div>
                  <label className={labelCls}>Источник</label>
                  <input {...register('source')} className={inputCls} placeholder="PHB 2024" />
                </div>

                <div className="flex gap-4 pt-4 border-t border-gray-200">
                  <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400">
                    {loading ? 'Сохранение…' : isEditMode ? 'Сохранить изменения' : 'Создать вид'}
                  </button>
                  <button type="button" onClick={() => navigate('/?type=races')} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          </div>

          {showPreview && (
            <div className="lg:col-span-5">
              <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Превью вида</h3>
                <div className="flex justify-center">
                  <RacePreview race={previewRace} parentRaceName={parentRace?.name} disableHover />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RaceCreator;
