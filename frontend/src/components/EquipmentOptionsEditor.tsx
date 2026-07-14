import ItemRefSelector from './ItemRefSelector';
import type { EquipmentOption } from '../types';

export type EquipOptSpec<K extends string> = {
  key: K;
  label: string;
  /** Необязательная подпись под конкретным вариантом. */
  note?: string;
};

interface EquipmentOptionsEditorProps<K extends string> {
  /** Какие варианты показывать и в каком порядке (А/Б у предыстории, А/Б/В у класса). */
  specs: ReadonlyArray<EquipOptSpec<K>>;
  value: Record<K, EquipmentOption>;
  onChange: (key: K, patch: Partial<EquipmentOption>) => void;
  /** Сетка: у предыстории 2 колонки, у класса 3. */
  className?: string;
}

/**
 * Варианты стартового снаряжения (предметы + золото) — общий редактор для предыстории и класса.
 * Раньше одна и та же карточка «золото + ItemRefSelector» была написана дважды: руками (предыстория)
 * и через .map (класс).
 */
export function EquipmentOptionsEditor<K extends string>({
  specs,
  value,
  onChange,
  className = 'grid grid-cols-1 md:grid-cols-2 gap-4',
}: EquipmentOptionsEditorProps<K>) {
  return (
    <div className={className}>
      {specs.map(({ key, label, note }) => (
        <div key={key} className="border border-gray-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-gray-800">{label}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={value[key]?.gold ?? 0}
                onChange={(e) => onChange(key, { gold: parseInt(e.target.value || '0', 10) })}
                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <span className="text-sm text-yellow-600">ЗМ</span>
            </div>
          </div>
          {note && <p className="text-xs text-gray-400 mb-2">{note}</p>}
          <ItemRefSelector
            value={value[key]?.items ?? []}
            onChange={(items) => onChange(key, { items })}
          />
        </div>
      ))}
    </div>
  );
}

export default EquipmentOptionsEditor;
