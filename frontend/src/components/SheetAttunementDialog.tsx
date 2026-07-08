import { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { Card } from '../types';
import SheetItemRow from './SheetItemRow';

// Окно управления настройкой: сверху — предметы, на которые вы настроены,
// ниже через разделитель — предметы (надетые/в сумке), на которые можно настроиться.

interface Props {
  attunedCards: Card[];
  attunableCards: Card[];
  max: number;
  canChange: boolean;
  busy?: boolean;
  onToggle: (cardId: string) => void;
  onClose: () => void;
}

export default function SheetAttunementDialog({ attunedCards, attunableCards, max, canChange, busy, onToggle, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const atMax = attunedCards.length >= max;

  return (
    <div className="sheet-equip-overlay" onClick={onClose}>
      <div className="sheet-settings-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-equip-close" onClick={onClose} title="Закрыть (Esc)">
          <X size={18} />
        </button>
        <h2 className="sheet-settings-title">
          <Sparkles size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          Настройка на предметы <span className="sheet-attune-count">{attunedCards.length} / {max}</span>
        </h2>
        {!canChange && (
          <p className="sheet-settings-hint">Менять настройку можно только на коротком или долгом отдыхе.</p>
        )}

        <div className="sheet-attune-section">
          <div className="sheet-settings-row-label">Вы настроены</div>
          {attunedCards.length === 0 ? (
            <p className="sheet-settings-hint">Пока ни на что.</p>
          ) : (
            <div className="sheet-attune-list">
              {attunedCards.map((c) => (
                <SheetItemRow
                  key={c.id}
                  card={c}
                  onClick={() => { if (canChange && !busy) onToggle(c.id); }}
                  right={<span className={`sheet-attune-tag is-on${canChange ? '' : ' is-locked'}`}>Прервать</span>}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sheet-attune-section is-divider">
          <div className="sheet-settings-row-label">Можно настроиться</div>
          {attunableCards.length === 0 ? (
            <p className="sheet-settings-hint">Нет доступных предметов, требующих настройки.</p>
          ) : (
            <div className="sheet-attune-list">
              {attunableCards.map((c) => {
                const blocked = !canChange || atMax;
                return (
                  <SheetItemRow
                    key={c.id}
                    card={c}
                    dimmed={blocked}
                    onClick={() => { if (!blocked && !busy) onToggle(c.id); }}
                    right={<span className={`sheet-attune-tag${blocked ? ' is-locked' : ''}`}>Настроиться</span>}
                  />
                );
              })}
            </div>
          )}
          {atMax && canChange && (
            <p className="sheet-settings-hint">Достигнут максимум ({max}). Прервите одну настройку, чтобы добавить новую.</p>
          )}
        </div>
      </div>
    </div>
  );
}
