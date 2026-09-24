import { useEffect, useState } from 'react';
import { ArrowRight, FilePlus2, LogIn, ScrollText } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createPaperSheet, loadPaperSheet, PAPER_SHEET_STORAGE_KEY } from '../paper-sheet/model';
import { paperDocumentApi, paperDocumentError, type PaperDocumentSummary, type SavedPaperDocument } from '../paper-sheet/documentApi';
import { useSavedPaperDocument } from '../paper-sheet/useSavedPaperDocument';
import { Dialog } from '../paper-sheet/controls';
import PaperCharacterSheet from './PaperCharacterSheet';
import './PaperSheetEntry.css';

function SavedEditor({ saved }: { saved: SavedPaperDocument }) {
  const session = useSavedPaperDocument(saved);
  const [discardOpen, setDiscardOpen] = useState(false);
  return <>
    <div className="paper-access-bar"><Link to="/paper-sheet">← Все бумажные листы</Link>
      {saved.anonymous && <span>Анонимный лист. Сохраните ссылку: любой, у кого она есть, сможет редактировать этот лист.</span>}
    </div>
    {session.error && <div className="paper-entry-error" role="alert">{session.error} {session.conflict
      ? <button onClick={() => setDiscardOpen(true)}>Загрузить серверную версию</button>
      : <button onClick={session.retry}>Повторить сохранение</button>}</div>}
    <PaperCharacterSheet initialDocument={session.initialDocument} onDocumentChange={session.onDocumentChange} remoteSaveStatus={session.status} remoteSaveError={session.error} />
    {discardOpen && <Dialog heading="Загрузить серверную версию?" onClose={() => setDiscardOpen(false)}><p>Сначала сохраните свой черновик через «Настройки листа → Скачать лист JSON». Несохранённые правки в этом браузере будут заменены серверной версией.</p><div className="ps-dialog-actions"><button onClick={() => setDiscardOpen(false)}>Вернуться к черновику</button><button onClick={session.discardDraft}>Заменить черновик</button></div></Dialog>}
  </>;
}

export default function PaperSheetEntry() {
  const { id } = useParams();
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<SavedPaperDocument | null>(null);
  const [sheets, setSheets] = useState<PaperDocumentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [hasLegacy] = useState(() => { try { return localStorage.getItem(PAPER_SHEET_STORAGE_KEY) !== null; } catch { return false; } });
  useEffect(() => {
    if (isLoading) return;
    let active = true;
    setSaved(null); setError(''); setSheets([]);
    if (!id && !isAuthenticated) { setLoading(false); return; }
    setLoading(true);
    const request = id ? paperDocumentApi.get(id).then(doc => { if (active) setSaved(doc); }) : paperDocumentApi.list().then(rows => { if (active) setSheets(rows); });
    void request.catch(cause => { if (active) setError(paperDocumentError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isAuthenticated, isLoading, retry]);
  const create = async (legacy = false) => {
    if (creating) return;
    setCreating(true); setError('');
    try {
      const source = legacy ? loadPaperSheet() : { document: createPaperSheet() };
      if (source.error) throw new Error(source.error);
      const created = await paperDocumentApi.create(source.document, !isAuthenticated);
      navigate(`/paper-sheet/${created.id}`);
    } catch (cause) { setError(paperDocumentError(cause)); }
    finally { setCreating(false); }
  };
  if (isLoading || (id && loading)) return <div className="paper-entry-loading" role="status">Загрузка листа…</div>;
  if (id) return saved ? <SavedEditor key={`${saved.id}:${isAuthenticated}`} saved={saved} /> : <section className="paper-entry-state"><h1>Не удалось открыть лист</h1><p role="alert">{error || 'Проверяем ссылку…'}</p><button onClick={() => setRetry(value => value + 1)}>Повторить</button>{!isAuthenticated && <Link to="/login" state={{ from: { pathname: `/paper-sheet/${id}` } }}>Авторизоваться</Link>}<Link to="/paper-sheet">К бумажным листам</Link></section>;
  return <div className="paper-entry">
    <section className="paper-entry-hero"><img src="/images/home/paper.jpg" alt="" /><div className="paper-entry-copy"><ScrollText size={32} strokeWidth={1.3} /><span className="paper-entry-eyebrow">ВАША ИСТОРИЯ НА БУМАГЕ</span><h1>Бумажные листы<br />персонажей</h1>
      {isAuthenticated ? <p>Создавайте героев, заполняйте листы и возвращайтесь к ним с любого устройства.</p> : <><p>Листами персонажей удобнее пользоваться после авторизации: они будут доступны в вашем аккаунте.</p><p>Можно создать и анонимный лист. Сохраните его ID из адресной строки, а лучше всю ссылку — только так вы сможете вернуться к нему. Не передавайте ссылку тем, кому не хотите разрешать редактирование.</p></>}
      <div className="paper-entry-actions">{!isAuthenticated && <Link className="paper-entry-primary" to="/login" state={{ from: { pathname: '/paper-sheet' } }}><LogIn size={17} />Авторизоваться</Link>}<button className={isAuthenticated ? 'paper-entry-primary' : ''} disabled={creating} onClick={() => { void create(); }}><FilePlus2 size={17} />{creating ? 'Создаём…' : isAuthenticated ? 'Создать лист' : 'Создать анонимный'}</button></div>
    </div></section>
    {error && <div className="paper-entry-error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button></div>}
    {hasLegacy && <div className="paper-entry-legacy"><span>В этом браузере есть лист из прежней версии. Он остался без изменений.</span><button disabled={creating} onClick={() => { void create(true); }}>Сохранить его отдельным листом <ArrowRight size={15} /></button></div>}
    {isAuthenticated && <section className="paper-entry-list"><h2>Ваши листы</h2>{loading ? <p role="status">Загружаем листы…</p> : sheets.length ? <ul>{sheets.map(sheet => <li key={sheet.id}><Link to={`/paper-sheet/${sheet.id}`}><ScrollText size={20} /><span>{sheet.name}<small>Изменён {new Date(sheet.updated_at).toLocaleDateString('ru-RU')}</small></span><ArrowRight size={18} /></Link></li>)}</ul> : <p>Пока здесь пусто. Начните с нового листа или перенесите существующий из браузера.</p>}</section>}
  </div>;
}
