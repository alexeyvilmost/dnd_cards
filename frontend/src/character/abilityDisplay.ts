/**
 * Подписи способностей на листе/в кузне: боевые стили выбираются как ЧЕРТЫ
 * («Оборона»), а механика лежит в related-эффекте. Исторически эффекты
 * назывались «Боевой стиль: Оборона» — на листе это выглядело как чужая
 * способность класса, хотя в пикере кузни стили правильные.
 */
import type { ChoiceOrigin } from '../mechanics/collectChoices';
import type { Feat, PassiveEffect } from '../types';

const FS_PREFIX = /^Боевой стиль:\s*/u;

export function stripFightingStylePrefix(name: string): string {
  return name.replace(FS_PREFIX, '');
}

export function isFightingStyleEffect(
  effect: Pick<PassiveEffect, 'name' | 'card_number'>,
  origin: ChoiceOrigin,
  feats: Feat[] = [],
): boolean {
  if (String(effect.card_number ?? '').startsWith('fs_')) return true;
  if (FS_PREFIX.test(effect.name ?? '')) return true;
  if (origin.kind !== 'feat') return false;
  return feats.some((f) => f.id === origin.id && f.category === 'fighting_style');
}

/** Имя и sourceLabel для строки/превью эффекта на листе. */
export function effectAbilityPresentation(
  effect: PassiveEffect,
  origin: ChoiceOrigin,
  feats: Feat[] = [],
  originKindLabel: (kind: string) => string = (k) => k,
): { name: string; sourceLabel: string; effect: PassiveEffect; fallbackImageUrl?: string | null } {
  // Effect rows are the executable projection of a feat. Content may keep the
  // artwork on the owning feat (the canonical fighting-style data does), so the
  // presentation carries that relationship instead of teaching each sheet a
  // list of styles or card numbers.
  const feat = origin.kind === 'feat' ? feats.find((candidate) => candidate.id === origin.id) : undefined;
  if (!isFightingStyleEffect(effect, origin, feats)) {
    return {
      name: effect.name,
      sourceLabel: `${originKindLabel(origin.kind)} · ${origin.name}`,
      effect,
      fallbackImageUrl: feat?.image_url,
    };
  }
  const name = feat?.name ?? stripFightingStylePrefix(effect.name);
  return {
    name,
    sourceLabel: `Боевой стиль · ${name}`,
    effect: effect.name === name ? effect : { ...effect, name },
    fallbackImageUrl: feat?.image_url,
  };
}
