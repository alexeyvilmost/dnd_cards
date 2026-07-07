/**
 * Глобальный диалог броска кубов: любое место сайта может запросить бросок
 * через useDiceDialog().request(plan, title) — вернётся Promise с решением
 * игрока: авто-бросок, значения физических кубов или отмена.
 * Включается/выключается в настройках (/settings, «Диалог бросков кубов»).
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { getSettings } from '../settings';
import { summarizeDice, type PlannedDie } from '../engine/dicePlan';
import './DiceDialog.css';

export type DiceDecision =
  | { mode: 'auto' }
  | { mode: 'manual'; values: number[] }
  | { mode: 'cancel' };

interface DiceDialogApi {
  /**
   * Запросить решение игрока. Если диалог выключен в настройках или план пуст —
   * сразу резолвится в {mode:'auto'} без показа окна. preview — карточка действия/
   * заклинания сбоку (ради чего бросок).
   */
  request: (plan: PlannedDie[], title: string, preview?: ReactNode) => Promise<DiceDecision>;
}

const Ctx = createContext<DiceDialogApi | null>(null);

export function useDiceDialog(): DiceDialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDiceDialog must be used within DiceDialogProvider');
  return api;
}

interface DialogState {
  plan: PlannedDie[];
  title: string;
  preview?: ReactNode;
}

export function DiceDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const resolver = useRef<((d: DiceDecision) => void) | null>(null);

  const request = useCallback((plan: PlannedDie[], title: string, preview?: ReactNode): Promise<DiceDecision> => {
    if (!getSettings().diceDialog || plan.length === 0) {
      return Promise.resolve({ mode: 'auto' });
    }
    return new Promise((resolve) => {
      resolver.current = resolve;
      setValues(plan.map(() => ''));
      setDialog({ plan, title, preview });
    });
  }, []);

  const finish = (d: DiceDecision) => {
    setDialog(null);
    resolver.current?.(d);
    resolver.current = null;
  };

  const parsed = dialog ? values.map((v, i) => {
    const n = parseInt(v, 10);
    const sides = dialog.plan[i].sides;
    return Number.isFinite(n) && n >= 1 && n <= sides ? n : null;
  }) : [];
  const manualReady = dialog ? parsed.every((v) => v !== null) : false;

  return (
    <Ctx.Provider value={{ request }}>
      {children}
      {dialog && (
        <div className="dice-dialog-backdrop" onClick={() => finish({ mode: 'cancel' })}>
          <div className="dice-dialog-wrap" onClick={(e) => e.stopPropagation()}>
            {dialog.preview && <div className="dice-dialog-preview">{dialog.preview}</div>}
          <div className="dice-dialog" role="dialog" aria-label="Бросок кубов">
            <div className="dice-dialog-title">{dialog.title}</div>
            <div className="dice-dialog-summary">
              Бросьте: <b>{summarizeDice(dialog.plan)}</b> — или доверьте бросок системе.
            </div>
            <div className="dice-dialog-list">
              {dialog.plan.map((d, i) => (
                <label key={i} className="dice-dialog-row">
                  <span className="dice-dialog-die">к{d.sides}</span>
                  <span className="dice-dialog-label">{d.label}</span>
                  <input
                    className="dice-dialog-input"
                    type="number"
                    min={1}
                    max={d.sides}
                    placeholder={`1–${d.sides}`}
                    value={values[i]}
                    onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                  />
                </label>
              ))}
            </div>
            <div className="dice-dialog-actions">
              <button type="button" className="dice-dialog-btn primary" onClick={() => finish({ mode: 'auto' })}>
                Автобросок
              </button>
              <button
                type="button"
                className="dice-dialog-btn"
                disabled={!manualReady}
                title={manualReady ? undefined : 'Заполните значения всех кубов'}
                onClick={() => finish({ mode: 'manual', values: parsed as number[] })}
              >
                Использовать мои кубы
              </button>
              <button type="button" className="dice-dialog-btn ghost" onClick={() => finish({ mode: 'cancel' })}>
                Отмена
              </button>
            </div>
            <p className="dice-dialog-note">
              Если атака промахнётся, значения костей урона не понадобятся. Окно можно отключить в настройках сайта.
            </p>
          </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
