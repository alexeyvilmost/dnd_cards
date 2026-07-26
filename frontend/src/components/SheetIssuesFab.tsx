import { useEffect, useState } from 'react';
import { AlertTriangle, Moon, Swords, X } from 'lucide-react';
import './SheetIssuesFab.css';

export type SheetIssueItem = {
  id: string;
  title: string;
  detail?: string;
  /** Кнопка действия (напр. открыть диалог искусности). */
  actionLabel?: string;
  onAction?: () => void;
  severity?: 'error' | 'warning' | 'choice';
};

interface FabProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SheetIssueItem[];
}

/** Красный FAB слева снизу: незавершённые выборы и ошибки правил. */
export default function SheetIssuesFab({ open, onOpenChange, items }: FabProps) {
  if (!items.length) return null;

  return (
    <div className="sheet-issues-fab-root">
      {open && (
        <div className="sheet-issues-popup" role="dialog" aria-label="Ошибки и выборы">
          <div className="sheet-issues-popup-head">
            <h2 className="sheet-issues-popup-title">Требует внимания</h2>
            <button
              type="button"
              className="sheet-issues-popup-close"
              onClick={() => onOpenChange(false)}
              aria-label="Закрыть"
            >
              <X size={16} />
            </button>
          </div>
          <ul className="sheet-issues-list">
            {items.map((item) => (
              <li key={item.id} className={`sheet-issues-item sheet-issues-item--${item.severity ?? 'choice'}`}>
                <div className="sheet-issues-item-text">
                  <strong>{item.title}</strong>
                  {item.detail && <span>{item.detail}</span>}
                </div>
                {item.actionLabel && item.onAction && (
                  <button type="button" className="forge-btn sheet-issues-action" onClick={item.onAction}>
                    {item.actionLabel}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        className={`sheet-issues-fab${open ? ' open' : ''}`}
        onClick={() => onOpenChange(!open)}
        title={open ? 'Закрыть' : 'Ошибки и незавершённые выборы'}
        aria-expanded={open}
        aria-label={open ? 'Закрыть список проблем' : 'Открыть ошибки и незавершённые выборы'}
      >
        {open ? <X size={24} strokeWidth={2.2} /> : <AlertTriangle size={24} strokeWidth={2.2} />}
        {!open && <span className="sheet-issues-badge">{items.length > 9 ? '9+' : items.length}</span>}
      </button>
    </div>
  );
}

interface LongRestProps {
  open: boolean;
  onClose: () => void;
  hasWeaponMastery: boolean;
  onOpenWeaponMastery: () => void;
}

/** Действия, доступные после долгого отдыха. */
export function SheetLongRestDialog({
  open, onClose, hasWeaponMastery, onOpenWeaponMastery,
}: LongRestProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-equip-overlay" onClick={onClose}>
      <div
        className="sheet-settings-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Долгий отдых"
      >
        <button type="button" className="sheet-equip-close" onClick={onClose} title="Закрыть (Esc)">
          <X size={18} />
        </button>
        <h2 className="sheet-settings-title">
          <Moon size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Долгий отдых
        </h2>
        <p className="sheet-settings-hint">
          Отдых завершён. Пока вы отдыхали, доступны следующие действия:
        </p>

        <div className="sheet-longrest-actions">
          {hasWeaponMastery && (
            <button
              type="button"
              className="sheet-longrest-action"
              onClick={() => {
                onClose();
                onOpenWeaponMastery();
              }}
            >
              <Swords size={18} />
              <span>
                <strong>Выбрать мастерство оружия</strong>
                <small>Сменить виды оружия для искусности</small>
              </span>
            </button>
          )}
          <div className="sheet-longrest-note">
            Настройку на предметы можно изменить в инвентаре, пока действует окно отдыха.
          </div>
        </div>

        <div className="sheet-equip-actions">
          <button type="button" className="forge-btn sheet-equip-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

/** Хук-хелпер: локальный open/close для FAB. */
export function useIssuesFabState(hasItems: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!hasItems) setOpen(false);
  }, [hasItems]);
  return [open, setOpen] as const;
}
