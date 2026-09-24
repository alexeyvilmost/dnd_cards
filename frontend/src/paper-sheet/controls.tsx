import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SetStateAction } from 'react';
import { BookOpen, Pencil, Settings2, X } from 'lucide-react';
import { calculateSheet, defaultFormula, evaluatePaperFormula, fieldValue, type PaperEquipmentProjection, type PaperSheetDocument } from './model';
import { EntityName } from './EntityName';
import { LibraryPicker } from './LibraryPicker';
import { PAPER_ENTITY_TOKEN_PATTERN, paperEntityToken, parsePaperEntityToken, type PaperLibraryEntity } from './references';

export interface PaperSheetContextValue {
  doc: PaperSheetDocument;
  setDoc: Dispatch<SetStateAction<PaperSheetDocument>>;
  setField: (key: string, value: string) => void;
  calculations: ReturnType<typeof calculateSheet>;
  equipment?: PaperEquipmentProjection;
}
export const PaperSheetContext = createContext<PaperSheetContextValue | null>(null);
export function usePaperSheet() {
  const context = useContext(PaperSheetContext);
  if (!context) throw new Error('PaperSheetContext is missing');
  return context;
}

export function Frame({ heading, children, className = '' }: { heading?: string; children?: ReactNode; className?: string }) {
  return <section className={`ps-frame ${className}`}>{heading && <h2 className="ps-heading">{heading}</h2>}{children}</section>;
}

