import { useEffect, useState } from 'react';

/**
 * Мобильный режим для сквозного нижнего таб-бара многоуровневых экранов
 * (кузня, лист персонажа, конструкторы). Порог 820px совпадает с CSS-медиазапросами
 * этих экранов — держим их синхронно.
 */
export function useIsMobile(maxWidth = 820): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}
