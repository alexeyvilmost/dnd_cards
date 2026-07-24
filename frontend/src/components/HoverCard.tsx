/**
 * Единый примитив ховер-превью (парадигма №2), портированный в body.
 * - Портал в body + z-index — превью не обрезается transformed/overflow-предками.
 * - Обычный режим: карточка pointer-events:none, закрывается при уходе с триггера.
 * - Режим закрепления (клавиша T, usePinMode): карточка pointer-events:auto и «липкая» —
 *   есть время дойти до неё и навести на ссылки внутри; закрывается при уходе с карточки.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePinMode } from '../hooks/usePinMode';
import { useEntityDetail } from '../contexts/entityDetail';

interface HoverCardProps {
  children: ReactNode;   // триггер (inline)
  content: ReactNode;    // плавающее превью
  className?: string;    // класс триггера
  onClick?: () => void;  // клик по триггеру (напр. открыть детальное окно)
  disabled?: boolean;
}

function computePosition(trigger: DOMRect, card: { width: number; height: number }) {
  const M = 8;
  let left = trigger.left;
  let top = trigger.bottom + 6;
  if (left + card.width > window.innerWidth - M) left = window.innerWidth - M - card.width;
  if (left < M) left = M;
  // не влезает вниз — разворачиваем вверх
  if (top + card.height > window.innerHeight - M) {
    const above = trigger.top - card.height - 6;
    top = above >= M ? above : Math.max(M, window.innerHeight - M - card.height);
  }
  return { left, top };
}

const HoverCard = ({ children, content, className, onClick, disabled = false }: HoverCardProps) => {
  const { pinModeActive } = usePinMode();
  const { disableHoverPreviews = false } = useEntityDetail();
  const hoverDisabled = disabled || disableHoverPreviews;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const prevPin = useRef(pinModeActive);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const clearTimer = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const scheduleClose = useCallback((delay: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(false), delay);
  }, []);

  const openNow = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, []);

  // Уход мыши: в обычном режиме закрываем; в режиме закрепления НЕ закрываем —
  // превью остаётся, пока курсор был на триггере (можно дойти до ссылок внутри).
  const handleLeave = useCallback(() => {
    if (!pinModeActive) scheduleClose(90);
  }, [pinModeActive, scheduleClose]);

  // Закрываем «закреплённые» карточки при ВЫХОДЕ из режима (транзиция true→false),
  // не мешая обычным открытиям в обычном режиме.
  useEffect(() => {
    if (prevPin.current && !pinModeActive) setOpen(false);
    prevPin.current = pinModeActive;
  }, [pinModeActive]);

  // Позиционирование после монтирования карточки (когда известен её размер).
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const t = triggerRef.current?.getBoundingClientRect();
    const c = cardRef.current;
    if (!t || !c) return;
    const rect = c.getBoundingClientRect();
    setPos(computePosition(t, { width: rect.width, height: rect.height }));
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={hoverDisabled ? undefined : openNow}
        onMouseLeave={hoverDisabled ? undefined : handleLeave}
        onClick={onClick}
      >
        {children}
      </span>
      {!hoverDisabled && open && createPortal(
        <div
          ref={cardRef}
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            zIndex: 9999,
            // видимость превью не должна воровать курсор, пока не режим закрепления
            pointerEvents: pinModeActive ? 'auto' : 'none',
            visibility: pos ? 'visible' : 'hidden',
          }}
          onMouseEnter={openNow}
          onMouseLeave={handleLeave}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
};

export default HoverCard;
