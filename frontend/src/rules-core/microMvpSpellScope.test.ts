import { beforeAll, describe, expect, it } from 'vitest';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
  type MicroMvpSnapshotManifest,
} from '../canon/prodSnapshotL1Fixtures';
import type { Spell } from '../types';
import {
  buildMicroMvpSpellScopePolicy,
  createMicroMvpSpellScopeHook,
  MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS,
  MICRO_MVP_SPELL_SCOPE_CANTRIP_COUNT,
  MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT,
  MICRO_MVP_SPELL_SCOPE_LEVEL_ONE_COUNT,
  MicroMvpSpellScopeError,
  type MicroMvpSpellChoiceId,
  type MicroMvpSpellScopeHook,
  type MicroMvpSpellScopeManifest,
  type MicroMvpSpellScopePolicy,
} from './microMvpSpellScope';

type MutableRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const EXPECTED_POOLS: Readonly<Record<MicroMvpSpellChoiceId, readonly string[]>> = {
  cleric_cantrips: ['SPELL-0286', 'SPELL-0230', 'light', 'mending'],
  cleric_spells_l1: [
    'SPELL-0214', 'detect_magic', 'SPELL-0163', 'SPELL-0229', 'SPELL-0236', 'SPELL-0252',
  ],
  cleric_thaumaturge_cantrip: ['SPELL-0286', 'SPELL-0230', 'light', 'mending'],
  druid_cantrips: ['SPELL-0230', 'druidcraft', 'mending', 'poison_spray'],
  druid_spells_l1: [
    'SPELL-0214', 'SPELL-0171', 'detect_magic', 'SPELL-0236', 'SPELL-0252',
  ],
  druid_magician_cantrip: ['SPELL-0230', 'druidcraft', 'mending', 'poison_spray'],
  sorcerer_cantrips: [
    'fire_bolt', 'minor_illusion', 'SPELL-0218', 'chill_touch', 'light', 'dancing_lights',
    'mending', 'poison_spray', 'prestidigitation',
  ],
  sorcerer_spells_known: [
    'SPELL-0174', 'SPELL-0242', 'SPELL-0317', 'SPELL-0190', 'SPELL-0171', 'false_life',
    'detect_magic',
  ],
  warlock_cantrips: ['minor_illusion', 'chill_touch', 'poison_spray', 'prestidigitation'],
  warlock_spells_known: ['detect_magic', 'SPELL-0189'],
  wizard_cantrips: [
    'fire_bolt', 'minor_illusion', 'SPELL-0218', 'chill_touch', 'light', 'dancing_lights',
    'mending', 'poison_spray', 'prestidigitation',
  ],
  wizard_spellbook_level_1: [
    'SPELL-0174', 'SPELL-0242', 'SPELL-0317', 'SPELL-0190', 'SPELL-0171', 'false_life',
    'detect_magic', 'SPELL-0241',
  ],
  magic_initiate_wizard_cantrips: [
    'fire_bolt', 'minor_illusion', 'SPELL-0218', 'chill_touch', 'light', 'dancing_lights',
    'mending', 'poison_spray', 'prestidigitation',
  ],
  magic_initiate_wizard_level_1: [
    'SPELL-0174', 'SPELL-0242', 'SPELL-0317', 'SPELL-0190', 'SPELL-0171', 'false_life',
    'detect_magic', 'SPELL-0241',
  ],
  pact_tome_cantrips: [
    'fire_bolt', 'SPELL-0286', 'SPELL-0230', 'minor_illusion', 'SPELL-0218', 'chill_touch',
    'light', 'dancing_lights', 'druidcraft', 'mending', 'poison_spray', 'prestidigitation',
  ],
  pact_tome_rituals: ['detect_magic', 'SPELL-0236', 'SPELL-0241', 'SPELL-0252'],
};

function cardNumbers(policy: MicroMvpSpellScopePolicy, spellIds: readonly string[]): string[] {
  const byId = new Map(policy.spells.map((spell) => [spell.id, spell.cardNumber]));
  return spellIds.map((spellId) => byId.get(spellId)!);
}

