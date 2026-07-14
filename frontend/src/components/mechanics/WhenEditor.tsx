import { Trash2, Plus } from 'lucide-react';
import { CONDITIONS } from '../../mechanics/registries';
import {
  ALL_PREDICATE_KINDS,
  PREDICATE_KIND_MAP,
  emptyCond,
  type Cond,
  type PredField,
} from '../../mechanics/predicates';
import { MECH_INPUT_CLS as inputCls } from './shared';

// Рекурсивный редактор предикатов движка (массив условий `when` / `circumstances`).
// Условия верхнего уровня складываются по И (matchesWhen AND-fold); any_of — ИЛИ, not — отрицание.
// Редактирует «сырые» JSON-объекты условий напрямую — ничего не теряется при round-trip.

const MAX_DEPTH = 6;

function CondField({ field, cond, onChange }: { field: PredField; cond: Cond; onChange: (c: Cond) => void }) {
  const set = (val: unknown) => onChange({ ...cond, [field.key]: val });
  const cur = cond[field.key];
  switch (field.type) {
    case 'card':
    case 'text':
      return (
        <input
          className={inputCls}
          value={String(cur ?? '')}
          placeholder={field.type === 'card' ? 'id или слаг предмета' : ''}
          onChange={(e) => set(e.target.value)}
        />
      );
    case 'condition': {
      const known = CONDITIONS.some((c) => c.id === cur);
      return (
        <select className={inputCls} value={String(cur ?? '')} onChange={(e) => set(e.target.value)}>
          <option value="">—</option>
          {!known && cur != null && cur !== '' && <option value={String(cur)}>{String(cur)}</option>}
          {CONDITIONS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      );
    }
    case 'number':
      return (
        <input
          type="number"
          className={inputCls}
          value={cur !== undefined && cur !== null ? Number(cur) : ''}
          onChange={(e) => set(e.target.value === '' ? undefined : parseFloat(e.target.value))}
        />
      );
    case 'number-opt':
      return (
        <input
          type="number"
          className={inputCls}
          value={cur !== undefined && cur !== null ? Number(cur) : ''}
          placeholder="—"
          onChange={(e) => set(e.target.value === '' ? undefined : parseFloat(e.target.value))}
        />
      );
    default:
      return null;
  }
}

function CondRow({
  cond,
  onChange,
  onRemove,
  depth,
}: {
  cond: Cond;
  onChange: (c: Cond) => void;
  onRemove?: () => void;
  depth: number;
}) {
  const spec = PREDICATE_KIND_MAP[cond?.kind];
  const isRaw = !spec;
  return (
    <div className="border rounded-lg p-2 bg-gray-50 space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          className="flex-1 px-2 py-1 border rounded text-sm bg-white"
          value={isRaw ? '__raw__' : cond.kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === '__raw__') return;
            const next = emptyCond(k);
            const nextSpec = PREDICATE_KIND_MAP[k];
            // Переносим совместимые поля при смене вида (value/description/вложенные of групп).
            if (cond.value != null && nextSpec?.fields.some((f) => f.key === 'value')) next.value = cond.value;
            if (cond.description != null && nextSpec?.fields.some((f) => f.key === 'description')) next.description = cond.description;
            if (nextSpec?.group === 'many' && Array.isArray(cond.of)) next.of = cond.of;
            onChange(next);
          }}
        >
          {ALL_PREDICATE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>{k.label}{k.inert ? ' ⚠' : ''}</option>
          ))}
          {isRaw && <option value="__raw__">Сырое условие: {String(cond?.kind ?? '?')}</option>}
        </select>
        {onRemove && (
          <button type="button" className="p-1 text-red-400 hover:text-red-600" onClick={onRemove} title="Удалить условие">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {spec?.inert && <p className="text-xs text-amber-600">⚠ Схема допускает, но движок пока не интерпретирует (условие даст «ложь»).</p>}
      {spec?.hint && <p className="text-xs text-gray-400">{spec.hint}</p>}

      {isRaw ? (
        <textarea
          className="w-full px-2 py-1 border rounded font-mono text-xs h-16"
          spellCheck={false}
          value={JSON.stringify(cond)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); } catch { /* оставляем как есть до валидного JSON */ }
          }}
        />
      ) : (
        <>
          {spec.fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] text-gray-500 mb-0.5">{f.label}</label>
              <CondField field={f} cond={cond} onChange={onChange} />
            </div>
          ))}
          {spec.group === 'many' && (
            <div className="pl-3 border-l-2 border-gray-200">
              <WhenEditor
                value={(cond.of as Cond[]) || []}
                onChange={(of) => onChange({ ...cond, of })}
                depth={depth + 1}
                nested
              />
            </div>
          )}
          {spec.group === 'one' && (
            <div className="pl-3 border-l-2 border-gray-200">
              <CondRow
                cond={(cond.of as Cond) || { kind: 'narrative' }}
                onChange={(of) => onChange({ ...cond, of })}
                depth={depth + 1}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export interface WhenEditorProps {
  value: Cond[] | undefined;
  onChange: (when: Cond[]) => void;
  hint?: string;
  nested?: boolean;
  depth?: number;
}

export default function WhenEditor({ value, onChange, hint, nested, depth = 0 }: WhenEditorProps) {
  const conds = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-1.5">
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      {conds.map((c, i) => (
        <CondRow
          key={i}
          cond={c}
          depth={depth}
          onChange={(nc) => onChange(conds.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => onChange(conds.filter((_, j) => j !== i))}
        />
      ))}
      {depth < MAX_DEPTH && (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
          onClick={() => onChange([...conds, emptyCond('you_have_condition')])}
        >
          <Plus size={13} /> условие
        </button>
      )}
      {conds.length > 1 && !nested && (
        <p className="text-[11px] text-gray-400">Все условия должны выполняться одновременно (И).</p>
      )}
      {conds.length === 0 && !nested && (
        <p className="text-[11px] text-gray-400">Без условий — действует всегда.</p>
      )}
    </div>
  );
}
