import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, ChevronDown, X } from 'lucide-react';
import HoverCard from '../components/HoverCard';
import EntityRefPreview from '../components/EntityRefPreview';
import { useEntityDetail } from '../contexts/entityDetail';
import { Field, usePaperSheet } from './controls';
import { editPaperIdentityText, paperIdentityDisplayName, paperIdentityId, selectPaperIdentity, type PaperIdentityKind, type PaperIdentityOption } from './identity';
import { filterPaperIdentityCatalog, identityCatalogError, loadPaperIdentityCatalog } from './identityCatalog';
import './IdentitySelectionFields.css';

const LABELS = { background: 'Предыстория', species: 'Вид', subspecies: 'Подвид', class: 'Класс', subclass: 'Подкласс' };
const referenceType = (kind: PaperIdentityKind) => kind === 'species' || kind === 'subspecies' ? 'race' : kind === 'subclass' ? 'class' : kind;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]';

function SubspeciesDialog({ species, options, onSelect, onDecline, onClose }: {
  species: PaperIdentityOption;
  options: PaperIdentityOption[];
  onSelect: (option: PaperIdentityOption) => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const focusable = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); panel.current?.focus(); return; }
      if (!panel.current?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown, true);
      const active = document.activeElement;
      if (returnTo?.isConnected && (!active || active === document.body || !active.isConnected || element?.contains(active))) returnTo.focus();
    };
  }, []);
  return createPortal(<div className="ps-identity-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="ps-identity-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
      <header><h2 id={headingId}>Выберите подвид: {species.name}</h2><button type="button" aria-label="Закрыть выбор подвида" onClick={onClose}><X size={18} /></button></header>
      <p>Можно выбрать подвид сейчас или оставить только вид.</p>
      <ul>{options.map(option => <li key={option.id}><HoverCard allowPin={false} content={<EntityRefPreview type="race" id={option.id} />}><button type="button" className="ps-identity-dialog-option" onClick={() => onSelect(option)}><strong>{option.name}</strong></button></HoverCard></li>)}</ul>
      <footer><button type="button" onClick={onDecline}>Без подвида</button></footer>
    </div>
  </div>, document.body);
}

