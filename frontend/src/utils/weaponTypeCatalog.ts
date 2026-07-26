/**
 * Каталог видов оружия + иконки из шаблонов библиотеки (для UI искусности).
 */
import { useEffect, useState } from 'react';
import { cardsApi } from '../api/client';
import weaponTypesData from '../../utils/weapon_types.json';
import type { Card } from '../types';

export type WeaponTypeOption = {
  id: string;
  label: string;
  groupId: string;
  groupLabel: string;
};

export type WeaponTypeGroup = {
  id: string;
  label: string;
  weapons: WeaponTypeOption[];
};

type RawGroup = {
  name?: string;
  russian_name?: string;
  weapons?: Array<{ name: string; russian_name: string }>;
};

/** Группы видов оружия из общего справочника utils/weapon_types.json. */
export function weaponTypeGroups(): WeaponTypeGroup[] {
  return ((weaponTypesData as { basic?: RawGroup[] }).basic ?? []).map((group) => {
    const groupId = String(group.name ?? '');
    const groupLabel = String(group.russian_name ?? groupId);
    return {
      id: groupId,
      label: groupLabel,
      weapons: (group.weapons ?? []).map((w) => ({
        id: w.name,
        label: w.russian_name,
        groupId,
        groupLabel,
      })),
    };
  });
}

export function allWeaponTypeOptions(): WeaponTypeOption[] {
  return weaponTypeGroups().flatMap((g) => g.weapons);
}

let templateCache: Map<string, Card> | null = null;
let templateInflight: Promise<Map<string, Card>> | null = null;

/** Шаблоны оружия, проиндексированные по card.weapon_type. */
export function loadWeaponTemplatesByType(): Promise<Map<string, Card>> {
  if (templateCache) return Promise.resolve(templateCache);
  if (!templateInflight) {
    templateInflight = cardsApi.getCards({ template_only: true, limit: 200 })
      .then((res) => {
        const map = new Map<string, Card>();
        for (const card of res.cards || []) {
          if (card.type !== 'weapon') continue;
          const key = (card.weapon_type || '').trim();
          if (!key) continue;
          // Первый шаблон с картинкой предпочтительнее пустого.
          const prev = map.get(key);
          if (!prev || (!prev.image_url?.trim() && card.image_url?.trim())) {
            map.set(key, card);
          }
        }
        templateCache = map;
        return map;
      })
      .catch(() => {
        templateInflight = null;
        return new Map();
      });
  }
  return templateInflight;
}

export function useWeaponTemplatesByType(): Map<string, Card> {
  const [map, setMap] = useState<Map<string, Card>>(templateCache ?? new Map());
  useEffect(() => {
    let stale = false;
    loadWeaponTemplatesByType().then((m) => { if (!stale) setMap(m); });
    return () => { stale = true; };
  }, []);
  return map;
}
