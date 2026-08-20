import type { Card } from '../types';
import type { CharacterContext, EngineEvent, RuntimeState } from '../mvp/contracts';
import {
  CARD_DAGGER,
  CARD_FROST_HAMMER,
  CARD_GREATAXE,
  CARD_LONGSWORD,
  CARD_SHIELD,
  FIGHTER_CTX,
  MECH_WEAPON_ATTACK,
  freshFighterState,
} from '../mvp/fixtures';
import { executeAction } from '../engine/execute';
import { emptyDraft } from '../character/types';
import type { AssembledCharacter } from '../character/assemble';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { withDeclaredTestWeaponProfile } from './weaponProfileFixtures';

type Dict = Record<string, unknown>;

const RANGED_WEAPON_ATTACK: Dict = {
  ...MECH_WEAPON_ATTACK,
  effects: [{
    ...((MECH_WEAPON_ATTACK.effects as Dict[])[0]),
    attack_kind: 'weapon_ranged',
  }],
};

const TWO_HANDED_WITH_EXTRA_DAMAGE = withDeclaredTestWeaponProfile({
  ...CARD_FROST_HAMMER,
  id: 'test-two-handed-extra-damage',
}, {
  weaponType: 'maul',
  proficiencyCategory: 'martial',
  attackAbility: 'str',
  damageLines: [{ dice: '2d6', type: 'bludgeoning' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['two_handed', 'heavy'],
  masteryEffectId: 'effect:test:topple',
  enchantment: {
    attack_bonus: 0,
    damage_bonus: 0,
    extra_damage_lines: [{ dice: '1d6', type: 'cold' }],
  },
});

const SHORTBOW = withDeclaredTestWeaponProfile({
  ...CARD_LONGSWORD,
  id: 'test-shortbow-style-negative',
  name: 'Короткий лук',
  properties: ['ammunition', 'two_handed'],
}, {
  weaponType: 'shortbow',
  proficiencyCategory: 'simple',
  attackAbility: 'dex',
  damageLines: [{ dice: '1d6', type: 'piercing' }],
  defaultAttackMode: 'ranged',
  attackModes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
  properties: ['ammunition', 'two_handed'],
  masteryEffectId: 'effect:test:vex',
  ammo: { card_id: 'card:test-arrow' },
});

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0.5;
}

function die(face: number, sides: number): number {
  return (face - 0.5) / sides;
}

function stateWithEquipment(equipment: RuntimeState['equipment']): RuntimeState {
  const state = freshFighterState();
  state.equipment = { ...equipment };
  return state;
}

function characterWithCards(cards: Card[]): CharacterContext {
  return { ...FIGHTER_CTX, equippedCards: cards, knownCards: cards };
}

function runAttack(input: {
  card: Card;
  mechanics?: Dict;
  style?: Dict;
  offHand?: Card;
  rng?: () => number;
}): EngineEvent[] {
  const cards = [input.card, ...(input.offHand ? [input.offHand] : [])];
  return executeAction(
    stateWithEquipment({
      main_hand: input.card.id,
      ...(input.offHand ? { off_hand: input.offHand.id } : {}),
    }),
    input.mechanics ?? MECH_WEAPON_ATTACK,
    {
      character: characterWithCards(cards),
      passives: input.style ? [input.style] : [],
      target: { ac: 1 },
      rng: input.rng ?? (() => 0.5),
    },
  ).events;
}

function damageEvents(events: EngineEvent[]): Array<Extract<EngineEvent, { type: 'damage' }>> {
  return events.filter((event): event is Extract<EngineEvent, { type: 'damage' }> => event.type === 'damage');
}

function damageTotal(input: Parameters<typeof runAttack>[0]): number {
  return damageEvents(runAttack(input)).reduce((sum, event) => sum + event.amount, 0);
}

function requiredStyle(styles: ReadonlyMap<string, Dict>, cardNumber: string): Dict {
  const mechanics = styles.get(cardNumber);
  if (!mechanics) throw new Error(`Missing reviewed Fighting Style ${cardNumber}`);
  return mechanics;
}

/**
 * The same deterministic behavioral matrix is used by source tests and by the
 * live-DB gate. Values are returned instead of asserted here so the evidence
 * remains transparent and each test can report the exact violated contract.
 */
export function evaluateMiniMvpFightingStylePrimitiveScenarios(
  styles: ReadonlyMap<string, Dict>,
) {
  const dueling = requiredStyle(styles, 'fs_dueling');
  const greatWeapon = requiredStyle(styles, 'fs_great_weapon');
  const thrownWeapon = requiredStyle(styles, 'fs_thrown_weapon');
  const blindFighting = requiredStyle(styles, 'fs_blind_fighting');

  const greatWeaponEvents = damageEvents(runAttack({
    card: TWO_HANDED_WITH_EXTRA_DAMAGE,
    style: greatWeapon,
    rng: sequenceRng([die(10, 20), die(1, 6), die(2, 6), die(1, 6)]),
  }));
  const oneHandedEvents = damageEvents(runAttack({
    card: CARD_LONGSWORD,
    offHand: CARD_SHIELD,
    style: greatWeapon,
    rng: sequenceRng([die(10, 20), die(1, 8)]),
  }));

  const draft = emptyDraft();
  const assembled = {
    race: null,
    klass: null,
    subclass: null,
    background: null,
    feats: [],
    effects: [{
      effect: { id: 'fs_blind_fighting', name: 'Сражение вслепую', mechanics: blindFighting },
      origin: { kind: 'feat', id: 'blind-fighting', name: 'Сражение вслепую' },
    }],
    actions: [],
    spells: [],
    pendingChoices: [],
    featAbilityIncreases: [],
    derived: {},
  } as unknown as AssembledCharacter;

  return {
    dueling: {
      oneHandedMeleeDelta: damageTotal({ card: CARD_LONGSWORD, offHand: CARD_SHIELD, style: dueling })
        - damageTotal({ card: CARD_LONGSWORD, offHand: CARD_SHIELD }),
      otherWeaponDelta: damageTotal({ card: CARD_LONGSWORD, offHand: CARD_DAGGER, style: dueling })
        - damageTotal({ card: CARD_LONGSWORD, offHand: CARD_DAGGER }),
      twoHandedDelta: damageTotal({ card: CARD_GREATAXE, style: dueling })
        - damageTotal({ card: CARD_GREATAXE }),
      rangedDelta: damageTotal({ card: CARD_DAGGER, mechanics: RANGED_WEAPON_ATTACK, style: dueling })
        - damageTotal({ card: CARD_DAGGER, mechanics: RANGED_WEAPON_ATTACK }),
    },
    greatWeapon: {
      baseDice: greatWeaponEvents[0]?.roll?.dice.map((entry) => entry.result) ?? [],
      extraDice: greatWeaponEvents[1]?.roll?.dice.map((entry) => entry.result) ?? [],
      oneHandedDice: oneHandedEvents[0]?.roll?.dice.map((entry) => entry.result) ?? [],
    },
    thrownWeapon: {
      rangedThrownDelta: damageTotal({ card: CARD_DAGGER, mechanics: RANGED_WEAPON_ATTACK, style: thrownWeapon })
        - damageTotal({ card: CARD_DAGGER, mechanics: RANGED_WEAPON_ATTACK }),
      meleeThrownDelta: damageTotal({ card: CARD_DAGGER, style: thrownWeapon })
        - damageTotal({ card: CARD_DAGGER }),
      rangedNotThrownDelta: damageTotal({ card: SHORTBOW, mechanics: RANGED_WEAPON_ATTACK, style: thrownWeapon })
        - damageTotal({ card: SHORTBOW, mechanics: RANGED_WEAPON_ATTACK }),
    },
    blindFighting: {
      senses: resolveCharacterRules({ draft, assembled }).senses,
    },
  };
}
