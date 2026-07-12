/**
 * Подписка на онлайн-бой в реальном времени. Грузит текущее состояние (GET) + историю журнала
 * (getEvents), затем открывает SSE-поток и применяет входящие события к локальному состоянию
 * (дедуп по seq), дозаписывая строки в общий журнал боя. Нативный реконнект EventSource +
 * Last-Event-ID на сервере восстанавливают поток без потерь.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { encountersApi } from './encountersApi';
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

export function useEncounterStream(id: string | undefined) {
  const [meta, setMeta] = useState<Encounter | null>(null);
  const [state, setState] = useState<EncounterState>(emptyEncounterState());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<BattleLogLine[]>([]);
  const [seq, setSeq] = useState(0); // последний применённый seq — сигнал для подписчиков (лист)
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!id) return;
    const enc = await encountersApi.get(id);
    seqRef.current = enc.seq;
    setSeq(enc.seq);
    setMeta(enc);
    setState(normalizeState(enc.state));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let cancelled = false;
    setLog([]);
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
        es = new EventSource(encountersApi.streamUrl(id, enc.seq));
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false); // EventSource сам переподключится (Last-Event-ID)
        es.onmessage = (e) => {
          try {
            const ev = JSON.parse(e.data) as EncounterEvent;
            if (typeof ev.seq !== 'number' || ev.seq <= seqRef.current) return; // дедуп/устаревшие
            seqRef.current = ev.seq;
            setSeq(ev.seq);
            setState((prev) => applyEncounterEvent(prev, ev));
            const lines = logLinesOf(ev);
            if (lines.length) setLog((prev) => [...prev, ...lines].slice(-LOG_CAP));
          } catch { /* битое событие — игнор */ }
        };
      } catch {
        if (!cancelled) setError('Не удалось подключиться к бою');
      }
    })();
    return () => { cancelled = true; es?.close(); };
  }, [id]);

  return { meta, state, connected, error, log, seq, reload };
}
