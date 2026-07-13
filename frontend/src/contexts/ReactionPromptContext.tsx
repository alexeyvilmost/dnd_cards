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

/** Опция реакции (напр. круг ячейки для апкаста Божественной кары). id уходит в исполнение. */
export interface ReactionOption { id: string; label: string }
/** Итог решения: применять/нет + выбранная опция (если были). */
export interface ReactionResult { decision: ReactionDecision; option?: string }

interface ReactionPromptApi {
  /** Спросить игрока про реакцию. auto → сразу accept (перв. опция), disabled → decline, ask → модалка.
   *  opts.options — расширяемые варианты (апкаст и т.п.); выбранный id вернётся в ReactionResult.option. */
  request: (offer: ReactionOffer, opts?: { describe?: string; options?: ReactionOption[] }) => Promise<ReactionResult>;
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
  options?: ReactionOption[];
}

const linkStyle: CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'inherit', textDecoration: 'underline', font: 'inherit',
};

export function ReactionPromptProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const resolver = useRef<((r: ReactionResult) => void) | null>(null);

  const request = useCallback((offer: ReactionOffer, opts?: { describe?: string; options?: ReactionOption[] }): Promise<ReactionResult> => {
    const options = opts?.options;
    const policy = policyFor(offer.name);
    if (policy === 'auto') return Promise.resolve({ decision: 'accept', option: options?.[0]?.id });
    if (policy === 'disabled') return Promise.resolve({ decision: 'decline' });
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPrompt({ offer, describe: opts?.describe, options });
    });
  }, []);

  const finish = (r: ReactionResult) => {
    setPrompt(null);
    resolver.current?.(r);
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
        <div className="dice-dialog-backdrop" onClick={() => finish({ decision: 'decline' })}>
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
            <div className="dice-dialog-actions" style={{ flexWrap: 'wrap' }}>
              {prompt.options && prompt.options.length > 0 ? (
                // Расширяемые опции (напр. круг ячейки для апкаста) — каждая кнопка = «применить с этой опцией».
                prompt.options.map((o) => (
                  <button key={o.id} type="button" className="dice-dialog-btn primary" onClick={() => finish({ decision: 'accept', option: o.id })}>
                    {o.label}
                  </button>
                ))
              ) : (
                <button type="button" className="dice-dialog-btn primary" onClick={() => finish({ decision: 'accept' })}>
                  Использовать
                </button>
              )}
              <button type="button" className="dice-dialog-btn ghost" onClick={() => finish({ decision: 'decline' })}>
                Пропустить
              </button>
            </div>
            <p className="dice-dialog-note">
              <button type="button" style={linkStyle} onClick={() => { setPolicyFor(prompt.offer.name, 'auto'); finish({ decision: 'accept', option: prompt.options?.[0]?.id }); }}>
                Всегда использовать
              </button>
              {' · '}
              <button type="button" style={linkStyle} onClick={() => { setPolicyFor(prompt.offer.name, 'disabled'); finish({ decision: 'decline' }); }}>
                Больше не предлагать
              </button>
            </p>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
