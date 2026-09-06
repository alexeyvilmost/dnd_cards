import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function DialogShell({
  children,
  label,
  onCancel,
  wrap = false,
}: {
  children: ReactNode;
  label: string;
  onCancel: () => void;
  wrap?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusables = dialog ? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
    (focusables[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const current = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, []);

  const dialog = (
    <div
      ref={dialogRef}
      className="dice-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );

  return (
    <div className="dice-dialog-backdrop" onMouseDown={(event) => {
      const target = event.target as HTMLElement;
      if (target === event.currentTarget || target.classList.contains('dice-dialog-wrap')) onCancel();
    }}>
      {wrap ? <div className="dice-dialog-wrap">{dialog}</div> : dialog}
    </div>
  );
}
