import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import SettingsPanel, { type SettingsPage } from './SettingsPanel';
import { useOptionalDiceDialog } from '../contexts/DiceDialogContext';
import { useCombatDialogFocus } from './useCombatDialogFocus';

export default function SheetSettingsDialog({ onClose, initialPage, allowDiceTest = true }: { onClose: () => void; initialPage?: SettingsPage; allowDiceTest?: boolean }) {
  const dice = useOptionalDiceDialog();
  const ref = useCombatDialogFocus();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(<div className="settings-modal-backdrop" onClick={onClose}>
    <section ref={ref} tabIndex={-1} className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки" onClick={e => e.stopPropagation()}>
      <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Закрыть настройки">×</button>
      <h2>Настройки</h2>
      <SettingsPanel initialPage={initialPage} onTestDice={allowDiceTest && dice ? () => { onClose(); void dice.request([{ sides: 20, label: 'Бросок атаки' }, { sides: 8, label: 'Урон' }], 'Пробный бросок'); } : undefined} />
    </section>
  </div>, document.body);
}
