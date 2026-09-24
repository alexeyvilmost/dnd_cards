import { useEffect, useState } from 'react';
import { entityTagsApi, tagError } from '../../api/entityTags';
import LibraryTagControl from './LibraryTagControl';

export function useLibrarySelection(identity: string | null, scope: string) {
  const [authorizedIdentity, setAuthorizedIdentity] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const canManage = identity !== null && authorizedIdentity === identity;
  useEffect(() => {
    let active = true;
    setAuthorizedIdentity(null);
    setEnabled(false);
    setSelected(new Set());
    if (identity) void entityTagsApi.list().then(catalog => {
      if (active && catalog.can_manage) setAuthorizedIdentity(identity);
    }).catch(() => {});
    return () => { active = false; };
  }, [identity]);
  useEffect(() => { setSelected(new Set()); }, [scope]);
  const toggle = (id: string) => {
    if (!canManage || busy) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 500) next.add(id);
      return next;
    });
  };
  return { canManage, enabled: canManage && enabled, setEnabled, selected, setSelected, toggle, busy, setBusy };
}

export type LibrarySelection = ReturnType<typeof useLibrarySelection>;

export function LibrarySelectionCheckbox({ selection, id, name }: { selection: LibrarySelection; id: string; name: string }) {
  if (!selection.enabled) return null;
  return <label className="library-selection-checkbox" onClick={event => event.stopPropagation()}>
    <input type="checkbox" aria-label={`Выбрать: ${name}`} checked={selection.selected.has(id)}
      disabled={selection.busy} onChange={() => selection.toggle(id)} />
  </label>;
}

export default function LibraryBulkTags({ selection, visibleIDs }: { selection: LibrarySelection; visibleIDs: string[] }) {
  const [tag, setTag] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (!selection.canManage) return null;
  const apply = async (operation: 'add' | 'remove') => {
    if (!tag || !selection.selected.size || selection.busy) return;
    selection.setBusy(true); setError(''); setMessage('');
    try {
      await entityTagsApi.bulk('card', [...selection.selected], [tag], operation);
      setMessage(operation === 'add' ? 'Тег добавлен ко всем выбранным предметам.' : 'Тег снят со всех выбранных предметов.');
    } catch (reason) { setError(tagError(reason)); }
    finally { selection.setBusy(false); }
  };
  return <section className="library-bulk-tags library-chrome-panel" aria-label="Массовое изменение тегов">
    <button type="button" className="library-chrome-button" disabled={selection.busy} aria-pressed={selection.enabled} onClick={() => {
      selection.setEnabled(!selection.enabled); selection.setSelected(new Set()); setMessage(''); setError('');
    }}>{selection.enabled ? 'Завершить выбор' : 'Выбрать предметы'}</button>
    {selection.enabled && <>
      <span role="status" className="library-chrome-status">Выбрано: {selection.selected.size} / 500</span>
      <button type="button" className="library-chrome-button" disabled={selection.busy || !visibleIDs.length} onClick={() => selection.setSelected(new Set([...selection.selected, ...visibleIDs].slice(0, 500)))}>Выбрать загруженные</button>
      <button type="button" className="library-chrome-button" disabled={selection.busy || !selection.selected.size} onClick={() => selection.setSelected(new Set())}>Снять выбор</button>
      <LibraryTagControl value={tag} onChange={setTag} />
      <button type="button" className="library-chrome-button library-chrome-button--primary" disabled={selection.busy || !tag || !selection.selected.size} onClick={() => void apply('add')}>Добавить тег</button>
      <button type="button" className="library-chrome-button" disabled={selection.busy || !tag || !selection.selected.size} onClick={() => void apply('remove')}>Снять тег</button>
    </>}
    {message && <p role="status" className="library-chrome-status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
