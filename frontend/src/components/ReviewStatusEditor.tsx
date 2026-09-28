import { useEffect, useState } from 'react';
import type { TaggedEntityType } from '../api/entityTags';
import { updateReviewStatus } from '../api/contentReview';
import { ENTITY_SUPPORT_STATUSES, supportStatusPresentation, type EntityReviewStatus, type SupportableEntity } from '../content/supportStatus';
import { useReviewStatus } from '../content/useReviewStatus';
import { useContentPermissions } from '../hooks/useContentPermissions';
import { useEntityDetail } from '../contexts/entityDetail';
import { useSiteSettings } from '../settings';
import './reviewStatus.css';

export type ReviewableEntity = SupportableEntity & { type: TaggedEntityType; id: string; author?: string };

export default function ReviewStatusEditor({ entity }: { entity: ReviewableEntity }) {
  const { showReviewStatus } = useSiteSettings();
  const { canEdit } = useContentPermissions();
  const { readOnly } = useEntityDetail();
  const status = useReviewStatus(entity, entity.type);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [entity.type, entity.id]);
  if (!showReviewStatus) return null;
  const editable = !readOnly && canEdit(entity);
  const presentation = supportStatusPresentation(status);

  const save = async (next: EntityReviewStatus) => {
    if (!editable || busy || next === status) return;
    setBusy(true);
    setError('');
    try { await updateReviewStatus(entity.type, entity.id, next); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить статус проверки.'); }
    finally { setBusy(false); }
  };

  return <div className="review-status-editor">
    <label><span>Статус проверки</span>
      {editable ? <select aria-label="Статус проверки" value={status} disabled={busy}
        onChange={event => { void save(event.target.value as EntityReviewStatus); }}>
        {ENTITY_SUPPORT_STATUSES.map(value => <option key={value} value={value}>{supportStatusPresentation(value).label}</option>)}
      </select> : <span className="review-status-editor__value" style={{ borderLeftColor: presentation.color }}>{presentation.label}</span>}
    </label>
    {busy && <span role="status">Сохранение…</span>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
