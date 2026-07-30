import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Dices, RotateCcw, X } from 'lucide-react';
import type DiceBox from '@3d-dice/dice-box';
import type { PlannedDie } from '../engine/dicePlan';
import { calculatePlannedRollTotals, summarizeDice } from '../engine/dicePlan';
import type { TargetOption } from '../contexts/DiceDialogContext';
import {
  dicePresentation,
  diceStartPosition,
  diceThrowConfig,
  groupDiceResults,
} from './dicePresentation';

interface Props {
  active: boolean;
  requestKey: string;
  plan: PlannedDie[];
  title: string;
  preview?: ReactNode;
  targets?: TargetOption[];
  needsTarget?: boolean;
  autoThrow: boolean;
  targetId: string;
  onTargetChange: (id: string) => void;
  onComplete: (values: number[]) => void;
  onCancel: () => void;
  onFallback: () => void;
}

interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
  distance: number;
}

interface ThrowGesture {
  strength: number;
  releaseX?: number;
  releaseY?: number;
}

type Stage = 'loading' | 'ready' | 'rolling' | 'settled' | 'error';

const MAX_DRAG = 170;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function readValues(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const individual = raw.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray((item as Record<string, unknown>).rolls));
  if (individual.length === raw.length) {
    return individual
      .sort((a, b) => Number(a.groupId ?? 0) - Number(b.groupId ?? 0)
        || Number(a.rollId ?? 0) - Number(b.rollId ?? 0))
      .map((roll) => Number(roll.value ?? roll.result));
  }
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))
    .flatMap((group) => Array.isArray(group.rolls)
      ? [...group.rolls]
        .filter((roll): roll is Record<string, unknown> => !!roll && typeof roll === 'object')
        .sort((a, b) => Number(a.rollId ?? 0) - Number(b.rollId ?? 0))
        .map((roll) => Number(roll.value ?? roll.result))
      : []);
}

