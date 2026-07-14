import { REQUIREMENT_TYPES, ABILITIES } from '../../mechanics/registries';
import type { ReqRow } from '../../mechanics/blocks';
import { MECH_INPUT_CLS as cls, rowList, RowAddButton, RowDeleteButton } from './shared';

// Редактор требований доступности (activation.requirements[]) — все типы кроме level
// (мин. уровень задаётся отдельным полем выше). ⚠ движок пока не проверяет требования в
// рантайме; редактор нужен для полноты авторства и будущей реализации.

const valueLabel: Record<string, string> = {
  class: 'ID класса', subclass: 'ID подкласса', species: 'ID вида', feat: 'ID черты',
  proficiency: 'Владение (id)', equipment: 'Снаряжение (id)', resource: 'Ресурс (id)', state: 'Состояние (id)',
};

export default function RequirementsEditor({ value, onChange }: { value: ReqRow[]; onChange: (v: ReqRow[]) => void }) {
  const { rows, patch, remove, add } = rowList(value, onChange);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="border rounded-lg p-2 bg-gray-50 space-y-1.5">
          <div className="flex items-center gap-2">
            <select className={`${cls} bg-white`} value={r.type || 'class'} onChange={(e) => patch(i, { type: e.target.value })}>
              {REQUIREMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <RowDeleteButton onClick={() => remove(i)} title="Удалить требование" />
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
      <RowAddButton onClick={() => add({ type: 'class' })}>требование</RowAddButton>
    </div>
  );
}