function spellId(policy: MicroMvpSpellScopePolicy, reference: string): string {
  const spell = policy.spells.find((candidate) => (
    candidate.id === reference || candidate.cardNumber === reference
  ));
  if (!spell) throw new Error(`Test requires curated spell ${reference}`);
  return spell.id;
}

function combinations(values: readonly string[], count: number): string[][] {
  if (count === 0) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), count - 1)
    .map((rest) => [value, ...rest]));
}

/** Proves root-wide collision avoidance without putting allocation into production policy. */
function allocateDistinct(input: {
  policy: MicroMvpSpellScopePolicy;
  choiceIds: readonly MicroMvpSpellChoiceId[];
  reservedRefs: readonly string[];
}): Readonly<Record<string, readonly string[]>> | undefined {
  const used = new Set(input.reservedRefs.map((reference) => spellId(input.policy, reference)));
  const ordered = [...input.choiceIds].sort((left, right) => {
    const leftPolicy = input.policy.choices[left];
    const rightPolicy = input.policy.choices[right];
    return (leftPolicy.spellIds.length - leftPolicy.count)
      - (rightPolicy.spellIds.length - rightPolicy.count)
      || left.localeCompare(right);
  });
  const result: Record<string, string[]> = {};
  const visit = (index: number): boolean => {
    if (index === ordered.length) return true;
    const id = ordered[index];
    const choice = input.policy.choices[id];
    const available = choice.spellIds.filter((candidate) => !used.has(candidate));
    for (const selection of combinations(available, choice.count)) {
      selection.forEach((candidate) => used.add(candidate));
      result[id] = selection;
      if (visit(index + 1)) return true;
      delete result[id];
      selection.forEach((candidate) => used.delete(candidate));
    }
    return false;
  };
  return visit(0) ? result : undefined;
}

