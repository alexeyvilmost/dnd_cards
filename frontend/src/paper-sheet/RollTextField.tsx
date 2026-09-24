import { useId, useState } from 'react';
import { usePaperSheet } from './controls';
import { renderPaperRollText } from './rowAutofill';

/** A damage expression is displayed, not rolled; only explicit scalar tokens calculate. */
export function RollTextField({ field, label }: { field: string; label: string }) {
  const { doc, setField, equipment } = usePaperSheet();
  const [focused, setFocused] = useState(false);
  const errorId = useId();
  const source = doc.fields[field] ?? '';
  const rendered = renderPaperRollText(source, doc, equipment);
  return <span className={`ps-field ${rendered.error ? 'ps-field-invalid' : ''}`}>
    <input aria-label={label} autoComplete="off" spellCheck={false} value={focused ? source : rendered.text}
      aria-invalid={!!rendered.error} aria-describedby={focused && rendered.error ? errorId : undefined}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => setField(field, event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    {focused && rendered.error && <span id={errorId} className="ps-field-error" role="alert">{rendered.error}</span>}
  </span>;
}
