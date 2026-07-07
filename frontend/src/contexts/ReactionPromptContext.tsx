/**
 * Подсказка реакции (фаза A). Диспетчер событий движка возвращает pendingReactions
 * (реакции/триггеры со стоимостью); лист спрашивает игрока через
 * useReactionPrompt().request(offer). Политика на реакцию: Ask (спросить),
 * Automatic (использовать всегда), Disabled (не предлагать) — хранится в localStorage.
 *
 * По образцу DiceDialogContext (промис + модалка).
 */
import { createContext, useCallback, useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ReactionOffer } from '../mvp/contracts';
import './DiceDialog.css';

export type ReactionDecision = 'accept' | 'decline';
export type ReactionPolicy = 'ask' | 'auto' | 'disabled';

interface ReactionPromptApi {
  /** Спросить игрока про реакцию. auto → сразу accept, disabled → decline, ask → модалка. */
  request: (offer: ReactionOffer, describe?: string) => Promise<ReactionDecision>;
}

const Ctx = createContext<ReactionPromptApi | null>(null);

export function useReactionPrompt(): ReactionPromptApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useReactionPrompt must be used within ReactionPromptProvider');
  return api;
}

const POLICY_KEY = 'reactionPolicy';

function readPolicies(): Record<string, ReactionPolicy> {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ReactionPolicy>) : {};
  } catch {
    return {};
  }
}
function policyFor(name: string): ReactionPolicy {
  return readPolicies()[name] ?? 'ask';
}
function setPolicyFor(name: string, policy: ReactionPolicy): void {
  try {
    const map = readPolicies();
    map[name] = policy;
    localStorage.setItem(POLICY_KEY, JSON.stringify(map));
  } catch {
    /* localStorage недоступен — игнорируем */
  }
}

interface PromptState {
  offer: ReactionOffer;
  describe?: string;
}

const linkStyle: CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'inherit', textDecoration: 'underline', font: 'inherit',
};

export function ReactionPromptProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const resolver = useRef<((d: ReactionDecision) => void) | null>(null);

  const request = useCallback((offer: ReactionOffer, describe?: string): Promise<ReactionDecision> => {
    const policy = policyFor(offer.name);
    if (policy === 'auto') return Promise.resolve('accept');
    if (policy === 'disabled') return Promise.resolve('decline');
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPrompt({ offer, describe });
    });
  }, []);

  const finish = (d: ReactionDecision) => {
    setPrompt(null);
    resolver.current?.(d);
    resolver.current = null;
  };

  const costText = prompt
    ? (prompt.offer.cost ?? [])
        .map((c) => String((c as Record<string, unknown>).resource ?? ''))
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <Ctx.Provider value={{ request }}>
      {children}
      {prompt && (
        <div className="dice-dialog-backdrop" onClick={() => finish('decline')}>
          <div className="dice-dialog" role="dialog" aria-label="Реакция" onClick={(e) => e.stopPropagation()}>
            <div className="dice-dialog-title">Реакция: {prompt.offer.name}</div>
            <div className="dice-dialog-summary">
              {prompt.describe || 'Использовать эту реакцию?'}
              {costText && (
                <>
                  {' '}
                  <br />
                  Стоимость: <b>{costText}</b>
                </>
              )}
            </div>
            <div className="dice-dialog-actions">
              <button type="button" className="dice-dialog-btn primary" onClick={() => finish('accept')}>
                Использовать
              </button>
              <button type="button" className="dice-dialog-btn ghost" onClick={() => finish('decline')}>
                Пропустить
              </button>
            </div>
            <p className="dice-dialog-note">
              <button type="button" style={linkStyle} onClick={() => { setPolicyFor(prompt.offer.name, 'auto'); finish('accept'); }}>
                Всегда использовать
              </button>
              {' · '}
              <button type="button" style={linkStyle} onClick={() => { setPolicyFor(prompt.offer.name, 'disabled'); finish('decline'); }}>
                Больше не предлагать
              </button>
            </p>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
