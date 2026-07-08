import { useEffect } from 'react';
import { ArrowRight, Sparkles, Trash2, X } from 'lucide-react';
import type { Card } from '../types';
import CardPreview from './CardPreview';

// Диалог надевания/снятия предмета. Из инвентаря показывает нашу карточку и,
// если целевой слот занят, вытесняемый предмет справа (приглушённо) со стрелкой.

interface Props {
  card: Card;
  occupant?: Card | null;
  mode: 'inventory' | 'equipped';
  busy?: boolean;
  needsAttunement?: boolean;
  attuned?: boolean;
  canChangeAttunement?: boolean;
  onEquip: () => void;
  onUnequip: () => void;
  onRemove: () => void;
  onToggleAttune: () => void;
  onClose: () => void;
}

export default function EquipItemDialog({
  card, occupant, mode, busy,
  needsAttunement, attuned, canChangeAttunement,
  onEquip, onUnequip, onRemove, onToggleAttune, onClose,
}: Props) {
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
