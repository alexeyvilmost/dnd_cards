import type { CSSProperties, ReactNode } from 'react';
import './NavRail.css';

export type NavRailItem = {
  id: string;
  label: string;
  icon: ReactNode;
  /** Вторая строка — выбранное значение / счётчик (десктоп, режим wide). */
  sub?: string;
  /** Состояние заполнения шага: ok (готово) / todo (требует внимания). */
  status?: 'ok' | 'todo' | null;
  /** Числовой бейдж-нотификация (напр. непрочитанные события). */
  badge?: number | string | null;
  /** Точечный акцентный цвет медальона (переопределяет --nr-accent для шага). */
  accent?: string;
  /** Отключённый шаг. */
  disabled?: boolean;
};

type NavRailProps = {
  items: NavRailItem[];
  active: string;
  onSelect: (id: string) => void;
  /** wide — медальон + текст в строке (боковая панель кузни/листа).
   *  compact — иконка над подписью (узкий рейл конструкторов/библиотеки). */
  layout?: 'wide' | 'compact';
  /** Тема под окружение: dark (кузня/лист) или light (конструкторы/библиотека). */
  variant?: 'dark' | 'light';
  /** Куда «приклеивается» на мобильных: снизу (таб-бар) или горизонтальной лентой сверху. */
  mobileDock?: 'bottom' | 'top';
  ariaLabel?: string;
  className?: string;
};

/**
 * Сквозной навигационный примитив — «медальонный» рейл, который на узких экранах
 * (≤820px) превращается в фиксированный нижний таб-бар (mobileDock='bottom') либо
 * горизонтальную ленту-сегмент сверху (mobileDock='top'). Единый язык навигации для
 * кузни, листа персонажа, конструкторов и библиотеки. См. [[mobile-bottom-nav-shell]].
 */
export function NavRail({
  items,
  active,
  onSelect,
  layout = 'wide',
  variant = 'dark',
  mobileDock = 'bottom',
  ariaLabel = 'Разделы',
  className = '',
}: NavRailProps) {
  const cls = [
    'navrail',
    `navrail--${layout}`,
    variant === 'light' ? 'navrail--light' : '',
    `navrail--dock-${mobileDock}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <nav className={cls} aria-label={ariaLabel}>
      {/* Навигация между разделами/категориями — это меню-навигация (nav +
          aria-current), а не WAI-ARIA tablist: раскрываемых tabpanel и
          стрелочной навигации по паттерну tab у нас нет, поэтому не заявляем
          контракт, который не выполняем. */}
      <div className="navrail-track">
        {items.map((it) => {
          const isActive = active === it.id;
          const style = it.accent ? ({ ['--nr-accent']: it.accent } as CSSProperties) : undefined;
          const hasBadge = it.badge != null && it.badge !== 0 && it.badge !== '';
          return (
            <button
              key={it.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              disabled={it.disabled}
              className={[
                'navrail-item',
                isActive ? 'is-active' : '',
                it.status === 'todo' ? 'is-todo' : '',
                it.status === 'ok' ? 'is-ok' : '',
              ].filter(Boolean).join(' ')}
              style={style}
              onClick={() => onSelect(it.id)}
              title={it.sub ? `${it.label} · ${it.sub}` : it.label}
            >
              <span className="navrail-medal" aria-hidden>
                <span className="navrail-medal-icon">{it.icon}</span>
                {it.status === 'ok' && <span className="navrail-medal-check">✓</span>}
                {hasBadge && <span className="navrail-badge">{it.badge}</span>}
              </span>
              <span className="navrail-txt">
                <span className="navrail-label">{it.label}</span>
                {it.sub && <span className="navrail-sub">{it.sub}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default NavRail;
