import { TARGETING_SHAPES, AREA_KINDS } from '../../mechanics/registries';
import type { TargetingForm } from '../../mechanics/blocks';

// Наведение (mechanics.targeting). ⏳ — движок пока не интерпретирует (описательно).

const cls = 'w-full px-2 py-1 border rounded text-sm';

export default function TargetingEditor({ value, onChange }: { value: TargetingForm; onChange: (v: TargetingForm) => void }) {
  const t = value || {};
  const set = (p: Partial<TargetingForm>) => onChange({ ...t, ...p });
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-amber-600">⏳ Описательно — движок пока не использует наведение при разрешении.</p>
      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Форма</label>
          <select className={cls} value={t.shape || ''} onChange={(e) => set({ shape: e.target.value })}>
            {TARGETING_SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Дальность</label>
          <input className={cls} placeholder="30 фт" value={t.range || ''} onChange={(e) => set({ range: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Макс. целей</label>
          <input className={cls} placeholder="1" value={t.max_targets || ''} onChange={(e) => set({ max_targets: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Область</label>
          <select className={cls} value={t.area_kind || ''} onChange={(e) => set({ area_kind: e.target.value })}>
            {AREA_KINDS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Размер области</label>
          <input className={cls} type="number" placeholder="—" value={t.area_size || ''} onChange={(e) => set({ area_size: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-0.5">Фильтр целей</label>
          <input className={cls} placeholder="enemy / ally / …" value={t.filter || ''} onChange={(e) => set({ filter: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
