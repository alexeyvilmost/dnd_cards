import type { FilterRow } from '../../mechanics/blocks';
import { MECH_INPUT_CLS as cls, rowList, RowAddButton, RowDeleteButton } from './shared';

// Редактор фильтра модификатора (applies_to.filter) — пары ключ:значение (точное совпадение).
// Частые ключи: ability (характеристика), hand (main/off), skill (навык), damage_type.

const COMMON_KEYS = ['ability', 'hand', 'skill', 'damage_type', 'weapon'];

export default function FilterEditor({ value, onChange }: { value: FilterRow[] | undefined; onChange: (v: FilterRow[]) => void }) {
  const { rows, patch, remove, add } = rowList(value, onChange);
  return (
    <div className="space-y-1.5">
      <datalist id="filter-keys">{COMMON_KEYS.map((k) => <option key={k} value={k} />)}</datalist>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input list="filter-keys" className={cls} placeholder="ключ (ability…)" value={r.key ?? ''} onChange={(e) => patch(i, { key: e.target.value })} />
          <span className="text-gray-400">=</span>
          <input className={cls} placeholder="значение" value={r.value ?? ''} onChange={(e) => patch(i, { value: e.target.value })} />
          <RowDeleteButton onClick={() => remove(i)} />
        </div>
      ))}
      <RowAddButton onClick={() => add({ key: '', value: '' })}>условие фильтра</RowAddButton>
      {rows.length === 0 && <p className="text-[11px] text-gray-400">Без фильтра — модификатор применяется ко всем броскам выбранного вида.</p>}
    </div>
  );
}
