/**
 * Всплывающие подсказки листа (как в трекере инициативы): каждое действие —
 * карточка в правом нижнем углу; новые снизу, старые бледнеют и исчезают.
 * Полная история — в журнале (FAB), который открывается только вручную.
 * События ресурсов рендерятся тем же helper-ом, что и журнал (русские имена + иконки).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EngineEvent } from '../mvp/contracts';
import { describeEngineEvent } from '../engine/events';
import { resourceEventNode } from '../utils/eventDisplay';
import { useResourceOptions } from '../utils/resources';
import './SheetToasts.css';

const TOAST_TTL_MS = 8_000;
const MAX_VISIBLE = 4;

type ResourceOptions = ReturnType<typeof useResourceOptions>;

export interface SheetToast {
  id: string;
  title: ReactNode;
  lines: ReactNode[];
}

/** Заголовок тоста: подпись первого броска, иначе первое событие. */
function toastFromEvents(events: EngineEvent[], options: ResourceOptions): SheetToast | null {
  const describe = (e: EngineEvent): ReactNode => resourceEventNode(e, options) ?? describeEngineEvent(e);
  const lines = events
    .filter((e) => e.type !== 'turn_started' && e.type !== 'turn_ended')
    .map(describe)
    .filter(Boolean);
  if (!lines.length) return null;
  const rollEvent = events.find((e) => e.type === 'roll');
  const title = rollEvent && rollEvent.type === 'roll' ? rollEvent.label : lines[0];
  const body = rollEvent ? lines : lines.slice(1);
  return {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    lines: body,
  };
}

export function useSheetToasts() {
  const [toasts, setToasts] = useState<SheetToast[]>([]);
  const timers = useRef<number[]>([]);
  const resourceOptions = useResourceOptions();

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  const push = useCallback((events: EngineEvent[]) => {
    const toast = toastFromEvents(events, resourceOptions);
    if (!toast) return;
    setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), toast]);
    timers.current.push(window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, TOAST_TTL_MS));
  }, [resourceOptions]);

  return { toasts, push };
}

export default function SheetToasts({ toasts }: { toasts: SheetToast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="sheet-toasts">
      {toasts.map((t, i) => {
        const newerCount = toasts.length - 1 - i;
        return (
          <div key={t.id} className="sheet-toast" style={{ opacity: Math.max(0.35, 1 - 0.2 * newerCount) }}>
            <div className="sheet-toast-title">{t.title}</div>
            {t.lines.map((l, j) => <div key={j} className="sheet-toast-line">{l}</div>)}
          </div>
        );
      })}
    </div>
  );
}
