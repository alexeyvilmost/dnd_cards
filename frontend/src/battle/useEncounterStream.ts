/**
 * Подписка на онлайн-бой в реальном времени. Грузит текущее состояние (GET) + историю журнала
 * (getEvents), затем открывает SSE-поток и применяет входящие события к локальному состоянию
 * (дедуп по seq), дозаписывая строки в общий журнал боя. Fetch-stream передаёт Bearer JWT;
 * reconnect открывает новый поток с последним применённым seq и восстанавливает пропуски.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EncounterStreamError,
  encountersApi,
  type ApplyOp,
  type EncounterApply,
  type EncounterApplyResult,
} from './encountersApi';
import {
  applyEncounterEvent, emptyEncounterState, normalizeState,
  type Encounter, type EncounterEvent, type EncounterState,
} from './encounterTypes';

export interface BattleLogLine { seq: number; text: string }

/** Строки журнала боя из одного события (структурный log приоритетнее legacy-строк events). */
function logLinesOf(ev: EncounterEvent): BattleLogLine[] {
  const out: BattleLogLine[] = [];
  if (Array.isArray(ev.log) && ev.log.length) {
    for (const e of ev.log) if (e?.message) out.push({ seq: ev.seq, text: e.message });
  } else if (Array.isArray(ev.events)) {
    for (const s of ev.events) if (typeof s === 'string' && s) out.push({ seq: ev.seq, text: s });
  }
  return out;
}

const LOG_CAP = 300;

function waitForReconnect(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function useEncounterStream(id: string | undefined) {
  const [meta, setMeta] = useState<Encounter | null>(null);
  const [state, setState] = useState<EncounterState>(emptyEncounterState());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<BattleLogLine[]>([]);
  const [seq, setSeq] = useState(0); // последний применённый seq — сигнал для подписчиков (лист)
  const seqRef = useRef(0);
  const commandQueueRef = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    if (!id) return;
    const enc = await encountersApi.get(id);
    seqRef.current = enc.seq;
    setSeq(enc.seq);
    setMeta(enc);
    setState(normalizeState(enc.state));
  }, [id]);

  // Serialize local commands and advance seq immediately from Apply responses.
  // SSE remains the cross-client delivery path, while its echo is deduplicated
  // because seqRef already contains the committed response version.
  const apply: EncounterApply = useCallback((op: ApplyOp, expectedSeq: number): Promise<EncounterApplyResult> => {
    if (!id) return Promise.reject(new Error('Бой не выбран'));
    const run = async (): Promise<EncounterApplyResult> => {
      const result = await encountersApi.apply(id, expectedSeq, op);
      seqRef.current = result.seq;
      setSeq(result.seq);
      setState(normalizeState(result.state));
      setMeta((previous) => previous
        ? { ...previous, seq: result.seq, state: normalizeState(result.state) }
        : previous);
      return result;
    };
    const command = commandQueueRef.current.then(run, run);
    commandQueueRef.current = command.then(() => undefined, () => undefined);
    return command;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const controller = new AbortController();
    setLog([]);
    setError(null);
    setConnected(false);
    (async () => {
      try {
        const enc = await encountersApi.get(id);
        if (cancelled) return;
        seqRef.current = enc.seq;
        setSeq(enc.seq);
        setMeta(enc);
        setState(normalizeState(enc.state));
        // История общего журнала (бэкскролл). Ограничиваем снимком (seq <= enc.seq): события
        // новее придут по SSE (?since=enc.seq), иначе при гонке одно и то же событие попало бы
        // и в seed, и в поток — дубль в журнале.
        const snapshotSeq = enc.seq;
        encountersApi.getEvents(id).then((events) => {
          if (cancelled) return;
          const lines = events.filter((e) => e.seq <= snapshotSeq).flatMap(logLinesOf);
          if (lines.length) setLog((prev) => [...lines, ...prev].slice(-LOG_CAP));
        }).catch(() => { /* журнал не критичен */ });

        let backoffMs = 500;
        while (!cancelled && !controller.signal.aborted) {
          try {
            await encountersApi.stream(id, seqRef.current, {
              signal: controller.signal,
              onOpen: () => {
                backoffMs = 500;
                if (!cancelled) {
                  setConnected(true);
                  setError(null);
                }
              },
              onEvent: (ev) => {
                if (cancelled) return;
                if (typeof ev.seq !== 'number' || ev.seq <= seqRef.current) return; // дедуп/устаревшие
                seqRef.current = ev.seq;
                setSeq(ev.seq);
                setState((prev) => applyEncounterEvent(prev, ev));
                const lines = logLinesOf(ev);
                if (lines.length) setLog((prev) => [...prev, ...lines].slice(-LOG_CAP));
              },
            });
            if (!cancelled) setConnected(false);
          } catch (streamError) {
            if (cancelled || controller.signal.aborted) return;
            setConnected(false);
            if (streamError instanceof EncounterStreamError && (streamError.status === 401 || streamError.status === 403)) {
              setError(streamError.message);
              return;
            }
          }
          if (!(await waitForReconnect(backoffMs, controller.signal))) return;
          backoffMs = Math.min(backoffMs * 2, 10_000);
        }
      } catch (loadError) {
        if (!cancelled) {
          setConnected(false);
          setError(loadError instanceof Error && loadError.message ? loadError.message : 'Не удалось подключиться к бою');
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  return { meta, state, connected, error, log, seq, reload, apply };
}
