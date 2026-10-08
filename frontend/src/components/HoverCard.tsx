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
import { previewAnchor } from '../utils/previewAnchor';
import { DISMISS_ENTITY_PREVIEWS, pointerPreviewsSuppressed } from '../utils/previewLifecycle';

interface HoverCardProps {
  children: ReactNode;   // триггер (inline)
  content: ReactNode;    // плавающее превью
  className?: string;    // класс триггера
  onClick?: () => void;  // клик по триггеру (напр. открыть детальное окно)
  disabled?: boolean;
  /** Passive selectors can show the canonical preview without opening nested dialogs. */
  allowPin?: boolean;
}

function computePosition(trigger: { x: number; y: number; left: number; right: number }, card: { width: number; height: number }) {
  const M = 8;
  // Leave the trigger and the controls below it clickable in pin mode.
  let left = trigger.right + 12;
  if (left + card.width > window.innerWidth - M) left = trigger.left - card.width - 12;
  if (left < M) left = trigger.x;
  let top = trigger.y + 6;
  if (left + card.width > window.innerWidth - M) left = window.innerWidth - M - card.width;
  if (left < M) left = M;
  // не влезает вниз — разворачиваем вверх
  if (top + card.height > window.innerHeight - M) {
    const above = trigger.y - card.height - 6;
    top = above >= M ? above : Math.max(M, window.innerHeight - M - card.height);
  }
  return { left, top };
}

const HoverCard = ({ children, content, className, onClick, disabled = false, allowPin = true }: HoverCardProps) => {
  const { pinModeActive } = usePinMode();
  const pinned = allowPin && pinModeActive;
  const { disableHoverPreviews = false } = useEntityDetail();
  const hoverDisabled = disabled || disableHoverPreviews;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const prevPin = useRef(pinned);
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

  useEffect(() => {
    const dismiss = () => { clearTimer(); setOpen(false); };
    window.addEventListener(DISMISS_ENTITY_PREVIEWS, dismiss);
    return () => { clearTimer(); window.removeEventListener(DISMISS_ENTITY_PREVIEWS, dismiss); };
  }, []);

  useEffect(() => {
    if (hoverDisabled) {
      clearTimer();
      setOpen(false);
    }
  }, [hoverDisabled]);

  // Уход мыши: в обычном режиме закрываем; в режиме закрепления НЕ закрываем —
  // превью остаётся, пока курсор был на триггере (можно дойти до ссылок внутри).
  const handleLeave = useCallback(() => {
    if (!pinned) scheduleClose(90);
  }, [pinned, scheduleClose]);

  // Закрываем «закреплённые» карточки при ВЫХОДЕ из режима (транзиция true→false),
  // не мешая обычным открытиям в обычном режиме.
  useEffect(() => {
    if (prevPin.current && !pinned) setOpen(false);
    prevPin.current = pinned;
  }, [pinned]);

  // Позиционирование после монтирования карточки (когда известен её размер).
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const t = triggerRef.current;
    const c = cardRef.current;
    if (!t || !c) return;
    const place = () => {
      const rect = c.getBoundingClientRect();
      const bounds = t.getBoundingClientRect();
      setPos(computePosition({...previewAnchor(t),left:bounds.left,right:bounds.right}, { width: rect.width, height: rect.height }));
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(c);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={hoverDisabled ? undefined : () => {if (!pointerPreviewsSuppressed()) openNow();}}
        onMouseMove={hoverDisabled ? undefined : () => {if (!open && !pointerPreviewsSuppressed()) openNow();}}
        onMouseLeave={hoverDisabled ? undefined : handleLeave}
        onFocus={hoverDisabled ? undefined : openNow}
        onBlur={hoverDisabled ? undefined : handleLeave}
        onClick={() => { clearTimer(); setOpen(false); onClick?.(); }}
      >
        {children}
      </span>
      {!hoverDisabled && open && createPortal(
        <div
          ref={cardRef}
          className="entity-preview-enter"
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            zIndex: 9999,
            // видимость превью не должна воровать курсор, пока не режим закрепления
            pointerEvents: pinned ? 'auto' : 'none',
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
