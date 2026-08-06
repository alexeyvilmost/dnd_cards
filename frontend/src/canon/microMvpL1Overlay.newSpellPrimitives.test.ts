import { beforeAll, describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from './microMvpL1Overlay';
import { readProdSnapshotCatalogs } from './prodSnapshotL1Fixtures';

type Dict = Record<string, unknown>;

const WORLD_PRIMITIVES = [
  {
    cardNumber: 'dancing_lights',
    primitiveType: 'dancing_lights_world',
    castTime: { unit: 'action', amount: 1 },
    cost: [{ resource: 'action' }],
  },
  {
    cardNumber: 'druidcraft',
    primitiveType: 'druidcraft_world',
    castTime: { unit: 'action', amount: 1 },
    cost: [{ resource: 'action' }],
  },
  {
    cardNumber: 'mending',
    primitiveType: 'mending_world',
    castTime: { unit: 'minute', amount: 1 },
    cost: [{ resource: 'action' }],
  },
  {
    cardNumber: 'prestidigitation',
    primitiveType: 'prestidigitation_world',
    castTime: { unit: 'action', amount: 1 },
    cost: [{ resource: 'action' }],
  },
  {
    cardNumber: 'SPELL-0236',
    primitiveType: 'detect_poison_disease_world',
    castTime: { unit: 'action', amount: 1 },
    cost: [
      { resource: 'action' },
      { amount: 1, level: 1, resource: 'spell_slot' },
    ],
  },
  {
    cardNumber: 'SPELL-0252',
    primitiveType: 'purify_food_drink_world',
    castTime: { unit: 'action', amount: 1 },
    cost: [
      { resource: 'action' },
      { amount: 1, level: 1, resource: 'spell_slot' },
    ],
  },
] as const;

const ARMOR_OF_AGATHYS = {
  cardNumber: 'SPELL-0189',
  primitiveType: 'temporary_hp_melee_retaliation',
  castTime: { unit: 'bonus_action', amount: 1 },
  cost: [
    { resource: 'bonus_action' },
    { amount: 1, level: 1, resource: 'spell_slot' },
  ],
} as const;

function containsNarrative(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsNarrative);
  if (!value || typeof value !== 'object') return false;
  const record = value as Dict;
  return record.kind === 'narrative' || Object.values(record).some(containsNarrative);
}

function rootByClass(provider: CompiledMicroMvpL1Provider, classCardNumber: string) {
  const root = provider.roots.find((candidate) => (
    candidate.matrixCase.klass.card_number === classCardNumber
      && candidate.matrixCase.species.card_number === 'RACE-0003'
      && candidate.matrixCase.originFeat.card_number === 'FEAT-0001'
  ));
  if (!root) throw new Error(`Missing Dwarf/Alert test root for ${classCardNumber}`);
  return root;
}

function spellActions(root: CompiledMicroMvpL1Root, spellId: string): RuleActionDefinition[] {
  return root.rulesActions.filter((action) => (
    action.kind === 'spell' && action.sourceEntityIds.includes(spellId)
  ));
}

