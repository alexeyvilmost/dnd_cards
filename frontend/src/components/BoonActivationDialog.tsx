import { X } from 'lucide-react';
import type { BoonRollKind, BoonTiming, RuntimeBoonSpec } from '../engine/boons';
import './SheetHpDialog.css';

const ROLL_LABEL: Record<BoonRollKind, string> = {
  attack_roll: 'Следующий бросок атаки',
  saving_throw: 'Следующий спасбросок',
  ability_check: 'Следующая проверка характеристики',
};

export default function BoonActivationDialog({
  boon,
  busy = false,
  onChoose,
  onClose,
}: {
  boon: RuntimeBoonSpec | null;
  busy?: boolean;
  onChoose: (rollKind: BoonRollKind, timing: BoonTiming) => void;
  onClose: () => void;
}) {
  if (!boon) return null;
  return (
    <div className="cs-hp-dialog-backdrop" onClick={onClose} role="presentation">
      <div className="cs-hp-dialog" role="dialog" aria-label={`Использовать ${boon.name}`} onClick={(event) => event.stopPropagation()}>
        <div className="cs-hp-dialog-head">
          <h2 className="cs-hp-dialog-title">Использовать: {boon.name}</h2>
          <button type="button" className="cs-hp-dialog-close" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <p>Выберите подходящий бросок. Кость {boon.die.replace('d', 'к')} будет добавлена и эффект автоматически исчезнет.</p>
        <div className="sheet-boon-options">
          {boon.appliesTo.flatMap((rollKind) => [
            ...(boon.timing.includes('before_roll') ? [(
              <button key={`${rollKind}:before`} type="button" className="forge-btn" disabled={busy} onClick={() => onChoose(rollKind, 'before_roll')}>
                {ROLL_LABEL[rollKind]} · до броска
              </button>
            )] : []),
            ...(boon.timing.includes('after_failure') ? [(
              <button key={`${rollKind}:failure`} type="button" className="forge-btn ghost" disabled={busy} onClick={() => onChoose(rollKind, 'after_failure')}>
                {ROLL_LABEL[rollKind]} · только при провале
              </button>
            )] : []),
          ])}
        </div>
        {boon.timing.includes('after_failure') && (
          <p className="forge-note">Вариант «только при провале» бросит кость и расходует эффект, только если основной итог не достиг КЗ/СЛ.</p>
        )}
      </div>
    </div>
  );
}
