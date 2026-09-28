import { useEffect, useMemo, useState } from 'react';
import { resourcesApi } from '../api/client';
import { REVIEW_STATUS_CHANGED, type ReviewStatusChange } from '../api/contentReview';
import type { ResourceDefinition } from '../types';
import type { EntitySupportCertification } from '../content/supportStatus';
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
    const reviews = new Map<string, EntitySupportCertification>();
    const refresh = () => {
      return resourcesApi.getResources({ fields: 'list' })
      .then((response) => {
        if (!stale) setDbResources((response.resources || []).map(row =>
          fromApi(reviews.has(row.id) ? {...row,support:reviews.get(row.id)} : row)));
      })
      .catch(() => { /* Keep the last authoritative snapshot if a refresh fails. */ });
    };
    const onReviewChanged = (event: Event) => {
      const change = (event as CustomEvent<ReviewStatusChange>).detail;
      if (change?.entity_type !== 'resource') return;
      reviews.set(change.entity_id, change.support);
      setDbResources(rows => rows.map(row => row.entityId === change.entity_id ? {...row,support:change.support} : row));
    };
    void refresh();
    window.addEventListener(REVIEW_STATUS_CHANGED, onReviewChanged);
    return () => { stale = true; window.removeEventListener(REVIEW_STATUS_CHANGED, onReviewChanged); };
  }, []);
  return useMemo(() => mergeResources(dbResources), [dbResources]);
}
