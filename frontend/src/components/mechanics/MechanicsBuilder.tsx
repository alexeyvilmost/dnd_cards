import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import { apiClient } from '../../api/client';
import type { Mechanics } from '../../mechanics/types';
import {
  TRIGGER_BLOCKS,
  EFFECT_BLOCKS,
  BLOCK_MAP,
  buildDeserializedMechanics,
  mechanicsRoundTripIsLossless,
  summarizeMechanics,
  defaultValuesForBlock,
  deserializeMechanics,
  targetingToJson,
  durationToJson,
  type Field,
  type CostRow,
  type ReqRow,
  type FilterRow,
  type TargetingForm,
  type DurationForm,
  type DeserializedMechanics,
} from '../../mechanics/blocks';
import { DAMAGE_TYPE_OPTIONS } from '../../mechanics/registries';
import type { Cond } from '../../mechanics/predicates';
import ChoiceEditor, { choiceFormToOptions, type ChoiceFormValue } from './ChoiceEditor';
import WhenEditor from './WhenEditor';
import CostEditor from './CostEditor';
import RequirementsEditor from './RequirementsEditor';
import FilterEditor from './FilterEditor';
import TargetingEditor from './TargetingEditor';
import DurationEditor from './DurationEditor';
import { MECH_INPUT_CLS as cls } from './shared';
import { describeMechanics } from '../../engine/describeMechanics';
import { FormattedText } from '../../utils/formattedText';

type EffectEntry = { id: string; blockId: string; values: Record<string, unknown> };

/** Контекст для AI-генерации механики по описанию сущности. */
export interface AiMechanicsContext {
  kind: 'item' | 'spell' | 'action' | 'passive_effect' | 'trait';
  name: string;
  description: string;
  extra?: string;
}

interface MechanicsBuilderProps {
  value: Mechanics | Record<string, unknown> | null;
  onChange: (m: Record<string, unknown> | null) => void;
  onValidationChange?: (valid: boolean) => void;
  resourceOptions?: { id: string; label: string }[];
  /** Если передан — показывается кнопка «AI»: генерация механики по описанию. */
  aiContext?: AiMechanicsContext;
}

let entryCounter = 0;
const newEntryId = () => `eff_${++entryCounter}`;

