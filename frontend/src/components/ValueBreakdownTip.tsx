import { useState } from 'react';
import type { ValueBreakdown } from '../mvp/contracts';

interface Props {
  breakdown: ValueBreakdown;
  children: React.ReactNode;
  label?: string;
}

/** Число с popover-разбивкой источников (F2). */
export default function ValueBreakdownTip({ breakdown, children, label }: Props) {
  const [open, setOpen] = useState(false);

  const tip = breakdown.parts.length
    ? breakdown.parts.map((p) => `${p.source}: ${p.value >= 0 ? '+' : ''}${p.value}`).join('\n')
    : String(breakdown.value);

  return (
    <span
      className="value-breakdown-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      title={tip}
    >
      {children}
      {open && breakdown.parts.length > 0 && (
        <span className="value-breakdown-popover" role="tooltip">
          {label && <span className="value-breakdown-popover-title">{label}</span>}
          <ul className="value-breakdown-list">
            {breakdown.parts.map((p, i) => (
              <li key={i}>
                <span>{p.source}</span>
                <span>{p.value >= 0 ? `+${p.value}` : p.value}</span>
              </li>
            ))}
            <li className="value-breakdown-total">
              <span>Итого</span>
              <span>{breakdown.value}</span>
            </li>
          </ul>
          {breakdown.rejected && breakdown.rejected.length > 0 && (
            <ul className="value-breakdown-alts">
              {breakdown.rejected.map((r, i) => (
                <li key={i}>
                  <span>другой способ: {r.name}</span>
                  <span>{r.value}</span>
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </span>
  );
}
