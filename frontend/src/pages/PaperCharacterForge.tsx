import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { addClassLevel } from '../character/multiclass';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { createPaperSheet, importPaperSheet } from '../paper-sheet/model';
import { paperIdentityDraft } from '../paper-sheet/identity';
import { forgeCharacterToPaper } from '../paper-sheet/characterConversion';
import { paperDocumentApi, paperDocumentError, type SavedPaperDocument } from '../paper-sheet/documentApi';
import CharacterForge, { type PaperForgeSaveInput } from './CharacterForge';
import './PaperSheetEntry.css';
import '../paper-sheet/PaperCharacterForge.css';

interface ForgeSession {
  saved?: SavedPaperDocument;
  draft: CharacterDraft;
  levelUpFrom?: CharacterDraft;
  restored: boolean;
  notice?: string;
}

interface CachedDraft { revision: number; draft: CharacterDraft; levelUpFrom?: CharacterDraft }

export function paperForgeDraftKey(id: string | undefined, levelUp: boolean): string {
  return `paper-forge-draft:${id ?? 'new'}:${levelUp ? 'level-up' : 'forge'}`;
}

function validateDraft(value: unknown): CharacterDraft {
  const doc = importPaperSheet(JSON.stringify({ ...createPaperSheet(), progression: { draft: value } }));
  if (!doc.progression) throw new Error('Некорректный черновик');
  return doc.progression.draft;
}

function readDraft(key: string, revision: number): { cached?: CachedDraft; stale?: boolean } {
  try {
    const text = localStorage.getItem(key);
    if (!text) return {};
    const value = JSON.parse(text) as CachedDraft;
    if (value.revision !== revision) return { stale: true };
    return { cached: { revision, draft: validateDraft(value.draft), levelUpFrom: value.levelUpFrom ? validateDraft(value.levelUpFrom) : undefined } };
  } catch { return {}; }
}

/** Only the document transport lives here. The forge remains the canonical choice UI. */
export default function PaperCharacterForge({ levelUp = false }: { levelUp?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState<ForgeSession | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [staleDraft, setStaleDraft] = useState(false);
  const activeRequest = useRef(0);
  const busy = useRef(false);
  const savedSuccessfully = useRef(false);
  const draftKey = paperForgeDraftKey(id, levelUp);
  const returnURL = id ? `/paper-sheet/${id}` : '/paper-sheet';

  useEffect(() => {
    if (isLoading) return;
    const generation = ++activeRequest.current;
    savedSuccessfully.current = false;
    setLoading(true); setError(''); setSession(null); setStaleDraft(false);
    void (async () => {
      try {
        const saved = id ? await paperDocumentApi.get(id) : undefined;
        if (generation !== activeRequest.current) return;
        let draft = saved ? paperIdentityDraft(saved.document) : emptyDraft();
        if (!draft) throw new Error('Проверьте уровень на бумажном листе: нужен целый уровень от 1 до 20.');
        draft = { ...draft, id: undefined };
        let levelUpFrom: CharacterDraft | undefined;
        if (levelUp) {
          if (!saved?.document.progression || !draft.classId || !draft.raceId || !draft.backgroundId) {
            throw new Error('Сначала откройте кузницу и проверьте вид, класс, предысторию и выборы этого листа.');
          }
          if (draft.level >= 20) throw new Error('Персонаж уже достиг 20-го уровня.');
          levelUpFrom = structuredClone(draft);
          draft = { ...draft, level: draft.level + 1, classLevels: addClassLevel(draft, draft.classId) };
        }
        const { cached, stale } = readDraft(draftKey, saved?.revision ?? 0);
        const validCached = cached && (!levelUp || (cached.levelUpFrom?.level === levelUpFrom?.level && cached.draft.level === draft.level));
        setStaleDraft(!!stale);
        setSession({
          saved, draft: validCached ? cached.draft : draft,
          levelUpFrom: validCached ? cached.levelUpFrom : levelUpFrom,
          restored: !!validCached,
          notice: saved && !saved.document.progression
            ? 'Проверьте сведения и завершите выборы персонажа. Свободные записи и ручные значения останутся на листе.' : undefined,
        });
      } catch (cause) {
        if (generation === activeRequest.current) setError(paperDocumentError(cause));
      } finally {
        if (generation === activeRequest.current) setLoading(false);
      }
    })();
    return () => { activeRequest.current += 1; };
  }, [id, levelUp, draftKey, isLoading, isAuthenticated, retry]);

  const onDraftChange = useCallback((draft: CharacterDraft) => {
    if (!session || savedSuccessfully.current || staleDraft) return;
    // Persist upgrades as well as creations. Keep the original choices for replacement limits.
    try { localStorage.setItem(draftKey, JSON.stringify({ revision: session.saved?.revision ?? 0, draft, levelUpFrom: session.levelUpFrom })); } catch { /* The server save remains available when browser storage is full. */ }
  }, [draftKey, session, staleDraft]);

  const onSave = useCallback(async (input: PaperForgeSaveInput) => {
    if (!session || busy.current) throw new Error('Сохранение уже выполняется.');
    busy.current = true;
    const generation = activeRequest.current;
    try {
      const document = await forgeCharacterToPaper({ ...input, existing: session.saved?.document });
      if (generation !== activeRequest.current) throw new Error('Открыт другой лист. Повторите сохранение в нужном листе.');
      const saved = session.saved;
      let documentId: string;
      if (saved) {
        await paperDocumentApi.save(saved.id, document, saved.revision);
        documentId = saved.id;
      } else {
        documentId = (await paperDocumentApi.create(document, !isAuthenticated)).id;
      }
      if (generation !== activeRequest.current) return;
      savedSuccessfully.current = true;
      try { localStorage.removeItem(draftKey); } catch { /* optional local recovery only */ }
      navigate(`/paper-sheet/${documentId}`, { replace: true });
    } catch (cause) { throw new Error(paperDocumentError(cause)); }
    finally { busy.current = false; }
  }, [session, isAuthenticated, draftKey, navigate]);

  if (isLoading || loading) return <div className="paper-forge-page paper-entry-loading" role="status">Загрузка персонажа…</div>;
  if (!session) return <section className="paper-forge-page paper-entry-state"><h1>Не удалось открыть кузницу</h1><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>Повторить</button>{id && levelUp && <Link to={`/paper-sheet/${id}/forge`}>Проверить персонажа в кузнице</Link>}<Link to={returnURL}>Вернуться к листу</Link></section>;
  return <div className="paper-forge-page">
    <div className="paper-forge-notice">
      {session.notice && <p>{session.notice}</p>}
      {session.restored && <p role="status">Восстановлен незавершённый черновик.</p>}
      {staleDraft && <p role="alert">Лист изменён после сохранения черновика. Открыта текущая версия; прежний черновик сохранён в браузере. <button onClick={() => { try { localStorage.removeItem(draftKey); } catch { /* optional */ } setStaleDraft(false); }}>Продолжить с текущей версией</button></p>}
      {!id && !isAuthenticated && <p>Будет создан анонимный лист. Сохраните ссылку после создания, чтобы вернуться к нему.</p>}
    </div>
    <CharacterForge key={`${id ?? 'new'}:${levelUp}:${retry}:${isAuthenticated}`} paperMode paperSession={{
      draft: session.draft, documentId: session.saved?.id, anonymous: !isAuthenticated, levelUpFrom: session.levelUpFrom,
      returnURL, onDraftChange, onSave,
    }} />
  </div>;
}
