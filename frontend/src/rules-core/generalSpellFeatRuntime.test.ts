import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from './domain';
import {
  applyGeneralSpellFeatActionRules,
  elementalAdeptPolicy,
  hasRitualCasterQuickRitual,
  mageSlayerBreaksConcentration,
  mageSlayerProtectedMindOption,
  spellAttackIgnoresAdjacentDisadvantage,
  spellAttackIgnoresCover,
  warCasterAllowsSomaticWithOccupiedHands,
  warCasterOpportunitySpellVersion,
} from './generalSpellFeatRuntime';

const spell = (): RuleActionDefinition => ({
  id: 'spell-ray', name: 'Ray', kind: 'spell', sourceEntityIds: ['spell-ray'],
  spell: { level: 1, components: { verbal: true, somatic: true, material: false } },
  targeting: { minTargets: 1, maxTargets: 1, rangeFt: 30, requiresLineOfSight: true, allowedRelations: ['enemy'] },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1 }] },
    targeting: { range_ft: 30 }, effects: [{ resolution: 'attack_roll', on_hit: [] }],
  },
});

const spellSniper = { effects: [{ resolution: 'auto', result: [
  { kind: 'modifier', op: 'add', value: 60, applies_to: { roll: 'attack', filter: { attackKind: 'spell', minimumBaseRangeFt: 10 } }, reason: 'spell_sniper_range_ft' },
  { kind: 'modifier', op: 'deny', applies_to: { roll: 'attack', filter: { attackKind: 'spell', cover: 'half' } }, reason: 'spell_sniper_ignore_cover' },
  { kind: 'modifier', op: 'deny', applies_to: { roll: 'attack', filter: { attackKind: 'spell', penalty: 'enemy_adjacent' } }, reason: 'spell_sniper_ignore_adjacent_disadvantage' },
] }] };

describe('general spell-feat runtime', () => {
  it('adapts Spell Sniper range and exact cover/adjacency policy from data', () => {
    const source = spell();
    const projected = applyGeneralSpellFeatActionRules(source, [spellSniper]);
    expect(projected.targeting?.rangeFt).toBe(90);
    expect((projected.mechanics.targeting as Record<string, unknown>).range_ft).toBe(90);
    expect(source.targeting?.rangeFt).toBe(30);
    expect(spellAttackIgnoresCover([spellSniper], 'half')).toBe(true);
    expect(spellAttackIgnoresCover([spellSniper], 'three_quarters')).toBe(false);
    expect(spellAttackIgnoresCover([spellSniper], 'total')).toBe(false);
    expect(spellAttackIgnoresAdjacentDisadvantage([spellSniper])).toBe(true);
  });

  it('reads Elemental Adept only for the chosen spell damage type', () => {
    const passive = { effects: [{ result: [
      { kind: 'modifier', op: 'deny', applies_to: { roll: 'damage', filter: { attackKind: 'spell', damageType: 'fire' } }, reason: 'ignore_spell_damage_resistance' },
      { kind: 'modifier', op: 'minimum_die', value: 2, applies_to: { roll: 'damage', filter: { attackKind: 'spell', damageType: 'fire' } }, reason: 'elemental_adept_minimum_die' },
    ] }] };
    expect(elementalAdeptPolicy([passive], 'fire')).toEqual({ ignoreResistance: true, minimumNaturalDamageDie: 2 });
    expect(elementalAdeptPolicy([passive], 'cold')).toEqual({ ignoreResistance: false, minimumNaturalDamageDie: 0 });
  });

  it('recognizes Quick Ritual from the data-owned shared resource grant', () => {
    expect(hasRitualCasterQuickRitual([{ effects: [{ result: [
      { kind: 'resource', op: 'grant', id: 'ritual_caster_quick_ritual', amount: 1 },
    ] }] }])).toBe(true);
    expect(hasRitualCasterQuickRitual([])).toBe(false);
  });

  it('builds only eligible War Caster spells as reaction casts', () => {
    const passives = [{ effects: [{ result: [
      { kind: 'modifier', op: 'deny', applies_to: { roll: 'spellcasting' }, reason: 'war_caster_somatic_components' },
      { kind: 'modifier', op: 'set', value: 1, applies_to: { roll: 'reaction' }, reason: 'war_caster_opportunity_spell' },
    ] }] }];
    expect(warCasterAllowsSomaticWithOccupiedHands(passives)).toBe(true);
    const reaction = warCasterOpportunitySpellVersion(spell(), passives);
    expect(reaction?.id).toContain(':war-caster-opportunity');
    expect((reaction?.mechanics.activation as Record<string, unknown>).cost).toEqual([
      { resource: 'reaction', amount: 1 }, { resource: 'spell_slot', level: 1 },
    ]);
    expect(warCasterOpportunitySpellVersion({ ...spell(), targeting: { ...spell().targeting!, maxTargets: 2 } }, passives)).toBeNull();
  });

  it('offers Mage Slayer Protected Mind only after a failed mental save with charge', () => {
    const passives = [{ effects: [{ result: [
      { kind: 'modifier', op: 'disadvantage', scope: 'target', applies_to: { roll: 'saving_throw' }, reason: 'mage_slayer_break_concentration' },
      { kind: 'modifier', op: 'outcome', value: 'success', applies_to: { roll: 'saving_throw', filter: { resource: 'mage_slayer_protected_mind' } }, reason: 'mage_slayer_protected_mind' },
    ] }] }];
    expect(mageSlayerBreaksConcentration(passives)).toBe(true);
    expect(mageSlayerProtectedMindOption({ passives, ability: 'wis', outcome: 'fail', resources: { mage_slayer_protected_mind: 1 } }))
      .toEqual({ resource: 'mage_slayer_protected_mind' });
    expect(mageSlayerProtectedMindOption({ passives, ability: 'con', outcome: 'fail', resources: { mage_slayer_protected_mind: 1 } })).toBeNull();
    expect(mageSlayerProtectedMindOption({ passives, ability: 'cha', outcome: 'success', resources: { mage_slayer_protected_mind: 1 } })).toBeNull();
  });
});
