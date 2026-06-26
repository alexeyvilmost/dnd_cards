import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { spellsApi } from '../api/client';
import type {
  CreateSpellRequest,
  UpdateSpellRequest,
  Spell,
  SpellDamageEntry,
} from '../types';
import {
  SPELL_SCHOOL_OPTIONS,
  SPELL_CLASS_OPTIONS,
  SPELL_SAVE_TYPE_OPTIONS,
  SPELL_CASTING_TIME_OPTIONS,
  SPELL_DAMAGE_TYPE_OPTIONS,
} from '../types';
import SpellPreview from '../components/SpellPreview';
import ImageUploader from '../components/ImageUploader';

type ScalarForm = {
  name: string;
  card_number: string;
  level: number;
  school: string;
  casting_time: string;
  range: string;
  duration: string;
  area: string;
  material_text: string;
  heal_dice: string;
  save_outcome: string;
  description: string;
  upcast_description: string;
  detailed_description: string;
  image_url: string;
  component_verbal: boolean;
  component_somatic: boolean;
  component_material: boolean;
  attack_roll: boolean;
  saving_throw: boolean;
  concentration: boolean;
  ritual: boolean;
  is_healing: boolean;
  source: string;
};

const SECTIONS = [
  { id: 'main', label: 'Основное' },
  { id: 'components', label: 'Компоненты' },
  { id: 'mechanics', label: 'Механика' },
  { id: 'text', label: 'Описание' },
] as const;

const SpellCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } =
    useForm<ScalarForm>({
      defaultValues: {
        level: 0,
        component_verbal: true,
        component_somatic: true,
        component_material: false,
        attack_roll: false,
        saving_throw: false,
        concentration: false,
        ritual: false,
        is_healing: false,
      },
    });

  const [classes, setClasses] = useState<string[]>([]);
  const [subclassesText, setSubclassesText] = useState('');
  const [saveTypes, setSaveTypes] = useState<string[]>([]);
  const [damage, setDamage] = useState<SpellDamageEntry[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingSpell, setLoadingSpell] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('main');
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    if (isEditMode && editId) {
      const load = async () => {
        try {
          setLoadingSpell(true);
          const spell = await spellsApi.getSpell(editId);
          reset({
            name: spell.name,
            card_number: spell.card_number || '',
            level: spell.level ?? 0,
            school: spell.school || '',
            casting_time: spell.casting_time || '',
            range: spell.range || '',
            duration: spell.duration || '',
            area: spell.area || '',
            material_text: spell.material_text || '',
            heal_dice: spell.heal_dice || '',
            save_outcome: spell.save_outcome || '',
            description: spell.description || '',
            upcast_description: spell.upcast_description || '',
            detailed_description: spell.detailed_description || '',
            image_url: spell.image_url || '',
            component_verbal: spell.component_verbal,
            component_somatic: spell.component_somatic,
            component_material: spell.component_material,
            attack_roll: spell.attack_roll,
            saving_throw: spell.saving_throw,
            concentration: spell.concentration,
            ritual: spell.ritual,
            is_healing: spell.is_healing,
            source: spell.source || '',
          });
          setClasses(spell.classes || []);
          setSubclassesText((spell.subclasses || []).join(', '));
          setSaveTypes(spell.save_types || []);
          setDamage(spell.damage || []);
        } catch (err) {
          setError('Ошибка загрузки заклинания');
          console.error(err);
        } finally {
          setLoadingSpell(false);
        }
      };
      load();
    }
  }, [isEditMode, editId, reset]);

  const fd = watch();

  const subclasses = subclassesText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const previewSpell: Spell = {
    id: '',
    name: fd.name || 'Название заклинания',
    description: fd.description || 'Описание заклинания',
    detailed_description: fd.detailed_description || null,
    image_url: fd.image_url || '',
    rarity: 'common',
    card_number: '',
    level: Number(fd.level) || 0,
    school: fd.school || null,
    casting_time: fd.casting_time || null,
    range: fd.range || null,
    component_verbal: !!fd.component_verbal,
    component_somatic: !!fd.component_somatic,
    component_material: !!fd.component_material,
    material_text: fd.material_text || null,
    duration: fd.duration || null,
    classes,
    subclasses,
    attack_roll: !!fd.attack_roll,
    saving_throw: !!fd.saving_throw,
    concentration: !!fd.concentration,
    ritual: !!fd.ritual,
    save_types: saveTypes,
    damage,
    area: fd.area || null,
    is_healing: !!fd.is_healing,
    heal_dice: fd.heal_dice || null,
    save_outcome: fd.save_outcome || null,
    upcast_description: fd.upcast_description || null,
    type: null,
    created_at: '',
    updated_at: '',
  };

  const toggleInList = (
    value: string,
    list: string[],
    setter: (v: string[]) => void
  ) => {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const onSubmit = async (data: ScalarForm) => {
    setLoading(true);
    setError(null);
    setIdError(null);

    if (!isEditMode && data.card_number && data.card_number.trim() !== '') {
      const idRegex = /^[a-zA-Z0-9_-]{1,30}$/;
      if (!idRegex.test(data.card_number)) {
        setIdError('ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов');
        setLoading(false);
        return;
      }
    }

    const payload: CreateSpellRequest & UpdateSpellRequest = {
      name: data.name,
      description: data.description,
      detailed_description: data.detailed_description || null,
      image_url: data.image_url || '',
      level: Number(data.level) || 0,
      school: data.school || null,
      casting_time: data.casting_time || null,
      range: data.range || null,
      component_verbal: !!data.component_verbal,
      component_somatic: !!data.component_somatic,
      component_material: !!data.component_material,
      material_text: data.material_text || null,
      duration: data.duration || null,
      classes,
      subclasses,
      attack_roll: !!data.attack_roll,
      saving_throw: !!data.saving_throw,
      concentration: !!data.concentration,
      ritual: !!data.ritual,
      save_types: saveTypes,
      damage,
      area: data.area || null,
      is_healing: !!data.is_healing,
      heal_dice: data.heal_dice || null,
      save_outcome: data.save_outcome || null,
      upcast_description: data.upcast_description || null,
      source: data.source || null,
    };

    try {
      if (isEditMode && editId) {
        await spellsApi.updateSpell(editId, payload);
      } else {
        await spellsApi.createSpell({ ...payload, card_number: data.card_number || undefined });
      }
      navigate('/?type=spells');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Ошибка сохранения заклинания');
      setLoading(false);
    }
  };

  if (loadingSpell) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      </div>
    );
  }

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-2';

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Заголовок */}
        <div className="mb-4 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <button
              onClick={() => navigate('/?type=spells')}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft size={18} />
              <span className="text-sm sm:text-base">Назад</span>
            </button>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">
              {isEditMode ? 'Редактирование заклинания' : 'Создание заклинания'}
            </h1>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm sm:text-base"
            >
              {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
              <span className="hidden sm:inline">{showPreview ? 'Скрыть' : 'Показать'}</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4">
          {/* Навигация по секциям */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow p-2 flex lg:flex-col gap-1 sticky top-6 overflow-x-auto">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium text-left whitespace-nowrap transition-colors ${
                    activeSection === s.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Форма */}
          <div className={showPreview ? 'lg:col-span-6' : 'lg:col-span-10'}>
            <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                {/* ── Основное ── */}
                {activeSection === 'main' && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-medium text-gray-900">Основная информация</h2>

                    <div>
                      <label className={labelCls}>Название *</label>
                      <input {...register('name', { required: 'Название обязательно' })} className={inputCls} placeholder="Огненный снаряд" />
                      {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Уровень (0 = заговор)</label>
                        <input type="number" min={0} max={12} {...register('level', { valueAsNumber: true })} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Школа</label>
                        <select {...register('school')} className={inputCls}>
                          <option value="">—</option>
                          {SPELL_SCHOOL_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Время сотворения</label>
                        <input {...register('casting_time')} list="casting-time-list" className={inputCls} placeholder="Действие" />
                        <datalist id="casting-time-list">
                          {SPELL_CASTING_TIME_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className={labelCls}>Дистанция</label>
                        <input {...register('range')} className={inputCls} placeholder="120 фт" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>Длительность</label>
                        <input {...register('duration')} className={inputCls} placeholder="Мгновенная" />
                      </div>
                      <div>
                        <label className={labelCls}>Область</label>
                        <input {...register('area')} className={inputCls} placeholder="20 фт" />
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>ID заклинания</label>
                      <input
                        {...register('card_number')}
                        type="text"
                        maxLength={30}
                        disabled={isEditMode}
                        placeholder="fire_bolt"
                        className={`${inputCls} ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {isEditMode ? 'ID нельзя изменить' : 'Необязательно. Латиница, цифры, - и _, до 30 символов'}
                      </p>
                      {idError && <p className="text-red-500 text-sm mt-1">{idError}</p>}
                    </div>

                    <div>
                      <label className={labelCls}>Изображение (иконка)</label>
                      <ImageUploader
                        onImageUpload={(url) => setValue('image_url', url)}
                        currentImageUrl={fd.image_url}
                      />
                    </div>
                  </div>
                )}

                {/* ── Компоненты ── */}
                {activeSection === 'components' && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-medium text-gray-900">Компоненты и классы</h2>

                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('component_verbal')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Вербальный (В)</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('component_somatic')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Соматический (С)</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('component_material')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Материальный (М)</span>
                      </label>
                    </div>

                    {fd.component_material && (
                      <div>
                        <label className={labelCls}>Материальный компонент (текст)</label>
                        <input {...register('material_text')} className={inputCls} placeholder="щепотка серы и фосфора" />
                      </div>
                    )}

                    <div>
                      <label className={labelCls}>Классы</label>
                      <div className="flex flex-wrap gap-2">
                        {SPELL_CLASS_OPTIONS.map((o) => (
                          <button
                            type="button"
                            key={o.value}
                            onClick={() => toggleInList(o.value, classes, setClasses)}
                            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                              classes.includes(o.value)
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Подклассы (через запятую)</label>
                      <input
                        value={subclassesText}
                        onChange={(e) => setSubclassesText(e.target.value)}
                        className={inputCls}
                        placeholder="Магия войны, Свет"
                      />
                    </div>
                  </div>
                )}

                {/* ── Механика ── */}
                {activeSection === 'mechanics' && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-medium text-gray-900">Механика</h2>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('attack_roll')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Бросок атаки</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('saving_throw')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Спасбросок</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('concentration')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Концентрация</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('ritual')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Ритуал</span>
                      </label>
                    </div>

                    {fd.saving_throw && (
                      <div>
                        <label className={labelCls}>Тип спасброска</label>
                        <div className="flex flex-wrap gap-2">
                          {SPELL_SAVE_TYPE_OPTIONS.map((o) => (
                            <button
                              type="button"
                              key={o.value}
                              onClick={() => toggleInList(o.value, saveTypes, setSaveTypes)}
                              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                                saveTypes.includes(o.value)
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {fd.saving_throw && (
                      <div>
                        <label className={labelCls}>Результат при спасброске</label>
                        <input {...register('save_outcome')} className={inputCls} placeholder="При успехе — половина урона" />
                      </div>
                    )}

                    {/* Урон */}
                    <div>
                      <label className={labelCls}>Урон (кубы)</label>
                      <div className="space-y-2">
                        {damage.map((d, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <input
                              value={d.dice}
                              onChange={(e) =>
                                setDamage(damage.map((x, j) => (j === i ? { ...x, dice: e.target.value } : x)))
                              }
                              className={`${inputCls} flex-1`}
                              placeholder="2d8"
                            />
                            <select
                              value={d.damage_type}
                              onChange={(e) =>
                                setDamage(damage.map((x, j) => (j === i ? { ...x, damage_type: e.target.value } : x)))
                              }
                              className={`${inputCls} flex-1`}
                            >
                              <option value="">тип урона</option>
                              {SPELL_DAMAGE_TYPE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setDamage(damage.filter((_, j) => j !== i))}
                              className="p-2 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setDamage([...damage, { dice: '', damage_type: '' }])}
                          className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm"
                        >
                          <Plus size={16} /> Добавить куб урона
                        </button>
                      </div>
                    </div>

                    {/* Лечение */}
                    <div>
                      <label className="flex items-center space-x-2">
                        <input type="checkbox" {...register('is_healing')} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm text-gray-700">Лечение</span>
                      </label>
                      {fd.is_healing && (
                        <input {...register('heal_dice')} className={`${inputCls} mt-2`} placeholder="1d8 + модификатор" />
                      )}
                    </div>
                  </div>
                )}

                {/* ── Описание ── */}
                {activeSection === 'text' && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-medium text-gray-900">Описание</h2>
                    <div>
                      <label className={labelCls}>Описание *</label>
                      <textarea {...register('description', { required: 'Описание обязательно' })} rows={5} className={inputCls} placeholder="Что делает заклинание. **жирный** для выделения." />
                      {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>}
                    </div>
                    <div>
                      <label className={labelCls}>Повышение уровня / Усиление заговора</label>
                      <textarea {...register('upcast_description')} rows={3} className={inputCls} placeholder="Урон увеличивается на 1d6 за каждый уровень слота выше первого." />
                    </div>
                    <div>
                      <label className={labelCls}>Дополнительное описание</label>
                      <textarea {...register('detailed_description')} rows={3} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Источник</label>
                      <input {...register('source')} className={inputCls} placeholder="PHB 2024" />
                    </div>
                  </div>
                )}

                {/* Кнопки */}
                <div className="flex gap-4 pt-4 border-t border-gray-200">
                  <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400">
                    {loading ? (isEditMode ? 'Сохранение...' : 'Создание...') : (isEditMode ? 'Сохранить изменения' : 'Создать заклинание')}
                  </button>
                  <button type="button" onClick={() => navigate('/?type=spells')} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                    Отмена
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Превью */}
          {showPreview && (
            <div className="lg:col-span-4">
              <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="text-lg font-medium text-gray-900 mb-8">Превью заклинания</h3>
                <div className="flex justify-center pt-4">
                  <SpellPreview spell={previewSpell} disableHover={true} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpellCreator;