describe('new micro-MVP canonical spell primitives', () => {
  let provider: CompiledMicroMvpL1Provider;
  let relevantRoots: CompiledMicroMvpL1Root[];

  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
    const wizard = rootByClass(provider, 'CLASS-wizard');
    const druid = rootByClass(provider, 'CLASS-druid');
    const cleric = rootByClass(provider, 'CLASS-cleric');
    const warlock = rootByClass(provider, 'CLASS-warlock');
    const variants = await compileMicroMvpL1ChoiceVariants([
      {
        stableKey: wizard.stableKey,
        overrides: {
          wizard_cantrips: ['dancing_lights', 'mending', 'prestidigitation'],
        },
      },
      {
        stableKey: druid.stableKey,
        overrides: { druid_cantrips: ['druidcraft', 'poison_spray'] },
      },
      {
        stableKey: cleric.stableKey,
        overrides: {
          cleric_spells_l1: ['SPELL-0214', 'SPELL-0163', 'SPELL-0236', 'SPELL-0252'],
        },
      },
      {
        stableKey: warlock.stableKey,
        overrides: { warlock_spells_known: ['detect_magic', 'SPELL-0189'] },
      },
    ]);
    relevantRoots = [...provider.roots, ...variants];
  }, 60_000);

  it('compiles every world primitive from its exact pinned spell without narrative authority', () => {
    const pinnedSpells = readProdSnapshotCatalogs().spells;
    for (const expected of WORLD_PRIMITIVES) {
      const pinned = pinnedSpells.find((spell) => spell.card_number === expected.cardNumber)!;
      expect(pinned, expected.cardNumber).toBeDefined();
      const roots = relevantRoots.filter((root) => (
        root.assembled.spells.some((spell) => spell.id === pinned.id)
      ));
      expect(roots.length, `${expected.cardNumber}: relevant roots`).toBeGreaterThan(0);

      for (const root of roots) {
        const compiled = root.assembled.spells.find((spell) => spell.id === pinned.id)!;
        expect(compiled.card_number, root.stableKey).toBe(pinned.card_number);
        expect(compiled.casting_time, root.stableKey).toBe(pinned.casting_time);
        expect(compiled.concentration, root.stableKey).toBe(pinned.concentration);
        expect(compiled.ritual, root.stableKey).toBe(pinned.ritual);
        expect(containsNarrative(compiled.mechanics), `${root.stableKey}:${expected.cardNumber}`)
          .toBe(false);

        const actions = spellActions(root, pinned.id);
        expect(actions.length, `${root.stableKey}:${expected.cardNumber}: actions`).toBeGreaterThan(0);
        for (const action of actions) {
          expect(action.mechanics.primitive).toEqual(
            (compiled.mechanics as Dict).primitive,
          );
          expect(action.mechanics.primitive).toMatchObject({
            type: expected.primitiveType,
            policy: expect.any(Object),
          });
          expect(action.mechanics.activation).toMatchObject({
            mode: 'active',
            cast_time: expected.castTime,
            cost: expected.cost,
          });
          expect(action.targeting?.minTargets).toBe(0);
          expect(action.concentration).toBe(pinned.concentration ? true : undefined);
          expect(containsNarrative(action.mechanics)).toBe(false);

          const grant = root.actor.spellcastingAccess?.grants.find((candidate) => (
            candidate.actionId === action.id
          ));
          expect(grant, `${root.stableKey}:${action.id}: source-scoped grant`).toBeDefined();
          expect(grant?.ritual).toBe(pinned.ritual ? true : undefined);
        }
      }
    }
  });

  it('compiles Armor of Agathys as a Bonus Action primitive without narrative retaliation', () => {
    const pinned = readProdSnapshotCatalogs().spells.find((spell) => (
      spell.card_number === ARMOR_OF_AGATHYS.cardNumber
    ))!;
    const roots = relevantRoots.filter((root) => (
      root.assembled.spells.some((spell) => spell.id === pinned.id)
    ));
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      const compiled = root.assembled.spells.find((spell) => spell.id === pinned.id)!;
      expect(compiled.casting_time).toBe(pinned.casting_time);
      expect(compiled.concentration).toBe(false);
      expect(compiled.ritual).toBe(false);
      expect(containsNarrative(compiled.mechanics)).toBe(false);
      expect(compiled.mechanics).toMatchObject({
        primitive: { type: ARMOR_OF_AGATHYS.primitiveType },
        activation: {
          mode: 'active',
          cast_time: ARMOR_OF_AGATHYS.castTime,
          cost: ARMOR_OF_AGATHYS.cost,
        },
        effects: [{
          resolution: 'auto',
          result: [{ kind: 'temp_hp', amount: '5' }],
        }],
      });
      for (const action of spellActions(root, pinned.id)) {
        expect(action.mechanics.primitive).toMatchObject({
          type: ARMOR_OF_AGATHYS.primitiveType,
          temporary_hp_per_slot: 5,
          retaliation_damage_per_slot: 5,
          retaliation_damage_type: 'cold',
          retaliation_trigger: 'hit_by_melee_attack_roll',
          duration_rounds: 600,
          end_when_no_temporary_hp: true,
        });
        expect(action.targeting).toMatchObject({
          minTargets: 0, maxTargets: 1, rangeFt: 0, allowedRelations: ['self'],
        });
        expect(action.concentration).toBeUndefined();
        expect(containsNarrative(action.mechanics)).toBe(false);
      }
    }
  });

  it('pins Poison Spray to one 30-foot ranged spell attack dealing 1d12 poison damage', () => {
    const pinned = readProdSnapshotCatalogs().spells.find((spell) => (
      spell.card_number === 'poison_spray'
    ))!;
    const roots = relevantRoots.filter((root) => (
      root.assembled.spells.some((spell) => spell.id === pinned.id)
    ));
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      const compiled = root.assembled.spells.find((spell) => spell.id === pinned.id)!;
      expect(compiled.casting_time).toBe(pinned.casting_time);
      expect(compiled.concentration).toBe(false);
      expect(compiled.ritual).toBe(false);
      expect(compiled.mechanics).toEqual({
        spell_class_list_ids: [
          'CLASS-druid',
          'CLASS-sorcerer',
          'CLASS-warlock',
          'CLASS-wizard',
        ],
        activation: {
          mode: 'active',
          cast_time: { unit: 'action', amount: 1 },
          cost: [{ resource: 'action' }],
        },
        effects: [{
          resolution: 'attack_roll',
          ability: 'spellcasting',
          attack_kind: 'spell_ranged',
          vs: 'ac',
          on_hit: [{
            kind: 'damage',
            dice: '1d12',
            type: 'poison',
            scaling: { dice: '1d12', per: 'character_level' },
          }],
        }],
        interaction: { intent: 'harmful' },
        targeting: {
          domain: 'actor',
          actor_targets: true,
          shape: 'single',
          min_targets: 1,
          max_targets: 1,
          range_ft: 30,
          requires_line_of_sight: true,
          allowed_relations: ['self', 'ally', 'enemy', 'neutral'],
          range: '30 футов',
          filter: 'creature',
        },
      });
      for (const action of spellActions(root, pinned.id)) {
        expect(action.kind).toBe('spell');
        expect(action.targeting).toMatchObject({ minTargets: 1, maxTargets: 1, rangeFt: 30 });
        expect(action.mechanics.effects).toEqual(compiled.mechanics?.effects);
        expect(containsNarrative(action.mechanics)).toBe(false);
      }
    }
  });
});
