import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Меняется при навигации (pathname) — сбрасывает границу, чтобы уход со сломанной
   *  страницы возвращал работоспособный UI, а не оставлял залипший фолбэк. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  prevResetKey?: string;
}

/**
 * Единственная защитная граница приложения (KB-004). До неё любое исключение при рендере —
 * например непарсируемая формула КЗ у надетого предмета — уносило всю страницу в белый экран,
 * и снять проблемный предмет через UI было уже нельзя. Теперь падение локализуется: показываем
 * фолбэк с выходом, а не пустой экран.
 *
 * Это подстраховка, а не основной фикс данных: конкретную формулу чинит движок (ac.ts try/catch)
 * и досев ASCII-формул. Граница ловит ВСЁ остальное, что может бросить при рендере впредь.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.prevResetKey) {
      // Навигация сменила ключ — сбрасываем пойманную ошибку (новая страница может быть цела).
      return { error: null, prevResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary поймал ошибку рендера:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: '60px 24px', maxWidth: 640, margin: '0 auto', textAlign: 'center', color: '#a59886' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12, color: '#c9b896' }}>Что-то пошло не так</h1>
        <p style={{ marginBottom: 20, lineHeight: 1.5 }}>
          Страница не смогла отрисоваться. Обычно виноват один сломанный предмет или эффект —
          вернитесь назад и попробуйте снять последнее изменение.
        </p>
        <pre style={{
          textAlign: 'left', fontSize: 12, background: 'rgba(0,0,0,0.25)', padding: 12,
          borderRadius: 6, overflowX: 'auto', marginBottom: 20, color: '#8a7d6a',
        }}>
          {error.message}
        </pre>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => { window.history.back(); }}
            style={{ padding: '8px 18px', borderRadius: 6, cursor: 'pointer' }}
          >
            Назад
          </button>
          <a
            href="/"
            style={{ padding: '8px 18px', borderRadius: 6, textDecoration: 'none', color: '#c9b896', border: '1px solid #4a4133' }}
          >
            На главную
          </a>
        </div>
      </div>
    );
  }
}
