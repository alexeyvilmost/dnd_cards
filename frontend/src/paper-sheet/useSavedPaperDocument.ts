import { useCallback, useEffect, useRef, useState } from 'react';
import { importPaperSheet, type PaperSheetDocument } from './model';
import { paperDocumentApi, paperDocumentError, type SavedPaperDocument } from './documentApi';

const draftKey = (id: string) => `bagofholding.paper-sheet.draft.${id}`;
function readDraft(saved: SavedPaperDocument) {
  try {
    const raw = localStorage.getItem(draftKey(saved.id));
    if (raw) {
      const draft = JSON.parse(raw);
      if (draft.pending) return { document: importPaperSheet(JSON.stringify(draft.document)), conflict: draft.revision !== saved.revision, pending: true };
    }
  } catch { /* A corrupt local draft must not replace a valid server document. */ }
  return { document: saved.document, conflict: false, pending: false };
}

/** One in-flight mutation per document; later edits are queued, never overwritten by an old ACK. */
export function useSavedPaperDocument(saved: SavedPaperDocument) {
  const [initial] = useState(() => readDraft(saved));
  const [status, setStatus] = useState(initial.pending ? 'Есть несохранённые изменения' : 'Сохранено на сервере');
  const [error, setError] = useState(initial.conflict ? 'Серверная версия изменилась. Ваш черновик сохранён в браузере; скачайте JSON перед загрузкой серверной версии.' : '');
  const [conflict, setConflict] = useState(initial.conflict);
  const state = useRef({ revision: saved.revision, latest: initial.document, acknowledged: saved.document, pending: initial.pending, saving: false, blocked: initial.conflict });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);
  const backup = useCallback(() => {
    const current = state.current;
    try { localStorage.setItem(draftKey(saved.id), JSON.stringify({ document: current.latest, revision: current.revision, pending: current.pending })); }
    catch { /* Server save remains available; errors never claim that a local copy exists. */ }
  }, [saved.id]);
  const flush = useCallback(async () => {
    const current = state.current;
    if (current.saving || !current.pending || current.blocked) return;
    current.saving = true;
    if (mounted.current) { setStatus('Сохраняем…'); setError(''); }
    const document = current.latest;
    try {
      current.revision = await paperDocumentApi.save(saved.id, document, current.revision);
      current.acknowledged = document;
      current.pending = current.latest !== document;
      backup();
      if (mounted.current) setStatus(current.pending ? 'Сохраняем…' : 'Сохранено на сервере');
    } catch (cause) {
      const statusCode = (cause as { response?: { status?: number }; status?: number })?.response?.status ?? (cause as { status?: number })?.status;
      current.blocked = true;
      if (mounted.current) { setError(paperDocumentError(cause)); setStatus('Не сохранено на сервере'); setConflict(statusCode === 409); }
    } finally {
      current.saving = false;
      if (current.pending && !current.blocked && mounted.current) timer.current = setTimeout(() => { void flush(); }, 500);
    }
  }, [saved.id, backup]);
  const onDocumentChange = useCallback((document: PaperSheetDocument) => {
    state.current.latest = document;
    state.current.pending = document !== state.current.acknowledged;
    backup();
    setStatus('Есть несохранённые изменения');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 600);
  }, [backup, flush]);
  useEffect(() => {
    mounted.current = true;
    if (state.current.pending && !state.current.blocked) timer.current = setTimeout(() => { void flush(); }, 600);
    const warn = (event: BeforeUnloadEvent) => { if (state.current.pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; clearTimeout(timer.current); window.removeEventListener('beforeunload', warn); };
  }, [flush]);
  const retry = () => { if (conflict) return; state.current.blocked = false; void flush(); };
  const discardDraft = () => { localStorage.removeItem(draftKey(saved.id)); state.current.pending = false; window.location.reload(); };
  return { initialDocument: initial.document, onDocumentChange, status, error, conflict, retry, discardDraft };
}
