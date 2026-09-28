import { useEffect, useMemo, useState } from 'react';
import { resourcesApi } from '../api/client';
import { REVIEW_STATUS_CHANGED, type ReviewStatusChange } from '../api/contentReview';
import type { ResourceDefinition } from '../types';
import { mergeResources, type ResourceOption } from './resourcePresentation';
export * from './resourcePresentation';

const fromApi = (resource: ResourceDefinition): ResourceOption => ({
  id: resource.resource_id,
  entityId: resource.id,
  label: resource.name,
  description: resource.description,
  category: resource.category,
  imageUrl: resource.image_url,
  imageUrlSpent: resource.image_url_spent,
  recharge: resource.recharge,
  sortOrder: resource.sort_order,
  support: resource.support,
});


export function useResourceOptions() {
  const [dbResources, setDbResources] = useState<ResourceOption[]>([]);
  useEffect(() => {
    let stale = false;
    let revision = 0;
    const refresh = () => {
      const requestedRevision = ++revision;
      return resourcesApi.getResources({ fields: 'list' })
      .then((response) => {
        if (!stale && requestedRevision === revision) setDbResources((response.resources || []).map(fromApi));
      })
      .catch(() => { /* Keep the last authoritative snapshot if a refresh fails. */ });
    };
    const onReviewChanged = (event: Event) => {
      const change = (event as CustomEvent<ReviewStatusChange>).detail;
      if (change?.entity_type !== 'resource') return;
      setDbResources(rows => rows.map(row => row.entityId === change.entity_id ? {...row,support:change.support} : row));
      void refresh();
    };
    void refresh();
    window.addEventListener(REVIEW_STATUS_CHANGED, onReviewChanged);
    return () => { stale = true; window.removeEventListener(REVIEW_STATUS_CHANGED, onReviewChanged); };
  }, []);
  return useMemo(() => mergeResources(dbResources), [dbResources]);
}
