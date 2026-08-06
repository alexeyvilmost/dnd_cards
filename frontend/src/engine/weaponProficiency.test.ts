import { describe, expect, it } from 'vitest';
import type { AssembledCharacter } from '../character/assemble';
import {
  buildCharacterContext,
  buildTargetFromCharacter,
} from '../character/runtime';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import {
  emptyDraft,
  type CharacterDraft,
  type ForgeCharacter,
} from '../character/types';
import type { Card } from '../types';
import type { CharacterContext, EngineEvent } from '../mvp/contracts';
import {
  CARD_LONGSWORD,
  FIGHTER_CTX,
  MECH_UNARMED_STRIKE,
  MECH_WEAPON_ATTACK,
  freshFighterState,
  seededRng,
} from '../mvp/fixtures';
import { executeAction } from './execute';
import { isWeaponProficient, weaponAttackPreview } from './weapon';

const LONGSWORD: Card = {
  ...CARD_LONGSWORD,
  weapon_type: 'longsword',
};

const characterWith = (weaponProficiencies: string[] | undefined): CharacterContext => ({
  ...FIGHTER_CTX,
  ...(weaponProficiencies === undefined ? {} : { weaponProficiencies }),
  equippedCards: [LONGSWORD],
  knownCards: [LONGSWORD],
});

function attackRoll(events: EngineEvent[]) {
  const event = events.find((candidate): candidate is Extract<EngineEvent, { type: 'roll' }> => (
    candidate.type === 'roll' && candidate.label === 'Атака'
  ));
  if (!event) throw new Error('Expected attack-roll event');
  return event.roll;
}

describe('weapon proficiency projection', () => {
  it('copies exact CharacterRuleState weapon grants into both rich actor contexts', () => {
    const draft: CharacterDraft = {
      ...emptyDraft(),
      level: 1,
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    };
    const assembled = {
      race: null,
      klass: {
        id: 'class:fighter',
        name: 'Fighter',
        weapon_proficiencies: ['martial_melee', 'simple_ranged'],
      },
      subclass: null,
      background: null,
      feats: [],
      effects: [],
      actions: [],
      spells: [],
      pendingChoices: [],
      featAbilityIncreases: [],
      derived: {},
    } as unknown as AssembledCharacter;
    const ruleState = resolveCharacterRules({ draft, assembled });
    const actorContext = buildCharacterContext(ruleState, draft, [], assembled.klass);
    const targetContext = buildTargetFromCharacter({
      id: 'target',
      name: 'Target',
      level: 1,
      current_hp: 10,
      max_hp: 10,
      equipment: {},
      inventory_items: [],
      resources: {},
      max_resources: {},
      active_effects: [],
      rule_state: ruleState,
    } as unknown as ForgeCharacter).characterContext;

    expect(ruleState.proficiencies.weapons).toEqual(['martial_melee', 'simple_ranged']);
    expect(actorContext.weaponProficiencies).toEqual(['martial_melee', 'simple_ranged']);
    expect(targetContext?.weaponProficiencies).toEqual(['martial_melee', 'simple_ranged']);
    expect(actorContext.weaponProficiencies).not.toBe(ruleState.proficiencies.weapons);
    expect(targetContext?.weaponProficiencies).not.toBe(ruleState.proficiencies.weapons);
  });
});

describe('isWeaponProficient', () => {
  it.each([
    { grants: undefined, weaponType: 'longsword', expected: true, label: 'legacy context' },
    { grants: [], weaponType: 'longsword', expected: false, label: 'explicitly none' },
    { grants: ['longsword'], weaponType: 'longsword', expected: true, label: 'exact type' },
    { grants: ['martial_melee'], weaponType: 'longsword', expected: true, label: 'catalog group' },
    { grants: ['martial'], weaponType: 'longsword', expected: true, label: 'broad category' },
    { grants: ['Martial Weapons'], weaponType: 'longsword', expected: true, label: 'normalized category' },
    { grants: ['all_weapons'], weaponType: 'longsword', expected: true, label: 'all weapons' },
    { grants: ['simple'], weaponType: 'longsword', expected: false, label: 'wrong category' },
    { grants: ['martial'], weaponType: 'unknown-homebrew', expected: false, label: 'unknown type' },
    { grants: ['all'], weaponType: null, expected: false, label: 'missing immutable type' },
  ] as const)('$label -> $expected', ({ grants, weaponType, expected }) => {
    expect(isWeaponProficient(
      characterWith(grants === undefined ? undefined : [...grants]),
      weaponType,
    )).toBe(expected);
  });
});

describe('weapon proficiency is shared by preview and execution', () => {
  const preview = (grants: string[] | undefined) => weaponAttackPreview(
    MECH_WEAPON_ATTACK,
    characterWith(grants),
    { main_hand: LONGSWORD.id },
  )!;

  const execute = (grants: string[] | undefined) => {
    const state = freshFighterState();
    state.equipment = { main_hand: LONGSWORD.id };
    return attackRoll(executeAction(state, MECH_WEAPON_ATTACK, {
      character: characterWith(grants),
      target: { ac: 30 },
      rng: seededRng(404),
    }).events);
  };

  it('adds PB for exact, group and broad-category ownership in both paths', () => {
    for (const grants of [['longsword'], ['martial_melee'], ['martial']]) {
      expect(preview(grants).attack).toBe(4);
      expect(execute(grants).modifiers).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 2, source: 'БМ' }),
      ]));
    }
  });

  it('does not add or narrate PB when explicit ownership is absent', () => {
    expect(preview([]).attack).toBe(2);
    const roll = execute([]);
    expect(roll.modifiers).toEqual([
      expect.objectContaining({ value: 2, source: 'СИЛ' }),
    ]);
    expect(roll.modifiers.some(({ source }) => source === 'БМ')).toBe(false);
  });

  it('preserves legacy contexts and always grants PB to Unarmed Strike', () => {
    expect(preview(undefined).attack).toBe(4);
    expect(execute(undefined).modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 2, source: 'БМ' }),
    ]));
    expect(weaponAttackPreview(
      MECH_UNARMED_STRIKE,
      characterWith([]),
      {},
    )?.attack).toBe(4);
  });
});
