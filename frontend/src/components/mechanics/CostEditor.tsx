import type { CostRow } from '../../mechanics/blocks';
import { MECH_INPUT_CLS as cls, rowList, RowAddButton, RowDeleteButton } from './shared';

// Редактор дополнительной стоимости активации (activation.cost[]): произвольные ресурсы
// с количеством, уровнем (для ячеек заклинаний) и card_id (для расхода предмета).
// Экономическую стоимость (действие/бонусное) задаёт мультиселект в блоке «Активная способность».

const COMMON_RESOURCES = [
  'spell_slot', 'pact_slot', 'hp', 'hit_die', 'item', 'movement', 'rage', 'focus',
  'sorcery_points', 'superiority_die', 'bardic_inspiration', 'channel_divinity',
  'ki', 'lay_on_hands', 'second_wind', 'action_surge', 'luck_points', 'wild_shape',
];

export default function CostEditor({ value, onChange }: { value: CostRow[]; onChange: (v: CostRow[]) => void }) {
  const { rows, patch, remove, add } = rowList(value, onChange);
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
            <RowDeleteButton onClick={() => remove(i)} title="Удалить стоимость" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <input className={cls} placeholder="кол-во" value={r.amount ?? ''} onChange={(e) => patch(i, { amount: e.target.value })} />
            <input className={cls} placeholder="уровень (слот)" value={r.level ?? ''} onChange={(e) => patch(i, { level: e.target.value })} />
            <input className={cls} placeholder="card_id (item)" value={r.card_id ?? ''} onChange={(e) => patch(i, { card_id: e.target.value })} />
          </div>
        </div>
      ))}
      <RowAddButton onClick={() => add({ resource: '' })}>стоимость</RowAddButton>
    </div>
  );
}
