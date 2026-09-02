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
  { id: 'giant_legacy', label: 'Наследие великанов', description: 'Заряд наследия голиафа.', category: 'species_resource', sortOrder: 50 },
  { id: 'rage', label: 'Ярость', description: 'Использования Ярости варвара.', category: 'class_resource', sortOrder: 100 },
  { id: 'rage_charge', label: 'Ярость', description: 'Использования Ярости варвара.', category: 'class_resource', sortOrder: 101 },
  { id: 'bardic_inspiration', label: 'Бардовское вдохновение', description: 'Кости Бардовского вдохновения.', category: 'class_resource', sortOrder: 110 },
  { id: 'channel_divinity', label: 'Божественный канал', description: 'Использования Божественного канала.', category: 'class_resource', sortOrder: 120 },
  { id: 'wild_shape', label: 'Дикий облик', description: 'Использования Дикого облика.', category: 'class_resource', sortOrder: 130 },
  { id: 'focus', label: 'Очки фокусировки', description: 'Очки Фокуса монаха.', category: 'class_resource', sortOrder: 140 },
  { id: 'sorcery_points', label: 'Очки чародейства', description: 'Очки чародейства для Метамагии и Магического источника.', category: 'class_resource', sortOrder: 150 },
  { id: 'second_wind', label: 'Второе дыхание', description: 'Использования Второго дыхания воина.', category: 'class_resource', sortOrder: 160 },
  { id: 'action_surge', label: 'Всплеск действий', description: 'Использования Всплеска действий воина.', category: 'class_resource', sortOrder: 170 },
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

export function findResource(resources: ResourceOption[], id?: string | null): ResourceOption | undefined {
  if (!id) return undefined;
  return resources.find((resource) => resource.id === id) || staticResourceOptions().find((resource) => resource.id === id);
}

export function resourceLabel(resources: ResourceOption[], id?: string | null): string {
  const spellSlot = /^spell_slot_([1-9])$/u.exec(id ?? '');
  if (spellSlot) return `Ячейка ${spellSlot[1]}-го круга`;
  const pactSlot = /^(?:pact_slot|warlock_spell_slot)_?([1-9])?$/u.exec(id ?? '');
  if (pactSlot) return pactSlot[1]
    ? `Ячейка Магии договора ${pactSlot[1]}-го круга`
    : 'Ячейка Магии договора';
  if (id === 'self_uses') return 'Заряд способности';
  if (id?.startsWith('uses_')) return 'Заряд способности';
  if (id === 'self_item') return 'Использование предмета';
  if (id === 'equipped_weapon_ammo') return 'Боеприпас оружия';
  if (id?.startsWith('freeuse-')) return 'Бесплатное применение заклинания';
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
