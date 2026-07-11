import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './entityDetailModal.css';

/**
 * Единое детальное окно сущности — в стиле предметов (CardDetailModal): БЕЗ
 * рамки диалога. Превью-карточка слева, детали справа прямо поверх затемнённого
 * фона, одной колонкой, без видимого скролл-бара. Заголовок и кнопки — в потоке
 * инфо-колонки. Все *DetailModal используют этот каркас.
 */
export function EntityDetailShell({
  title,
  titlePrefix,
  isOpen,
  onClose,
  preview,
  actions,
  children,
  maxWidth,
  labelledById,
}: {
  title: ReactNode;
  /** Необязательный префикс перед названием (напр. символ редкости). */
  titlePrefix?: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  preview?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
  labelledById?: string;
}) {
  // Закрытие по клику на фон — только если и нажатие, и отпускание были на самом
  // оверлее (иначе перетаскивание/выделение, начатое внутри и завершённое на
  // фоне, ошибочно закрывало бы окно).
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="edm-overlay"
      onMouseDown={(e) => { pressedOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && pressedOnOverlay.current) onClose(); }}
    >
      <div
        className="edm-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {preview !== undefined && <div className="edm-preview">{preview}</div>}

        <div className="edm-info">
          <div className="edm-titlerow">
            <h2 className="edm-title" id={labelledById}>
              {titlePrefix}
              {title}
            </h2>
            <button type="button" className="edm-close" onClick={onClose} aria-label="Закрыть">
              <X size={24} />
            </button>
          </div>

          {children}

          {actions && <div className="edm-actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** Короткое поле «Метка: значение» в одну строку (стек друг под другом). */
export function EdmField({
  label,
  children,
  mono = false,
  hidden = false,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className="edm-field">
      <span className="edm-flabel">{label}:</span>
      <span className={mono ? 'edm-fval--mono' : undefined}>{children}</span>
    </div>
  );
}

/** Группа коротких полей одной колонкой. */
export function EdmFields({ children }: { children: ReactNode }) {
  return <div className="edm-fields">{children}</div>;
}

/** Ведущее описание (крупнее, с форматированием). */
export function EdmDesc({ children }: { children: ReactNode }) {
  return <div className="edm-desc">{children}</div>;
}

/** Многострочный блок с меткой сверху (доп. описание, усиление и т.п.). */
export function EdmBlock({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="edm-block">
      {label && <span className="edm-blabel">{label}</span>}
      <div className="edm-bval">{children}</div>
    </div>
  );
}

/** Тег-пилюля (концентрация, ритуал, лечение и т.п.). */
export function EdmTag({ children }: { children: ReactNode }) {
  return <span className="edm-tag">{children}</span>;
}

export default EntityDetailShell;
