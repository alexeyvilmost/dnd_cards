import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Search } from 'lucide-react';
import type { Card, CardRef } from '../types';
import { getCardsIndex } from '../utils/cardsIndex';

interface ItemRefSelectorProps {
  value: CardRef[];
  onChange: (refs: CardRef[]) => void;
  label?: string;
  showQuantity?: boolean;
}

const ItemRefSelector: React.FC<ItemRefSelectorProps> = ({
  value,
  onChange,
  label,
  showQuantity = true,
}) => {
  const [index, setIndex] = useState<Map<string, Card>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    getCardsIndex()
      .then((m) => setIndex(m))
      .finally(() => setLoaded(true));
  }, []);

  const selectedIds = useMemo(() => new Set(value.map((r) => r.card_id)), [value]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...index.values()].filter((c) => !selectedIds.has(c.id));
    const filtered = q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
    return filtered.slice(0, 40);
  }, [index, query, selectedIds]);

  const addItem = (card: Card) => {
    onChange([...value, { card_id: card.id, quantity: 1 }]);
    setQuery('');
  };
  const removeItem = (id: string) => onChange(value.filter((r) => r.card_id !== id));
  const setQty = (id: string, qty: number) =>
    onChange(value.map((r) => (r.card_id === id ? { ...r, quantity: Math.max(1, qty) } : r)));

  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>}

      <div className="space-y-2">
        {value.map((ref) => {
          const card = index.get(ref.card_id);
          return (
            <div key={ref.card_id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
              <img
                src={card?.image_url || '/default_image.png'}
                alt=""
                className="w-8 h-8 object-contain flex-shrink-0"
                onError={(e) => ((e.target as HTMLImageElement).src = '/default_image.png')}
              />
              <span className="flex-1 text-sm text-gray-800 truncate">
                {card?.name || (loaded ? '(удалённый предмет)' : '…')}
              </span>
              {showQuantity && (
                <input
                  type="number"
                  min={1}
                  value={ref.quantity}
                  onChange={(e) => setQty(ref.card_id, parseInt(e.target.value || '1', 10))}
                  className="w-14 px-2 py-1 border border-gray-300 rounded text-sm"
                  title="Количество"
                />
              )}
              <button
                type="button"
                onClick={() => removeItem(ref.card_id)}
                className="p-1 text-gray-400 hover:text-red-500"
                title="Убрать"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>

      {!pickerOpen ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus size={16} /> Добавить предмет
        </button>
      ) : (
        <div className="mt-2 border border-gray-200 rounded-lg p-2">
          <div className="flex items-center gap-2 mb-2">
            <Search size={16} className="text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск предмета…"
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="button" onClick={() => { setPickerOpen(false); setQuery(''); }} className="p-1 text-gray-400 hover:text-gray-700">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
            {!loaded && <div className="text-sm text-gray-400 py-2 text-center">Загрузка…</div>}
            {loaded && candidates.length === 0 && (
              <div className="text-sm text-gray-400 py-2 text-center">Ничего не найдено</div>
            )}
            {candidates.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => addItem(card)}
                className="w-full flex items-center gap-2 px-1 py-1.5 hover:bg-gray-50 text-left"
              >
                <img
                  src={card.image_url || '/default_image.png'}
                  alt=""
                  className="w-7 h-7 object-contain flex-shrink-0"
                  onError={(e) => ((e.target as HTMLImageElement).src = '/default_image.png')}
                />
                <span className="flex-1 text-sm text-gray-800 truncate">{card.name}</span>
                <Plus size={14} className="text-blue-500" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemRefSelector;
