import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { LevelProgression } from '../types';
import type { RefItem } from './EntityRefSelector';

interface LevelProgressionEditorProps {
  value: LevelProgression;
  onChange: (value: LevelProgression) => void;
  loadEffects: () => Promise<RefItem[]>;
  loadActions: () => Promise<RefItem[]>;
  /** Догрузка имён привязанных id вне окна loadEffects/loadActions (иначе — сырой UUID). */
  resolveEffects?: (ids: string[]) => Promise<RefItem[]>;
  resolveActions?: (ids: string[]) => Promise<RefItem[]>;
  showAllLevels?: boolean;
  maxLevel?: number;
}

const normalizeLevel = (level: number) => String(Math.max(1, Math.min(20, level)));

const InlineRefSelector = ({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
  items: RefItem[];
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selected = new Set(value);
  const candidates = items
    .filter((i) => !selected.has(i.id))
    .filter((i) => !query || i.name.toLowerCase().includes(query.toLowerCase()) || i.card_number?.includes(query))
    .slice(0, 30);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="space-y-2 mb-2">
        {value.map((id) => {
          const item = map.get(id);
          return (
            <div key={id} className="flex items-center gap-2 bg-white border rounded px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">{item?.name || id}</span>
              {item?.card_number && <span className="text-xs text-gray-400">{item.card_number}</span>}
              <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-sm text-blue-600">
          <Plus size={14} /> Добавить
        </button>
      ) : (
        <div className="border rounded-lg p-2 bg-white shadow-sm">
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
            <input
              className="w-full pl-7 pr-2 py-1.5 border rounded text-sm"
              placeholder="Поиск..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="max-h-40 overflow-y-auto text-sm">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 hover:bg-blue-50 rounded"
                  onClick={() => { onChange([...value, c.id]); setQuery(''); setOpen(false); }}
                >
                  {c.name}
                  {c.card_number && <span className="text-gray-400 ml-2">{c.card_number}</span>}
                </button>
              </li>
            ))}
            {candidates.length === 0 && <li className="px-2 py-1 text-gray-400">Ничего не найдено</li>}
          </ul>
          <button type="button" className="mt-2 text-xs text-gray-500" onClick={() => setOpen(false)}>Закрыть</button>
        </div>
      )}
    </div>
  );
};

const LevelProgressionEditor = ({
  value,
  onChange,
  loadEffects,
  loadActions,
  resolveEffects,
  resolveActions,
  showAllLevels = false,
  maxLevel = 20,
}: LevelProgressionEditorProps) => {
  const [newLevel, setNewLevel] = useState(1);
  const [effects, setEffects] = useState<RefItem[]>([]);
  const [actions, setActions] = useState<RefItem[]>([]);

  useEffect(() => {
    loadEffects().then(setEffects).catch(() => setEffects([]));
    loadActions().then(setActions).catch(() => setActions([]));
  }, [loadActions, loadEffects]);

  // Догружаем недостающие имена привязанных id (вне окна limit:200) — по одному разу на id.
  const effectIds = useMemo(() => [...new Set(Object.values(value).flatMap((v) => v?.effects || []))], [value]);
  const actionIds = useMemo(() => [...new Set(Object.values(value).flatMap((v) => v?.actions || []))], [value]);
  const attemptedEff = useRef<Set<string>>(new Set());
  const attemptedAct = useRef<Set<string>>(new Set());
  useEffect(() => {
    const merge = async (
      ids: string[], known: RefItem[], attempted: React.MutableRefObject<Set<string>>,
      resolver: ((ids: string[]) => Promise<RefItem[]>) | undefined, setter: React.Dispatch<React.SetStateAction<RefItem[]>>,
    ) => {
      if (!resolver) return;
      const knownIds = new Set(known.map((i) => i.id));
      const missing = ids.filter((id) => !knownIds.has(id) && !attempted.current.has(id));
      if (!missing.length) return;
      missing.forEach((id) => attempted.current.add(id));
      const extra = await resolver(missing).catch(() => [] as RefItem[]);
      if (extra.length) setter((prev) => {
        const k = new Set(prev.map((i) => i.id));
        const add = extra.filter((e) => e && !k.has(e.id));
        return add.length ? [...prev, ...add] : prev;
      });
    };
    merge(effectIds, effects, attemptedEff, resolveEffects, setEffects);
    merge(actionIds, actions, attemptedAct, resolveActions, setActions);
  }, [effectIds, actionIds, effects, actions, resolveEffects, resolveActions]);

  const visibleLevels = useMemo(() => {
    if (showAllLevels) {
      return Array.from({ length: maxLevel }, (_, i) => String(i + 1));
    }
    return Object.keys(value).sort((a, b) => Number(a) - Number(b));
  }, [maxLevel, showAllLevels, value]);

  const setLevelAbilities = (level: string, patch: Partial<NonNullable<LevelProgression[string]>>) => {
    const current = value[level] || {};
    const next = {
      ...value,
      [level]: {
        effects: current.effects || [],
        actions: current.actions || [],
        ...patch,
      },
    };
    onChange(next);
  };

  const removeLevel = (level: string) => {
    const next = { ...value };
    delete next[level];
    onChange(next);
  };

  const addLevel = () => {
    const level = normalizeLevel(newLevel);
    if (!value[level]) {
      onChange({ ...value, [level]: { effects: [], actions: [] } });
    }
  };

  return (
    <div className="space-y-4">
      {!showAllLevels && (
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Уровень</label>
            <input
              type="number"
              min={1}
              max={maxLevel}
              value={newLevel}
              onChange={(e) => setNewLevel(parseInt(e.target.value || '1', 10))}
              className="w-24 px-2 py-1.5 border rounded text-sm"
            />
          </div>
          <button type="button" onClick={addLevel} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50">
            <Plus size={14} /> Добавить уровень
          </button>
        </div>
      )}

      <div className="space-y-3">
        {visibleLevels.map((level) => {
          const entry = value[level] || {};
          return (
            <div key={level} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-900">Уровень {level}</h4>
                {!showAllLevels && (
                  <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => removeLevel(level)} title="Удалить уровень">
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InlineRefSelector
                  label="Эффекты"
                  value={entry.effects || []}
                  onChange={(ids) => setLevelAbilities(level, { effects: ids })}
                  items={effects}
                />
                <InlineRefSelector
                  label="Действия"
                  value={entry.actions || []}
                  onChange={(ids) => setLevelAbilities(level, { actions: ids })}
                  items={actions}
                />
              </div>
            </div>
          );
        })}
        {visibleLevels.length === 0 && (
          <p className="text-sm text-gray-500 italic">Добавьте уровень, на котором вид получает способности.</p>
        )}
      </div>
    </div>
  );
};

export default LevelProgressionEditor;
