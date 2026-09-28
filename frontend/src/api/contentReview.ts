import { apiClient } from './client';
import { patchCachedValues } from './apiCache';
import type { TaggedEntityType } from './entityTags';
import type { EntityReviewStatus, EntitySupportCertification } from '../content/supportStatus';

export const REVIEW_STATUS_CHANGED = 'entity-review-status-changed';
export interface ReviewStatusChange {
  entity_type: TaggedEntityType;
  entity_id: string;
  support: EntitySupportCertification;
}

const CATALOGS: Record<TaggedEntityType, string> = {
  card: 'cards', action: 'actions', effect: 'effects', spell: 'spells', feat: 'feats',
  background: 'backgrounds', race: 'races', class: 'classes', resource: 'resources',
  variable: 'variables', concept: 'concepts', monster: 'monsters', passive: 'passive-presentations',
};

/** Patch only the saved entity, preserving other fields and list membership. */
function patchReviewResponse(value: unknown, change: ReviewStatusChange): unknown {
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  const identity = change.entity_type === 'passive' ? row.key : row.id;
  if (identity === change.entity_id) return { ...row, support: change.support };
  const collection = change.entity_type === 'passive' ? 'passives' : CATALOGS[change.entity_type];
  if (Array.isArray(row[collection])) return {
    ...row, [collection]: row[collection].map(item => patchReviewResponse(item, change)),
  };
  return value;
}

/** Uncached catalog reads retain reviews saved while their response was in flight. */
export async function readWithReviewUpdates<T>(type: TaggedEntityType, read: () => Promise<T>): Promise<T> {
  const changes: ReviewStatusChange[] = [];
  const onChange = (event: Event) => {
    const change = (event as CustomEvent<ReviewStatusChange>).detail;
    if (change?.entity_type === type) changes.push(change);
  };
  window.addEventListener(REVIEW_STATUS_CHANGED, onChange);
  try {
    const value = await read();
    return changes.reduce((current, change) => patchReviewResponse(current, change), value as unknown) as T;
  } finally { window.removeEventListener(REVIEW_STATUS_CHANGED, onChange); }
}

export async function updateReviewStatus(type: TaggedEntityType, id: string, status: EntityReviewStatus) {
  const { data } = await apiClient.patch<ReviewStatusChange>(
    `/api/content-review/${type}/${encodeURIComponent(id)}`, { status },
  );
  patchCachedValues(`/api/${CATALOGS[data.entity_type]}`, value => patchReviewResponse(value, data));
  window.dispatchEvent(new CustomEvent<ReviewStatusChange>(REVIEW_STATUS_CHANGED, { detail: data }));
  return data.support;
}
