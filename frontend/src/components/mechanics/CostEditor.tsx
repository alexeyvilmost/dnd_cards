import { Trash2, Plus } from 'lucide-react';
import type { CostRow } from '../../mechanics/blocks';

// Редактор дополнительной стоимости активации (activation.cost[]): произвольные ресурсы
// с количеством, уровнем (для ячеек заклинаний) и card_id (для расхода предмета).
// Экономическую стоимость (действие/бонусное) задаёт мультиселект в блоке «Активная способность».

const COMMON_RESOURCES = [
  'spell_slot', 'pact_slot', 'hp', 'hit_die', 'item', 'movement', 'rage', 'focus',
  'sorcery_points', 'superiority_die', 'bardic_inspiration', 'channel_divinity',
  'ki', 'lay_on_hands', 'second_wind', 'action_surge', 'luck_points', 'wild_shape',
];

const cls = 'w-full px-2 py-1 border rounded text-sm';

export default function CostEditor({ value, onChange }: { value: CostRow[]; onChange: (v: CostRow[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  const patch = (i: number, p: Partial<CostRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-2">
      <datalist id="cost-resources">
        {COMMON_RESOURCES.map((r) => <option key={r} value={r} />)}
      </datalist>
      {rows.map((r, i) => (
        <div key={i} className="border rounded-lg p-2 bg-gray-50 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              list="cost-resources"
              className={cls}
              placeholder="ресурс (spell_slot, hp, item…)"
              value={r.resource ?? ''}
              onChange={(e) => patch(i, { resource: e.target.value })}
            />
            <button type="button" className="p-1 text-red-400 hover:text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Удалить стоимость">
              <Trash2 size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <input className={cls} placeholder="кол-во" value={r.amount ?? ''} onChange={(e) => patch(i, { amount: e.target.value })} />
            <input className={cls} placeholder="уровень (слот)" value={r.level ?? ''} onChange={(e) => patch(i, { level: e.target.value })} />
            <input className={cls} placeholder="card_id (item)" value={r.card_id ?? ''} onChange={(e) => patch(i, { card_id: e.target.value })} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
        onClick={() => onChange([...rows, { resource: '' }])}
      >
        <Plus size={13} /> стоимость
      </button>
    </div>
  );
}
