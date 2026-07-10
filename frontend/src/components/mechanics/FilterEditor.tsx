import { Trash2, Plus } from 'lucide-react';
import type { FilterRow } from '../../mechanics/blocks';

// Редактор фильтра модификатора (applies_to.filter) — пары ключ:значение (точное совпадение).
// Частые ключи: ability (характеристика), hand (main/off), skill (навык), damage_type.

const COMMON_KEYS = ['ability', 'hand', 'skill', 'damage_type', 'weapon'];
const cls = 'w-full px-2 py-1 border rounded text-sm';

export default function FilterEditor({ value, onChange }: { value: FilterRow[] | undefined; onChange: (v: FilterRow[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  const patch = (i: number, p: Partial<FilterRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-1.5">
      <datalist id="filter-keys">{COMMON_KEYS.map((k) => <option key={k} value={k} />)}</datalist>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input list="filter-keys" className={cls} placeholder="ключ (ability…)" value={r.key ?? ''} onChange={(e) => patch(i, { key: e.target.value })} />
          <span className="text-gray-400">=</span>
          <input className={cls} placeholder="значение" value={r.value ?? ''} onChange={(e) => patch(i, { value: e.target.value })} />
          <button type="button" className="p-1 text-red-400 hover:text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Удалить">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800" onClick={() => onChange([...rows, { key: '', value: '' }])}>
        <Plus size={13} /> условие фильтра
      </button>
      {rows.length === 0 && <p className="text-[11px] text-gray-400">Без фильтра — модификатор применяется ко всем броскам выбранного вида.</p>}
    </div>
  );
}
