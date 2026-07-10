import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';

export type RefItem = { id: string; name: string; card_number?: string; repeatable?: boolean };

interface EntityRefSelectorProps {
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
  loadItems: () => Promise<RefItem[]>;
  /** Догрузить имена для уже привязанных id, которых нет в списке loadItems (напр. сущности
   *  вне окна limit:200) — иначе они показываются сырым UUID. Каждый id резолвится один раз. */
  resolveItems?: (ids: string[]) => Promise<RefItem[]>;
  placeholder?: string;
}

const EntityRefSelector = ({ label, value, onChange, loadItems, resolveItems, placeholder }: EntityRefSelectorProps) => {
  const [items, setItems] = useState<RefItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadItems().then(setItems).finally(() => setLoaded(true));
  }, [loadItems]);

  const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Догружаем недостающие привязанные id (вне окна loadItems), чтобы показать имя, а не UUID.
  const attempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!resolveItems || !loaded) return;
    const missing = value.filter((id) => !map.has(id) && !attempted.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => attempted.current.add(id));
    let alive = true;
    resolveItems(missing).then((extra) => {
      if (!alive || !extra?.length) return;
      setItems((prev) => {
        const known = new Set(prev.map((i) => i.id));
        const add = extra.filter((e) => e && !known.has(e.id));
        return add.length ? [...prev, ...add] : prev;
      });
    }).catch(() => { /* удалённые id остаются сырым fallback */ });
    return () => { alive = false; };
  }, [resolveItems, loaded, value, map]);
  const selected = new Set(value);
  // Повторяемые сущности (repeatable) можно добавлять несколько раз — не убираем их из списка.
  const repeatableIds = useMemo(() => new Set(items.filter((i) => i.repeatable).map((i) => i.id)), [items]);

  const candidates = items
    .filter((i) => repeatableIds.has(i.id) || !selected.has(i.id))
    .filter((i) => !query || i.name.toLowerCase().includes(query.toLowerCase()) || i.card_number?.includes(query))
    .slice(0, 30);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className="space-y-2 mb-2">
        {value.map((id, idx) => {
          const item = map.get(id);
          return (
            // Ключ по индексу: повторяемые сущности могут встречаться в value несколько раз (одинаковый id).
            <div key={`${id}:${idx}`} className="flex items-center gap-2 bg-gray-50 border rounded px-2 py-1.5 text-sm">
              <span className="flex-1 truncate">{item?.name || (loaded ? id : '…')}</span>
              {item?.card_number && <span className="text-xs text-gray-400">{item.card_number}</span>}
              <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => onChange(value.filter((_, i) => i !== idx))}>
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
              placeholder={placeholder || 'Поиск…'}
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
            {loaded && candidates.length === 0 && (
              <li className="px-2 py-1 text-gray-400">Ничего не найдено</li>
            )}
          </ul>
          <button type="button" className="mt-2 text-xs text-gray-500" onClick={() => setOpen(false)}>Закрыть</button>
        </div>
      )}
    </div>
  );
};

export default EntityRefSelector;
