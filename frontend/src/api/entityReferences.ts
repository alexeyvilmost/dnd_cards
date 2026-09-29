import { apiClient } from './client';
import { bustPrefix } from './apiCache';
import type { TaggedEntityType } from './entityTags';
export { withoutEntityReferences } from '../utils/entityReferenceMetadata';

export type ReferenceEntityType = TaggedEntityType;
export interface EntityReference {
  entity_type: ReferenceEntityType;
  entity_id: string;
  name?: string;
  level?: number;
  paths: string[];
  missing?: boolean;
}
export interface EntityReferences {
  references?: EntityReference[];
  referenced_by?: EntityReference[];
}
export const REFERENCE_KIND: Record<ReferenceEntityType, string> = {
  card: 'cards', action: 'actions', effect: 'effects', spell: 'spells', feat: 'feats',
  background: 'backgrounds', race: 'races', class: 'classes', resource: 'resources',
  variable: 'variables', concept: 'concepts', monster: 'monsters', passive: 'passives',
};
export const REFERENCE_LABEL: Record<ReferenceEntityType, string> = {
  card: 'Предмет', action: 'Действие', effect: 'Эффект', spell: 'Заклинание', feat: 'Черта',
  background: 'Предыстория', race: 'Вид', class: 'Класс', resource: 'Ресурс',
  variable: 'Переменная', concept: 'Понятие', monster: 'Монстр', passive: 'Пассив',
};
export const entityReferencesApi = {
  get: async (type: ReferenceEntityType, id: string): Promise<EntityReferences> =>
    (await apiClient.get(`/api/entity-references/${type}/${encodeURIComponent(id)}`)).data,
  preview: async (type: ReferenceEntityType, entity: object): Promise<EntityReferences> =>
    (await apiClient.post(`/api/entity-references/${type}/preview`, { entity })).data,
  refresh: async (type: ReferenceEntityType, id: string): Promise<EntityReferences> => {
    const { data } = await apiClient.post(`/api/entity-references/${type}/${encodeURIComponent(id)}/refresh`);
    bustPrefix('/api/');
    return data;
  },
};

export function referenceLabel(ref: EntityReference): string {
  return `${ref.name || ref.entity_id}${ref.level != null ? ` · уровень ${ref.level}` : ''}`;
}

export function referenceSummary(entity: EntityReferences): string {
  const sources = entity.referenced_by || [];
  if (!sources.length) return 'Нет входящих связей';
  const visible = sources.slice(0, 3).map(referenceLabel).join('; ');
  return `Используется: ${visible}${sources.length > 3 ? `; ещё ${sources.length - 3}` : ''}`;
}