describe('micro-MVP curated spell-scope foundation', () => {
  let manifest: MicroMvpSnapshotManifest;
  let snapshotSpells: Spell[];
  let policy: MicroMvpSpellScopePolicy;
  let hook: MicroMvpSpellScopeHook;

  beforeAll(async () => {
    manifest = await readMicroMvpSnapshotManifest();
    snapshotSpells = readProdSnapshotCatalogs().spells;
    policy = buildMicroMvpSpellScopePolicy({ manifest, snapshotSpells });
    hook = createMicroMvpSpellScopeHook(policy);
  });

  it('derives only the 26 manifest spells from the current 49-entity pinned scope', () => {
    expect(policy.manifestVersion).toBe(manifest.manifestVersion);
    expect(policy.manifestEntityCount).toBe(MICRO_MVP_SPELL_SCOPE_ENTITY_COUNT);
    expect(policy.spells.filter((spell) => spell.level === 0))
      .toHaveLength(MICRO_MVP_SPELL_SCOPE_CANTRIP_COUNT);
    expect(policy.spells.filter((spell) => spell.level === 1))
      .toHaveLength(MICRO_MVP_SPELL_SCOPE_LEVEL_ONE_COUNT);
    expect(policy.spells).toHaveLength(26);
    expect(policy.spells.map((spell) => spell.cardNumber)).toEqual([
      ...manifest.collections.cantrips.map((entry) => entry.selector.cardNumber),
      ...manifest.collections.firstLevelSpells.map((entry) => entry.selector.cardNumber),
    ]);
    expect(policy.spells.map((spell) => spell.cardNumber)).toEqual(expect.arrayContaining([
      'dancing_lights', 'prestidigitation', 'druidcraft', 'SPELL-0241',
    ]));
    expect(policy.spells.map((spell) => spell.cardNumber)).not.toContain('SPELL-0173');
  });

  it('pins every class, Order, Magic Initiate, and Tome pool to level/class/ritual metadata', () => {
    expect(Object.keys(policy.choices).sort()).toEqual(
      MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS.map((choice) => choice.id).sort(),
    );
    for (const definition of MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS) {
      const choice = policy.choices[definition.id];
      expect(hook.choicePool(`fixture:${definition.id}`), `${definition.id}:hook pool`)
        .toEqual(choice.spellIds);
      expect(choice.count, definition.id).toBe(definition.count);
      expect(choice.level, definition.id).toBe(definition.level);
      expect(cardNumbers(policy, choice.spellIds), definition.id)
        .toEqual(EXPECTED_POOLS[definition.id]);
      expect(choice.spellIds.length, definition.id).toBeGreaterThanOrEqual(choice.count);
      for (const id of choice.spellIds) {
        const spell = policy.spells.find((candidate) => candidate.id === id)!;
        expect(spell.level, `${definition.id}:${spell.cardNumber}`).toBe(definition.level);
        if ('spellClass' in definition) {
          expect(spell.classes, `${definition.id}:${spell.cardNumber}`)
            .toContain(choice.catalogClassName);
        }
        if ('ritual' in definition) {
          expect(spell.ritual, `${definition.id}:${spell.cardNumber}`).toBe(true);
        }
      }
    }
  });

  it('accepts every curated pool member combination and rejects every excluded curated entity', () => {
    for (const definition of MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS) {
      const choice = policy.choices[definition.id];
      const valid = choice.spellIds.slice(0, choice.count);
      expect(hook.assertChoice(`fixture:source:${definition.id}`, valid), definition.id)
        .toEqual(valid);
      const validCards = cardNumbers(policy, valid);
      expect(hook.assertChoice(definition.id, validCards), `${definition.id}:card refs`)
        .toEqual(valid);
      const eligible = new Set(choice.spellIds);
      for (const excluded of policy.spells.filter((spell) => !eligible.has(spell.id))) {
        const candidate = [...valid];
        candidate[candidate.length - 1] = excluded.id;
        expect(
          () => hook.assertChoice(definition.id, candidate),
          `${definition.id} must reject ${excluded.cardNumber}`,
        ).toThrow(MicroMvpSpellScopeError);
      }
    }
  });

  it('fails closed on exact count, canonical distinctness, level, scope, and unknown choices', () => {
    const wizardCantrips = policy.choices.wizard_cantrips.spellIds;
    expect(() => hook.assertChoice('wizard_cantrips', wizardCantrips.slice(0, 2)))
      .toThrow(/requires exactly 3/);
    expect(() => hook.assertChoice('wizard_cantrips', wizardCantrips.slice(0, 4)))
      .toThrow(/requires exactly 3/);
    const first = policy.spells.find((spell) => spell.id === wizardCantrips[0])!;
    expect(() => hook.assertChoice('wizard_cantrips', [
      first.id, first.cardNumber, wizardCantrips[1],
    ])).toThrow(/distinct canonical spells/);
    expect(() => hook.assertChoice('wizard_cantrips', [
      'SPELL-0174', ...wizardCantrips.slice(0, 2),
    ])).toThrow(/must be level 0/);
    expect(() => hook.assertChoice('future_spell_choice', []))
      .toThrow(/unsupported spell choice/);
  });

  it('rejects all four previously demonstrated override bypasses', () => {
    const wizardCantrips = policy.choices.wizard_cantrips.spellIds;
    expect(() => hook.assertChoice('wizard_cantrips', [
      'SPELL-0173', ...wizardCantrips.slice(0, 2),
    ])).toThrow(/SPELL-0173 is outside the curated manifest/);

    expect(() => hook.assertChoice('wizard_cantrips', [
      'druidcraft', ...wizardCantrips.slice(0, 2),
    ])).toThrow(/druidcraft is not on the wizard spell list/);

    expect(() => hook.assertChoice('magic_initiate_wizard_level_1', ['SPELL-0214']))
      .toThrow(/SPELL-0214 is not on the wizard spell list/);

    expect(() => hook.assertChoice('pact_tome_rituals', ['false_life', 'SPELL-0190']))
      .toThrow(/is not a ritual/);
  });

  it('requires fixed spells to be exact and owned by the granting feature', () => {
    const expected: Readonly<Record<string, string>> = {
      'RE-sub-drow': 'dancing_lights',
      'RE-sub-high_elf': 'prestidigitation',
      'RE-sub-wood_elf': 'druidcraft',
      'EFF-pact-chain': 'SPELL-0241',
      'EFF-invoc-armor_of_shadows': 'SPELL-0190',
    };
    for (const [featureId, cardNumber] of Object.entries(expected)) {
      expect(hook.assertFixedGrants(featureId, [cardNumber]), featureId)
        .toEqual([spellId(policy, cardNumber)]);
    }
    expect(() => hook.assertFixedGrants('RE-sub-drow', ['prestidigitation']))
      .toThrow(/feature-owned policy/);
    expect(() => hook.assertFixedGrants('EFF-pact-chain', ['SPELL-0214']))
      .toThrow(/feature-owned policy/);
    expect(() => hook.assertFixedGrants('EFF-pact-chain', []))
      .toThrow(/feature-owned policy/);
    expect(() => hook.assertFixedGrants('EFF-pact-chain', ['SPELL-0241', 'SPELL-0241']))
      .toThrow(/feature-owned policy/);
    expect(() => hook.assertFixedGrants('future-feature', ['SPELL-0241']))
      .toThrow(/unsupported fixed spell-grant feature/);
  });

  it('has a collision-free exact allocation for every L1 class/order/MI/Tome combination', () => {
    const scenarios: Readonly<Record<string, readonly MicroMvpSpellChoiceId[]>> = {
      cleric_thaumaturge_and_magic_initiate: [
        'cleric_cantrips', 'cleric_spells_l1', 'cleric_thaumaturge_cantrip',
        'magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1',
      ],
      druid_magician_and_magic_initiate: [
        'druid_cantrips', 'druid_spells_l1', 'druid_magician_cantrip',
        'magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1',
      ],
      sorcerer_and_magic_initiate: [
        'sorcerer_cantrips', 'sorcerer_spells_known',
        'magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1',
      ],
      warlock_tome_and_magic_initiate: [
        'warlock_cantrips', 'warlock_spells_known',
        'magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1',
        'pact_tome_cantrips', 'pact_tome_rituals',
      ],
      wizard_and_magic_initiate: [
        'wizard_cantrips', 'wizard_spellbook_level_1',
        'magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1',
      ],
    };
    const lineageReservations = ['dancing_lights', 'prestidigitation', 'druidcraft'];
    for (const [scenario, choiceIds] of Object.entries(scenarios)) {
      for (const fixedCantrip of lineageReservations) {
        const allocation = allocateDistinct({
          policy,
          choiceIds,
          reservedRefs: [fixedCantrip],
        });
        expect(allocation, `${scenario} with ${fixedCantrip}`).toBeDefined();
        const flattened = Object.values(allocation!).flat();
        expect(new Set([...flattened, spellId(policy, fixedCantrip)]).size)
          .toBe(flattened.length + 1);
        for (const choiceId of choiceIds) {
          expect(hook.assertChoice(choiceId, allocation![choiceId]), `${scenario}:${choiceId}`)
            .toEqual(allocation![choiceId]);
        }
      }
    }

    const chainAllocation = allocateDistinct({
      policy,
      choiceIds: [
        'warlock_cantrips', 'warlock_spells_known',
        'magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1',
      ],
      reservedRefs: ['druidcraft', 'SPELL-0241'],
    });
    expect(chainAllocation, 'Warlock Pact Chain fixed Find Familiar').toBeDefined();
  });

  it('rejects malformed manifest/snapshot boundaries before producing a policy', () => {
    type MutableFixture = {
      manifest: MutableRecord;
      spells: MutableRecord[];
    };
    const fixtures: Array<[string, (fixture: MutableFixture) => void, RegExp]> = [
      ['release', ({ manifest: candidate }) => { candidate.release = 'mini-mvp'; }, /release must be micro-mvp/],
      ['system', ({ manifest: candidate }) => { candidate.systemId = 'dnd5e-2014'; }, /systemId must be dnd5e-2024/],
      ['level', ({ manifest: candidate }) => { candidate.characterLevel = 2; }, /characterLevel must be 1/],
      ['version', ({ manifest: candidate }) => { candidate.manifestVersion = ''; }, /manifestVersion/],
      ['entity cardinality', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        (collections.fightingStyles as unknown[]).pop();
      }, /exactly 49 entities/],
      ['duplicate key', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        const classes = collections.classes as MutableRecord[];
        classes[1].key = classes[0].key;
      }, /keys must be non-empty and unique/],
      ['spell collection cardinality', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        (collections.cantrips as unknown[]).pop();
      }, /cantrips must contain exactly 12/],
      ['non-array spell collection', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        collections.cantrips = null;
      }, /manifest collection cantrips must be an array/],
      ['manifest level', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        const first = (collections.cantrips as MutableRecord[])[0];
        (first.expected as MutableRecord).level = 1;
      }, /manifest level must be 0/],
      ['missing selector', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        const first = (collections.cantrips as MutableRecord[])[0];
        delete (first.selector as MutableRecord).cardNumber;
      }, /requires selector.cardNumber/],
      ['missing snapshot spell', ({ spells }) => {
        const index = spells.findIndex((spell) => spell.card_number === 'fire_bolt');
        spells.splice(index, 1);
      }, /fire_bolt resolves to 0 snapshot spells/],
      ['duplicate snapshot spell', ({ spells }) => {
        spells.push(clone(spells.find((spell) => spell.card_number === 'fire_bolt')!));
      }, /fire_bolt resolves to 2 snapshot spells/],
      ['empty snapshot id', ({ spells }) => {
        spells.find((spell) => spell.card_number === 'fire_bolt')!.id = '';
      }, /resolved spell id must be non-empty/],
      ['snapshot level', ({ spells }) => {
        spells.find((spell) => spell.card_number === 'fire_bolt')!.level = 1;
      }, /snapshot level must be 0/],
      ['snapshot classes', ({ spells }) => {
        spells.find((spell) => spell.card_number === 'fire_bolt')!.classes = [];
      }, /classes must be a non-empty string array/],
      ['snapshot ritual', ({ spells }) => {
        spells.find((spell) => spell.card_number === 'fire_bolt')!.ritual = 'false';
      }, /ritual must be boolean/],
      ['duplicate resolved id', ({ spells }) => {
        const fireBolt = spells.find((spell) => spell.card_number === 'fire_bolt')!;
        spells.find((spell) => spell.card_number === 'SPELL-0286')!.id = fireBolt.id;
      }, /resolve to unique snapshot IDs/],
      ['duplicate resolved card', ({ manifest: candidate }) => {
        const collections = candidate.collections as MutableRecord;
        const cantrips = collections.cantrips as MutableRecord[];
        (cantrips[1].selector as MutableRecord).cardNumber = (
          cantrips[0].selector as MutableRecord
        ).cardNumber;
      }, /spell card numbers must be unique/],
      ['insufficient legal pool', ({ spells }) => {
        spells.find((spell) => spell.card_number === 'SPELL-0189')!.classes = ['волшебник'];
      }, /warlock_spells_known: curated pool has 1, requires 2/],
    ];
    for (const [label, mutate, message] of fixtures) {
      const fixture: MutableFixture = {
        manifest: clone(manifest) as unknown as MutableRecord,
        spells: clone(snapshotSpells) as unknown as MutableRecord[],
      };
      mutate(fixture);
      expect(() => buildMicroMvpSpellScopePolicy({
        manifest: fixture.manifest as unknown as MicroMvpSpellScopeManifest,
        snapshotSpells: fixture.spells as unknown as Spell[],
      }), label).toThrow(message);
    }
  });
});
