/**
 * Ярус 1.2: диалог выбора «в момент действия». Любое место может запросить выборы
 * context:'in_play', встроенные в механику действия (напр. вариант эффекта при активации),
 * через useChoiceDialog().request(choices, title) — вернётся Promise с картой id→значения
 * или null при отмене. Переиспользует ChoiceResolver и стили dice-диалога.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { PendingChoice } from '../mechanics/collectChoices';
import { ChoiceResolver } from '../character/components';
import './DiceDialog.css';

/** Результат: id выбора (сырой choice.id) → выбранные значения. null — отмена. */
export type ChoiceResult = Record<string, string[]> | null;

interface ChoiceDialogApi {
  /** Пустой список выборов → сразу resolve({}) без окна (как автобросок в dice-диалоге). */
  request: (choices: PendingChoice[], title: string) => Promise<ChoiceResult>;
}

const Ctx = createContext<ChoiceDialogApi | null>(null);

export function useChoiceDialog(): ChoiceDialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useChoiceDialog must be used within ChoiceDialogProvider');
  return api;
}

interface DialogState { choices: PendingChoice[]; title: string; }

export function ChoiceDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [values, setValues] = useState<Record<string, string[]>>({});
  const resolver = useRef<((r: ChoiceResult) => void) | null>(null);

  const request = useCallback((choices: PendingChoice[], title: string): Promise<ChoiceResult> => {
    if (choices.length === 0) return Promise.resolve({});
    return new Promise((resolve) => {
      // Не оставляем предыдущий запрос «висящим» без ответа (защита от гонки при повторном request).
      resolver.current?.(null);
      resolver.current = resolve;
      setValues(Object.fromEntries(choices.map((c) => [c.id, []])));
      setDialog({ choices, title });
    });
  }, []);

  const finish = (r: ChoiceResult) => {
    setDialog(null);
    resolver.current?.(r);
    resolver.current = null;
  };

  // Готово, когда у каждого выбора набрано нужное число значений (count, минимум 1).
  const ready = dialog ? dialog.choices.every((c) => (values[c.id]?.length ?? 0) >= Math.max(1, c.count || 1)) : false;

  return (
    <Ctx.Provider value={{ request }}>
      {children}
      {dialog && (
        <div className="dice-dialog-backdrop" onClick={() => finish(null)}>
          <div className="dice-dialog-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="dice-dialog" role="dialog" aria-label="Выбор при действии">
              <div className="dice-dialog-title">{dialog.title}</div>
              <div className="dice-dialog-summary">Выберите вариант применения:</div>
              <div className="dice-dialog-list">
                {dialog.choices.map((c) => (
                  <ChoiceResolver
                    key={c.id}
                    choice={c}
                    value={values[c.id] || []}
                    onChange={(v) => setValues((prev) => ({ ...prev, [c.id]: v }))}
                  />
                ))}
              </div>
              <div className="dice-dialog-actions">
                <button
                  type="button"
                  className="dice-dialog-btn primary"
                  disabled={!ready}
                  title={ready ? undefined : 'Сделайте выбор'}
                  onClick={() => finish(values)}
                >
                  Применить
                </button>
                <button type="button" className="dice-dialog-btn ghost" onClick={() => finish(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
