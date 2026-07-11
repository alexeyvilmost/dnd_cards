/**
 * Подписка на онлайн-бой в реальном времени. Грузит текущее состояние (GET), затем
 * открывает SSE-поток и применяет входящие события к локальному состоянию (дедуп по seq).
 * Нативный реконнект EventSource + Last-Event-ID на сервере восстанавливают поток без потерь.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { encountersApi } from './encountersApi';
import {
  applyEncounterEvent, emptyEncounterState, normalizeState,
  type Encounter, type EncounterEvent, type EncounterState,
} from './encounterTypes';

export function useEncounterStream(id: string | undefined) {
  const [meta, setMeta] = useState<Encounter | null>(null);
  const [state, setState] = useState<EncounterState>(emptyEncounterState());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!id) return;
    const enc = await encountersApi.get(id);
    seqRef.current = enc.seq;
    setMeta(enc);
    setState(normalizeState(enc.state));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      try {
        const enc = await encountersApi.get(id);
        if (cancelled) return;
        seqRef.current = enc.seq;
        setMeta(enc);
        setState(normalizeState(enc.state));
        es = new EventSource(encountersApi.streamUrl(id, enc.seq));
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false); // EventSource сам переподключится (Last-Event-ID)
        es.onmessage = (e) => {
          try {
            const ev = JSON.parse(e.data) as EncounterEvent;
            if (typeof ev.seq !== 'number' || ev.seq <= seqRef.current) return; // дедуп/устаревшие
            seqRef.current = ev.seq;
            setState((prev) => applyEncounterEvent(prev, ev));
          } catch { /* битое событие — игнор */ }
        };
      } catch {
        if (!cancelled) setError('Не удалось подключиться к бою');
      }
    })();
    return () => { cancelled = true; es?.close(); };
  }, [id]);

  return { meta, state, connected, error, reload };
}
