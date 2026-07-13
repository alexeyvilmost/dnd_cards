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

/** Кандидат-цель для пикера в окне броска (действие бьёт по другому персонажу). */
export interface TargetOption { id: string; name: string; disabled?: boolean; reason?: string }

export type DiceDecision =
  | { mode: 'auto'; targetId?: string }
  | { mode: 'manual'; values: number[]; targetId?: string }
  | { mode: 'cancel' };

export interface DiceRequestOpts {
  confirm?: boolean;
  /** Действие взаимодействует с другим персонажем — показать пикер цели. */
  targets?: TargetOption[];
  needsTarget?: boolean;
}

interface DiceDialogApi {
  /**
   * Запросить решение игрока. Диалог выключен в настройках → сразу {mode:'auto'} (цель не выбирается,
   * резолв в dummy). Диалог включён: при непустом плане — окно броска; при ПУСТОМ плане обычно тоже
   * {mode:'auto'}, но если opts.confirm или opts.needsTarget — окно (подтверждение/выбор цели).
   * Если opts.targets заданы — в окне пикер цели; выбранный id вернётся в DiceDecision.targetId.
   */
  request: (plan: PlannedDie[], title: string, preview?: ReactNode, opts?: DiceRequestOpts) => Promise<DiceDecision>;
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
  /** Пустой план + подтверждение расхода ресурсов: окно «Применить»/«Отмена» без кубов. */
  confirmOnly: boolean;
  targets?: TargetOption[];
  needsTarget?: boolean;
}

export function DiceDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [targetId, setTargetId] = useState<string>('');
  const resolver = useRef<((d: DiceDecision) => void) | null>(null);

  const request = useCallback((plan: PlannedDie[], title: string, preview?: ReactNode, opts?: DiceRequestOpts): Promise<DiceDecision> => {
    // Диалог выключен в настройках → всегда авто (никаких окон, цель не выбирается → dummy).
    if (!getSettings().diceDialog) return Promise.resolve({ mode: 'auto' });
    const hasTargets = !!opts?.targets?.length;
    const confirmOnly = plan.length === 0;
    // Пустой план, без подтверждения и без выбора цели (свободное действие) → авто.
    if (confirmOnly && !opts?.confirm && !(opts?.needsTarget && hasTargets)) return Promise.resolve({ mode: 'auto' });
    return new Promise((resolve) => {
      resolver.current = resolve;
      setValues(plan.map(() => ''));
      // Один кандидат — выбираем сразу; иначе просим выбрать.
      setTargetId(opts?.targets?.length === 1 ? opts.targets[0].id : '');
      setDialog({ plan, title, preview, confirmOnly, targets: opts?.targets, needsTarget: opts?.needsTarget });
    });
  }, []);

  const finish = (d: DiceDecision) => {
    setDialog(null);
    resolver.current?.(d);
    resolver.current = null;
  };
  // Цель обязательна, только если есть из кого выбирать.
  const mustPickTarget = !!dialog?.needsTarget && !!dialog.targets?.length && !targetId;
  const withTarget = (d: DiceDecision): DiceDecision =>
    d.mode === 'cancel' ? d : { ...d, targetId: targetId || undefined };

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
          <div className="dice-dialog" role="dialog" aria-label={dialog.confirmOnly ? 'Подтверждение действия' : 'Бросок кубов'}>
            <div className="dice-dialog-title">{dialog.title}</div>
            {!!dialog.targets?.length && (
              <div className="dice-dialog-target" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
                <span style={{ fontSize: 13, color: '#d8b978', whiteSpace: 'nowrap' }}>Цель:</span>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid #6b5836', background: '#1c1813', color: '#e8e0d0', fontSize: 13 }}
                >
                  <option value="">— выберите противника —</option>
                  {dialog.targets.map((t) => (
                    <option key={t.id} value={t.id} disabled={t.disabled} title={t.reason}>
                      {t.name}{t.disabled && t.reason ? ` — ${t.reason}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {dialog.confirmOnly ? (
              // Действие тратит ресурсы, но кубов нет — подтверждение расхода.
              <>
                <div className="dice-dialog-summary">Потратить ресурсы и применить действие?</div>
                <div className="dice-dialog-actions">
                  <button type="button" className="dice-dialog-btn primary" disabled={mustPickTarget} title={mustPickTarget ? 'Выберите цель' : undefined} onClick={() => finish(withTarget({ mode: 'auto' }))}>
                    Применить
                  </button>
                  <button type="button" className="dice-dialog-btn ghost" onClick={() => finish({ mode: 'cancel' })}>
                    Отмена
                  </button>
                </div>
                <p className="dice-dialog-note">Окно можно отключить в настройках сайта.</p>
              </>
            ) : (
              <>
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
                  <button type="button" className="dice-dialog-btn primary" disabled={mustPickTarget} title={mustPickTarget ? 'Выберите цель' : undefined} onClick={() => finish(withTarget({ mode: 'auto' }))}>
                    Автобросок
                  </button>
                  <button
                    type="button"
                    className="dice-dialog-btn"
                    disabled={!manualReady || mustPickTarget}
                    title={mustPickTarget ? 'Выберите цель' : manualReady ? undefined : 'Заполните значения всех кубов'}
                    onClick={() => finish(withTarget({ mode: 'manual', values: parsed as number[] }))}
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
              </>
            )}
          </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
