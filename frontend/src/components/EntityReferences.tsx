import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { subscribeApiCacheInvalidation } from '../api/apiCache';
import { cachedCatalogRead } from '../api/ownedItemCache';
import { entityReferencesApi, REFERENCE_KIND, REFERENCE_LABEL, referenceLabel, type EntityReference, type EntityReferences as ReferenceFields, type ReferenceEntityType } from '../api/entityReferences';
import { tagError } from '../api/entityTags';
import type { Action, Card, PassiveEffect, Spell } from '../types';
import { useSiteSettings } from '../settings';
import { useContentPermissions } from '../hooks/useContentPermissions';
import { useEntityDetail } from '../contexts/entityDetail';
import SheetActionLine from './SheetActionLine';
import SheetEntityRow from './SheetEntityRow';
import HoverCard from './HoverCard';
import CanonicalEntityPreview from './CanonicalEntityPreview';
import './EntityReferences.css';

export function loadReferenceEntity(type: ReferenceEntityType, id: string): Promise<Record<string, unknown> | undefined> {
  if (type === 'passive') return cachedCatalogRead('/api/passive-presentations', 60_000,
    async () => (await apiClient.get<{ passives: { key: string }[] }>('/api/passive-presentations')).data)
    .then(data => data.passives.find(row => row.key === id));
  const path = `/api/${REFERENCE_KIND[type]}/${encodeURIComponent(id)}`;
  const fetch = async () => (await apiClient.get<Record<string, unknown>>(path)).data;
  // Same entity at different progression levels shares a request; reference
  // metadata in every catalog is scoped to the authenticated identity.
  return cachedCatalogRead(path, 60_000, fetch);
}

const REFERENCE_PREFIXES = [...Object.values(REFERENCE_KIND).map(kind => `/api/${kind}`), '/api/passive-presentations', '/api/entity-references'];

export function ReferenceItem({ reference, onNavigate, compact = false }: { reference: EntityReference; onNavigate?: () => void; compact?: boolean }) {
  const { entity_type: type, entity_id: id } = reference;
  const [entity, setEntity] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  const { entityDisplay } = useSiteSettings();
  const navigate = useNavigate();
  useEffect(() => {
    let live = true;
    setEntity(null); setFailed(false);
    if (reference.missing) { setFailed(true); return; }
    const request = loadReferenceEntity(type, id);
    void request.then(value => { if (live) { setEntity(value || null); setFailed(!value); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [type, id, reference.missing]);
  const name = String(entity?.name || reference.name || id);
  const detail = `${REFERENCE_LABEL[type]}${reference.level != null ? ` · уровень ${reference.level}` : ''}`;
  const open = () => { onNavigate?.(); navigate(`/entity/${REFERENCE_KIND[type]}/${encodeURIComponent(id)}`); };
  if (!entity) return <div className="entity-references__pending">{referenceLabel(reference)}<small>{failed ? 'Сущность не найдена' : 'Загрузка…'}</small></div>;
  const shared = { name, imageUrl: String(entity.image_url || entity.token_url || ''), detail, onActivate: open };
  return <div className="entity-references__item">
    {type === 'card' ? <SheetActionLine {...shared} itemRef={entity as unknown as Card} variant={entityDisplay.items} />
      : type === 'action' ? <SheetActionLine {...shared} actionRef={entity as unknown as Action} variant={entityDisplay.actions} />
      : type === 'effect' ? <SheetActionLine {...shared} effectRef={entity as unknown as PassiveEffect} variant={entityDisplay.effects} />
      : type === 'spell' ? <SheetActionLine {...shared} spellRef={entity as unknown as Spell} variant={entityDisplay.spells} level={Number(entity.level)} />
      : <HoverCard content={<CanonicalEntityPreview kind={REFERENCE_KIND[type]} entity={entity} />}>
        <SheetEntityRow name={name} imageUrl={shared.imageUrl} detail={detail} onClick={open} />
      </HoverCard>}
    {!compact && reference.level != null && ['card', 'action', 'effect', 'spell'].includes(type) && <small>Уровень {reference.level}</small>}
    {!compact && reference.paths.length > 0 && <details className="entity-references__paths"><summary>Поля механики</summary><ul>{reference.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul></details>}
  </div>;
}

/** Both directions come from the backend mechanic index, including draft previews. */
export default function EntityReferences({ type, id, draft, author, onNavigate }: {
  type: ReferenceEntityType; id?: string | null; draft?: object; author?: string; onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ReferenceFields | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const { canEdit } = useContentPermissions();
  const { readOnly } = useEntityDetail();
  const draftJSON = draft === undefined ? undefined : JSON.stringify(draft);
  useEffect(() => {
    if (!open) return;
    return subscribeApiCacheInvalidation(({ prefix }) => {
      if (prefix === null || REFERENCE_PREFIXES.some(path => path.startsWith(prefix) || prefix.startsWith(path))) setRevision(value => value + 1);
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true); setError(''); setFields(null);
    const timer = window.setTimeout(() => {
      const request = draftJSON !== undefined
        ? entityReferencesApi.preview(type, { ...JSON.parse(draftJSON), ...(id ? { id } : {}) })
        : id ? entityReferencesApi.get(type, id) : Promise.resolve({ references: [], referenced_by: [] });
      void request.then(value => { if (live) setFields(value); })
        .catch(reason => { if (live) setError(tagError(reason)); })
        .finally(() => { if (live) setBusy(false); });
    }, draftJSON !== undefined ? 350 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [type, id, draftJSON, open, revision]);
  return <details className="entity-references" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Связи механик</summary>
    <p>Связи вычисляются из полей механик. Текстовые ссылки не учитываются. Измените механику и сохраните сущность, чтобы обновить связи.</p>
    {draft && <p>Исходящие связи показаны для текущего черновика; входящие — для сохранённых сущностей.</p>}
    {busy && <p role="status">Обновление связей…</p>}
    {error && <p role="alert">{error}</p>}
    {open && fields && <div className="entity-references__directions">{([
      ['references', 'Ссылается на'], ['referenced_by', 'На неё ссылаются'],
    ] as const).map(([field, label]) => <section key={field} aria-label={label}>
      <h3>{label} · {fields[field]?.length || 0}</h3>
      {fields[field]?.length ? <div className="entity-references__list">{fields[field]!.map(ref => <ReferenceItem key={`${ref.entity_type}:${ref.entity_id}:${ref.level ?? ''}`} reference={ref} onNavigate={onNavigate} />)}</div> : <p>Нет связей</p>}
    </section>)}</div>}
    {id && !readOnly && canEdit({ author }) && <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { const saved = await entityReferencesApi.refresh(type, id); if (!draft) setFields(saved); }
      catch (reason) { setError(tagError(reason)); }
      finally { setBusy(false); }
    }}>Пересчитать сохранённые связи</button>}
  </details>;
}
