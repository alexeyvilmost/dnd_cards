import type { Card } from '../types';
import type { CharacterContext, EngineEvent, RuntimeState } from '../mvp/contracts';
import {
  CARD_DAGGER,
  CARD_FROST_HAMMER,
  CARD_GREATAXE,
  CARD_LEATHER_ARMOR,
  CARD_LONGSWORD,
  CARD_SHIELD,
  FIGHTER_CTX,
  MECH_OFFHAND_ATTACK,
  MECH_WEAPON_ATTACK,
  freshFighterState,
} from '../mvp/fixtures';
import { executeAction } from '../engine/execute';
import { emptyDraft } from '../character/types';
import type { AssembledCharacter } from '../character/assemble';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { withDeclaredTestWeaponProfile } from './weaponProfileFixtures';
import { armorClassValue } from '../engine/ac';
import { bindDeclarativeFightingStyleProjection } from '../rules-core/fightingStyles';
import {
  protectionReactionEligibility,
  resolveProtectionReaction,
  type ProtectionTriggerFacts,
} from '../rules-core/testing/fightingStyleFixtures';
import {
  resolveInterceptionReaction,
  resolveTurnStartGrappleDamage,
  resolveUnarmedDamageProfile,
} from '../rules-core/fightingStyleComplexPrimitives';

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

