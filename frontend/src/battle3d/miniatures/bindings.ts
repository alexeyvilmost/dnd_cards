import { MINIATURE_RECIPES, type MiniatureRecipe, type MiniatureRecipeId } from './recipes';

/** Explicit asset bindings. Stable entity IDs are data, never combat behavior. */
export const MONSTER_MINIATURE_BINDINGS: Readonly<Record<string, MiniatureRecipeId>> = {
  'c1000000-0000-4000-8000-000000000001': 'goblin-warrior',
  'c1000000-0000-4000-8000-000000000002': 'goblin-minion',
  'c1000000-0000-4000-8000-000000000003': 'wolf',
  'c2000000-0000-4000-8000-000000000001': 'bandit',
  'c2000000-0000-4000-8000-000000000002': 'guard',
  'c2000000-0000-4000-8000-000000000003': 'giant-rat',
  'c2000000-0000-4000-8000-000000000004': 'kobold-warrior',
  'c2000000-0000-4000-8000-000000000005': 'goblin-warrior',
  'c2000000-0000-4000-8000-000000000006': 'skeleton',
  'c2000000-0000-4000-8000-000000000007': 'zombie',
  'c2000000-0000-4000-8000-000000000008': 'wolf',
  'c2000000-0000-4000-8000-000000000009': 'giant-wolf-spider',
  'c2000000-0000-4000-8000-000000000010': 'hobgoblin-warrior',
  'c2000000-0000-4000-8000-000000000011': 'tough',
  'c2000000-0000-4000-8000-000000000012': 'animated-armor',
  'c2000000-0000-4000-8000-000000000013': 'dire-wolf',
  'c2000000-0000-4000-8000-000000000014': 'bugbear-warrior',
  'c2000000-0000-4000-8000-000000000015': 'ogre',
  'c2000000-0000-4000-8000-000000000016': 'berserker',
  'c2000000-0000-4000-8000-000000000017': 'bandit-captain',
  'c2000000-0000-4000-8000-000000000018': 'warrior-veteran',
  '40d15b33-bfac-4438-a3ea-7ed0c0d3ff0a': 'training-dummy',
  '6e4161b2-07be-4b8a-86b0-6488f7b0e761': 'training-dummy-red',
  '24b39706-f71a-4813-9994-efa831b42604': 'skeleton',
};

export const TEMPLATE_MINIATURE_BINDINGS: Readonly<Record<string, MiniatureRecipeId>> = {
  'd2500000-0000-4000-8000-000000000001': 'swordsman',
  'd2500000-0000-4000-8000-000000000002': 'archer',
  'd2500000-0000-4000-8000-000000000003': 'line',
};

export const PORTRAIT_MINIATURE_BINDINGS: Readonly<Record<string, MiniatureRecipeId>> = {
  '/portraits/presets/swordsman.png': 'swordsman',
  '/portraits/presets/archer.png': 'archer',
  '/portraits/presets/line.png': 'line',
};

const SLUG_MINIATURE_BINDINGS: Readonly<Record<string, MiniatureRecipeId>> = {
  ...Object.fromEntries(Object.keys(MINIATURE_RECIPES).map(key => [key, key as MiniatureRecipeId])),
  'audit-20260905-dummy': 'training-dummy',
  'audit-release-dummy-20260906': 'training-dummy-red',
  'qa-l2-skeleton-20260903': 'skeleton',
};

/** Safe placeholders for future custom content, using declared creature category only. */
const CATEGORY_MINIATURE_BINDINGS: Readonly<Record<string, MiniatureRecipeId>> = {
  beast: 'wolf', undead: 'skeleton', construct: 'training-dummy', dragon: 'kobold-warrior',
  giant: 'ogre', 'fey (goblinoid)': 'goblin-warrior',
};

export interface MiniatureIdentity {
  monsterId?: string;
  monsterSlug?: string;
  templateId?: string;
  portraitUrl?: string;
  creatureType?: string;
  size?: string | number;
  kind?: string;
}

export function resolveMiniature(identity: MiniatureIdentity): MiniatureRecipe {
  const exact = (identity.monsterId && MONSTER_MINIATURE_BINDINGS[identity.monsterId])
    || (identity.templateId && TEMPLATE_MINIATURE_BINDINGS[identity.templateId])
    || (identity.monsterSlug && SLUG_MINIATURE_BINDINGS[identity.monsterSlug]);
  if (exact) return MINIATURE_RECIPES[exact];
  // Portrait paths survive template copying/renaming. Query strings are cache versions.
  const portrait = identity.portraitUrl?.split(/[?#]/)[0];
  const portraitPath = portrait?.replace(/^https?:\/\/[^/]+/i, '');
  if (portraitPath && PORTRAIT_MINIATURE_BINDINGS[portraitPath]) {
    return MINIATURE_RECIPES[PORTRAIT_MINIATURE_BINDINGS[portraitPath]];
  }
  const category = identity.creatureType?.toLowerCase();
  return MINIATURE_RECIPES[(category && CATEGORY_MINIATURE_BINDINGS[category]) || 'adventurer'];
}
