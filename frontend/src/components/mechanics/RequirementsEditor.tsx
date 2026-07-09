import { Trash2, Plus } from 'lucide-react';
import { REQUIREMENT_TYPES, ABILITIES } from '../../mechanics/registries';
import type { ReqRow } from '../../mechanics/blocks';

// Редактор требований доступности (activation.requirements[]) — все типы кроме level
// (мин. уровень задаётся отдельным полем выше). ⚠ движок пока не проверяет требования в
// рантайме; редактор нужен для полноты авторства и будущей реализации.

const cls = 'w-full px-2 py-1 border rounded text-sm';
const valueLabel: Record<string, string> = {
  class: 'ID класса', subclass: 'ID подкласса', species: 'ID вида', feat: 'ID черты',
  proficiency: 'Владение (id)', equipment: 'Снаряжение (id)', resource: 'Ресурс (id)', state: 'Состояние (id)',
};

export default function RequirementsEditor({ value, onChange }: { value: ReqRow[]; onChange: (v: ReqRow[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  const patch = (i: number, p: Partial<ReqRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="border rounded-lg p-2 bg-gray-50 space-y-1.5">
          <div className="flex items-center gap-2">
            <select className={`${cls} bg-white`} value={r.type || 'class'} onChange={(e) => patch(i, { type: e.target.value })}>
              {REQUIREMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <button type="button" className="p-1 text-red-400 hover:text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Удалить требование">
              <Trash2 size={15} />
            </button>
          </div>
          {r.type === 'ability_score' ? (
            <div className="grid grid-cols-2 gap-1.5">
              <select className={cls} value={r.ability || 'str'} onChange={(e) => patch(i, { ability: e.target.value })}>
                {ABILITIES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <input className={cls} type="number" placeholder="мин. значение" value={r.min ?? ''} onChange={(e) => patch(i, { min: e.target.value })} />
            </div>
          ) : (
            <input className={cls} placeholder={valueLabel[r.type] || 'Значение'} value={r.value ?? ''} onChange={(e) => patch(i, { value: e.target.value })} />
          )}
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
        onClick={() => onChange([...rows, { type: 'class' }])}
      >
        <Plus size={13} /> требование
      </button>
    </div>
  );
}
