import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { cardsApi, spellsApi } from '../api/client';
import HoverCard from '../components/HoverCard';
import EntityRefPreview from '../components/EntityRefPreview';
import type { PaperLibraryEntity } from './references';
import './LibraryPicker.css';

type LibraryType = PaperLibraryEntity['type'];
const PAGE_SIZE = 20;
const TABS: { type: LibraryType; label: string }[] = [{ type: 'card', label: 'Предметы' }, { type: 'spell', label: 'Заклинания' }];
const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';

function libraryError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined;
  if (status === 401) return message || 'Войдите в аккаунт, чтобы открыть библиотеку.';
  if (status === 403) return message || 'У вас нет доступа к этой библиотеке.';
  if (!status && (!message || (cause instanceof Error && cause.name === 'ApiRequestError') || /network|failed to fetch|fetch failed|load failed|timeout/i.test(message))) {
    return 'Не удалось загрузить библиотеку. Проверьте, что локальный сервер запущен.';
  }
  return message || 'Не удалось загрузить библиотеку. Попробуйте ещё раз.';
}

export function LibraryPicker({ initialType = 'card', onSelect, onClose }: {
  initialType?: LibraryType;
  onSelect: (entity: PaperLibraryEntity) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<LibraryType>(initialType);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<PaperLibraryEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const close = useRef(onClose);
  close.current = onClose;
  const id = useId();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const mountedPanel = panel.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    search.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === 'Tab') {
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first || !last) { event.preventDefault(); panel.current?.focus(); return; }
        const active = document.activeElement;
        if (!panel.current?.contains(active) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = previousOverflow;
      // A caller may replace the picker with an editor which has already taken
      // focus. Do not pull focus out of that newly opened dialog during cleanup.
      const active = document.activeElement;
      if (returnTo?.isConnected && returnTo !== document.body
        && (!active || active === document.body || !active.isConnected || mountedPanel?.contains(active))) returnTo.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setResults([]);
    setTotal(0);
    const load = async () => {
      try {
        const params = { page, limit: PAGE_SIZE, fields: 'list' as const, search: query.trim() };
        const response = type === 'card' ? await cardsApi.getCards(params) : await spellsApi.getSpells(params);
        if (!active) return;
        const entities = 'cards' in response ? response.cards : response.spells;
        setResults(entities.map(entity => ({ type, id: entity.id, name: entity.name })));
        setTotal(response.total);
      } catch (cause) {
        if (!active) return;
        setError(libraryError(cause));
      } finally {
        if (active) setLoading(false);
      }
    };
    const timer = query.trim() ? window.setTimeout(() => void load(), 250) : undefined;
    if (timer === undefined) void load();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [type, query, page, retry]);

  const changeTab = (next: LibraryType) => { setType(next); setPage(1); };
  const tabKeydown = (event: ReactKeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    changeTab(TABS[next].type);
    tabs.current[next]?.focus();
  };

  return createPortal(<div className="ps-library-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="ps-library-picker" role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} tabIndex={-1}>
      <header className="ps-library-header"><div><h2 id={`${id}-heading`}>Добавить из библиотеки</h2><p>Выберите предмет или заклинание для листа.</p></div><button type="button" className="ps-library-close" onClick={onClose} aria-label="Закрыть библиотеку"><X size={20} /></button></header>
      <div className="ps-library-tabs" role="tablist" aria-label="Тип сущности">
        {TABS.map((tab, index) => <button key={tab.type} ref={element => { tabs.current[index] = element; }} id={`${id}-${tab.type}-tab`} type="button" role="tab" aria-selected={type === tab.type} aria-controls={`${id}-results`} tabIndex={type === tab.type ? 0 : -1} onKeyDown={event => tabKeydown(event, index)} onClick={() => changeTab(tab.type)}>{tab.label}</button>)}
      </div>
      <label className="ps-library-search"><Search size={18} aria-hidden="true" /><input ref={search} type="search" autoComplete="off" aria-label="Поиск в библиотеке" placeholder={type === 'card' ? 'Название предмета…' : 'Название заклинания…'} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      <div id={`${id}-results`} className="ps-library-results" role="tabpanel" aria-labelledby={`${id}-${type}-tab`} aria-busy={loading}>
        {loading ? <p className="ps-library-state" role="status">Загрузка…</p> : error ? <div className="ps-library-state ps-library-error"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></div> : results.length === 0 ? <p className="ps-library-state" role="status">{query.trim() ? 'Ничего не найдено. Попробуйте другое название.' : 'В этом разделе пока нет записей.'}</p> : <ul>
          {results.map(entity => <li key={`${entity.type}:${entity.id}`}><HoverCard allowPin={false} className="ps-library-result-preview" content={<EntityRefPreview type={entity.type} id={entity.id} />}><button type="button" className="ps-library-result" onClick={() => onSelect(entity)}><strong>{entity.name}</strong><span aria-hidden="true">＋</span></button></HoverCard></li>)}
        </ul>}
      </div>
      <footer className="ps-library-footer"><span role="status">{!loading && !error ? `Найдено: ${total}` : ' '}</span><nav aria-label="Страницы библиотеки"><button type="button" aria-label="Предыдущая страница библиотеки" disabled={loading || !!error || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span>Страница {page}{!loading && !error ? ` из ${pages}` : ''}</span><button type="button" aria-label="Следующая страница библиотеки" disabled={loading || !!error || page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></nav></footer>
    </div>
  </div>, document.body);
}
