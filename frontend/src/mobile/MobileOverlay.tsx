import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import './mobile.css';

export default function MobileOverlay({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const startSwipe = (event: TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const endSwipe = (event: TouchEvent) => {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    if (start.x < 42 && dx > 82 && dy < 70) onClose();
  };

  return (
    <div
      className="m-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="m-overlay-card" onTouchStart={startSwipe} onTouchEnd={endSwipe}>
        <header className="m-overlay-header">
          <button type="button" className="m-icon-button" onClick={onClose} aria-label="Назад">
            <ArrowLeft size={21} />
          </button>
          <h2>{title}</h2>
          <span className="m-overlay-header-spacer" />
        </header>
        <div className="m-overlay-body">{children}</div>
        {footer && <footer className="m-overlay-footer">{footer}</footer>}
      </div>
    </div>
  );
}
