import { useMemo, useState } from 'react';
import type { ActiveEffectEntry } from '../mvp/contracts';
import type { RemoteManipulatorCommand } from '../engine/execute';

interface RemoteManipulatorSpec {
  maxDistanceFt: number;
  movePerActionFt: number;
  maxLoadLb: number;
  allowedOperations: string[];
}

const OPERATION_LABELS: Record<string, string> = {
  move_object: 'Переместить предмет',
  open_unlocked_door: 'Открыть незапертую дверь',
  open_unlocked_container: 'Открыть незапертый контейнер',
  stow_item: 'Убрать предмет',
  retrieve_item: 'Достать предмет',
  pour_vial: 'Вылить содержимое сосуда',
};

function visitRemoteManipulator(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = visitRemoteManipulator(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.kind === 'remote_manipulator') return row;
  for (const nested of Object.values(row)) {
    const found = visitRemoteManipulator(nested);
    if (found) return found;
  }
  return null;
}

export function remoteManipulatorSpec(effect: ActiveEffectEntry): RemoteManipulatorSpec | null {
  const payload = visitRemoteManipulator(effect.mechanics);
  if (!payload) return null;
  const allowedOperations = Array.isArray(payload.allowed_operations)
    ? payload.allowed_operations.map(String).filter(Boolean)
    : [];
  if (!allowedOperations.length) return null;
  return {
    maxDistanceFt: Number(payload.max_distance_ft) || 0,
    movePerActionFt: Number(payload.move_per_action_ft) || 0,
    maxLoadLb: Number(payload.max_load_lb) || 0,
    allowedOperations,
  };
}

export function remoteManipulatorOperationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation;
}

export default function RemoteManipulatorControl({
  effect,
  disabled = false,
  onExecute,
}: {
  effect: ActiveEffectEntry;
  disabled?: boolean;
  onExecute: (command: RemoteManipulatorCommand) => void | Promise<void>;
}) {
  const spec = useMemo(() => remoteManipulatorSpec(effect), [effect]);
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState(spec?.allowedOperations[0] ?? '');
  const [objectLabel, setObjectLabel] = useState('');
  const [distanceFt, setDistanceFt] = useState(0);
  const [objectWeightLb, setObjectWeightLb] = useState(0);
  const [moveDistanceFt, setMoveDistanceFt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!spec) return null;

  const submit = async () => {
    const label = objectLabel.trim();
    if (!label) {
      setError('Опишите объект, с которым взаимодействуете.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onExecute({
        operation,
        distanceFt,
        objectWeightLb,
        moveDistanceFt: operation === 'move_object' ? moveDistanceFt : 0,
        parameters: { object_label: label },
      });
      setOpen(false);
      setObjectLabel('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось управлять рукой.');
    } finally {
      setSubmitting(false);
    }
  };

  return <>
    <button
      type="button"
      className="sheet-link-btn"
      disabled={disabled}
      onClick={() => { setError(null); setOpen(true); }}
    >
      Управлять рукой
    </button>
    {open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-label="Управление Волшебной рукой">
        <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
        <section className="relative rounded-lg border border-[#8a7320] bg-[#1c1813] text-[#e8e0d0] shadow-xl p-4 w-96 max-w-[92vw]">
          <h3 className="text-base mb-1">Управление Волшебной рукой</h3>
          <p className="text-xs text-[#a99f8b] mb-3">Тратит основное действие. До {spec.maxDistanceFt} фт., вес до {spec.maxLoadLb} фунтов.</p>
          <label className="block text-xs mb-2">
            Операция
            <select className="mt-1 w-full rounded border border-[#6b5836] bg-[#241f16] px-2 py-1.5" value={operation} onChange={(event) => setOperation(event.target.value)}>
              {spec.allowedOperations.map((value) => <option key={value} value={value}>{remoteManipulatorOperationLabel(value)}</option>)}
            </select>
          </label>
          <label className="block text-xs mb-2">
            Объект
            <input className="mt-1 w-full rounded border border-[#6b5836] bg-[#241f16] px-2 py-1.5" value={objectLabel} onChange={(event) => setObjectLabel(event.target.value)} placeholder="Например: рычаг у двери" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">Дистанция, фт.
              <input type="number" min={0} max={spec.maxDistanceFt} className="mt-1 w-full rounded border border-[#6b5836] bg-[#241f16] px-2 py-1.5" value={distanceFt} onChange={(event) => setDistanceFt(Number(event.target.value))} />
            </label>
            <label className="block text-xs">Вес, фунты
              <input type="number" min={0} max={spec.maxLoadLb} className="mt-1 w-full rounded border border-[#6b5836] bg-[#241f16] px-2 py-1.5" value={objectWeightLb} onChange={(event) => setObjectWeightLb(Number(event.target.value))} />
            </label>
          </div>
          {operation === 'move_object' && <label className="block text-xs mt-2">Переместить на, фт.
            <input type="number" min={0} max={spec.movePerActionFt} className="mt-1 w-full rounded border border-[#6b5836] bg-[#241f16] px-2 py-1.5" value={moveDistanceFt} onChange={(event) => setMoveDistanceFt(Number(event.target.value))} />
          </label>}
          {error && <p className="issues mt-2" role="alert">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" disabled={submitting} className="px-3 py-1.5 rounded border border-[#8a7320] bg-[#2b2520]" onClick={() => { void submit(); }}>Применить</button>
            <button type="button" disabled={submitting} className="px-3 py-1.5 rounded border border-[#6b5836]" onClick={() => setOpen(false)}>Отмена</button>
          </div>
        </section>
      </div>
    )}
  </>;
}
