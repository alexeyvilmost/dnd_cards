import {useState} from 'react';

/** Selectable, searchable source. Never emits changes to the certified mechanic. */
export default function LockedMechanicsViewer({value}: {value: unknown}) {
  const [query, setQuery] = useState('');
  const json = JSON.stringify(value ?? null, null, 2);
  const matches = query ? json.split('\n').filter(line => line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : [];
  return <section className="space-y-3">
    <p role="status">Механика закреплена. JSON доступен для изучения и копирования; название, текст и изображение можно менять.</p>
    <label className="block">Найти в механике
      <input className="w-full border rounded p-2" value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    {query && <pre className="overflow-auto text-sm" aria-live="polite">{matches.length ? matches.join('\n') : 'Совпадений нет'}</pre>}
    <textarea aria-label="JSON механики (только чтение)" readOnly spellCheck={false} value={json}
      className="w-full rounded border p-3 font-mono text-sm" style={{minHeight: 420, tabSize: 2}} />
  </section>;
}
