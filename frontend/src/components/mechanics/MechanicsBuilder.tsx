import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Mechanics } from '../../mechanics/types';
import {
  TRIGGER_BLOCKS,
  EFFECT_BLOCKS,
  BLOCK_MAP,
  buildMechanics,
  summarizeMechanics,
  defaultValuesForBlock,
  deserializeMechanics,
  type Field,
} from '../../mechanics/blocks';
import { DAMAGE_TYPE_OPTIONS } from '../../mechanics/registries';
import ChoiceEditor, { choiceFormToOptions, type ChoiceFormValue } from './ChoiceEditor';

type EffectEntry = { id: string; blockId: string; values: Record<string, unknown> };

interface MechanicsBuilderProps {
  value: Mechanics | Record<string, unknown> | null;
  onChange: (m: Record<string, unknown> | null) => void;
}

let entryCounter = 0;
const newEntryId = () => `eff_${++entryCounter}`;

const MechanicsBuilder = ({ value, onChange }: MechanicsBuilderProps) => {
  const [triggerId, setTriggerId] = useState('trg_passive');
  const [triggerValues, setTriggerValues] = useState<Record<string, unknown>>({});
  const [effectEntries, setEffectEntries] = useState<EffectEntry[]>([]);
  const [minLevel, setMinLevel] = useState<number | ''>('');
  const [mode, setMode] = useState<'blocks' | 'json'>('blocks');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
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
      return;
    }
    setTriggerId(d.triggerId);
    setTriggerValues(d.triggerValues);
    setMinLevel(d.minLevel);
    setEffectEntries(d.effectEntries.map((e) => ({ id: newEntryId(), blockId: e.blockId, values: e.values })));
  };

  // Гидрация из сохранённого значения (один раз): блоки восстанавливаются из JSON.
  useEffect(() => {
    if (hydrated) return;
    if (value) {
      applyDeserialized(value as Record<string, unknown>);
      setJsonText(JSON.stringify(value, null, 2));
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, hydrated]);

  const built = useMemo(() => {
    const base = buildMechanics(triggerId, triggerValues, effectEntries.map((e) => ({
      blockId: e.blockId,
      values: e.values,
    })));
    if (!base) return null;
    if (minLevel !== '' && Number(minLevel) > 0) {
      const act = base.activation as Record<string, unknown>;
      const reqs = (act.requirements as unknown[]) || [];
      act.requirements = [...reqs, { type: 'level', min_level: Number(minLevel) }];
    }
    return base;
  }, [triggerId, triggerValues, effectEntries, minLevel]);

  const summary = useMemo(
    () => summarizeMechanics(triggerId, triggerValues, effectEntries.map((e) => ({ blockId: e.blockId, values: e.values }))),
    [triggerId, triggerValues, effectEntries],
  );

  const emit = (next: typeof built) => {
    if (!next && effectEntries.length === 0 && triggerId === 'trg_passive') {
      onChange(null);
      return;
    }
    onChange(next);
  };

  // В режиме блоков отдаём собранную механику — только после правок пользователя,
  // чтобы открытие существующего эффекта не перезаписывало его механику.
  useEffect(() => {
    if (!hydrated || !dirty.current || mode !== 'blocks') return;
    emit(built);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, hydrated, mode]);

  const switchToJson = () => {
    setJsonText(JSON.stringify(built ?? value ?? null, null, 2));
    setJsonError(null);
    setMode('json');
  };

  const switchToBlocks = () => {
    // Разбираем текущий JSON обратно в блоки
    try {
      const parsed = jsonText.trim() ? JSON.parse(jsonText) : null;
      applyDeserialized(parsed);
      setJsonError(null);
    } catch {
      // Если JSON не разобрался — оставляем блоки как есть
    }
    setMode('blocks');
  };

  const onJsonChange = (text: string) => {
    setJsonText(text);
    markDirty();
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
    switch (field.type) {
      case 'select':
        return (
          <select
            className="w-full px-2 py-1 border rounded text-sm"
            value={String(values[field.key] ?? field.default ?? '')}
            onChange={(e) => onField(field.key, e.target.value)}
          >
            {field.options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        );
      case 'multiselect':
        return (
          <select
            multiple
            className="w-full px-2 py-1 border rounded text-sm h-20"
            value={(values[field.key] as string[]) || []}
            onChange={(e) =>
              onField(field.key, Array.from(e.target.selectedOptions).map((o) => o.value))
            }
          >
            {field.options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        );
      case 'number':
        return (
          <input
            type="number"
            className="w-full px-2 py-1 border rounded text-sm"
            value={values[field.key] !== undefined ? Number(values[field.key]) : (field.default ?? '')}
            onChange={(e) => onField(field.key, parseFloat(e.target.value))}
          />
        );
      case 'formula':
      case 'text':
        return (
          <input
            className="w-full px-2 py-1 border rounded text-sm"
            value={String(values[field.key] ?? field.default ?? '')}
            onChange={(e) => onField(field.key, e.target.value)}
            placeholder={field.type === 'formula' ? 'prof_bonus, self_level d4' : ''}
          />
        );
      case 'damage-type':
        return (
          <select
            className="w-full px-2 py-1 border rounded text-sm"
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

  return (
    <div className="space-y-6">
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
          Сырой JSON
        </button>
      </div>

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
            <p className="text-xs text-green-600 mt-1">JSON корректен</p>
          )}
        </div>
      ) : (
      <>
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Триггер / активация</h3>
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
              <div key={f.key}>
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

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">Эффекты</h3>
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
                      onClick={() => { markDirty(); setEffectEntries((prev) => {
                        const n = [...prev];
                        [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
                        return n;
                      }); }}>
                      <ChevronUp size={16} />
                    </button>
                    <button type="button" title="Ниже" className="p-1 text-gray-400 hover:text-gray-700"
                      disabled={idx === effectEntries.length - 1}
                      onClick={() => { markDirty(); setEffectEntries((prev) => {
                        const n = [...prev];
                        [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
                        return n;
                      }); }}>
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
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Превью</h3>
        <p className="text-sm text-gray-700 mb-2">{summary || '—'}</p>
        <p className="text-xs text-gray-400">Полный JSON — на вкладке «Сырой JSON».</p>
      </div>
      </>
      )}
    </div>
  );
};

export default MechanicsBuilder;