export function Field({ field, label, signed = false, className = '', placeholder }: {
  field: string; label: string; signed?: boolean; className?: string; placeholder?: string;
}) {
  const { doc, setField, calculations, equipment } = usePaperSheet();
  const [focused, setFocused] = useState(false);
  const errorId = useId();
  const raw = fieldValue(doc, field);
  const computed = calculations.values[field];
  const error = calculations.errors[field];
  const shown = computed === undefined ? raw : `${signed && computed >= 0 ? '+' : ''}${Number(computed.toFixed(2))}`;
  return <span className={`ps-field ${error ? 'ps-field-invalid' : ''} ${className}`}>
    <input aria-label={label} aria-description={equipment?.sources?.[field]?.join('; ')} aria-invalid={!!error} aria-describedby={error && focused ? errorId : undefined}
      autoComplete="off" spellCheck={false} placeholder={placeholder}
      value={focused ? raw : error ? raw : shown}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => setField(field, event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    {error && focused && <span id={errorId} role="alert" className="ps-field-error">{error}</span>}
  </span>;
}

export function Check({ field, label, diamond = false }: { field: string; label: string; diamond?: boolean }) {
  const { doc, setDoc } = usePaperSheet();
  return <input type="checkbox" className={`ps-check ${diamond ? 'ps-diamond' : ''}`} aria-label={label}
    checked={!!doc.checks[field]} onChange={event => setDoc(current => ({ ...current, checks: { ...current.checks, [field]: event.target.checked } }))} />;
}

export function Dialog({ heading, children, onClose }: { heading: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();
  return <dialog ref={element => { ref.current = element; if (element && !element.open) element.showModal(); }}
    className="ps-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ps-dialog-inner"><header><h2 id={headingId}>{heading}</h2><button type="button" onClick={onClose} aria-label="Закрыть окно"><X size={20} /></button></header>{children}</div>
  </dialog>;
}

export function FieldSettings({ field, label }: { field: string; label: string }) {
  const { doc, setField, calculations } = usePaperSheet();
  const [open, setOpen] = useState(false);
  const formula = defaultFormula(field, doc);
  return <><button type="button" className="ps-cog" onClick={() => setOpen(true)} aria-label={`Настроить: ${label}`}><Settings2 size={11} /></button>
    {open && <Dialog heading={label} onClose={() => setOpen(false)}>
      <p className="ps-dialog-hint">Введите число или формулу. Значение пересчитывается при изменении характеристик.</p>
      <label className="ps-dialog-label">Значение / формула<input autoFocus value={doc.fields[field] ?? ''} placeholder={formula || 'Число или =формула'} onChange={event => setField(field, event.target.value)} /></label>
      <p className="ps-formula-result">Результат: {calculations.errors[field] || calculations.values[field] || '0'}</p>
      {formula && <><p className="ps-dialog-hint">По умолчанию: {formula}</p><button type="button" className="ps-dialog-button" onClick={() => setField(field, '')}>Автоматическое значение</button></>}
      <FormulaHelp />
    </Dialog>}
  </>;
}

export function FormulaHelp() {
  return <div className="ps-formula-help"><p>Формула начинается с <b>=</b>, например <code>=10 + [DEX]</code> или <code>=8 + [PROF] + [WIS]</code>.</p>
    <p><code>[STR] [DEX] [CON] [INT] [WIS] [CHA]</code> — модификаторы характеристик; <code>[PROF]</code> — бонус владения; <code>[LVL]</code> — уровень. <code>str</code> или <code>[STR_SCORE]</code> — значение Силы.</p>
    <p>Доступны +, −, *, /, скобки и min, max, floor, ceil. В заметках заключите формулу в двойные фигурные скобки: <code>{'{{8 + [PROF] + [WIS]}}'}</code>.</p>
  </div>;
}

// Notes are plain text with small, explicit tokens, never executable HTML.
function StyledText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|_[^_\n]+_|~~[^~]+~~)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('_') && part.endsWith('_') ? <em key={i}>{part.slice(1, -1)}</em> : part.startsWith('~~') && part.endsWith('~~') ? <s key={i}>{part.slice(2, -2)}</s> : <span key={i}>{part}</span>)}</>;
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${PAPER_ENTITY_TOKEN_PATTERN.source})`, 'g'));
  return <>{parts.map((part, index) => {
    const entity = parsePaperEntityToken(part);
    return entity ? <EntityName key={index} entity={entity} /> : <StyledText key={index} text={part} />;
  })}</>;
}

function NoteText({ text, onChange }: { text: string; onChange: (value: string) => void }) {
  const { doc, equipment } = usePaperSheet();
  const tokens = text.split(/(\{\{[^{}]+\}\})/g);
  let offset = 0;
  return <>{tokens.map((token, index) => {
    const start = offset;
    offset += token.length;
    if (!token.startsWith('{{')) return <LinkedText key={index} text={token} />;
    const expr = token.slice(2, -2);
    if (expr.startsWith('ресурс:')) {
      const [name, currentRaw = '0', maxRaw = ''] = expr.slice(7).split('|');
      const current = Number(currentRaw);
      const max = maxRaw === '' ? Infinity : Number(maxRaw);
      if (!Number.isFinite(current) || Number.isNaN(max)) return <span key={index}>{token}</span>;
      const update = (delta: number) => onChange(text.slice(0, start) + `{{ресурс:${name}|${Math.max(0, Math.min(max, current + delta))}|${maxRaw}}}` + text.slice(start + token.length));
      return <span className="ps-resource" key={index}><b>{name}</b><button type="button" aria-label={`Потратить: ${name}`} onClick={() => update(-1)}>−</button><span>{current}{max !== Infinity ? ` / ${max}` : ''}</span><button type="button" aria-label={`Добавить: ${name}`} onClick={() => update(1)}>+</button></span>;
    }
    const evaluated = evaluatePaperFormula(expr, doc, equipment);
    return <span key={index} className={evaluated.error ? 'ps-inline-error' : 'ps-inline-formula'} aria-label={`Формула ${expr}`} aria-description={evaluated.error || expr}>{evaluated.error ? token : evaluated.value}</span>;
  })}</>;
}

function sourcePosition(text: string, offset: number) {
  const before = text.slice(0, Math.max(0, Math.min(text.length, offset))).split('\n');
  return { line: before.length - 1, column: before[before.length - 1].length };
}

export function Note({ section, heading, className = '', children }: { section: string; heading: string; className?: string; children?: ReactNode }) {
  const { doc, setDoc, setField } = usePaperSheet();
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceName, setResourceName] = useState('Ресурс');
  const [resourceMax, setResourceMax] = useState('3');
  const [toolbarTop, setToolbarTop] = useState(0);
  const insertion = useRef<{ start: number; end: number; fromEditor: boolean } | null>(null);
  const selection = useRef<{ line: number; start: number; end: number } | null>(null);
  const returnFocus = useRef(false);
  const note = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const currentLine = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const data = doc.sections[section] ?? { text: '', fontSize: 12 };
  const lines = data.text.split('\n');
  const editing = activeLine !== null;

  const change = (patch: Partial<typeof data>) => setDoc(current => ({ ...current, sections: { ...current.sections, [section]: { ...(current.sections[section] ?? { text: '', fontSize: 12 }), ...patch } } }));
  const replaceLine = (index: number, value: string) => setDoc(current => {
    const old = current.sections[section] ?? { text: '', fontSize: 12 };
    const nextLines = old.text.split('\n');
    nextLines.splice(index, 1, ...value.split('\n'));
    return { ...current, sections: { ...current.sections, [section]: { ...old, text: nextLines.join('\n') } } };
  });
  const editLine = (index: number, value: string, cursor: number) => {
    if (value === lines[index]) {
      selection.current = null;
      textarea.current?.setSelectionRange(cursor, cursor);
      return;
    }
    const position = sourcePosition(value, cursor);
    const nextLine = index + position.line;
    selection.current = { line: nextLine, start: position.column, end: position.column };
    setActiveLine(nextLine);
    replaceLine(index, value);
  };
  const activate = (index: number, column = lines[index]?.length ?? 0) => {
    if (index === activeLine) {
      textarea.current?.focus({ preventScroll: true });
      return;
    }
    selection.current = { line: index, start: column, end: column };
    setActiveLine(index);
  };
  const finishEditing = () => {
    returnFocus.current = true;
    setResourceOpen(false);
    setActiveLine(null);
  };

  useEffect(() => {
    if (!editing) return;
    const finishOutside = (event: Event) => {
      if (event.target instanceof Node && !note.current?.contains(event.target)) {
        setActiveLine(null);
        setResourceOpen(false);
      }
    };
    document.addEventListener('pointerdown', finishOutside);
    document.addEventListener('focusin', finishOutside);
    return () => {
      document.removeEventListener('pointerdown', finishOutside);
      document.removeEventListener('focusin', finishOutside);
    };
  }, [editing]);

  useLayoutEffect(() => {
    if (activeLine === null) {
      if (returnFocus.current) preview.current?.focus({ preventScroll: true });
      returnFocus.current = false;
      return;
    }
    const element = textarea.current;
    if (element && document.activeElement !== element) element.focus({ preventScroll: true });
    if (element && selection.current?.line === activeLine) {
      element.setSelectionRange(selection.current.start, selection.current.end);
      selection.current = null;
    }
  }, [activeLine, data.text]);

  useLayoutEffect(() => {
    if (activeLine === null) return;
    const placeToolbar = () => {
      const container = body.current;
      const line = currentLine.current;
      if (!container || !line) return;
      const containerRect = container.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const scale = containerRect.width ? container.offsetWidth / containerRect.width : 1;
      setToolbarTop(Math.max(0, (lineRect.bottom - containerRect.top) * scale));
    };
    placeToolbar();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(placeToolbar);
    if (body.current) observer?.observe(body.current);
    if (currentLine.current) observer?.observe(currentLine.current);
    const scrollbox = preview.current;
    scrollbox?.addEventListener('scroll', placeToolbar);
    window.addEventListener('resize', placeToolbar);
    return () => {
      observer?.disconnect();
      scrollbox?.removeEventListener('scroll', placeToolbar);
      window.removeEventListener('resize', placeToolbar);
    };
  }, [activeLine, data.text, data.fontSize]);

  const openLibrary = (fromEditor: boolean) => {
    const base = activeLine === null ? data.text.length : lines.slice(0, activeLine).reduce((total, line) => total + line.length + 1, 0);
    insertion.current = {
      start: fromEditor ? base + (textarea.current?.selectionStart ?? lines[activeLine ?? 0].length) : data.text.length,
      end: fromEditor ? base + (textarea.current?.selectionEnd ?? lines[activeLine ?? 0].length) : data.text.length,
      fromEditor,
    };
    setActiveLine(null);
    setPicking(true);
  };
  const closeLibrary = (nextText = data.text) => {
    setPicking(false);
    if (insertion.current?.fromEditor) {
      const start = sourcePosition(nextText, insertion.current.start);
      const end = sourcePosition(nextText, insertion.current.end);
      selection.current = { line: start.line, start: start.column, end: end.line === start.line ? end.column : start.column };
      setActiveLine(start.line);
    }
    insertion.current = null;
  };
  const addEntity = (entity: PaperLibraryEntity) => {
    const at = insertion.current ?? { start: data.text.length, end: data.text.length, fromEditor: false };
    const prefix = !at.fromEditor && data.text && !data.text.endsWith('\n') ? '\n' : '';
    const token = prefix + paperEntityToken(entity);
    const nextText = data.text.slice(0, at.start) + token + data.text.slice(at.end);
    change({ text: nextText });
    insertion.current = { ...at, start: at.start + token.length, end: at.start + token.length };
    closeLibrary(nextText);
  };
  const insert = (text: string) => {
    if (activeLine === null) return;
    const element = textarea.current;
    const line = lines[activeLine];
    const start = element?.selectionStart ?? line.length;
    const end = element?.selectionEnd ?? start;
    const nextText = line.slice(0, start) + text + line.slice(end);
    if (nextText === line) {
      selection.current = null;
      element?.focus({ preventScroll: true });
      element?.setSelectionRange(start + text.length, start + text.length);
      return;
    }
    editLine(activeLine, nextText, start + text.length);
  };
  const format = (marker: string) => {
    if (activeLine === null) return;
    const element = textarea.current;
    const start = element?.selectionStart ?? lines[activeLine].length;
    const end = element?.selectionEnd ?? start;
    insert(`${marker}${lines[activeLine].slice(start, end) || 'текст'}${marker}`);
  };
  const moveLine = (index: number, column: number) => {
    const nextColumn = Math.min(column, lines[index].length);
    selection.current = { line: index, start: nextColumn, end: nextColumn };
    setActiveLine(index);
  };
  const handleEditorKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      format(event.key.toLowerCase() === 'b' ? '**' : '_');
      return;
    }
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      editLine(index, lines[index].slice(0, start) + '\n' + lines[index].slice(end), start + 1);
    } else if (event.key === 'Backspace' && start === 0 && end === 0 && index > 0) {
      event.preventDefault();
      const previousLength = lines[index - 1].length;
      selection.current = { line: index - 1, start: previousLength, end: previousLength };
      setActiveLine(index - 1);
      setDoc(current => {
        const old = current.sections[section] ?? { text: '', fontSize: 12 };
        const nextLines = old.text.split('\n');
        nextLines.splice(index - 1, 2, nextLines[index - 1] + nextLines[index]);
        return { ...current, sections: { ...current.sections, [section]: { ...old, text: nextLines.join('\n') } } };
      });
    } else if (event.key === 'Delete' && start === lines[index].length && end === start && index < lines.length - 1) {
      event.preventDefault();
      selection.current = { line: index, start, end: start };
      setDoc(current => {
        const old = current.sections[section] ?? { text: '', fontSize: 12 };
        const nextLines = old.text.split('\n');
        nextLines.splice(index, 2, nextLines[index] + nextLines[index + 1]);
        return { ...current, sections: { ...current.sections, [section]: { ...old, text: nextLines.join('\n') } } };
      });
    } else if (event.key === 'ArrowUp' && index > 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      moveLine(index - 1, start);
    } else if (event.key === 'ArrowDown' && index < lines.length - 1 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      moveLine(index + 1, start);
    }
  };
  const clickColumn = (element: HTMLElement, raw: string, x: number, y: number) => {
    if (/\[\[|\{\{|\*\*|~~|_/.test(raw)) return raw.length;
    const caret = document.caretPositionFromPoint?.(x, y);
    if (!caret || !element.contains(caret.offsetNode)) return raw.length;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(caret.offsetNode, caret.offset);
    return Math.min(raw.length, range.toString().length);
  };

  return <section ref={note} data-note-section={section} className={`ps-frame ps-note ${editing ? 'ps-note-editing' : ''} ${className}`}
    onKeyDown={event => { if (editing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishEditing(); } }}>
    <div className="ps-heading ps-note-heading"><input aria-label={`Заголовок: ${heading}`} value={doc.fields[`heading.${section}`] ?? heading} onChange={event => setField(`heading.${section}`, event.target.value)} />
      <button type="button" className="ps-note-library" aria-label={`Добавить из библиотеки: ${heading}`} onClick={() => openLibrary(editing)}><BookOpen size={12} /></button>
      <button type="button" aria-label={`Редактировать: ${heading}`} onClick={() => activate(0)}><Pencil size={12} fill="currentColor" /></button></div>
    <div ref={body} className={`ps-note-body ${doc.settings.grid ? 'ps-grid' : ''}`} style={{ fontSize: data.fontSize }}>
      <div ref={preview} className="ps-note-text" tabIndex={0} role="textbox" aria-label={heading} aria-multiline="true"
        onClick={event => { if (event.target === event.currentTarget) activate(lines.length - 1); }}
        onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(0); } }}>
        {lines.map((line, index) => <div key={index} ref={index === activeLine ? currentLine : undefined}
          className={`ps-note-line ${index === activeLine ? 'ps-note-line-active' : ''} ${/\[\[|\{\{/.test(line) ? 'ps-note-line-token' : ''}`}
          onClick={event => { if (index !== activeLine && !(event.target as HTMLElement).closest('button')) activate(index, clickColumn(event.currentTarget, line, event.clientX, event.clientY)); }}>
          {index === activeLine ? <>
            <div className="ps-note-line-print" aria-hidden="true"><NoteText text={line} onChange={text => replaceLine(index, text)} /></div>
            <div className="ps-note-line-measure" aria-hidden="true">{line || '\u200b'}</div>
            <textarea ref={textarea} className="ps-inline-textarea" rows={1} aria-label={`Текст: ${heading}, строка ${index + 1}`}
              value={line} onChange={event => editLine(index, event.target.value, event.target.selectionStart)} onKeyDown={event => handleEditorKey(event, index)} />
          </> : <NoteText text={line} onChange={text => replaceLine(index, text)} />}
        </div>)}
      </div>
      {editing && <div className="ps-inline-tools" style={{ top: toolbarTop }} role="group" aria-label={`Редактирование: ${heading}`}>
        <div className="ps-editor-tools"><button type="button" aria-label="Полужирный текст" onClick={() => format('**')}><b>Ж</b></button><button type="button" aria-label="Курсив" onClick={() => format('_')}><i>К</i></button><button type="button" aria-label="Зачёркнутый текст" onClick={() => format('~~')}><s>А</s></button><button type="button" aria-label="Маркированный список" onClick={() => insert('\n• ')}>☷</button><button type="button" onClick={() => insert('{{8 + [PROF] + [WIS]}}')}>ƒ Формула</button><button type="button" aria-expanded={resourceOpen} onClick={() => setResourceOpen(!resourceOpen)}>＋ Ресурс</button><button type="button" onClick={() => openLibrary(true)}><BookOpen size={12} /> Из библиотеки</button><button type="button" onClick={finishEditing}>Готово</button></div>
        {resourceOpen && <div className="ps-resource-editor"><input aria-label="Название ресурса" value={resourceName} onChange={event => setResourceName(event.target.value)} /><input aria-label="Максимум ресурса" type="number" min="0" value={resourceMax} onChange={event => setResourceMax(event.target.value)} /><button type="button" onClick={() => { const count = Math.max(0, Number(resourceMax) || 0); insert(`{{ресурс:${resourceName.replace(/[|{}]/g, '')}|${count}|${count}}}`); setResourceOpen(false); }}>Вставить</button></div>}
      </div>}
    </div>
    {children && <div className="ps-note-footer">{children}</div>}
    <div className="ps-font-controls"><button type="button" aria-label={`Увеличить шрифт: ${heading}`} disabled={data.fontSize >= 26} onClick={() => change({ fontSize: Math.min(26, data.fontSize + 1) })}>+</button><button type="button" aria-label={`Уменьшить шрифт: ${heading}`} disabled={data.fontSize <= 8} onClick={() => change({ fontSize: Math.max(8, data.fontSize - 1) })}>−</button></div>
    {picking && <LibraryPicker initialType={section === 'attacks' ? 'spell' : 'card'} onSelect={addEntity} onClose={() => closeLibrary()} />}
  </section>;
}
