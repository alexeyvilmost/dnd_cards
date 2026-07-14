import { useMemo } from 'react';
import {
  CHOICE_SOURCES,
  ORIGIN_FEATS,
  labelOf,
  optionsForChoiceSource,
} from '../../mechanics/registries';
import { MECH_INPUT_CLS as cls } from './shared';

export type ChoiceFormValue = {
  id?: string;
  prompt?: string;
  count?: number;
  source?: string;
  // Объектная форма ({classes,levels,only_available_slots}) не редактируется строковым select'ом, но
  // сохраняется здесь дословно для lossless round-trip (иначе правка другого поля стёрла бы ограничение).
  filter?: string | string[] | Record<string, unknown>;
  /** source='spell': предлагать только круги, ячейки которых доступны персонажу (1..макс. слот). */
  onlyAvailableSlots?: boolean;
  recommended?: string[];
  resolution?: 'on_acquire' | 'immediate';
  items?: Array<{ id: string; name: string; grantsJson: string }>;
};

interface ChoiceEditorProps {
  value: ChoiceFormValue;
  onChange: (v: ChoiceFormValue) => void;
}

const ITEM_SOURCES = ['subfeature', 'explicit', 'effect'];

const ChoiceEditor = ({ value, onChange }: ChoiceEditorProps) => {
  const sourceOptions = useMemo(() => optionsForChoiceSource(value.source || 'skill'), [value.source]);
  const usesItems = ITEM_SOURCES.includes(value.source || 'skill');
  const isEffect = value.source === 'effect';

  // Варианты для «Рекомендуемые» (предвыбор): feat → черты; item-источники → сами бусины;
  // иначе → справочник источника (навыки/инструменты/языки). Для spell справочник пуст →
  // редактируем списком ID через запятую (полный список заклинаний грузится не здесь).
  const recOptions = useMemo(() => {
    if (value.source === 'feat') return ORIGIN_FEATS;
    if (usesItems) return (value.items || []).filter((it) => it.id).map((it) => ({ id: it.id, label: it.name || it.id }));
    return sourceOptions;
  }, [value.source, value.items, usesItems, sourceOptions]);

  const set = (patch: Partial<ChoiceFormValue>) => onChange({ ...value, ...patch });

  const patchItem = (idx: number, p: Partial<NonNullable<ChoiceFormValue['items']>[number]>) =>
    set({ items: (value.items || []).map((it, j) => (j === idx ? { ...it, ...p } : it)) });

  const rec = (value.recommended as string[]) || [];
  const toggleRec = (id: string) =>
    set({ recommended: rec.includes(id) ? rec.filter((x) => x !== id) : [...rec, id] });

  return (
    <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">ID (стабильный)</label>
          <input
            className={cls}
            value={value.id || ''}
            onChange={(e) => set({ id: e.target.value })}
            placeholder="human_skill"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Количество</label>
          <input
            type="number"
            min={1}
            className={cls}
            value={value.count ?? 1}
            onChange={(e) => set({ count: parseInt(e.target.value || '1', 10) })}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Подсказка</label>
        <input
          className={cls}
          value={value.prompt || ''}
          onChange={(e) => set({ prompt: e.target.value })}
          placeholder="Выберите навык"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Источник</label>
          <select
            className={cls}
            value={value.source || 'skill'}
            onChange={(e) => set({ source: e.target.value, filter: 'all' })}
          >
            {CHOICE_SOURCES.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Разрешение</label>
          <select
            className={cls}
            value={value.resolution || 'on_acquire'}
            onChange={(e) => set({ resolution: e.target.value as ChoiceFormValue['resolution'] })}
          >
            <option value="on_acquire">При получении</option>
            <option value="immediate">Немедленно</option>
          </select>
        </div>
      </div>

      {/* Рекомендуемые варианты — предвыбираются в кузне при рендере выбора (можно изменить). */}
      <div>
        <label className="block text-xs text-gray-600 mb-1">Рекомендуемые (предвыбор)</label>
        {recOptions.length > 0 ? (
          // Чипы-переключатели, а не нативный <select multiple>: тот требует ctrl+click и
          // сбрасывает выбор при обычном клике (тот же выбор, что уже сделан в MechanicsBuilder).
          <div className="flex flex-wrap gap-1.5">
            {recOptions.map((o) => {
              const on = rec.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleRec(o.id)}
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
          </div>
        ) : (
          <input
            className={cls}
            value={rec.join(', ')}
            onChange={(e) =>
              set({ recommended: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
            }
            placeholder="ID вариантов через запятую (напр. id заклинаний)"
          />
        )}
        <p className="text-xs text-gray-500 mt-0.5">
          Отмеченные варианты выбираются автоматически при создании — снижает число решений новичку
          (игрок сможет изменить).
        </p>
      </div>

      {!usesItems && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Фильтр ({labelOf(CHOICE_SOURCES, value.source)})
          </label>
          <select
            className={`${cls} disabled:bg-gray-100 disabled:text-gray-400`}
            value={typeof value.filter === 'string' ? value.filter : 'all'}
            disabled={value.source === 'spell' && !!value.onlyAvailableSlots}
            onChange={(e) => set({ filter: e.target.value === 'all' ? 'all' : e.target.value })}
          >
            <option value="all">Все</option>
            {sourceOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {value.source === 'spell' && (
        <label className="flex items-start gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!value.onlyAvailableSlots}
            onChange={(e) => set({ onlyAvailableSlots: e.target.checked })}
          />
          <span>
            Только доступные круги ячеек
            <span className="block text-gray-500">
              Предлагать заклинания кругов 1..максимальный доступный слот персонажа (нативно для
              колдунов). Заговоры не входят — для них используйте фильтр «Заговор».
            </span>
          </span>
        </label>
      )}

      {usesItems && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-gray-700">
              {isEffect ? 'Эффекты-бусины (id = slug/card_number эффекта)' : 'Варианты выбора'}
            </span>
            <button
              type="button"
              className="text-xs text-blue-600"
              onClick={() =>
                set({
                  items: [...(value.items || []), { id: '', name: '', grantsJson: '[]' }],
                })
              }
            >
              + вариант
            </button>
          </div>
          {isEffect && (
            <p className="text-xs text-gray-500">
              id — card_number эффекта (напр. EFF-disadvantage-attacks); при выборе эффект добавляется
              персонажу как самостоятельная бусина. grants можно оставить пустым.
            </p>
          )}
          {(value.items || []).map((item, idx) => (
            <div key={idx} className="p-2 border rounded bg-white space-y-1">
              <input
                className={cls}
                placeholder={isEffect ? 'EFF-... (slug эффекта)' : 'id'}
                value={item.id}
                onChange={(e) => patchItem(idx, { id: e.target.value })}
              />
              <input
                className={cls}
                placeholder="Название"
                value={item.name}
                onChange={(e) => patchItem(idx, { name: e.target.value })}
              />
              <textarea
                className={`${cls} font-mono text-xs`}
                rows={3}
                placeholder={isEffect ? '[] (доп. гранты; обычно пусто)' : '[{"kind":"grant_spell","value":"light"}]'}
                value={item.grantsJson}
                onChange={(e) => patchItem(idx, { grantsJson: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function choiceFormToOptions(value: ChoiceFormValue) {
  if (ITEM_SOURCES.includes(value.source || 'skill')) {
    return {
      source: value.source,
      items: (value.items || []).map((it) => {
        let grants: unknown[] = [];
        try { grants = JSON.parse(it.grantsJson || '[]'); } catch { /* ignore */ }
        return { id: it.id, name: it.name, grants };
      }),
    };
  }
  const raw = value.filter;
  // Объектный фильтр ({classes,levels,...}) сохраняем дословно, лишь накладывая чекбокс
  // only_available_slots (иначе класс/уровневые ограничения сид-контента терялись бы при правке).
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    if (value.source === 'spell') {
      if (value.onlyAvailableSlots) obj.only_available_slots = true;
      else delete obj.only_available_slots;
    }
    return { source: value.source || 'skill', filter: obj };
  }
  // Строковый/массивный фильтр + чекбокс only_available_slots (без объектных ограничений).
  if (value.source === 'spell' && value.onlyAvailableSlots) {
    return { source: 'spell', filter: { only_available_slots: true } };
  }
  const filter = value.source === 'feat' && !value.filter ? 'origin_feats' : (value.filter || 'all');
  return { source: value.source || 'skill', filter };
}

export default ChoiceEditor;
