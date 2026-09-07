import { useEffect, useMemo, useState } from 'react';
import { resourcesApi } from '../api/client';
import type { ResourceDefinition } from '../types';
import { mergeResources, type ResourceOption } from './resourcePresentation';
export * from './resourcePresentation';

const fromApi = (resource: ResourceDefinition): ResourceOption => ({
  id: resource.resource_id,
  label: resource.name,
  description: resource.description,
  category: resource.category,
  imageUrl: resource.image_url,
  imageUrlSpent: resource.image_url_spent,
  recharge: resource.recharge,
  sortOrder: resource.sort_order,
});


export function useResourceOptions() {
  const [dbResources, setDbResources] = useState<ResourceOption[]>([]);
  useEffect(() => {
    let stale = false;
    resourcesApi.getResources({ fields: 'list' })
      .then((response) => {
        if (!stale) setDbResources((response.resources || []).map(fromApi));
      })
      .catch(() => {
        if (!stale) setDbResources([]);
      });
    return () => { stale = true; };
  }, []);
  return useMemo(() => mergeResources(dbResources), [dbResources]);
}
