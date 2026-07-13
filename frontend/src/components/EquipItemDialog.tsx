import { useEffect } from 'react';
import { ArrowRight, PackagePlus, Sparkles, Trash2, X } from 'lucide-react';
import type { Card } from '../types';
import CardPreview from './CardPreview';

// Диалог надевания/снятия предмета. Из инвентаря показывает нашу карточку и,
// если целевой слот занят, вытесняемый предмет справа (приглушённо) со стрелкой.
// Отсюда же предмет можно убрать в контейнер (перенесено со строки инвентаря).

interface Props {
  card: Card;
  occupant?: Card | null;
  mode: 'inventory' | 'equipped';
  busy?: boolean;
  needsAttunement?: boolean;
  attuned?: boolean;
  canChangeAttunement?: boolean;
  /** Носимые контейнеры-цели «убрать в контейнер» (без самого предмета); undefined — вне режима инвентаря. */
  containerTargets?: Card[];
  onMoveToContainer?: (containerId: string) => void;
  onEquip: () => void;
  onUnequip: () => void;
  onRemove: () => void;
  onToggleAttune: () => void;
  onClose: () => void;
}

export default function EquipItemDialog({
  card, occupant, mode, busy,
  needsAttunement, attuned, canChangeAttunement,
  containerTargets, onMoveToContainer,
  onEquip, onUnequip, onRemove, onToggleAttune, onClose,
}: Props) {
  const showContainer = mode === 'inventory' && card.type !== 'container'
    && !!containerTargets && containerTargets.length > 0 && !!onMoveToContainer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-equip-overlay" onClick={onClose}>
      <div className="sheet-equip-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-equip-close" onClick={onClose} title="Закрыть (Esc)">
          <X size={18} />
        </button>

        <div className="sheet-equip-cards">
          <div className="sheet-equip-card">
            <CardPreview card={card} disableHover />
          </div>
          {mode === 'inventory' && occupant && (
            <>
              <div className="sheet-equip-arrow"><ArrowRight size={26} /></div>
              <div className="sheet-equip-card is-outgoing">
                <div className="sheet-equip-outgoing-label">Снимется в сумку</div>
                <CardPreview card={occupant} disableHover />
              </div>
            </>
          )}
        </div>

        <div className="sheet-equip-actions">
          {mode === 'inventory' ? (
            <>
              <button type="button" className="forge-btn sheet-equip-primary" disabled={busy} onClick={onEquip}>
                {occupant ? 'Надеть (заменить)' : 'Надеть'}
              </button>
              <button type="button" className="forge-btn ghost sheet-equip-danger" disabled={busy} onClick={onRemove}>
                <Trash2 size={15} /> Удалить
              </button>
              {showContainer && (
                <label className="sheet-equip-container" title="Убрать предмет в контейнер">
                  <PackagePlus size={15} />
                  <span>В контейнер:</span>
                  <select
                    className="sheet-equip-container-sel"
                    value=""
                    disabled={busy}
                    onChange={(e) => { if (e.target.value) onMoveToContainer!(e.target.value); }}
                  >
                    <option value="">— выберите —</option>
                    {containerTargets!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <button type="button" className="forge-btn sheet-equip-primary" disabled={busy} onClick={onUnequip}>
                Снять в сумку
              </button>
              {needsAttunement && (
                <button
                  type="button"
                  className={`forge-btn ghost${attuned ? ' is-on' : ''}`}
                  disabled={busy || !canChangeAttunement}
                  title={canChangeAttunement ? undefined : 'Настройка меняется только на отдыхе'}
                  onClick={onToggleAttune}
                >
                  <Sparkles size={14} /> {attuned ? 'Настроен' : 'Настроиться'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
