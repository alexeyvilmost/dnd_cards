/**
 * Ярус 1.2: диалог выбора «в момент действия». Любое место может запросить выборы
 * context:'in_play', встроенные в механику действия (напр. вариант эффекта при активации),
 * через useChoiceDialog().request(choices, title) — вернётся Promise с картой id→значения
 * или null при отмене. Переиспользует ChoiceResolver и стили dice-диалога.
 */
import { createContext, lazy, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PendingChoice } from '../mechanics/collectChoices';
import DeferredDialog from '../components/DeferredDialog';
const ChoiceDialogHost = lazy(() => import('./ChoiceDialogHost'));
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

export interface ChoiceDialogState { choices: PendingChoice[]; title: string; options?: ChoiceDialogOptions; }

export function ChoiceDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ChoiceDialogState | null>(null);
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
        <DeferredDialog label={dialog.title} onCancel={() => finish(null)}>
          <ChoiceDialogHost dialog={dialog} values={values} ready={ready} setValues={setValues} finish={finish} />
        </DeferredDialog>
      )}
    </Ctx.Provider>
  );
}
