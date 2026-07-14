import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { classesApi } from '../api/client';
import { useEffectActionLoaders } from '../hooks/useEffectActionLoaders';
import type { CharacterClass, ClassEquipmentOptions, CreateClassRequest, EquipmentOption, LevelProgression, UpdateClassRequest } from '../types';
import EquipmentOptionsEditor from '../components/EquipmentOptionsEditor';
import ImageUploader from '../components/ImageUploader';
import { FormattedTextarea } from '../components/FormattedTextarea';
import LevelProgressionEditor from '../components/LevelProgressionEditor';
import ClassPreview from '../components/ClassPreview';
import CreatorShell, { CreatorActions, CREATOR_INPUT_CLS, CREATOR_LABEL_CLS } from '../components/CreatorShell';

type ClassForm = {
  name: string;
  name_en: string;
  card_number: string;
  hit_die: string;
  primary_abilities: string;
  saving_throws: string;
  armor_training: string;
  weapon_proficiencies: string;
  tool_proficiencies: string;
  skill_choices_json: string;
  resources_json: string;
  description: string;
  detailed_description: string;
  image_url: string;
  source: string;
};

const splitList = (value: string) =>
  value.split(',').map((x) => x.trim()).filter(Boolean);

const parseJsonObject = (value: string, label: string): Record<string, unknown> | null => {
  if (!value.trim()) return null;
  const parsed = JSON.parse(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label}: ожидается JSON-объект`);
  }
  return parsed as Record<string, unknown>;
};

const stringifyJson = (value: Record<string, unknown> | null | undefined) =>
  value ? JSON.stringify(value, null, 2) : '';

type EquipOptKey = 'option_a' | 'option_b' | 'option_c';
const EQUIP_OPT_LABELS: Array<{ key: EquipOptKey; label: string }> = [
  { key: 'option_a', label: 'Вариант А' },
  { key: 'option_b', label: 'Вариант Б' },
  { key: 'option_c', label: 'Вариант В' },
];
const emptyEquipOption = (): EquipmentOption => ({ items: [], gold: 0 });
const hasEquipContent = (o: EquipmentOption) => o.items.length > 0 || o.gold > 0;

const ClassCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<ClassForm>({
    defaultValues: { hit_die: 'd8' },
  });
  const [levelProgression, setLevelProgression] = useState<LevelProgression>({});
  // Стартовое снаряжение — до трёх вариантов (А/Б/В); пустые не сохраняются.
  const [equipmentOptions, setEquipmentOptions] = useState<Record<EquipOptKey, EquipmentOption>>({
    option_a: emptyEquipOption(),
    option_b: emptyEquipOption(),
    option_c: emptyEquipOption(),
  });
  const [loading, setLoading] = useState(false);
  const [loadingClass, setLoadingClass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Подкласс: по паттерну подвидов рас
  const [isSubclass, setIsSubclass] = useState(false);
  const [parentClassId, setParentClassId] = useState<string>('');
  const [subclassLevel, setSubclassLevel] = useState<number>(3);
  const [parentOptions, setParentOptions] = useState<CharacterClass[]>([]);

  useEffect(() => {
    classesApi.getClasses({ limit: 100 }).then((res) => {
      setParentOptions(res.classes.filter((cl) => !cl.is_subclass && cl.id !== editId));
    }).catch(() => setParentOptions([]));
  }, [editId]);

  const { loadEffects, loadActions } = useEffectActionLoaders();

  useEffect(() => {
    if (!isEditMode || !editId) return;
    const load = async () => {
      try {
        setLoadingClass(true);
        const cl = await classesApi.getClass(editId);
        reset({
          name: cl.name,
          name_en: cl.name_en || '',
          card_number: cl.card_number || '',
          hit_die: cl.hit_die || 'd8',
          primary_abilities: (cl.primary_abilities || []).join(', '),
          saving_throws: (cl.saving_throws || []).join(', '),
          armor_training: (cl.armor_training || []).join(', '),
          weapon_proficiencies: (cl.weapon_proficiencies || []).join(', '),
          tool_proficiencies: (cl.tool_proficiencies || []).join(', '),
          skill_choices_json: stringifyJson(cl.skill_choices),
          resources_json: stringifyJson(cl.resources),
          description: cl.description || '',
          detailed_description: cl.detailed_description || '',
          image_url: cl.image_url || '',
          source: cl.source || '',
        });
        setLevelProgression(cl.level_progression || {});
        setEquipmentOptions({
          option_a: cl.equipment_options?.option_a || emptyEquipOption(),
          option_b: cl.equipment_options?.option_b || emptyEquipOption(),
          option_c: cl.equipment_options?.option_c || emptyEquipOption(),
        });
        setIsSubclass(!!cl.is_subclass);
        setParentClassId(cl.parent_class_id || '');
        setSubclassLevel(cl.subclass_level ?? 3);
      } catch (err) {
        setError('Ошибка загрузки класса');
      } finally {
        setLoadingClass(false);
      }
    };
    load();
  }, [editId, isEditMode, reset]);

  const fd = watch();
  const inputCls = CREATOR_INPUT_CLS;
  const labelCls = CREATOR_LABEL_CLS;

  const previewClass: CharacterClass = {
    id: '',
    name: fd.name || 'Название класса',
    name_en: fd.name_en || null,
    description: fd.description || 'Описание класса',
    detailed_description: fd.detailed_description || null,
    image_url: fd.image_url || '',
    rarity: 'common',
    card_number: fd.card_number || '',
    hit_die: fd.hit_die || null,
    primary_abilities: splitList(fd.primary_abilities || ''),
    saving_throws: splitList(fd.saving_throws || ''),
    armor_training: splitList(fd.armor_training || ''),
    weapon_proficiencies: splitList(fd.weapon_proficiencies || ''),
    tool_proficiencies: splitList(fd.tool_proficiencies || ''),
    level_progression: levelProgression,
    created_at: '',
    updated_at: '',
  };

  const setEquipOpt = (key: EquipOptKey, patch: Partial<EquipmentOption>) =>
    setEquipmentOptions((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const onSubmit = async (data: ClassForm) => {
    setLoading(true);
    setError(null);
    try {
      // Пустые варианты не сохраняем; подкласс своё снаряжение не выдаёт.
      const equipPayload: ClassEquipmentOptions | null = isSubclass ? null : {
        option_a: hasEquipContent(equipmentOptions.option_a) ? equipmentOptions.option_a : null,
        option_b: hasEquipContent(equipmentOptions.option_b) ? equipmentOptions.option_b : null,
        option_c: hasEquipContent(equipmentOptions.option_c) ? equipmentOptions.option_c : null,
      };
      const payload: CreateClassRequest & UpdateClassRequest = {
        name: data.name,
        name_en: data.name_en?.trim() || null,
        description: data.description,
        detailed_description: data.detailed_description || null,
        image_url: data.image_url || '',
        hit_die: data.hit_die || null,
        primary_abilities: splitList(data.primary_abilities).length ? splitList(data.primary_abilities) : null,
        saving_throws: splitList(data.saving_throws).length ? splitList(data.saving_throws) : null,
        armor_training: splitList(data.armor_training).length ? splitList(data.armor_training) : null,
        weapon_proficiencies: splitList(data.weapon_proficiencies).length ? splitList(data.weapon_proficiencies) : null,
        tool_proficiencies: splitList(data.tool_proficiencies).length ? splitList(data.tool_proficiencies) : null,
        skill_choices: parseJsonObject(data.skill_choices_json, 'Выбор навыков'),
        equipment_options: equipPayload,
        resources: parseJsonObject(data.resources_json, 'Ресурсы'),
        level_progression: Object.keys(levelProgression).length ? levelProgression : null,
        is_subclass: isSubclass,
        parent_class_id: isSubclass ? (parentClassId || null) : null,
        subclass_level: subclassLevel,
        source: data.source || null,
      };
      if (isSubclass && !parentClassId) {
        throw new Error('Выберите родительский класс для подкласса');
      }
      if (isEditMode && editId) {
        await classesApi.updateClass(editId, payload);
      } else {
        await classesApi.createClass({ ...payload, card_number: data.card_number || undefined });
      }
      navigate('/?type=classes');
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения класса');
      setLoading(false);
    }
  };

  return (
    <CreatorShell
      title={isEditMode ? 'Редактирование класса' : 'Создание класса'}
      onBack={() => navigate('/?type=classes')}
      loading={loadingClass}
      error={error}
      previewTitle="Превью класса"
      preview={<ClassPreview characterClass={previewClass} disableHover />}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Название *</label>
            <input {...register('name', { required: 'Название обязательно' })} className={inputCls} placeholder="Воин" />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className={labelCls}>ID класса</label>
            <input {...register('card_number')} maxLength={30} disabled={isEditMode} placeholder="fighter"
              className={`${inputCls} ${isEditMode ? 'bg-gray-100 cursor-not-allowed' : ''}`} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Оригинальное название</label>
          <input {...register('name_en')} className={inputCls} placeholder="Fighter" />
        </div>

        <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={isSubclass} onChange={(e) => setIsSubclass(e.target.checked)} />
            Это подкласс другого класса
          </label>
          {isSubclass ? (
            <div>
              <label className={labelCls}>Родительский класс *</label>
              <select value={parentClassId} onChange={(e) => setParentClassId(e.target.value)} className={inputCls}>
                <option value="">— выберите класс —</option>
                {parentOptions.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Подкласс наследует кость хитов, владения и ресурсы родителя. В кузнице он появится
                под выбором класса, когда персонаж достигнет уровня подкласса.
              </p>
            </div>
          ) : (
            <div className="w-48">
              <label className={labelCls}>Уровень выбора подкласса</label>
              <input type="number" min={1} max={20} value={subclassLevel}
                onChange={(e) => setSubclassLevel(Math.max(1, Math.min(20, Number(e.target.value) || 3)))}
                className={inputCls} />
            </div>
          )}
        </div>

        {!isSubclass && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Кость хитов</label>
                <select {...register('hit_die')} className={inputCls}>
                  {['d6', 'd8', 'd10', 'd12'].map((die) => <option key={die} value={die}>{die}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Основные характеристики</label>
                <input {...register('primary_abilities')} className={inputCls} placeholder="str, con" />
              </div>
              <div>
                <label className={labelCls}>Спасброски</label>
                <input {...register('saving_throws')} className={inputCls} placeholder="str, con" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Доспехи</label>
                <input {...register('armor_training')} className={inputCls} placeholder="light, medium, shields" />
              </div>
              <div>
                <label className={labelCls}>Оружие</label>
                <input {...register('weapon_proficiencies')} className={inputCls} placeholder="simple, martial" />
              </div>
              <div>
                <label className={labelCls}>Инструменты</label>
                <input {...register('tool_proficiencies')} className={inputCls} placeholder="thieves_tools" />
              </div>
            </div>

            {/* Стартовое снаряжение — до трёх вариантов (как у предысторий) */}
            <div>
              <label className={labelCls}>Стартовое снаряжение — варианты (пустые не сохраняются)</label>
              <EquipmentOptionsEditor
                specs={EQUIP_OPT_LABELS}
                value={equipmentOptions}
                onChange={setEquipOpt}
                className="grid grid-cols-1 md:grid-cols-3 gap-4"
              />
            </div>
          </>
        )}

        <div>
          <label className={labelCls}>Изображение</label>
          <ImageUploader onImageUpload={(url) => setValue('image_url', url)} currentImageUrl={fd.image_url} />
        </div>

        <div>
          <label className={labelCls}>Описание *</label>
          <FormattedTextarea value={fd.description || ''} onChange={(v) => setValue('description', v)} rows={4}
            placeholder="Краткое описание класса." />
        </div>

        <div className="border-t pt-4 space-y-4">
          <h3 className="text-md font-semibold text-gray-900">Способности по уровням</h3>
          <p className="text-sm text-gray-500">Класс показывает все уровни 1–20. Привяжите эффекты и действия, которые открываются на каждом уровне.</p>
          <LevelProgressionEditor
            value={levelProgression}
            onChange={setLevelProgression}
            loadEffects={loadEffects}
            loadActions={loadActions}
            showAllLevels
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {!isSubclass && (
            <>
              <div>
                <label className={labelCls}>Выбор навыков (JSON)</label>
                <textarea {...register('skill_choices_json')} rows={5} className={`${inputCls} font-mono text-xs`} placeholder='{"count":2,"options":["athletics","perception"]}' />
              </div>
            </>
          )}
          <div>
            <label className={labelCls}>Ресурсы (JSON)</label>
            <textarea {...register('resources_json')} rows={5} className={`${inputCls} font-mono text-xs`} placeholder='{"rage":{"max":"2"}}' />
          </div>
        </div>

        <div>
          <label className={labelCls}>Дополнительное описание</label>
          <FormattedTextarea value={fd.detailed_description || ''} onChange={(v) => setValue('detailed_description', v)} rows={3}
            placeholder="Подробности класса, роли, советы." />
        </div>

        <div>
          <label className={labelCls}>Источник</label>
          <input {...register('source')} className={inputCls} placeholder="PHB 2024" />
        </div>

        <CreatorActions
          loading={loading}
          submitLabel={isEditMode ? 'Сохранить изменения' : 'Создать класс'}
          onCancel={() => navigate('/?type=classes')}
        />
      </form>
    </CreatorShell>
  );
};

export default ClassCreator;
