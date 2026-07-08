import { useEffect, useMemo, useState } from 'react';
import { resourcesApi } from '../api/client';
import type { ResourceDefinition } from '../types';
import { getAllCharges } from './charges';

export type ResourceOption = {
  id: string;
  label: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  imageUrlSpent?: string;
  recharge?: string;
  sortOrder?: number;
};

const actionDefaults: ResourceOption[] = [
  { id: 'action', label: 'Действие', description: 'Основное действие в ход.', category: 'action_cost', imageUrl: '/charges/main_action.png', sortOrder: 10 },
  { id: 'main_action', label: 'Основное действие', description: 'Основное действие в ход.', category: 'action_cost', imageUrl: '/charges/main_action.png', sortOrder: 11 },
  { id: 'bonus_action', label: 'Бонусное действие', description: 'Бонусное действие в ход.', category: 'action_cost', imageUrl: '/charges/bonus_action.png', sortOrder: 20 },
  { id: 'reaction', label: 'Реакция', description: 'Ответное действие.', category: 'action_cost', imageUrl: '/charges/reaction_action.png', sortOrder: 30 },
  { id: 'free_action', label: 'Свободное действие', description: 'Не тратит основной ресурс действия.', category: 'action_cost', imageUrl: '/charges/free_action.png', sortOrder: 40 },
];

export const staticResourceOptions = (): ResourceOption[] => [
  ...actionDefaults,
  ...getAllCharges().map((charge, index) => ({
    id: charge.id,
    label: charge.russian_name,
    description: charge.description,
    category: 'class_resource',
    imageUrl: `/charges/${charge.image}`,
    recharge: charge.cooldown,
    sortOrder: 1000 + index,
  })),
];

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

export function mergeResources(resources: ResourceOption[]): ResourceOption[] {
  const map = new Map<string, ResourceOption>();
  for (const res of staticResourceOptions()) map.set(res.id, res);
  for (const res of resources) map.set(res.id, { ...map.get(res.id), ...res });
  return [...map.values()].sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.label.localeCompare(b.label));
}

export function useResourceOptions() {
  const [dbResources, setDbResources] = useState<ResourceOption[]>([]);
  useEffect(() => {
    let stale = false;
    resourcesApi.getResources()
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

export function findResource(resources: ResourceOption[], id?: string | null): ResourceOption | undefined {
  if (!id) return undefined;
  return resources.find((resource) => resource.id === id) || staticResourceOptions().find((resource) => resource.id === id);
}

export function resourceLabel(resources: ResourceOption[], id?: string | null): string {
  return findResource(resources, id)?.label || id || '';
}

export function resourceIcon(resources: ResourceOption[], id?: string | null): string {
  return findResource(resources, id)?.imageUrl || '/charges/main_action.png';
}

// Иконки стоимости для нижней плашки карточек (действия/заклинания).
// Каталог /charges/ пуст — известные ресурсы стоимости отображаем реальными
// иконками из /icons/resources/, для остальных берём image_url ресурса.
const COST_ICON_MAP: Record<string, string> = {
  action: 'action',
  main_action: 'action',
  bonus_action: 'bonus_action',
  reaction: 'reaction',
  free_action: 'action',
  ritual: 'ritual',
  spell_slot: 'spell_slot',
  warlock_spell_slot: 'warlock_spell_slot',
};

export function resourceCostIcon(resources: ResourceOption[], id?: string | null): string {
  if (id && COST_ICON_MAP[id]) return `/icons/resources/${COST_ICON_MAP[id]}.png`;
  const found = findResource(resources, id);
  if (found?.imageUrl && !found.imageUrl.startsWith('/charges/')) return found.imageUrl;
  return '/icons/resources/action.png';
}

export function registryItems(resources: ResourceOption[]) {
  return resources.map((resource) => ({ id: resource.id, label: resource.label }));
}

/** Ресурсы-СТОИМОСТЬ действия для отображения. Единый источник правды — mechanics.activation.cost
 *  (что реально списывает движок). Откат на устаревшие resources/resource только если стоимости
 *  в механике нет (легаси-действия). spell_slot с уровнем → ключ ячейки конкретного круга. */
export function actionCostResourceIds(action: {
  resources?: string[] | null;
  resource?: string | null;
  mechanics?: Record<string, unknown> | null;
}): string[] {
  const activation = (action.mechanics as Record<string, unknown> | null | undefined)?.activation as Record<string, unknown> | undefined;
  const cost = Array.isArray(activation?.cost) ? (activation!.cost as Record<string, unknown>[]) : [];
  if (cost.length) {
    return cost
      .map((c) => {
        const r = String(c.resource ?? '');
        return r === 'spell_slot' && c.level != null ? `spell_slot_${c.level}` : r;
      })
      .filter(Boolean);
  }
  if (Array.isArray(action.resources) && action.resources.length) return action.resources;
  return action.resource ? [String(action.resource)] : [];
}
