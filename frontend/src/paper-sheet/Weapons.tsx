import { Field, Frame, usePaperSheet } from './controls';
import { AutofillEntityField } from './AutofillEntityField';
import { RollTextField } from './RollTextField';

export function Weapons() {
  const { doc, setDoc } = usePaperSheet();
  return <Frame heading="Оружие и боевые заговоры" className="ps-weapons">
    <button type="button" className="ps-row-add" aria-label="Добавить оружие" disabled={doc.weaponRows >= 8} onClick={() => setDoc(current => ({ ...current, weaponRows: Math.min(8, current.weaponRows + 1) }))}>+</button>
    <button type="button" className="ps-row-remove" aria-label="Убрать последнюю строку оружия" disabled={doc.weaponRows <= 1} onClick={() => setDoc(current => ({ ...current, weaponRows: Math.max(1, current.weaponRows - 1) }))}>−</button>
    <div className="ps-weapon-table"><div className="ps-weapon-table-header"><span>Название</span><span>Бонус /<br />Сложность</span><span>Урон / Вид</span><span>Заметки</span></div>
      {Array.from({ length: doc.weaponRows }, (_, index) => <div className="ps-weapon-row" key={index}>
        <AutofillEntityField kind="weapon" row={index} field={`weapon.${index}.name`} label={`Название оружия ${index + 1}`} />
        <Field field={`weapon.${index}.bonus`} label={`Бонус оружия ${index + 1}`} />
        <RollTextField field={`weapon.${index}.damage`} label={`Урон и вид ${index + 1}`} />
        <Field field={`weapon.${index}.notes`} label={`Заметки об оружии ${index + 1}`} />
      </div>)}
    </div>
  </Frame>;
}
