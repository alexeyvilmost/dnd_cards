import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import './LibraryChrome.css';

export const LIBRARY_SEARCH_DELAY = 250;

// One control/commit policy for both routes. URL owners keep their existing filters.
export default function LibrarySearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const previousValue = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const latest = useRef({ value, onSearch });
  latest.current = { value, onSearch };
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => {
    // Back/forward cancels drafts, including a POP between identical q values.
    // A filter PUSH/REPLACE must not discard text still inside its debounce.
    if (value !== previousValue.current || navigationType === 'POP') {
      cancel();
      setDraft(value);
      composing.current = false;
    }
    previousValue.current = value;
  }, [value, key, navigationType]);
  useEffect(() => () => cancel(), []);
  const commit = (next: string) => {
    cancel();
    if (next !== latest.current.value) latest.current.onSearch(next);
  };
  const schedule = (next: string) => {
    cancel();
    if (!composing.current) timer.current = setTimeout(() => commit(next), LIBRARY_SEARCH_DELAY);
  };
  return <form role="search" className="library-search" onSubmit={event => {
    event.preventDefault();
    if (!composing.current) commit(draft);
  }}>
    <Search className="library-search__icon" size={18} aria-hidden />
    <input type="search" className="library-search__input" aria-label="Поиск по библиотеке" placeholder="Поиск..."
      value={draft} onChange={event => { setDraft(event.target.value); schedule(event.target.value); }}
      onCompositionStart={() => { composing.current = true; cancel(); }}
      onCompositionEnd={event => { composing.current = false; schedule(event.currentTarget.value); }} />
    {draft && <button type="button" className="library-search__clear" aria-label="Очистить поиск"
      onClick={() => { composing.current = false; setDraft(''); commit(''); }}><X size={18} aria-hidden /></button>}
  </form>;
}
