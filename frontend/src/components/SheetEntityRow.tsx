import type { ReactNode } from 'react';

// Универсальный ряд-сущность в стиле библиотеки: миниатюра слева, имя на первой
// строке, подробности на второй. Используется для предметов, эффектов, действий и
// заклинаний (в строковом режиме). Поведение (клик/ховер) задаёт родитель.

interface Props {
  imageUrl?: string | null;
  name: string;
  namePrefix?: ReactNode;
  nameSuffix?: ReactNode;
  detail?: ReactNode;
  accent?: string;
  qty?: number;
  right?: ReactNode;
  dimmed?: boolean;
  disabled?: boolean;
  selected?: boolean;
  title?: string;
  className?: string;
  onClick?: () => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseMove?: (e: React.MouseEvent) => void;
  onMouseLeave?: () => void;
}

export default function SheetEntityRow({
  imageUrl, name, namePrefix, nameSuffix, detail, accent, qty, right,
  dimmed, disabled, selected, title, className = '',
  onClick, onMouseEnter, onMouseMove, onMouseLeave,
}: Props) {
  const url = imageUrl?.trim();
  return (
    <button
      type="button"
      className={`sheet-item-row${dimmed ? ' is-dimmed' : ''}${disabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''} ${className}`}
      style={accent ? { borderLeftColor: accent } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title ?? name}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <span className="sheet-item-row-thumb">
        {url ? (
          <img src={url} alt={name} onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/default_image.png'; }} />
        ) : (
          <span className="sheet-item-row-thumb-ph">{name.slice(0, 1)}</span>
        )}
        {qty != null && qty > 1 && <span className="sheet-item-row-qty">×{qty}</span>}
      </span>
      <span className="sheet-item-row-body">
        <span className="sheet-item-row-name" style={accent ? { color: accent } : undefined}>
          {namePrefix}{name}{nameSuffix}
        </span>
        {detail != null && <span className="sheet-item-row-detail">{detail}</span>}
      </span>
      {right && <span className="sheet-item-row-right">{right}</span>}
    </button>
  );
}
