import type { CharacterDraft } from '../character/types';
import type { AssembledCharacter } from '../character/assemble';
import type { Spell } from '../types';
import { isEntityUuid, splitRefs } from './ids';
import type { Registry } from './registry';

/** UUID заклинаний, выбранных игроком (spell_ids + resolvedChoices). */
export function collectChosenSpellUuids(
  draft: CharacterDraft,
  assembled?: AssembledCharacter,
): string[] {
  const fromResolved = (assembled?.pendingChoices || [])
    .filter((pc) => pc.source === 'spell')
    .flatMap((pc) => draft.resolvedChoices[pc.id] || []);
  return [...new Set([...draft.spellIds.filter(isEntityUuid), ...fromResolved.filter(isEntityUuid)])];
}

/** Slug-и заклинаний из rule_state (grant_spell и т.п.). */
export function grantedSpellSlugs(ruleStateKnown: string[]): string[] {
  return ruleStateKnown.filter((s) => !isEntityUuid(s));
}

export async function resolveSpellsForCharacter(
  registry: Registry,
  spellsById: Map<string, Spell>,
  spellsBySlug: Map<string, Spell>,
  uuids: string[],
  slugs: string[],
): Promise<Spell[]> {
  const byId = new Map<string, Spell>();

  for (const uuid of uuids) {
    const cached = spellsById.get(uuid);
    if (cached) byId.set(cached.id, cached);
  }

  for (const slug of slugs) {
    const cached = spellsBySlug.get(slug);
    if (cached) {
      byId.set(cached.id, cached);
      continue;
    }
    const resolved = await registry.resolve<Spell>('spell', slug);
    if (resolved?.id) byId.set(resolved.id, resolved);
  }

  return [...byId.values()];
}

export function indexSpells(spells: Spell[]): { byId: Map<string, Spell>; bySlug: Map<string, Spell> } {
  const byId = new Map<string, Spell>();
  const bySlug = new Map<string, Spell>();
  for (const s of spells) {
    byId.set(s.id, s);
    if (s.card_number) bySlug.set(s.card_number, s);
  }
  return { byId, bySlug };
}

/** Разделить сохранённые spell_ids на UUID (игрок) и slug (устаревший формат). */
export function splitStoredSpellIds(spellIds: string[] | null | undefined): { uuids: string[]; legacySlugs: string[] } {
  return splitRefs(spellIds || []);
}
