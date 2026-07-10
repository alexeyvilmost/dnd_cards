import { DURATION_TYPES } from '../../mechanics/registries';
import type { DurationForm } from '../../mechanics/blocks';
import type { Cond } from '../../mechanics/predicates';
import WhenEditor from './WhenEditor';

// Длительность (mechanics.duration). rounds / until_*_of_turn движок применяет; прочее ⏳.

const cls = 'w-full px-2 py-1 border rounded text-sm';

export default function DurationEditor({ value, onChange }: { value: DurationForm; onChange: (v: DurationForm) => void }) {
  const d = value || {};
  const set = (p: Partial<DurationForm>) => onChange({ ...d, ...p });
  const showAmount = d.type === 'rounds' || d.type === 'minutes' || d.type === 'hours';
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Тип</label>
          <select className={cls} value={d.type || ''} onChange={(e) => set({ type: e.target.value })}>
            {DURATION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        {showAmount && (
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Сколько</label>
            <input className={cls} type="number" placeholder="1" value={d.amount || ''} onChange={(e) => set({ amount: e.target.value })} />
          </div>
        )}
      </div>
      {d.type && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={!!d.concentration} onChange={(e) => set({ concentration: e.target.checked })} />
            Концентрация ⏳
          </label>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Заканчивается, когда ⏳</label>
            <WhenEditor value={d.ends_when as Cond[] | undefined} onChange={(w) => set({ ends_when: w })} nested />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Требует каждый ход ⏳</label>
            <WhenEditor value={d.requires_each_turn as Cond[] | undefined} onChange={(w) => set({ requires_each_turn: w })} nested />
          </div>
        </>
      )}
    </div>
  );
}
