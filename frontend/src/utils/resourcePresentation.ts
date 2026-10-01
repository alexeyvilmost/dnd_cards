import type {EntitySupportCertification} from '../content/supportStatus';
import { getAllCharges } from './charges';
import catalog from '../engine/data/resources.json';

export type ResourceOption = {
  id: string;
  entityId?: string;
  label: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  imageUrlSpent?: string;
  recharge?: string;
  sortOrder?: number;
  support?: EntitySupportCertification | null;
};

const declaredResourceOptions: ResourceOption[] = catalog.resources.map(resource => ({
  id: resource.resource_id,
  label: resource.name,
  description: 'description' in resource ? resource.description : undefined,
  category: resource.category,
  imageUrl: 'image_url' in resource ? resource.image_url : undefined,
  recharge: 'recharge' in resource ? resource.recharge : undefined,
  sortOrder: resource.sort_order,
}));

export const staticResourceOptions = (): ResourceOption[] => [
  ...declaredResourceOptions,
  ...getAllCharges().filter(charge => !declaredResourceOptions.some(resource => resource.id === charge.id)).map((charge, index) => ({
    id: charge.id,
    label: charge.russian_name,
    description: charge.description,
    category: 'class_resource',
    imageUrl: `/charges/${charge.image}`,
    recharge: charge.cooldown,
    sortOrder: 1000 + index,
  })),
];


export function mergeResources(resources: ResourceOption[]): ResourceOption[] {
  const map = new Map<string, ResourceOption>();
  for (const res of staticResourceOptions()) map.set(res.id, res);
  for (const res of resources) map.set(res.id, { ...map.get(res.id), ...res });
  return [...map.values()].sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.label.localeCompare(b.label));
}


export function findResource(resources: ResourceOption[], id?: string | null): ResourceOption | undefined {
  if (!id) return undefined;
  return resources.find((resource) => resource.id === id) || staticResourceOptions().find((resource) => resource.id === id);
}

export function resourceLabel(resources: ResourceOption[], id?: string | null): string {
  const declared = findResource(resources, id);
  if (declared) return declared.label;
  // Compatibility labels only for archived content without a catalog declaration.
  const hitDice = /^hit_dice_d(\d+)$/u.exec(id ?? '');
  if (hitDice) return findResource(resources, id)?.label || `Кости хитов (к${hitDice[1]})`;
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
  const declared = resources.find(resource => resource.id === id);
  if (declared?.imageUrl && !declared.imageUrl.startsWith('/charges/')) return declared.imageUrl;
  if (id && COST_ICON_MAP[id]) return `/icons/resources/${COST_ICON_MAP[id]}.png`;
  const found = findResource(resources, id);
  if (found?.imageUrl && !found.imageUrl.startsWith('/charges/')) return found.imageUrl;
  return '/icons/resources/action.png';
}

export function registryItems(resources: ResourceOption[]) {
  return resources.map((resource) => ({ id: resource.id, label: resource.label }));
}

/** Catalog categories own the grouping. Schema-key fallbacks retain the same
 * order for archived slot/free-use pools before their catalog definition loads. */
export function resourceDisplayGroup(key: string, resources: ResourceOption[]): 'main' | 'spellcasting' | 'other' {
  const category = findResource(resources, key)?.category;
  if (category === 'spellcasting_resource' || category === 'spell_slot'
    || /^(?:spell_slot|pact_slot|warlock_spell_slot)(?:_[1-9])?$/.test(key)
    || key.startsWith('freeuse-')) return 'spellcasting';
  if (category === 'action_cost') return 'main';
  return 'other';
}

export function resourceDisplayOrder(key: string, resources: ResourceOption[]): number {
  const group = resourceDisplayGroup(key, resources);
  const definition = findResource(resources, key);
  const slot = /^(spell_slot|pact_slot|warlock_spell_slot)(?:_([1-9]))?$/.exec(key);
  const fallback = slot ? (slot[1] === 'spell_slot' ? 100 : 200) + Number(slot[2] ?? 0)
    : key.startsWith('freeuse-') ? 300 : 89999;
  const order = Math.max(0, Math.min(definition?.sortOrder ?? fallback, 999999));
  return (group === 'main' ? 0 : group === 'spellcasting' ? 1000000 : 2000000) + order;
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
