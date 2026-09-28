import { apiClient } from './client';
import { bustPrefix } from './apiCache';
import type { TaggedEntityType } from './entityTags';
import type { EntityReviewStatus, EntitySupportCertification } from '../content/supportStatus';

export const REVIEW_STATUS_CHANGED = 'entity-review-status-changed';
export interface ReviewStatusChange {
  entity_type: TaggedEntityType;
  entity_id: string;
  support: EntitySupportCertification;
}

export async function updateReviewStatus(type: TaggedEntityType, id: string, status: EntityReviewStatus) {
  const { data } = await apiClient.patch<ReviewStatusChange>(
    `/api/content-review/${type}/${encodeURIComponent(id)}`, { status },
  );
  bustPrefix('/api/');
  window.dispatchEvent(new CustomEvent<ReviewStatusChange>(REVIEW_STATUS_CHANGED, { detail: data }));
  return data.support;
}
