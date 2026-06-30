import { useMemo } from 'react';
import {
  CHOICE_SOURCES,
  ORIGIN_FEATS,
  labelOf,
  optionsForChoiceSource,
} from '../../mechanics/registries';

export type ChoiceFormValue = {
  id?: string;
  prompt?: string;
  count?: number;
  source?: string;
  filter?: string | string[];
  recommended?: string[];
  resolution?: 'on_acquire' | 'immediate';
  items?: Array<{ id: string; name: string; grantsJson: string }>;
};

interface ChoiceEditorProps {
  value: ChoiceFormValue;
  onChange: (v: ChoiceFormValue) => void;
}

const ChoiceEditor = ({ value, onChange }: ChoiceEditorProps) => {
  const sourceOptions = useMemo(() => optionsForChoiceSource(value.source || 'skill'), [value.source]);

  const set = (patch: Partial<ChoiceFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">ID (стабильный)</label>
          <input
            className="w-full px-2 py-1 border rounded text-sm"
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
            className="w-full px-2 py-1 border rounded text-sm"
            value={value.count ?? 1}
            onChange={(e) => set({ count: parseInt(e.target.value || '1', 10) })}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Подсказка</label>
        <input
          className="w-full px-2 py-1 border rounded text-sm"
          value={value.prompt || ''}
          onChange={(e) => set({ prompt: e.target.value })}
          placeholder="Выберите навык"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Источник</label>
          <select
            className="w-full px-2 py-1 border rounded text-sm"
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
            className="w-full px-2 py-1 border rounded text-sm"
            value={value.resolution || 'on_acquire'}
            onChange={(e) => set({ resolution: e.target.value as ChoiceFormValue['resolution'] })}
          >
            <option value="on_acquire">При получении</option>
            <option value="immediate">Немедленно</option>
          </select>
        </div>
      </div>

      {value.source === 'feat' && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">Рекомендуемые</label>
          <select
            multiple
            className="w-full px-2 py-1 border rounded text-sm h-20"
            value={(value.recommended as string[]) || []}
            onChange={(e) =>
              set({ recommended: Array.from(e.target.selectedOptions).map((o) => o.value) })
            }
          >
            {ORIGIN_FEATS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {value.source !== 'subfeature' && value.source !== 'explicit' && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Фильтр ({labelOf(CHOICE_SOURCES, value.source)})
          </label>
          <select
            className="w-full px-2 py-1 border rounded text-sm"
            value={typeof value.filter === 'string' ? value.filter : 'all'}
            onChange={(e) => set({ filter: e.target.value === 'all' ? 'all' : e.target.value })}
          >
            <option value="all">Все</option>
            {sourceOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      )}

      {value.source === 'subfeature' && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-gray-700">Варианты подвида</span>
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
          {(value.items || []).map((item, idx) => (
            <div key={idx} className="p-2 border rounded bg-white space-y-1">
              <input
                className="w-full px-2 py-1 border rounded text-sm"
                placeholder="id"
                value={item.id}
                onChange={(e) => {
                  const items = [...(value.items || [])];
                  items[idx] = { ...items[idx], id: e.target.value };
                  set({ items });
                }}
              />
              <input
                className="w-full px-2 py-1 border rounded text-sm"
                placeholder="Название"
                value={item.name}
                onChange={(e) => {
                  const items = [...(value.items || [])];
                  items[idx] = { ...items[idx], name: e.target.value };
                  set({ items });
                }}
              />
              <textarea
                className="w-full px-2 py-1 border rounded text-sm font-mono text-xs"
                rows={3}
                placeholder='[{"kind":"grant_spell","value":"light"}]'
                value={item.grantsJson}
                onChange={(e) => {
                  const items = [...(value.items || [])];
                  items[idx] = { ...items[idx], grantsJson: e.target.value };
                  set({ items });
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function choiceFormToOptions(value: ChoiceFormValue) {
  if (value.source === 'subfeature') {
    return {
      source: 'subfeature',
      items: (value.items || []).map((it) => {
        let grants: unknown[] = [];
        try { grants = JSON.parse(it.grantsJson || '[]'); } catch { /* ignore */ }
        return { id: it.id, name: it.name, grants };
      }),
    };
  }
  const filter = value.source === 'feat' && !value.filter ? 'origin_feats' : (value.filter || 'all');
  return { source: value.source || 'skill', filter };
}

export default ChoiceEditor;
