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
  /** Лого-штамп на заднем фоне справа (напр. лого слота). */
  stamp?: string | null;
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
  imageUrl, name, namePrefix, nameSuffix, detail, accent, qty, right, stamp,
  dimmed, disabled, selected, title, className = '',
  onClick, onMouseEnter, onMouseMove, onMouseLeave,
}: Props) {
  const url = imageUrl?.trim();
  const rowClassName = `sheet-item-row${dimmed ? ' is-dimmed' : ''}${disabled ? ' is-disabled' : ''}${selected ? ' is-selected' : ''} ${className}`;
  const rowContent = (
    <>
      {stamp && <img className="sheet-item-stamp" src={stamp} alt="" aria-hidden="true" />}
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
    </>
  );

  // Some inventory rows contain their own action button on the right. A div
  // keeps that markup valid while preserving keyboard access to the row itself.
  if (right) {
    return (
      <div
        className={rowClassName}
        style={accent ? { borderLeftColor: accent } : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick && !disabled ? 0 : undefined}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(event) => {
          if (!disabled && onClick && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onClick();
          }
        }}
        title={title ?? name}
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {rowContent}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={rowClassName}
      style={accent ? { borderLeftColor: accent } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title ?? name}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {rowContent}
    </button>
  );
}
