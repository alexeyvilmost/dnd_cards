import type { Spell } from '../types';
import type { AssembledCharacter } from './assemble';
import type { CharacterRuleState } from './rules/types';

export function itemSpellReferences(state: Pick<CharacterRuleState, 'appliedGrants'> | null): string[] {
  return [...new Set((state?.appliedGrants ?? []).filter(grant => grant.kind === 'spell' && grant.source.type === 'item').map(grant => grant.value))];
}

/** Hydrate references only through the same canonical spell resolver as other grants. */
export async function loadItemGrantedSpells(references: readonly string[], resolve: (reference: string) => Promise<Spell>): Promise<Spell[]> {
  const spells = await Promise.all(references.map(resolve));
  return [...new Map(spells.map(spell => [spell.id, spell])).values()];
}

/** Filter stale async results immediately when equipment/attunement changes. */
export function withItemGrantedSpells(assembled: AssembledCharacter, loaded: readonly Spell[], references: readonly string[]): AssembledCharacter {
  const active = new Set(references);
  const seen = new Set(assembled.spells.flatMap(spell => [spell.id, spell.card_number]));
  const extra = loaded.filter(spell => (active.has(spell.id) || active.has(spell.card_number)) && !seen.has(spell.id) && !seen.has(spell.card_number));
  return extra.length ? { ...assembled, spells: [...assembled.spells, ...extra] } : assembled;
}