const MechanicsBuilder = ({ value, onChange, onValidationChange, resourceOptions = [], aiContext }: MechanicsBuilderProps) => {
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [triggerId, setTriggerId] = useState('trg_passive');
  const [triggerValues, setTriggerValues] = useState<Record<string, unknown>>({});
  const [effectEntries, setEffectEntries] = useState<EffectEntry[]>([]);
  const [minLevel, setMinLevel] = useState<number | ''>('');
  // S3: гейты-разрешения (доступность). Хранятся отдельно, вплетаются в собранную механику.
  const [itemWhile, setItemWhile] = useState<'' | 'equipped' | 'carried' | 'attuned'>('');
  const [consumesSelf, setConsumesSelf] = useState(false);
  const [ammo, setAmmo] = useState('');
  const [recharge, setRecharge] = useState('');
  const [extraCost, setExtraCost] = useState<CostRow[]>([]);
  const [requirements, setRequirements] = useState<ReqRow[]>([]);
  const [targeting, setTargeting] = useState<TargetingForm>({});
  const [duration, setDuration] = useState<DurationForm>({});
  const [mode, setMode] = useState<'blocks' | 'json'>('blocks');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [blockModeError, setBlockModeError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // dirty=true только после правки пользователя — чтобы открытие эффекта не перезаписывало механику
  const dirty = useRef(false);
  const markDirty = () => { dirty.current = true; };

  // Применить десериализованное значение к блокам
  const applyDeserialized = (m: Record<string, unknown> | null) => {
    const d = deserializeMechanics(m);
    if (!d) {
      setTriggerId('trg_passive');
      setTriggerValues({});
      setEffectEntries([]);
      setMinLevel('');
      setItemWhile('');
      setConsumesSelf(false);
      setAmmo('');
      setRecharge('');
      setExtraCost([]);
      setRequirements([]);
      setTargeting({});
      setDuration({});
      return;
    }
    setTriggerId(d.triggerId);
    setTriggerValues(d.triggerValues);
    setMinLevel(d.minLevel);
    setItemWhile(d.itemWhile);
    setConsumesSelf(d.consumesSelf);
    setAmmo(d.ammo);
    setRecharge(d.recharge);
    setExtraCost(d.extraCost);
    setRequirements(d.requirements);
    setTargeting(d.targeting);
    setDuration(d.duration);
    setEffectEntries(d.effectEntries.map((e) => ({ id: newEntryId(), blockId: e.blockId, values: e.values })));
  };

  // Гидрация из сохранённого значения (один раз): блоки восстанавливаются из JSON.
  useEffect(() => {
    if (hydrated) return;
    if (value) {
      applyDeserialized(value as Record<string, unknown>);
      setJsonText(JSON.stringify(value, null, 2));
      if (!mechanicsRoundTripIsLossless(value as Record<string, unknown>)) {
        setMode('json');
        setBlockModeError('Эта механика содержит поля или порядок, которые блоковый редактор пока не сохраняет. Используйте сырой JSON.');
      }
    }
    setHydrated(true);
  }, [value, hydrated]);

  const buildResult = useMemo(() => {
    const state: DeserializedMechanics = {
      triggerId,
      triggerValues,
      effectEntries,
      minLevel,
      itemWhile,
      consumesSelf,
      ammo,
      recharge,
      extraCost,
      requirements,
      targeting,
      duration,
    };
    try {
      return { built: buildDeserializedMechanics(state), error: null as string | null };
    } catch (error) {
      return {
        built: null,
        error: error instanceof Error ? error.message : 'Механику не удалось собрать',
      };
    }
  }, [triggerId, triggerValues, effectEntries, minLevel, itemWhile, consumesSelf, ammo, recharge, extraCost, requirements, targeting, duration]);
  const built = buildResult.built;

  const summary = useMemo(
    () => summarizeMechanics(triggerId, triggerValues, effectEntries.map((e) => ({ blockId: e.blockId, values: e.values }))),
    [triggerId, triggerValues, effectEntries],
  );
  const executableDescription = useMemo(
    () => describeMechanics(built as Record<string, unknown> | null),
    [built],
  );

  const emit = (next: typeof built) => {
    // Пустой конструктор (пассив без эффектов, гейтов и требований) → очищаем механику (null),
    // а не сохраняем «пустой» {activation:{mode:passive},effects:[]}.
    const empty = triggerId === 'trg_passive' && effectEntries.length === 0
      && minLevel === '' && !itemWhile && !consumesSelf && !ammo.trim() && !recharge.trim()
      && extraCost.length === 0 && requirements.length === 0
      && !targetingToJson(targeting) && !durationToJson(duration);
    onChange(empty ? null : next);
  };

  // В режиме блоков отдаём собранную механику — только после правок пользователя,
  // чтобы открытие существующего эффекта не перезаписывало его механику.
  useEffect(() => {
    if (!hydrated || !dirty.current || mode !== 'blocks' || buildResult.error) return;
    emit(built);

  }, [built, buildResult.error, hydrated, mode]);

  useEffect(() => {
    onValidationChange?.(mode === 'json' ? !jsonError : !buildResult.error);
  }, [mode, jsonError, buildResult.error, onValidationChange]);

  const switchToJson = () => {
    if (buildResult.error) {
      setBlockModeError(buildResult.error);
      return;
    }
    setJsonText(JSON.stringify(dirty.current ? built : (value ?? built ?? null), null, 2));
    setJsonError(null);
    setBlockModeError(null);
    setMode('json');
  };

  const switchToBlocks = () => {
    // Разбираем текущий JSON обратно в блоки
    try {
      const parsed = jsonText.trim() ? JSON.parse(jsonText) : null;
      if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        setJsonError('Корень механики должен быть JSON-объектом');
        return;
      }
      if (!mechanicsRoundTripIsLossless(parsed)) {
        setBlockModeError('Переход в блоки отменён: блоковый редактор потерял бы поля или изменил порядок эффектов.');
        return;
      }
      applyDeserialized(parsed);
      setJsonError(null);
      setBlockModeError(null);
      setMode('blocks');
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Некорректный JSON');
    }
  };

  const onJsonChange = (text: string) => {
    setJsonText(text);
    markDirty();
    setBlockModeError(null);
    if (!text.trim()) {
      setJsonError(null);
      onChange(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setJsonError(null);
      onChange(parsed);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Некорректный JSON');
    }
  };

  const renderField = (
    field: Field,
    values: Record<string, unknown>,
    onField: (key: string, val: unknown) => void,
  ) => {
    const options = 'optionSource' in field && field.optionSource === 'resources' && resourceOptions.length
      ? resourceOptions
      : ('options' in field ? field.options : []);
    switch (field.type) {
      case 'select':
        return (
          <select
            className={cls}
            value={String(values[field.key] ?? field.default ?? '')}
            onChange={(e) => onField(field.key, e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        );
      case 'multiselect': {
        // Чипы-переключатели вместо нативного <select multiple> (тот требует ctrl+click и
        // при обычном клике сбрасывает выбор — из-за этого «нельзя выбрать несколько»).
        const selected = (values[field.key] as string[]) || [];
        const toggle = (id: string) => {
          const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
          onField(field.key, next);
        };
        return (
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                    on
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
            {options.length === 0 && <span className="text-xs text-gray-400">Нет вариантов</span>}
          </div>
        );
      }
      case 'number':
        return (
          <input
            type="number"
            className={cls}
            value={values[field.key] !== undefined ? Number(values[field.key]) : (field.default ?? '')}
            onChange={(e) => onField(field.key, parseFloat(e.target.value))}
          />
        );
      case 'formula':
      case 'text':
        return (
          <input
            className={cls}
            value={String(values[field.key] ?? field.default ?? '')}
            onChange={(e) => onField(field.key, e.target.value)}
            placeholder={field.type === 'formula' ? 'prof_bonus, self_level d4' : ''}
          />
        );
      case 'damage-type':
        return (
          <select
            className={cls}
            value={String(values[field.key] ?? field.default ?? 'fire')}
            onChange={(e) => onField(field.key, e.target.value)}
          >
            {DAMAGE_TYPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        );
      case 'choice-source':
        return (
          <ChoiceEditor
            value={(values.choice as ChoiceFormValue) || { source: 'skill', count: 1, resolution: 'on_acquire' }}
            onChange={(c) => {
              const choice = {
                ...c,
                options: choiceFormToOptions(c),
              };
              onField('choice', choice);
            }}
          />
        );
      case 'when':
        return (
          <WhenEditor
            value={values[field.key] as Cond[] | undefined}
            hint={field.hint}
            onChange={(w) => onField(field.key, w)}
          />
        );
      case 'kvfilter':
        return (
          <FilterEditor
            value={values[field.key] as FilterRow[] | undefined}
            onChange={(f) => onField(field.key, f)}
          />
        );
      default:
        return null;
    }
  };

  const addEffect = (blockId: string) => {
    markDirty();
    setEffectEntries((prev) => [
      ...prev,
      { id: newEntryId(), blockId, values: defaultValuesForBlock(blockId) },
    ]);
  };

  // Перенос блока эффекта: dir = -1 (выше) | 1 (ниже).
  const moveEffect = (idx: number, dir: -1 | 1) => {
    markDirty();
    setEffectEntries((prev) => {
      const n = [...prev];
      const j = idx + dir;
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
  };

  // AI-генерация механики по описанию сущности (кнопка «AI»).
  const generateWithAi = async () => {
    if (!aiContext || aiBusy) return;
    if (!aiContext.description?.trim()) {
      setAiError('Заполните описание — AI генерирует механику по нему');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const { data } = await apiClient.post<{ mechanics: Record<string, unknown> }>('/api/ai/mechanics', {
        kind: aiContext.kind,
        name: aiContext.name || 'без названия',
        description: aiContext.description,
        extra: aiContext.extra ?? '',
      });
      const mech = data.mechanics;
      setJsonText(JSON.stringify(mech, null, 2));
      markDirty();
      onChange(mech);
      if (mechanicsRoundTripIsLossless(mech)) {
        applyDeserialized(mech);
        setMode('blocks');
        setBlockModeError(null);
      } else {
        setMode('json');
        setBlockModeError('Сгенерированная механика содержит поля, которые блоковый редактор пока не сохраняет. Продолжайте в JSON.');
      }
    } catch (e) {
      console.error(e);
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setAiError(msg || 'Не удалось сгенерировать механику');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            type="button"
            className={`px-3 py-1 text-sm rounded-md ${mode === 'blocks' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500'}`}
            onClick={() => mode !== 'blocks' && switchToBlocks()}
          >
            Блоки
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-sm rounded-md ${mode === 'json' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500'}`}
            onClick={() => mode !== 'json' && switchToJson()}
          >
            Расширенный JSON
          </button>
        </div>
        {aiContext && (
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-white hover:bg-gray-800 disabled:bg-gray-300"
            disabled={aiBusy}
            title="Сгенерировать механику по описанию (OpenAI)"
            onClick={generateWithAi}
          >
            <Wand2 size={14} />
            {aiBusy ? 'Генерация…' : 'AI-черновик'}
          </button>
        )}
        {aiError && <span className="text-xs text-red-600">{aiError}</span>}
      </div>
      {blockModeError && <p className="text-xs text-amber-700">{blockModeError}</p>}
      {mode === 'blocks' && buildResult.error && (
        <p className="text-xs text-red-600">Ошибка механики: {buildResult.error}</p>
      )}

      {mode === 'json' ? (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Прямое редактирование унифицированной механики. Переключитесь на «Блоки», чтобы собрать обратно.
          </p>
          <textarea
            className="w-full h-80 p-3 border rounded-lg font-mono text-xs"
            spellCheck={false}
            value={jsonText}
            onChange={(e) => onJsonChange(e.target.value)}
            placeholder='{"activation":{"mode":"passive"},"effects":[]}'
          />
          {jsonError ? (
            <p className="text-xs text-red-600 mt-1">Ошибка JSON: {jsonError}</p>
          ) : (
            <p className="text-xs text-green-600 mt-1">Синтаксис JSON корректен. Исполняемость проверяется общей валидацией формы.</p>
          )}
        </div>
      ) : (
      <>
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Когда срабатывает</h3>
        <select
          className="w-full px-3 py-2 border rounded-lg text-sm mb-3"
          value={triggerId}
          onChange={(e) => {
            markDirty();
            const id = e.target.value;
            setTriggerId(id);
            setTriggerValues(defaultValuesForBlock(id));
          }}
        >
          {TRIGGER_BLOCKS.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
        {BLOCK_MAP[triggerId]?.fields.length ? (
          <div className="grid grid-cols-2 gap-2">
            {BLOCK_MAP[triggerId].fields.map((f) => (
              <div key={f.key} className={f.type === 'when' ? 'col-span-2' : ''}>
                <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                {renderField(f, triggerValues, (k, v) => {
                  markDirty();
                  setTriggerValues((prev) => ({ ...prev, [k]: v }));
                })}
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
          <label className="block text-xs text-gray-600 mb-1">Мин. уровень (опционально)</label>
          <input
            type="number"
            min={1}
            className="w-32 px-2 py-1 border rounded text-sm"
            value={minLevel}
            onChange={(e) => {
              markDirty();
              setMinLevel(e.target.value === '' ? '' : parseInt(e.target.value, 10));
            }}
            placeholder="—"
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Цена и доступность</h3>
        <p className="text-xs text-gray-500 mb-3">Укажите, когда способность доступна и какие ресурсы она расходует.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Когда предмет действует</label>
            <select
              className={cls}
              value={itemWhile}
              onChange={(e) => { markDirty(); setItemWhile(e.target.value as typeof itemWhile); }}
            >
              <option value="">— (по умолчанию: пока надет)</option>
              <option value="equipped">Пока надет</option>
              <option value="carried">Пока при себе (надет или в сумке)</option>
              <option value="attuned">Пока настроен</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Боеприпас</label>
            <input
              className={cls}
              value={ammo}
              placeholder="напр. arrow"
              onChange={(e) => { markDirty(); setAmmo(e.target.value); }}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Особая перезарядка</label>
            <input
              className={cls}
              value={recharge}
              placeholder="напр. 5-6, dawn"
              onChange={(e) => { markDirty(); setRecharge(e.target.value); }}
            />
            <p className="text-[11px] text-amber-600 mt-0.5">Расширенный параметр: сейчас восстановления задаются настройкой «За период».</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-1 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={consumesSelf}
              onChange={(e) => { markDirty(); setConsumesSelf(e.target.checked); }}
            />
            Саморасход (тратит сам предмет)
          </label>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-gray-600 mb-1">Дополнительная стоимость</label>
          <CostEditor value={extraCost} onChange={(c) => { markDirty(); setExtraCost(c); }} />
        </div>
        <div className="mt-3">
          <label className="block text-xs text-gray-600 mb-1">Требования</label>
          <p className="text-xs text-amber-600 mb-1">Требования применяются при выдаче способности; в бою повторно проверяется минимальный уровень.</p>
          <RequirementsEditor value={requirements} onChange={(r) => { markDirty(); setRequirements(r); }} />
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Цель и длительность</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1">Наведение (targeting)</div>
            <TargetingEditor value={targeting} onChange={(t) => { markDirty(); setTargeting(t); }} />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1">Длительность (duration)</div>
            <DurationEditor value={duration} onChange={(d) => { markDirty(); setDuration(d); }} />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">Результат</h3>
          <select
            className="text-sm border rounded px-2 py-1"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addEffect(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="">+ Добавить эффект</option>
            {EFFECT_BLOCKS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-3">
          {effectEntries.map((entry, idx) => {
            const block = BLOCK_MAP[entry.blockId];
            if (!block) return null;
            return (
              <div key={entry.id} className="border rounded-lg p-3 bg-white shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-800">{block.label}</span>
                  <div className="flex gap-1">
                    <button type="button" title="Выше" className="p-1 text-gray-400 hover:text-gray-700"
                      disabled={idx === 0}
                      onClick={() => moveEffect(idx, -1)}>
                      <ChevronUp size={16} />
                    </button>
                    <button type="button" title="Ниже" className="p-1 text-gray-400 hover:text-gray-700"
                      disabled={idx === effectEntries.length - 1}
                      onClick={() => moveEffect(idx, 1)}>
                      <ChevronDown size={16} />
                    </button>
                    <button type="button" className="p-1 text-red-400 hover:text-red-600"
                      onClick={() => { markDirty(); setEffectEntries((prev) => prev.filter((x) => x.id !== entry.id)); }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {block.fields.map((f) => (
                    <div key={f.key}>
                      {f.type !== 'choice-source' && (
                        <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                      )}
                      {renderField(f, entry.values, (k, v) => {
                        markDirty();
                        setEffectEntries((prev) =>
                          prev.map((x) => (x.id === entry.id ? { ...x, values: { ...x.values, [k]: v } } : x)),
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">{block.summary(entry.values)}</p>
              </div>
            );
          })}
          {effectEntries.length === 0 && (
            <p className="text-sm text-gray-500 italic">Добавьте блок эффекта</p>
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Исполняемое резюме</h3>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm text-gray-800 mb-1">
            <FormattedText text={executableDescription.summary || summary || 'Результат пока не задан'} />
          </p>
          {executableDescription.details.map((detail) => (
            <p key={detail} className="text-xs text-gray-600 mt-1"><FormattedText text={detail} /></p>
          ))}
          {!built?.uses && <p className="text-xs text-gray-600 mt-1">Использования: без лимита</p>}
        </div>
        <p className="text-xs text-gray-400 mt-2">Полный документ доступен на вкладке «Расширенный JSON».</p>
      </div>
      </>
      )}
    </div>
  );
};

export default MechanicsBuilder;
