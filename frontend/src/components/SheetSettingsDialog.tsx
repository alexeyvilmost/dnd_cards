import { useEffect } from 'react';
import { Dices, LayoutGrid, List, X } from 'lucide-react';
import {
  setEntityDisplay,
  setSetting,
  useSiteSettings,
  type EntityDisplayKind,
  type EntityDisplayMode,
} from '../settings';

// Тёмная модалка настроек отображения на листе персонажа — те же настройки, что
// на /settings, но рядом с самим отображением.

const ENTITY_ROWS: Array<{ kind: EntityDisplayKind; label: string; hint: string }> = [
  { kind: 'spells', label: 'Заклинания', hint: 'Лист, кузница, библиотека' },
  { kind: 'actions', label: 'Действия', hint: 'Способности-действия' },
  { kind: 'effects', label: 'Эффекты', hint: 'Пассивные способности' },
  { kind: 'items', label: 'Предметы', hint: 'Инвентарь и слоты' },
];

const MODE_OPTIONS: Array<{ mode: EntityDisplayMode; label: string; icon: typeof LayoutGrid }> = [
  { mode: 'icon', label: 'Иконки', icon: LayoutGrid },
  { mode: 'row', label: 'Список', icon: List },
];

export default function SheetSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useSiteSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-equip-overlay" onClick={onClose}>
      <div className="sheet-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-equip-close" onClick={onClose} title="Закрыть (Esc)">
          <X size={18} />
        </button>
        <h2 className="sheet-settings-title">Настройки отображения</h2>

        <label className="sheet-settings-check">
          <input
            type="checkbox"
            checked={settings.diceDialog}
            onChange={(e) => setSetting('diceDialog', e.target.checked)}
          />
          <span>
            <span className="sheet-settings-row-label"><Dices size={16} /> Диалог бросков кубов</span>
            <span className="sheet-settings-hint">Перед броском показывать окно: авто-бросок или ввод своих кубов.</span>
          </span>
        </label>

        <div className="sheet-settings-section">
          <div className="sheet-settings-row-label"><LayoutGrid size={16} /> Отображение сущностей</div>
          <p className="sheet-settings-hint">«Иконки» — плитки с карточкой при наведении. «Список» — строки с деталями.</p>
          <div className="sheet-settings-list">
            {ENTITY_ROWS.map(({ kind, label, hint }) => (
              <div key={kind} className="sheet-settings-item">
                <div className="sheet-settings-item-labels">
                  <div className="sheet-settings-item-name">{label}</div>
                  <div className="sheet-settings-hint">{hint}</div>
                </div>
                <div className="sheet-settings-toggle" role="radiogroup" aria-label={label}>
                  {MODE_OPTIONS.map(({ mode, label: modeLabel, icon: Icon }) => {
                    const active = settings.entityDisplay[kind] === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`sheet-settings-mode${active ? ' is-active' : ''}`}
                        onClick={() => setEntityDisplay(kind, mode)}
                      >
                        <Icon size={13} /> {modeLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