export default function Dice3DOverlay({
  active,
  requestKey,
  plan,
  title,
  preview,
  targets,
  needsTarget,
  autoThrow,
  targetId,
  onTargetChange,
  onComplete,
  onCancel,
  onFallback,
}: Props) {
  const diceBoxRef = useRef<DiceBox | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [values, setValues] = useState<number[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [lastPower, setLastPower] = useState(0.55);
  const [lastGesture, setLastGesture] = useState<ThrowGesture>({ strength: 0.55 });
  const autoThrownRequestRef = useRef('');
  const mustPickTarget = !!needsTarget && !!targets?.length && !targetId;

  const grouped = useMemo(() => groupDiceResults(plan, values), [plan, values]);
  const totals = useMemo(() => calculatePlannedRollTotals(plan, values), [plan, values]);
  const largestDie = useMemo(
    () => plan.reduce<PlannedDie | undefined>(
      (largest, die) => !largest || die.sides > largest.sides ? die : largest,
      undefined,
    ),
    [plan],
  );
  const largestPresentation = largestDie ? dicePresentation(largestDie) : undefined;
  const power = drag ? clamp(drag.distance / MAX_DRAG, 0, 1) : lastPower;
  const dragDx = drag ? clamp(drag.x - drag.startX, -MAX_DRAG, MAX_DRAG) : 0;
  const dragDy = drag ? clamp(drag.y - drag.startY, -MAX_DRAG, MAX_DRAG) : 0;
  const tetherAngle = drag ? Math.atan2(dragDy, dragDx) * 180 / Math.PI : 0;

  const ensureBox = useCallback(async () => {
    if (diceBoxRef.current) return diceBoxRef.current;
    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        setStage('loading');
        const { default: DiceBoxClass } = await import('@3d-dice/dice-box');
        const box = new DiceBoxClass({
          assetPath: '/assets/dice-box/',
          container: '#character-dice-box',
          id: 'character-dice-canvas',
          gravity: 1.25,
          mass: 1.2,
          friction: 0.72,
          restitution: 0.2,
          angularDamping: 0.34,
          linearDamping: 0.42,
          spinForce: 7,
          throwForce: 7,
          startingHeight: 9,
          settleTimeout: 6500,
          delay: 55,
          lightIntensity: 0.95,
          enableShadows: true,
          shadowTransparency: 0.72,
          theme: 'default',
          themeColor: '#6f5134',
          // На 20% меньше прежнего размера (4.2/5.8).
          scale: window.innerWidth < 640 ? 3.36 : 4.64,
          offscreen: true,
        });
        await box.init();
        diceBoxRef.current = box;
      })().catch((error) => {
        initPromiseRef.current = null;
        throw error;
      });
    }
    await initPromiseRef.current;
    return diceBoxRef.current!;
  }, []);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    setValues([]);
    setDrag(null);
    setStage(diceBoxRef.current ? 'ready' : 'loading');
    ensureBox()
      .then((box) => {
        if (stale) return;
        box.clear();
        setStage('ready');
      })
      .catch((error) => {
        console.error('3D dice initialization failed', error);
        if (!stale) setStage('error');
      });
    return () => { stale = true; };
  }, [active, requestKey, ensureBox]);

  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active, onCancel]);

  const roll = useCallback(async (gesture: ThrowGesture = { strength: 0.55 }) => {
    if (stage === 'rolling' || !plan.length) return;
    try {
      const box = await ensureBox();
      const throwConfig = diceThrowConfig(gesture.strength);
      const hasReleasePoint = gesture.releaseX != null && gesture.releaseY != null;
      const startPosition = hasReleasePoint
        ? diceStartPosition(
          { x: gesture.releaseX!, y: gesture.releaseY! },
          { width: window.innerWidth, height: window.innerHeight },
          throwConfig.startingHeight,
        )
        : undefined;
      setLastPower(throwConfig.strength);
      setLastGesture({ ...gesture, strength: throwConfig.strength });
      setValues([]);
      setDrag(null);
      setStage('rolling');
      box.updateConfig({
        throwForce: throwConfig.throwForce,
        spinForce: throwConfig.spinForce,
        startingHeight: throwConfig.startingHeight,
        ...(startPosition ? { startPosition } : {}),
      });
      const result = await box.roll(
        plan.map((die) => ({
          qty: 1,
          sides: die.sides,
          theme: 'default',
          themeColor: dicePresentation(die).color,
        })),
        // При жесте сохраняем рассчитанную из точки отпускания позицию.
        // Быстрый клик и клавиатура используют штатную случайную границу стола.
        { newStartPoint: !startPosition },
      );
      const rolled = readValues(result);
      if (rolled.length !== plan.length || rolled.some((value) => !Number.isFinite(value))) {
        throw new Error(`Dice result mismatch: ${rolled.length}/${plan.length}`);
      }
      setValues(rolled);
      setStage('settled');
    } catch (error) {
      console.error('3D dice roll failed', error);
      setStage('error');
    }
  }, [ensureBox, plan, stage]);

  useEffect(() => {
    if (!active || !autoThrow || stage !== 'ready' || autoThrownRequestRef.current === requestKey) return;
    autoThrownRequestRef.current = requestKey;
    void roll({ strength: 0.2 });
  }, [active, autoThrow, requestKey, roll, stage]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (stage !== 'ready' && stage !== 'settled') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      distance: 0,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setDrag({ ...drag, x: event.clientX, y: event.clientY, distance: Math.hypot(dx, dy) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < 12) {
      void roll();
      return;
    }
    void roll({
      strength: clamp(distance / MAX_DRAG, 0.15, 1),
      releaseX: event.clientX,
      releaseY: event.clientY,
    });
  };

  return (
    <div
      className={`dice3d-overlay${active ? '' : ' dice3d-overlay--inactive'}`}
      role={active ? 'dialog' : undefined}
      aria-modal={active ? 'true' : undefined}
      aria-hidden={!active}
      aria-label={active ? 'Трёхмерный бросок кубов' : undefined}
    >
      <div id="character-dice-box" className="dice3d-canvas" aria-hidden="true" />
      <div className="dice3d-vignette" aria-hidden="true" />

      <header className="dice3d-header">
        <div className="dice3d-kicker"><Dices size={15} /> Бросок</div>
        <h2>{title}</h2>
        <p>{summarizeDice(plan)} · потяните к{largestDie?.sides ?? 20} и отпустите</p>
        {!!targets?.length && (
          <label className="dice3d-target">
            <span>Цель</span>
            <select value={targetId} onChange={(event) => onTargetChange(event.target.value)}>
              <option value="">— выберите противника —</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id} disabled={target.disabled} title={target.reason}>
                  {target.name}{target.disabled && target.reason ? ` — ${target.reason}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <button type="button" className="dice3d-close" onClick={onCancel} aria-label="Отменить бросок">
        <X size={21} />
      </button>

      {preview && <div className="dice3d-preview">{preview}</div>}

      {(stage === 'ready' || stage === 'settled') && !autoThrow && (
        <>
          {drag && (
            <span
              className="dice3d-tether"
              style={{
                width: Math.min(drag.distance, MAX_DRAG),
                transform: `rotate(${tetherAngle}deg)`,
              }}
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            className={`dice3d-pile${drag ? ' is-dragging' : ''}`}
            style={{ transform: `translate(${dragDx}px, ${dragDy}px)` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void roll();
              }
            }}
            aria-label={`Потяните к${largestDie?.sides ?? 20} и отпустите, чтобы бросить`}
          >
            <span
              className={`dice3d-grab-die dice3d-grab-die--d${largestDie?.sides ?? 20}`}
              style={{
                '--dice3d-grab-color': largestPresentation?.color ?? '#6f5134',
                '--dice3d-grab-text': largestPresentation?.textColor ?? '#f1dfbd',
              } as CSSProperties}
            >
              <span>к{largestDie?.sides ?? 20}</span>
            </span>
            <span className="dice3d-pile-copy">
              {drag ? 'Отпускайте' : values.length ? 'Потяните, чтобы перебросить' : 'Потяните, чтобы бросить'}
            </span>
          </button>
          <div className="dice3d-power" aria-live="polite">
            <span>Сила броска</span>
            <span className="dice3d-power-track"><i style={{ width: `${Math.round(power * 100)}%` }} /></span>
            <b>{Math.round(power * 100)}%</b>
          </div>
        </>
      )}

      {(stage === 'loading' || stage === 'rolling') && (
        <div className="dice3d-status" aria-live="polite">
          <Dices size={26} className={stage === 'rolling' ? 'is-rolling' : ''} />
          <span>{stage === 'loading' ? 'Готовим стол…' : 'Кубы катятся…'}</span>
        </div>
      )}

      {stage === 'error' && (
        <div className="dice3d-error" role="alert">
          <strong>3D-сцена недоступна</strong>
          <span>Можно продолжить обычным автоброском или ввести значения вручную.</span>
          <button type="button" className="dice-dialog-btn primary" onClick={onFallback}>
            Обычный диалог
          </button>
        </div>
      )}

      {stage === 'settled' && values.length === plan.length && (
        <section className="dice3d-results" aria-live="polite">
          <div className="dice3d-results-heading">
            <div>
              <span className="dice3d-results-eyebrow">Кубы остановились</span>
              <h3>Результаты броска</h3>
            </div>
            <button type="button" className="dice3d-reroll" onClick={() => void roll(lastGesture)}>
              <RotateCcw size={15} /> Перебросить
            </button>
          </div>
          <div className="dice3d-result-groups">
            {grouped.map((group, index) => (
              <div className="dice3d-result-row" key={`${group.label}-${group.sides}-${index}`}>
                <span
                  className="dice3d-result-die"
                  style={{ background: group.presentation.color, color: group.presentation.textColor }}
                >
                  к{group.sides}
                </span>
                <span className="dice3d-result-label">{group.label}</span>
                <span className="dice3d-result-values">
                  {group.values.map((value, valueIndex) => (
                    <b key={valueIndex}>{value}</b>
                  ))}
                </span>
                <strong className="dice3d-result-total">
                  {group.values.length > 1 ? `= ${group.values.reduce((sum, value) => sum + value, 0)}` : ''}
                </strong>
              </div>
            ))}
          </div>
          <div className="dice3d-roll-totals">
            {totals.map((total) => (
              <div key={total.key} className="dice3d-roll-total">
                <span>{total.label}</span>
                <strong>
                  {total.modifier
                    ? `${total.diceTotal} ${total.modifier >= 0 ? '+' : '−'} ${Math.abs(total.modifier)} = ${total.total}`
                    : `= ${total.total}`}
                </strong>
              </div>
            ))}
          </div>
          <div className="dice3d-results-actions">
            <button
              type="button"
              className="dice-dialog-btn primary"
              disabled={mustPickTarget}
              title={mustPickTarget ? 'Сначала выберите цель' : undefined}
              onClick={() => onComplete(values)}
            >
              Далее
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
