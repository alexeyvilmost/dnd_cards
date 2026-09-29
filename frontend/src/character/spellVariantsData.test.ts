import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectRuleAction } from '../canon/ruleActionProjection';
import { materializeDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import { activeConditionsOf } from '../engine/circumstances';
import { collectModifiers } from '../engine/modifiers';
import { freshFighterState } from '../mvp/fixtures';
import type { Spell } from '../types';

const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/content/data/spell-variants-280.json');
type VariantRow = {
  entity_type: 'spell'; id: string; card_number: string; name: string;
  preimage: { mechanics: Record<string, unknown> } | null;
  patch: Spell | { mechanics: Record<string, unknown> };
};
const rows = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VariantRow[];
const mechanics = (row: VariantRow) => row.patch.mechanics as Record<string, unknown>;
const parents = rows.filter((row) => row.preimage !== null && Array.isArray(mechanics(row).spell_variant_ids));
const audited = rows.filter((row) => row.preimage !== null && !Array.isArray(mechanics(row).spell_variant_ids));
const children = rows.filter((row) => row.preimage === null);
const choices = (value: unknown): number => Array.isArray(value)
  ? value.reduce((count, entry) => count + choices(entry), 0)
  : value && typeof value === 'object'
    ? Number((value as Record<string, unknown>).kind === 'choice'
      && ((value as Record<string, unknown>).options as Record<string, unknown> | undefined)?.source !== 'target_equipped_weapon')
      + Object.values(value).reduce<number>((count, entry) => count + choices(entry), 0)
    : 0;

describe('fixed spell variant data', () => {
  it('keeps every child in exactly one parent catalog and no runtime option choice', () => {
    expect(parents).toHaveLength(22);
    expect(children).toHaveLength(116);
    expect(audited).toHaveLength(9);
    expect(audited.every((row) => (row as VariantRow & {review:{status:string}}).review.status
      === 'partial_narrative_not_verified')).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.card_number)).size).toBe(rows.length);
    for (const parent of parents) {
      const ids = mechanics(parent).spell_variant_ids as string[];
      const listed = children.filter((child) => mechanics(child).variant_of_spell_id === parent.id);
      expect(ids, parent.card_number).toEqual(listed.map((child) => child.id));
      expect(ids.length, parent.card_number).toBeGreaterThan(1);
      for (const child of listed) {
        expect(choices(mechanics(child)), child.card_number).toBe(0);
        expect((child.patch as Spell).level, child.card_number).toBeDefined();
        expect(() => projectRuleAction({ ...(child.patch as Spell),
          mechanics: materializeDeclaredMechanicsTargeting(mechanics(child)) }), child.card_number).not.toThrow();
      }
    }
  });

  it('pins the six Hex abilities and five Command outcomes as distinct payloads', () => {
    const byRef = (cardNumber: string) => parents.find((row) => row.card_number === cardNumber)!;
    for (const [ref, count] of [['SPELL-0287', 6], ['SPELL-0272', 5], ['SPELL-0182', 2]] as const) {
      const parent = byRef(ref);
      const variants = children.filter((row) => mechanics(row).variant_of_spell_id === parent.id);
      expect(variants).toHaveLength(count);
      expect(new Set(variants.map((row) => JSON.stringify(mechanics(row).effects))).size).toBe(count);
    }
  });
  it('separates textual outcomes without claiming their narrative branches are automated', () => {
    const parent = parents.find((row) => row.card_number === 'greater_restoration')!;
    const variants = children.filter((row) => mechanics(row).variant_of_spell_id === parent.id);
    expect(variants).toHaveLength(6);
    const exhaustion = variants.find((row) => row.name.includes('Истощения'))!;
    expect(JSON.stringify(mechanics(exhaustion).effects)).toContain('max_removals');
    const contagion = parents.find((row) => row.card_number === 'contagion')!;
    expect(children.filter((row) => mechanics(row).variant_of_spell_id === contagion.id)).toHaveLength(6);
    const growth = parents.find((row) => row.card_number === 'plant_growth')!;
    const overgrowth = children.find((row) => mechanics(row).variant_of_spell_id === growth.id
      && row.name.includes('Чрезмерный рост'))!;
    expect(JSON.stringify(mechanics(overgrowth).effects)).toContain('movement_cost_multiplier');
    const elemental = parents.find((row) => row.card_number === 'elemental_weapon')!;
    const elementalChildren = children.filter((row) => mechanics(row).variant_of_spell_id === elemental.id);
    expect(elementalChildren).toHaveLength(5);
    expect(new Set(elementalChildren.map((row) => JSON.stringify(mechanics(row).effects))).size).toBe(5);
    for (const child of elementalChildren) {
      const effects = mechanics(child).effects as Array<Record<string, unknown>>;
      expect(effects[0]).toMatchObject({ kind: 'choice', options: { source: 'target_equipped_weapon' } });
      expect(effects[1]).toMatchObject({ who: 'target', result: [{ kind: 'weapon_attack_buff',
        scaling: [{ min_spell_level: 3, damage_dice: '1d4' },
          { min_spell_level: 5, damage_dice: '2d4' },
          { min_spell_level: 7, damage_dice: '3d4' }] }] });
    }
  });
  it.each(['str', 'dex'])('limits Contagion save disadvantage to chosen %s while poisoned', (ability) => {
    const parent = parents.find((row) => row.card_number === 'contagion')!;
    const child = children.find((row) => mechanics(row).variant_of_spell_id === parent.id
      && row.card_number.endsWith(`-${ability}`))!;
    const payload = ((mechanics(child).effects as { on_fail: Record<string, unknown>[] }[])[0].on_fail)
      .find((entry) => entry.kind === 'modifier')!;
    const state = freshFighterState();
    state.activeEffects = [{ id: 'poisoned', name: 'Poisoned', source: 'spell',
      mechanics: { kind: 'condition', value: 'poisoned' } },
    { id: 'contagion', name: 'Contagion', source: 'spell', mechanics: payload }];
    const collect = (selected: string) => collectModifiers(state, [], { roll: 'saving_throw',
      filter: { ability: selected }, evalCtx: { state, activeConditions: activeConditionsOf(state) } }).advantage;
    expect(collect(ability)).toBe('disadvantage');
    expect(collect(ability === 'str' ? 'dex' : 'str')).toBe('none');
    state.activeEffects = state.activeEffects.filter((effect) => effect.id !== 'poisoned');
    expect(collect(ability)).toBe('none');
  });
});
