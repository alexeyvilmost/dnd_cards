import { X } from 'lucide-react';
import type { ForgeCharacter } from '../character/types';
import SheetHpPanel from './SheetHpPanel';
import type { EngineEvent, ValueBreakdown } from '../mvp/contracts';
import './SheetHpDialog.css';

interface Props {
  open: boolean;
  onClose: () => void;
  character: ForgeCharacter;
  maxHp: number;
  maxHpBreakdown?: ValueBreakdown | null;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  /** Бонус спасброска ТЕЛ — для проверки концентрации при уроне. */
  conSaveBonus?: number;
}

/** Диалог хитов кокпита: тонкая обёртка над SheetHpPanel (единая логика
 * урона/лечения/temp HP, спасбросков смерти и концентрации). */
export default function SheetHpDialog({
  open, onClose, character, maxHp, maxHpBreakdown, onUpdated, onEvents, conSaveBonus,
}: Props) {
  if (!open) return null;

  return (
    <div className="cs-hp-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="cs-hp-dialog"
        role="dialog"
        aria-label="Управление хитами"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cs-hp-dialog-head">
          <h2 className="cs-hp-dialog-title">Хиты</h2>
          <button type="button" className="cs-hp-dialog-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <SheetHpPanel
          embedded
          character={character}
          maxHp={maxHp}
          maxHpBreakdown={maxHpBreakdown}
          onUpdated={onUpdated}
          onEvents={onEvents}
          conSaveBonus={conSaveBonus}
        />
      </div>
    </div>
  );
}
