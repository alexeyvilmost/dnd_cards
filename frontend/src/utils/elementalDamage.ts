// Стихийный урон — тонкая обёртка над единым манифестом damageTypes.ts.
// Оставлено для обратной совместимости существующих импортов.
import {
  ELEMENTAL_DAMAGE_TYPES,
  getDamageColor,
  getDamageLabel,
  getDamageIconPath,
  type DamageType,
} from './damageTypes';

export type ElementalDamageType = Extract<
  DamageType,
  'fire' | 'cold' | 'acid' | 'poison' | 'necrotic' | 'lightning' | 'psychic' | 'radiant' | 'thunder' | 'force'
>;

export const ELEMENTAL_DAMAGE_OPTIONS: { value: ElementalDamageType; label: string }[] =
  ELEMENTAL_DAMAGE_TYPES.map((d) => ({ value: d.value as ElementalDamageType, label: d.label }));

export const getElementalDamageColor = (type: string): string => getDamageColor(type);

export const getElementalDamageLabel = (type: string): string => getDamageLabel(type);

export const getElementalDamageIconPath = (type: string): string => getDamageIconPath(type);

export const hasElementalDamage = (card: {
  elemental_damage_value?: string | null;
  elemental_damage_type?: string | null;
}): boolean =>
  Boolean(card.elemental_damage_value?.trim() && card.elemental_damage_type?.trim());
