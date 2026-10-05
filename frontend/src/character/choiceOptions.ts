import { optionsForChoiceSource, type RegistryItem } from '../mechanics/registries';
import type { PendingChoice } from '../mechanics/collectChoices';
import { ABILITY_LABEL_RU, type AbilityKey } from './types';
import type { Feat, FeatCategory } from '../types';

export type ChoiceOption = RegistryItem & {
  /** Alternate content references (for example a card number or legacy
   * registry key) that resolve to the canonical persisted option id. */
  aliases?: readonly string[];
};

const FEAT_FILTER_CATEGORY: Record<string, FeatCategory> = {
  fighting_style: 'fighting_style',
  origin_feats: 'origin',
  origin: 'origin',
  general: 'general',
  epic_boon: 'epic_boon',
};

export function optionsForChoice(choice: PendingChoice, feats?: Feat[]): ChoiceOption[] {
  // Любой choice может сузить общий реестр явным options.items. Это единый
  // data-driven домен вариантов: например source:"ability" обычно даёт все
  // характеристики, а «Посвящённый в магию» объявляет только INT/WIS/CHA.
  if (choice.items?.length) {
    const isAbilityIncrease = choice.grant?.kind === 'grant_ability_score';
    return choice.items
      .filter((it) => it.minimumClassLevel == null
        || choice.origin.owningClassLevel == null
        || choice.origin.owningClassLevel >= it.minimumClassLevel)
      .map((it) => ({
        id: it.id,
        label: isAbilityIncrease && ABILITY_LABEL_RU[it.id as AbilityKey]
          ? ABILITY_LABEL_RU[it.id as AbilityKey]
          : it.name,
      }));
  }
  // Черты (боевые стили, черты происхождения, «Получение черты» на ASI-уровнях):
  // варианты — реальные черты из справочника, суженные по категории из filter или
  // по списку категорий options.categories (напр. ['origin','general'] для level-up).
  if (choice.source === 'feat' && feats?.length) {
    const cats = (choice.options?.categories as string[] | undefined);
    let pool = feats;
    if (Array.isArray(cats) && cats.length) {
      pool = feats.filter((f) => cats.includes(f.category as string));
    } else if (Array.isArray(choice.filter)) {
      const allow = choice.filter as string[];
      pool = feats.filter((f) => allow.includes(f.id) || allow.includes(f.card_number));
    } else if (typeof choice.filter === 'string' && choice.filter && choice.filter !== 'all') {
      const category = FEAT_FILTER_CATEGORY[choice.filter];
      pool = category ? feats.filter((f) => f.category === category) : feats;
    }
    const registryOptions = optionsForChoiceSource(choice.source);
    const normalizedLabel = (value: string) => value.trim().toLocaleLowerCase('ru-RU');
    return pool.map((f) => {
      // Older mechanics use the stable feat registry key (for example
      // `skilled`) while live catalogs persist UUIDs. Resolve that alias from
      // the two declared catalogs instead of branching on a feat identity.
      const labels = new Set(
        [f.name, f.name_en].filter((value): value is string => Boolean(value)).map(normalizedLabel),
      );
      const registryAliases = registryOptions
        .filter((option) => labels.has(normalizedLabel(option.label)))
        .map((option) => option.id);
      return {
        id: f.id,
        label: f.name,
        aliases: [...new Set([f.card_number, ...registryAliases])],
      };
    });
  }
  const opts = optionsForChoiceSource(choice.source);
  if (opts.length) {
    // сузить по фильтру, если он список
    if (Array.isArray(choice.filter)) return opts.filter((o) => (choice.filter as string[]).includes(o.id));
    return opts;
  }
  return [];
}

/** Resolve any declared option reference to the canonical id persisted by the
 * picker. Unknown references fail closed rather than selecting a different
 * recommendation by accident. */
export function choiceOptionIdByReference(
  options: readonly ChoiceOption[],
  reference: string,
): string | undefined {
  return options.find((option) => (
    option.id === reference || option.aliases?.includes(reference)
  ))?.id;
}

/** Join a picker option to its declared feat payload without changing the
 * option id persisted by the generic choice resolver. */
export function featForChoiceOption(choice: PendingChoice, optionId: string, feats: readonly Feat[]): Feat | undefined {
  const item = choice.items?.find(candidate => candidate.id === optionId);
  const references = item
    ? [item.value, ...(item.grants ?? []).filter(grant => grant.kind === 'grant_feat').map(grant => grant.value), optionId]
    : [optionId];
  for (const reference of references) {
    if (typeof reference !== 'string') continue;
    const feat = feats.find(candidate => candidate.id === reference || candidate.card_number === reference);
    if (feat) return feat;
  }
  // Older data can point at a shared registry key. Reuse the declared alias
  // join already used by the full feat domain, never entity-specific rules.
  const all = optionsForChoice({...choice, source: 'feat', items: undefined, filter: 'all', options: undefined}, [...feats]);
  const canonical = references.flatMap(reference => typeof reference === 'string'
    ? [choiceOptionIdByReference(all, reference)].filter((id): id is string => Boolean(id)) : []);
  return feats.find(feat => canonical.includes(feat.id));
}