const SCIMITAR = withDeclaredTestWeaponProfile({
  ...CARD_DAGGER,
  id: 'test-scimitar-existing-style',
  name: 'Скимитар',
}, {
  weaponType: 'scimitar',
  proficiencyCategory: 'martial',
  attackAbility: 'finesse',
  damageLines: [{ dice: '1d6', type: 'slashing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['finesse', 'light'],
  masteryEffectId: 'effect:test:nick',
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

function attackModifier(events: EngineEvent[]): number {
  const roll = events.find((event): event is Extract<EngineEvent, { type: 'roll' }> => (
    event.type === 'roll' && event.roll.kind === 'd20'
  ));
  if (!roll) throw new Error('Expected attack roll');
  return roll.roll.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}

/** Behavioral matrix for the four locked styles inherited from micro-MVP. */
export function evaluateExistingMiniMvpFightingStyleScenarios(
  styles: ReadonlyMap<string, Dict>,
) {
  const archery = requiredStyle(styles, 'fs_archery');
  const defense = requiredStyle(styles, 'fs_defense');
  const protection = requiredStyle(styles, 'fs_protection');
  const twoWeapon = requiredStyle(styles, 'fs_two_weapon');

  const armoredCharacter = characterWithCards([CARD_LEATHER_ARMOR, CARD_SHIELD]);
  const acDelta = (equipment: RuntimeState['equipment']) => (
    armorClassValue(armoredCharacter, stateWithEquipment(equipment), [defense]).value
    - armorClassValue(armoredCharacter, stateWithEquipment(equipment), []).value
  );

  const protectionBinding = bindDeclarativeFightingStyleProjection({
    featEntityId: 'feat-protection',
    featCardNumber: 'FEAT-0055',
    relatedEffectEntityIds: ['effect-protection'],
    effectEntityId: 'effect-protection',
    effectCardNumber: 'fs_protection',
    effectMechanics: protection,
  });
  if (!protectionBinding) throw new Error('Live Protection mechanics did not bind');
  const eligibleFacts: ProtectionTriggerFacts = {
    factsSource: 'scenario',
    boardRevision: 17,
    defenderActorId: 'fighter',
    attackerActorId: 'goblin',
    targetActorId: 'wizard',
    targetRelationToDefender: 'ally',
    defenderDistanceToTargetFt: 5,
    defenderCanSeeAttacker: true,
    defenderHasEquippedShield: true,
    defenderReactionAvailable: true,
  };
  const protectionAccepted = resolveProtectionReaction({
    triggeringAttackId: 'attack-1',
    sourceEntityIds: protectionBinding.sourceEntityIds,
    facts: eligibleFacts,
  });

  return {
    archery: {
      rangedWeaponAttackDelta: attackModifier(runAttack({
        card: SHORTBOW, mechanics: RANGED_WEAPON_ATTACK, style: archery,
      })) - attackModifier(runAttack({ card: SHORTBOW, mechanics: RANGED_WEAPON_ATTACK })),
      meleeWeaponAttackDelta: attackModifier(runAttack({ card: CARD_DAGGER, style: archery }))
        - attackModifier(runAttack({ card: CARD_DAGGER })),
      thrownMeleeWeaponDelta: attackModifier(runAttack({
        card: CARD_DAGGER, mechanics: RANGED_WEAPON_ATTACK, style: archery,
      })) - attackModifier(runAttack({ card: CARD_DAGGER, mechanics: RANGED_WEAPON_ATTACK })),
    },
    defense: {
      armorDelta: acDelta({ body: CARD_LEATHER_ARMOR.id }),
      unarmoredDelta: acDelta({}),
      shieldOnlyDelta: acDelta({ off_hand: CARD_SHIELD.id }),
    },
    twoWeapon: {
      lightExtraAttackDelta: damageTotal({
        card: CARD_DAGGER, offHand: SCIMITAR, mechanics: MECH_OFFHAND_ATTACK, style: twoWeapon,
      }) - damageTotal({ card: CARD_DAGGER, offHand: SCIMITAR, mechanics: MECH_OFFHAND_ATTACK }),
      normalAttackDelta: damageTotal({ card: CARD_DAGGER, offHand: SCIMITAR, style: twoWeapon })
        - damageTotal({ card: CARD_DAGGER, offHand: SCIMITAR }),
      nonLightPairDelta: damageTotal({
        card: CARD_LONGSWORD, offHand: CARD_DAGGER, mechanics: MECH_OFFHAND_ATTACK, style: twoWeapon,
      }) - damageTotal({ card: CARD_LONGSWORD, offHand: CARD_DAGGER, mechanics: MECH_OFFHAND_ATTACK }),
    },
    protection: {
      binding: {
        styleId: protectionBinding.styleId,
        mode: protectionBinding.mode,
        capabilityId: protectionBinding.capabilityId,
      },
      eligible: protectionReactionEligibility(eligibleFacts),
      outOfRange: protectionReactionEligibility({
        ...eligibleFacts, defenderDistanceToTargetFt: 10,
      }),
      accepted: protectionAccepted.status === 'accepted'
        ? { status: protectionAccepted.status, reactionSpent: protectionAccepted.reactionSpent }
        : protectionAccepted,
    },
  };
}

export const EXISTING_STYLE_EXPECTED_SCENARIOS = {
  archery: {
    rangedWeaponAttackDelta: 2,
    meleeWeaponAttackDelta: 0,
    thrownMeleeWeaponDelta: 0,
  },
  defense: { armorDelta: 1, unarmoredDelta: 0, shieldOnlyDelta: 0 },
  twoWeapon: { lightExtraAttackDelta: 2, normalAttackDelta: 0, nonLightPairDelta: 0 },
  protection: {
    binding: {
      styleId: 'protection',
      mode: 'reaction_capability',
      capabilityId: 'fighting_style.protection.reaction',
    },
    eligible: { eligible: true },
    outOfRange: { eligible: false, reason: 'target_out_of_range' },
    accepted: { status: 'accepted', reactionSpent: true },
  },
} as const;

export function evaluateComplexMiniMvpFightingStyleScenarios(
  styles: ReadonlyMap<string, Dict>,
) {
  const interception = requiredStyle(styles, 'fs_interception');
  const unarmed = requiredStyle(styles, 'fs_unarmed');
  const interceptionFacts = {
    interceptorActorId: 'fighter',
    attackerActorId: 'goblin',
    targetActorId: 'wizard',
    attackHit: true,
    interceptorCanSeeAttacker: true,
    interceptorDistanceToTargetFt: 5,
    interceptorHoldingShieldOrSimpleOrMartialWeapon: true,
    interceptorReactionAvailable: true,
    proficiencyBonus: 2,
    incomingDamage: 9,
  };
  return {
    unarmed: {
      armed: resolveUnarmedDamageProfile([unarmed], { holdingWeaponOrShield: true }),
      emptyHands: resolveUnarmedDamageProfile([unarmed], { holdingWeaponOrShield: false }),
      grappleDamage: resolveTurnStartGrappleDamage({
        passives: [unarmed],
        sourceActorId: 'fighter',
        selectedCapabilityId: 'fighting_style.unarmed.turn_start_grapple_damage',
        selectedTargetActorId: 'goblin',
        grapples: [{ grapplerActorId: 'fighter', targetActorId: 'goblin' }],
        rng: () => 0.999,
      }),
      invalidGrappleTarget: resolveTurnStartGrappleDamage({
        passives: [unarmed],
        sourceActorId: 'fighter',
        selectedCapabilityId: 'fighting_style.unarmed.turn_start_grapple_damage',
        selectedTargetActorId: 'wolf',
        grapples: [{ grapplerActorId: 'fighter', targetActorId: 'goblin' }],
        rng: () => 0.999,
      }),
    },
    interception: {
      resolved: resolveInterceptionReaction({
        mechanics: interception, facts: interceptionFacts, decision: 'use', rng: () => 0,
      }),
      outOfRange: resolveInterceptionReaction({
        mechanics: interception,
        facts: { ...interceptionFacts, interceptorDistanceToTargetFt: 10 },
        decision: 'use',
        rng: () => 0,
      }),
      noEquipment: resolveInterceptionReaction({
        mechanics: interception,
        facts: { ...interceptionFacts, interceptorHoldingShieldOrSimpleOrMartialWeapon: false },
        decision: 'use',
        rng: () => 0,
      }),
    },
  };
}

export const COMPLEX_STYLE_EXPECTED_SCENARIOS = {
  unarmed: {
    armed: {
      dice: '1d6', ability: 'str', damageType: 'bludgeoning',
      source: 'Боевой стиль: Сражение без оружия',
    },
    emptyHands: {
      dice: '1d8', ability: 'str', damageType: 'bludgeoning',
      source: 'Боевой стиль: Сражение без оружия',
    },
    grappleDamage: {
      status: 'resolved',
      capabilityId: 'fighting_style.unarmed.turn_start_grapple_damage',
      targetActorId: 'goblin', amount: 4, damageType: 'bludgeoning', dice: '1d4', values: [4],
      source: 'Боевой стиль: Сражение без оружия',
    },
    invalidGrappleTarget: { status: 'invalid_target' },
  },
  interception: {
    resolved: {
      status: 'resolved', capabilityId: 'fighting_style.interception.reaction',
      reactionSpent: true, rolledReduction: 3, appliedReduction: 3,
      damageAfter: 6, diceValues: [1],
    },
    outOfRange: { status: 'rejected', reason: 'target_out_of_range', reactionSpent: false },
    noEquipment: {
      status: 'rejected', reason: 'equipment_requirement_failed', reactionSpent: false,
    },
  },
} as const;
