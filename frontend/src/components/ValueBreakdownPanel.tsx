import type { ValueBreakdown } from '../mvp/contracts';

interface Props {
  breakdown: ValueBreakdown;
  label?: string;
  className?: string;
  id?: string;
  role?: 'tooltip' | 'group';
}

/** Shared, non-floating rendering of a derived value and all of its sources. */
export default function ValueBreakdownPanel({
  breakdown,
  label,
  className = '',
  id,
  role = 'group',
}: Props) {
  return (
    <div
      id={id}
      className={`value-breakdown-panel${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={label ? `Расчёт: ${label}` : 'Расчёт значения'}
    >
      {label && <div className="value-breakdown-popover-title">{label}</div>}
      {breakdown.selectedMethod && (
        <div className="value-breakdown-method">
          <b>
            Используется: {breakdown.selectedMethod.name}
            {breakdown.selectedMethod.value != null ? ` (${breakdown.selectedMethod.value})` : ''}
          </b>
          <small>{breakdown.selectedMethod.reason}</small>
        </div>
      )}
      <ul className="value-breakdown-list">
        {breakdown.parts.map((part, index) => (
          <li key={`${part.source}-${index}`}>
            <span>
              {part.source}
              {part.reason && <small>{part.reason}</small>}
            </span>
            <span>{part.value >= 0 ? `+${part.value}` : part.value}</span>
          </li>
        ))}
        <li className="value-breakdown-total">
          <span>Итого</span>
          <span>{breakdown.value}</span>
        </li>
      </ul>
      {breakdown.rejected && breakdown.rejected.length > 0 && (
        <ul className="value-breakdown-alts">
          {breakdown.rejected.map((alternative, index) => (
            <li key={`${alternative.name}-${index}`}>
              <span>другой способ: {alternative.name}</span>
              <span>{alternative.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
