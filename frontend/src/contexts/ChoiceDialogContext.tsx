/**
 * Ярус 1.2: диалог выбора «в момент действия». Любое место может запросить выборы
 * context:'in_play', встроенные в механику действия (напр. вариант эффекта при активации),
 * через useChoiceDialog().request(choices, title) — вернётся Promise с картой id→значения
 * или null при отмене. Переиспользует ChoiceResolver и стили dice-диалога.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PendingChoice } from '../mechanics/collectChoices';
import { ChoiceResolver } from '../character/components';
import DialogShell from '../components/DialogShell';
import type {Feat} from '../types';
import './DiceDialog.css';
import './ForgeChoiceDialog.css';

/** Результат: id выбора (сырой choice.id) → выбранные значения. null — отмена. */
export type ChoiceResult = Record<string, string[]> | null;

export interface ChoiceDialogOptions {
  presentation?: 'levelup';
  feats?: Feat[];
  summary?: string;
  unavailableOptions?: (choice: PendingChoice, selection: string[]) => Record<string, string>;
  canApply?: (values: Record<string, string[]>) => boolean;
}

interface ChoiceDialogApi {
  /** Пустой список выборов → сразу resolve({}) без окна (как автобросок в dice-диалоге). */
  request: (choices: PendingChoice[], title: string, options?: ChoiceDialogOptions) => Promise<ChoiceResult>;
}

const Ctx = createContext<ChoiceDialogApi | null>(null);

export function useChoiceDialog(): ChoiceDialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useChoiceDialog must be used within ChoiceDialogProvider');
  return api;
}

interface DialogState { choices: PendingChoice[]; title: string; options?: ChoiceDialogOptions; }

export function ChoiceDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [values, setValues] = useState<Record<string, string[]>>({});
  const resolver = useRef<((r: ChoiceResult) => void) | null>(null);
  useEffect(() => () => {
    resolver.current?.(null);
    resolver.current = null;
  }, []);

  const request = useCallback((choices: PendingChoice[], title: string, options?: ChoiceDialogOptions): Promise<ChoiceResult> => {
    if (choices.length === 0) return Promise.resolve({});
    return new Promise((resolve) => {
      // Не оставляем предыдущий запрос «висящим» без ответа (защита от гонки при повторном request).
      resolver.current?.(null);
      resolver.current = resolve;
      // Рекомендованные варианты предвыбираем сразу (можно изменить перед «Применить»).
      setValues(Object.fromEntries(choices.map((c) => [c.id, (c.recommended ?? []).slice(0, Math.max(1, c.count || 1))])));
      setDialog({ choices, title, options });
    });
  }, []);

  const finish = (r: ChoiceResult) => {
    setDialog(null);
    resolver.current?.(r);
    resolver.current = null;
  };

  // Готово, когда у каждого выбора набрано нужное число значений (count, минимум 1).
  const ready = dialog ? dialog.choices.every((c) => (values[c.id]?.length ?? 0) >= Math.max(1, c.count || 1))
    && (dialog.options?.canApply?.(values) ?? true) : false;

  return (
    <Ctx.Provider value={{ request }}>
      {children}
      {dialog && (
        <DialogShell label={dialog.title} onCancel={() => finish(null)} wrap
          initialFocus={dialog.options?.presentation === 'levelup' ? 'dialog' : 'first'}
          className={dialog.options?.presentation === 'levelup' ? 'forge-choice-dialog' : undefined}>
              <div className="dice-dialog-title">{dialog.title}</div>
              <div className="dice-dialog-summary">{dialog.options?.summary ?? 'Выберите вариант применения:'}</div>
              <div className="dice-dialog-list">
                {dialog.choices.map((c) => (
                  <ChoiceResolver
                    key={c.id}
                    choice={c}
                    value={values[c.id] || []}
                    feats={dialog.options?.feats}
                    groupSpellLevels={dialog.options?.presentation === 'levelup'}
                    unavailableOptions={dialog.options?.unavailableOptions?.(c, values[c.id] || [])}
                    onChange={(v) => setValues((prev) => ({ ...prev, [c.id]: v }))}
                  />
                ))}
              </div>
              <div className="dice-dialog-actions">
                <button
                  type="button"
                  className="dice-dialog-btn primary"
                  disabled={!ready}
                  aria-description={ready ? undefined : 'Сделайте выбор'}
                  onClick={() => finish(values)}
                >
                  Применить
                </button>
                <button type="button" className="dice-dialog-btn ghost" onClick={() => finish(null)}>
                  Отмена
                </button>
              </div>
        </DialogShell>
      )}
    </Ctx.Provider>
  );
}
