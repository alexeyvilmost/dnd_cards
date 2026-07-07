/**
 * Глобальный «режим закрепления» превью. По физической клавише T (любая раскладка,
 * e.code==='KeyT') ховер-карточки перестают закрываться при уходе мыши — можно навести
 * на ссылки внутри превью. Выход: T ещё раз, Esc или клик по подсказке.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface PinModeApi {
  pinModeActive: boolean;
  setPinModeActive: (v: boolean) => void;
}

const Ctx = createContext<PinModeApi>({ pinModeActive: false, setPinModeActive: () => {} });

export function usePinMode(): PinModeApi {
  return useContext(Ctx);
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

export function PinModeProvider({ children }: { children: ReactNode }) {
  const [pinModeActive, setPinModeActive] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinModeActive(false);
        return;
      }
      // Физическая клавиша T (KeyT) — не зависит от раскладки; игнор с модификаторами.
      if (e.code === 'KeyT' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isTypingTarget(document.activeElement)) return; // не мешаем набору текста
        e.preventDefault();
        setPinModeActive((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Ctx.Provider value={{ pinModeActive, setPinModeActive }}>
      {children}
      {pinModeActive && (
        <button
          type="button"
          onClick={() => setPinModeActive(false)}
          style={{
            position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)',
            zIndex: 10000, background: '#1c1813', color: '#e8dcc0',
            border: '1px solid #d8b978', borderRadius: 999, padding: '8px 16px',
            fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,0.5)', cursor: 'pointer',
          }}
        >
          📌 Режим закрепления превью — наводите на ссылки. <b>T</b> / <b>Esc</b> — выход
        </button>
      )}
    </Ctx.Provider>
  );
}
