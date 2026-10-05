/**
 * Глобальный диалог броска кубов: любое место сайта может запросить бросок
 * через useDiceDialog().request(plan, title) — вернётся Promise с решением
 * игрока: авто-бросок, значения физических кубов или отмена.
 * Включается/выключается в настройках (/settings, «Диалог бросков кубов»).
 */
import { createContext, lazy, useEffect, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { getSettings } from '../settings';
import type { PlannedDie } from '../engine/dicePlan';
import DeferredDialog from '../components/DeferredDialog';
const DiceDialogHost = lazy(() => import('./DiceDialogHost'));
import { diceEntryMode } from '../dice/diceMode';
import './DiceDialog.css';
import type { CompactCheckRequest } from '../components/SheetCheckRollDialog';
import type { RollLog } from '../mvp/contracts';

/** Кандидат-цель для пикера в окне броска (действие бьёт по другому персонажу). */
export interface TargetOption { id: string; name: string; disabled?: boolean; reason?: string }

export type DiceDecision =
  | { mode: 'auto'; targetId?: string }
  | { mode: 'manual'; values: number[]; targetId?: string; roll?: RollLog }
  | { mode: 'cancel' };

export interface DiceRequestOpts {
  compactCheck?: CompactCheckRequest;
  confirm?: boolean;
  /** Действие взаимодействует с другим персонажем — показать пикер цели. */
  targets?: TargetOption[];
  needsTarget?: boolean;
}

interface DiceDialogApi {
  /**
   * Запросить решение игрока. Диалог включён: при непустом плане сначала показывается компактное окно
   * с выбором авто/3D/ручного броска. Диалог выключен, но 3D включён → физическая сцена запускается
   * сразу. Оба интерфейса выключены → {mode:'auto'} (цель не выбирается, резолв в dummy).
   * При ПУСТОМ плане обычно тоже {mode:'auto'}, но если opts.confirm или opts.needsTarget и диалог
   * включён — показывается окно подтверждения/выбора цели.
   * Если opts.targets заданы — в окне пикер цели; выбранный id вернётся в DiceDecision.targetId.
   */
  request: (plan: PlannedDie[], title: string, preview?: ReactNode, opts?: DiceRequestOpts) => Promise<DiceDecision>;
}

const Ctx = createContext<DiceDialogApi | null>(null);
export function useOptionalDiceDialog() { return useContext(Ctx); }

export function useDiceDialog(): DiceDialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDiceDialog must be used within DiceDialogProvider');
  return api;
}

export interface DiceDialogState {
  compactCheck?: CompactCheckRequest;
  id: string;
  plan: PlannedDie[];
  title: string;
  preview?: ReactNode;
  /** Пустой план + подтверждение расхода ресурсов: окно «Применить»/«Отмена» без кубов. */
  confirmOnly: boolean;
  use3d: boolean;
  autoThrow3d: boolean;
  targets?: TargetOption[];
  needsTarget?: boolean;
}

export function DiceDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DiceDialogState | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [targetId, setTargetId] = useState<string>('');
  const [show3dScene, setShow3dScene] = useState(false);
  const resolver = useRef<((d: DiceDecision) => void) | null>(null);
  useEffect(() => () => { resolver.current?.({ mode: 'cancel' }); resolver.current = null; }, []);

  const request = useCallback((plan: PlannedDie[], title: string, preview?: ReactNode, opts?: DiceRequestOpts): Promise<DiceDecision> => {
    // A second request must not replace a pending roll (and orphan its caller).
    if (resolver.current) return Promise.resolve({ mode: 'cancel' });
    const settings = getSettings();
    const entryMode = diceEntryMode(settings, plan.length > 0);
    // Оба интерфейса выключены (либо бросать нечего) → системный автобросок.
    if (!opts?.compactCheck && entryMode === 'auto' && !settings.diceDialog) return Promise.resolve({ mode: 'auto' });
    const hasTargets = !!opts?.targets?.length;
    const confirmOnly = plan.length === 0;
    // Пустой план, без подтверждения и без выбора цели (свободное действие) → авто.
    if (confirmOnly && !opts?.confirm && !(opts?.needsTarget && hasTargets)) return Promise.resolve({ mode: 'auto' });
    return new Promise((resolve) => {
      resolver.current = resolve;
      setValues(plan.map(() => ''));
      setShow3dScene(!opts?.compactCheck && entryMode === '3d');
      // Один кандидат — выбираем сразу; иначе просим выбрать.
      setTargetId(opts?.targets?.length === 1 ? opts.targets[0].id : '');
      setDialog({
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        plan,
        compactCheck: opts?.compactCheck,
        title,
        preview,
        confirmOnly,
        use3d: settings.dice3d,
        targets: opts?.targets,
        needsTarget: opts?.needsTarget,
        autoThrow3d: settings.dice3dAutoThrow,
      });
    });
  }, []);

  const finish = (d: DiceDecision) => {
    setDialog(null);
    setShow3dScene(false);
    resolver.current?.(d);
    resolver.current = null;
  };
  return (
    <Ctx.Provider value={{ request }}>
      {children}
      {dialog && <DeferredDialog key={dialog.id} label={dialog.title} onCancel={() => finish({ mode: 'cancel' })}>
        <DiceDialogHost dialog={dialog} values={values} setValues={setValues} targetId={targetId} setTargetId={setTargetId}
          show3dScene={show3dScene} setShow3dScene={setShow3dScene} finish={finish} />
      </DeferredDialog>}
    </Ctx.Provider>
  );
}
