import { PASSIVE_EFFECT_TYPE_OPTIONS, type PassiveEffect } from '../types';

export function effectTypeLabel(type: string): string {
  return PASSIVE_EFFECT_TYPE_OPTIONS.find(option => option.value === type)?.label || type;
}

function effectCategorySource(effect: Pick<PassiveEffect, 'referenced_by'>) {
  const sources = effect.referenced_by || [];
  const source = sources.length === 1 ? sources[0] : undefined;
  return source && !source.missing && source.name && (source.entity_type === 'class' || source.entity_type === 'race') ? source : undefined;
}

export function hasEffectSourceCategory(effect: Pick<PassiveEffect, 'referenced_by'>): boolean {
  return Boolean(effectCategorySource(effect));
}

/** A category can name its sole mechanical class/species source, including its level. */
export function effectCategoryLabel(effect: Pick<PassiveEffect, 'effect_type' | 'referenced_by'>): string {
  const source = effectCategorySource(effect);
  if (source) {
    return `${source.name}${source.level != null ? `, ${source.level} уровень` : ''}`;
  }
  return effectTypeLabel(effect.effect_type);
}

/** The server uses this same type order before applying pagination. */
export function groupEffectsByType(effects: PassiveEffect[]): { type: string; label: string; effects: PassiveEffect[] }[] {
  const buckets = new Map<string, PassiveEffect[]>();
  for (const effect of effects) {
    const bucket = buckets.get(effect.effect_type);
    if (bucket) bucket.push(effect);
    else buckets.set(effect.effect_type, [effect]);
  }
  const order: string[] = PASSIVE_EFFECT_TYPE_OPTIONS.map(option => option.value);
  const types = [
    ...order.filter(type => buckets.has(type)),
    ...[...buckets.keys()].filter(type => !order.includes(type)).sort(),
  ];
  return types.map(type => ({ type, label: type === 'condition' ? 'Состояния' : effectTypeLabel(type), effects: buckets.get(type)! }));
}