function IdentitySelectionField({ kind }: { kind: Exclude<PaperIdentityKind, 'subspecies'> }) {
  const { doc, setDoc } = usePaperSheet();
  const { openEntity } = useEntityDetail();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<PaperIdentityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const [subspecies, setSubspecies] = useState<PaperIdentityOption | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220 });
  const wrapper = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const suppressFocus = useRef(false);
  const id = useId();
  const identityId = paperIdentityId(doc, kind);
  const label = LABELS[kind];
  const parentId = kind === 'subclass' ? doc.identity?.classId : undefined;
  const results = filterPaperIdentityCatalog(catalog, kind, query, parentId);
  const shown = paperIdentityDisplayName(doc, kind);

  useEffect(() => {
    if (!open || kind === 'subclass' && !parentId) return;
    let current = true;
    setLoading(true); setError('');
    void loadPaperIdentityCatalog(kind, () => current).then(options => {
      if (current) { setCatalog(options); setLoading(false); }
    }).catch(cause => {
      if (current) { setError(identityCatalogError(cause)); setLoading(false); }
    });
    return () => { current = false; };
  }, [open, kind, retry, parentId]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = wrapper.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, Math.max(240, rect.width));
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: rect.bottom + 3, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', dismiss); };
  }, [open]);

  useEffect(() => {
    if (open) popup.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const select = (option: PaperIdentityOption) => {
    setDoc(current => selectPaperIdentity(current, option));
    setOpen(false); setQuery('');
    if (option.kind === 'species' && filterPaperIdentityCatalog(catalog, 'subspecies', '', option.id).length) setSubspecies(option);
  };
  const closeSubspecies = () => { suppressFocus.current = true; setSubspecies(null); };
  const keydown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); setQuery(''); setActive(0); }
      else if (results.length) setActive(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    }
    if (event.key === 'Enter' && open && !loading && !error && results[active]) { event.preventDefault(); select(results[active]); }
  };

  return <div ref={wrapper} className={`ps-line-label ps-id-${kind} ps-identity-selection`} onBlur={event => {
    if (!(event.relatedTarget instanceof Node) || !wrapper.current?.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span className="ps-field ps-identity-input">
      <input ref={input} id={`${id}-input`} type="text" role="combobox" autoComplete="off" spellCheck={false} aria-label={label}
        aria-expanded={open} aria-autocomplete="list" aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && !loading && !error && results[active] ? `${id}-option-${active}` : undefined}
        value={shown} onFocus={() => { if (suppressFocus.current) { suppressFocus.current = false; return; } setOpen(true); setQuery(''); setActive(0); }}
        onChange={event => { setDoc(current => editPaperIdentityText(current, kind, event.target.value)); setQuery(event.target.value); setActive(0); setOpen(true); }} onKeyDown={keydown} />
      {identityId && <HoverCard className="ps-identity-current-preview" content={<EntityRefPreview type={referenceType(kind)} id={identityId} />}><button type="button" aria-label={`Открыть карточку: ${shown}`} onClick={() => { setOpen(false); openEntity(referenceType(kind), identityId); }}><BookOpen size={12} /></button></HoverCard>}
      {kind === 'species' && doc.identity?.subspeciesId && <HoverCard className="ps-identity-current-preview" content={<EntityRefPreview type="race" id={doc.identity.subspeciesId} />}><button type="button" aria-label={`Открыть подвид: ${doc.fields.subspecies}`} onClick={() => { setOpen(false); openEntity('race', doc.identity!.subspeciesId!); }}><BookOpen size={12} /></button></HoverCard>}
      <button type="button" aria-label={`Выбрать из каталога: ${label}`} onClick={() => { input.current?.focus(); setOpen(!open); setQuery(''); setActive(0); }}><ChevronDown size={13} /></button>
    </span><label htmlFor={`${id}-input`}>{label}</label>
    {open && createPortal(<div ref={popup} className="ps-identity-suggestions" style={position}>
      <div id={`${id}-list`} role="listbox" aria-label={`Каталог: ${label}`} aria-busy={loading}>
        {kind === 'subclass' && !parentId ? <p role="status">Сначала выберите класс из каталога. Название подкласса можно ввести вручную.</p>
          : loading ? <p role="status">Загрузка…</p>
            : error ? <div><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button></div>
              : !results.length ? <p role="status">Совпадений нет. Введённый текст сохранён.</p>
                : results.map((option, index) => <HoverCard key={option.id} allowPin={false} className="ps-identity-option-preview" content={<EntityRefPreview type={referenceType(kind)} id={option.id} />}><button type="button" id={`${id}-option-${index}`} role="option" aria-selected={active === index} className="ps-identity-option" onMouseDown={event => event.preventDefault()} onClick={() => select(option)}><strong>{option.name}</strong></button></HoverCard>)}
      </div>
    </div>, document.body)}
    {subspecies && <SubspeciesDialog species={subspecies} options={filterPaperIdentityCatalog(catalog, 'subspecies', '', subspecies.id)} onClose={closeSubspecies}
      onDecline={() => { setDoc(current => editPaperIdentityText(current, 'subspecies', '')); closeSubspecies(); }}
      onSelect={option => { setDoc(current => selectPaperIdentity(current, option)); closeSubspecies(); }} />}
  </div>;
}

/** Replaces the five existing labels inside .ps-identity-fields. */
export function IdentitySelectionFields() {
  return <><label className="ps-line-label ps-id-name"><Field field="name" label="Имя персонажа" /><span>Имя персонажа</span></label>
    <IdentitySelectionField kind="background" /><IdentitySelectionField kind="class" /><IdentitySelectionField kind="species" /><IdentitySelectionField kind="subclass" />
  </>;
}
