import { useEffect, useState } from 'react';
import { REVIEW_STATUS_CHANGED, type ReviewStatusChange } from '../api/contentReview';
import type { TaggedEntityType } from '../api/entityTags';
import { supportStatusOf, type EntitySupportCertification, type SupportableEntity } from './supportStatus';

/** Open previews update as soon as the authoritative status save succeeds. */
export function useReviewStatus(
  entity: (SupportableEntity & { id?: string; key?: string }) | null | undefined,
  entityType?: TaggedEntityType,
) {
  const [updated, setUpdated] = useState<EntitySupportCertification | undefined>();
  const id = entity?.id ?? entity?.key;
  const kind = entityType ?? (entity?.key ? 'passive' : undefined);
  useEffect(() => { setUpdated(undefined); }, [id, kind, entity?.support]);
  useEffect(() => {
    const onChange = (event: Event) => {
      const change = (event as CustomEvent<ReviewStatusChange>).detail;
      if (id && change?.entity_id === id && (!kind || change.entity_type === kind)) setUpdated(change.support);
    };
    window.addEventListener(REVIEW_STATUS_CHANGED, onChange);
    return () => window.removeEventListener(REVIEW_STATUS_CHANGED, onChange);
  }, [id, kind]);
  return supportStatusOf(updated ? { support: updated } : entity);
}
