import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { ValueBreakdown } from '../mvp/contracts';
import ValueBreakdownPanel from './ValueBreakdownPanel';

interface Props {
  breakdown: ValueBreakdown;
  children: React.ReactNode;
  label?: string;
}

interface FloatingPosition {
  left: number;
  top: number;
  theme: Record<string, string>;
}

const THEME_PROPERTIES = [
  '--forge-panel-2',
  '--forge-line',
  '--forge-gold-dim',
  '--forge-text',
  '--forge-muted',
] as const;

function floatingPosition(trigger: DOMRect, tooltip: DOMRect): { left: number; top: number } {
  const margin = 8;
  let left = trigger.left + trigger.width / 2 - tooltip.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltip.width - margin));

  let top = trigger.bottom + 6;
  if (top + tooltip.height > window.innerHeight - margin) {
    top = trigger.top - tooltip.height - 6;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - tooltip.height - margin));
  return { left, top };
}

/** Number with a viewport-safe, portalled source breakdown (F2). */
export default function ValueBreakdownTip({ breakdown, children, label }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const tip = breakdown.parts.length
    ? [
        breakdown.selectedMethod
          ? `Способ: ${breakdown.selectedMethod.name} (${breakdown.selectedMethod.reason})`
          : null,
        ...breakdown.parts.map((part) => (
          `${part.source}: ${part.value >= 0 ? '+' : ''}${part.value}${part.reason ? ` — ${part.reason}` : ''}`
        )),
      ].filter(Boolean).join('\n')
    : String(breakdown.value);

  useLayoutEffect(() => {
    if (!open || !breakdown.parts.length) {
      setPosition(null);
      return undefined;
    }

    const update = () => {
      const trigger = triggerRef.current;
      const tooltip = tooltipRef.current;
      if (!trigger || !tooltip) return;
      const computed = window.getComputedStyle(trigger);
      const theme = Object.fromEntries(
        THEME_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)]),
      );
      setPosition({
        ...floatingPosition(trigger.getBoundingClientRect(), tooltip.getBoundingClientRect()),
        theme,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, breakdown]);

  const tooltipStyle = {
    position: 'fixed',
    // The portal wrapper itself establishes the stacking context; applying the
    // z-index only to its child cannot lift it above modal/map siblings.
    zIndex: 9999,
    left: position?.left ?? -9999,
    top: position?.top ?? -9999,
    visibility: position ? 'visible' : 'hidden',
    ...position?.theme,
  } as CSSProperties;

  return (
    <span
      ref={triggerRef}
      className="value-breakdown-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
      tabIndex={0}
      title={breakdown.parts.length ? undefined : tip}
      aria-describedby={open && breakdown.parts.length ? tooltipId : undefined}
    >
      {children}
      {open && breakdown.parts.length > 0 && createPortal(
        <div ref={tooltipRef} style={tooltipStyle}>
          <ValueBreakdownPanel
            id={tooltipId}
            breakdown={breakdown}
            label={label}
            className="value-breakdown-popover"
            role="tooltip"
          />
        </div>,
        document.body,
      )}
    </span>
  );
}
