import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import type {
  CharacterContext,
  EngineEvent,
  RollLog,
  RuntimeState,
} from '../mvp/contracts';
import {
  CARD_DAGGER,
  CARD_LEATHER_ARMOR,
  CARD_LONGSWORD,
  CARD_SHIELD,
  FIGHTER_CTX,
  MECH_OFFHAND_ATTACK,
  MECH_WEAPON_ATTACK,
  freshFighterState,
} from '../mvp/fixtures';
import {
  MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  createMicroMvpFightingStylePassiveMechanics,
  type MicroMvpFightingStyleProjectionKind,
} from '../rules-core/testing/fightingStyleFixtures';
import { armorClassValue } from './ac';
import { executeAction } from './execute';
import { weaponAttackPreview } from './weapon';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';

type Dict = Record<string, unknown>;

const SHORTBOW: Card = withDeclaredTestWeaponProfile({
  ...CARD_LONGSWORD,
  id: 'test-shortbow',
  name: 'Короткий лук',
  card_number: 'TEST-shortbow',
  weapon_type: 'shortbow',
  slot: 'two_hands',
  bonus_value: '1d6',
  damage_type: 'piercing',
  properties: ['ammunition', 'two_handed'],
  tags: ['Простое', 'Дальнобойное'],
}, {
  weaponType: 'shortbow', proficiencyCategory: 'simple', attackAbility: 'dex',
  damageLines: [{ dice: '1d6', type: 'piercing' }],
  defaultAttackMode: 'ranged',
  attackModes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
  properties: ['ammunition', 'two_handed'], masteryEffectId: 'effect:test:vex',
  ammo: { card_id: 'card:test-arrow' },
});

const SCIMITAR: Card = withDeclaredTestWeaponProfile({
  ...CARD_LONGSWORD,
  id: 'test-scimitar',
  name: 'Скимитар',
  card_number: 'TEST-scimitar',
  weapon_type: 'scimitar',
  bonus_value: '1d6',
  damage_type: 'slashing',
  properties: ['finesse', 'light'],
}, {
  weaponType: 'scimitar', proficiencyCategory: 'martial', attackAbility: 'finesse',
  damageLines: [{ dice: '1d6', type: 'slashing' }],
  defaultAttackMode: 'melee', attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['finesse', 'light'], masteryEffectId: 'effect:test:nick',
});

const SPELL_ATTACK: Dict = {
  effects: [{
    resolution: 'attack_roll',
    ability: 'spellcasting',
    attack_kind: 'spell',
    on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire' }],
  }],
};

function style(kind: Exclude<MicroMvpFightingStyleProjectionKind, 'protection'>): Dict {
  const mechanics = createMicroMvpFightingStylePassiveMechanics({
    kind,
    sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES[kind].sourceEntityIds,
  });
  if (!mechanics) throw new Error(`Missing ${kind} passive bridge`);
  return mechanics;
}

function stateWithEquipment(
  equipment: RuntimeState['equipment'],
): RuntimeState {
  const state = freshFighterState();
  state.equipment = { ...equipment };
  return state;
}

function characterWithCards(
  cards: Card[],
  abilityMods: CharacterContext['abilityMods'] = FIGHTER_CTX.abilityMods,
): CharacterContext {
  return {
    ...FIGHTER_CTX,
    abilityMods,
    spellcastingMod: 3,
    equippedCards: cards,
    knownCards: cards,
  };
}

function attackRoll(events: EngineEvent[]): RollLog {
  const event = events.find((candidate): candidate is Extract<EngineEvent, { type: 'roll' }> => (
    candidate.type === 'roll' && candidate.roll.kind === 'd20'
  ));
  if (!event) throw new Error('Expected an attack roll');
  return event.roll;
}

function damageRoll(events: EngineEvent[]): RollLog {
  const event = events.find((candidate): candidate is Extract<EngineEvent, { type: 'damage' }> => (
    candidate.type === 'damage' && candidate.roll?.kind === 'damage'
  ));
  if (!event?.roll) throw new Error('Expected a damage roll');
  return event.roll;
}

function modifierTotal(roll: RollLog): number {
  return roll.modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}

function executeAttack(
  mechanics: Dict,
  state: RuntimeState,
  character: CharacterContext,
  passives: Dict[] = [],
): EngineEvent[] {
  return executeAction(state, mechanics, {
    character,
    passives,
    target: { ac: 1 },
    rng: () => 0.5,
  }).events;
}

describe('legacy-engine bridge: Fighting Style — Archery', () => {
  const archery = style('archery');

  function attackDelta(card: Card, mechanics: Dict = MECH_WEAPON_ATTACK): number {
    const character = characterWithCards([card]);
    const equipment = { main_hand: card.id };
    const withStyle = attackRoll(executeAttack(
      mechanics, stateWithEquipment(equipment), character, [archery],
    ));
    const baseline = attackRoll(executeAttack(
      mechanics, stateWithEquipment(equipment), character,
    ));
    return modifierTotal(withStyle) - modifierTotal(baseline);
  }

  it('uses the equipped Card category: Ranged +2; thrown Melee, ordinary Melee, and spell +0', () => {
    expect(attackDelta(SHORTBOW)).toBe(2);
    expect(attackDelta(CARD_DAGGER)).toBe(0);
    expect(attackDelta(CARD_LONGSWORD)).toBe(0);

    const spellCharacter = characterWithCards([SHORTBOW]);
    const spellState = stateWithEquipment({ main_hand: SHORTBOW.id });
    const spellWithStyle = attackRoll(executeAttack(
      SPELL_ATTACK, spellState, spellCharacter, [archery],
    ));
    const spellBaseline = attackRoll(executeAttack(
      SPELL_ATTACK, stateWithEquipment({ main_hand: SHORTBOW.id }), spellCharacter,
    ));
    expect(modifierTotal(spellWithStyle) - modifierTotal(spellBaseline)).toBe(0);
  });

  it('keeps attack preview and execution on the same modifier path', () => {
    const character = characterWithCards([SHORTBOW]);
    const equipment = { main_hand: SHORTBOW.id };
    const baselineState = stateWithEquipment(equipment);
    const styledState = stateWithEquipment(equipment);
    const baselinePreview = weaponAttackPreview(
      MECH_WEAPON_ATTACK, character, equipment, baselineState, [],
    );
    const styledPreview = weaponAttackPreview(
      MECH_WEAPON_ATTACK, character, equipment, styledState, [archery],
    );
    const baselineRoll = attackRoll(executeAttack(
      MECH_WEAPON_ATTACK, baselineState, character,
    ));
    const styledRoll = attackRoll(executeAttack(
      MECH_WEAPON_ATTACK, styledState, character, [archery],
    ));

    expect(styledPreview!.attack - baselinePreview!.attack).toBe(2);
    expect(modifierTotal(styledRoll) - modifierTotal(baselineRoll)).toBe(2);
    expect(styledPreview!.attack).toBe(modifierTotal(styledRoll));
    expect(styledRoll.modifiers).toContainEqual({
      value: 2,
      source: 'Fighting Style: Archery',
    });
  });
});

describe('legacy-engine bridge: Fighting Style — Defense', () => {
  const defense = style('defense');
  const character = characterWithCards([CARD_LEATHER_ARMOR, CARD_SHIELD]);

  function acDelta(equipment: RuntimeState['equipment']): number {
    const withStyle = armorClassValue(
      character, stateWithEquipment(equipment), [defense],
    ).value;
    const baseline = armorClassValue(character, stateWithEquipment(equipment), []).value;
    return withStyle - baseline;
  }

  it('derives wearingArmor from the body Card: armored +1, unarmored and shield-only +0', () => {
    expect(acDelta({ body: CARD_LEATHER_ARMOR.id })).toBe(1);
    expect(acDelta({})).toBe(0);
    expect(acDelta({ off_hand: CARD_SHIELD.id })).toBe(0);
  });
});

describe('legacy-engine bridge: Fighting Style — Two-Weapon Fighting', () => {
  const twoWeaponFighting = style('twoWeaponFighting');
  const dualWielderMods = { ...FIGHTER_CTX.abilityMods, str: 1, dex: 3 };

  function runOffhand(
    mechanics: Dict,
    main: Card,
    off: Card,
    passives: Dict[] = [],
  ): { roll: RollLog; preview: NonNullable<ReturnType<typeof weaponAttackPreview>> } {
    const character = characterWithCards([main, off], dualWielderMods);
    const equipment = { main_hand: main.id, off_hand: off.id };
    const state = stateWithEquipment(equipment);
    const roll = damageRoll(executeAttack(mechanics, state, character, passives));
    const preview = weaponAttackPreview(mechanics, character, equipment, state, passives);
    if (!preview) throw new Error('Expected weapon preview');
    return { roll, preview };
  }

  function damageDelta(mechanics: Dict, main: Card, off: Card): number {
    const styled = runOffhand(mechanics, main, off, [twoWeaponFighting]);
    const baseline = runOffhand(mechanics, main, off);
    return styled.roll.total - baseline.roll.total;
  }

  it('adds the attack ability modifier only to the extra attack granted by two Light Cards', () => {
    expect(damageDelta(MECH_OFFHAND_ATTACK, CARD_DAGGER, SCIMITAR)).toBe(3);

    const styled = runOffhand(
      MECH_OFFHAND_ATTACK, CARD_DAGGER, SCIMITAR, [twoWeaponFighting],
    );
    expect(styled.roll.modifiers).toContainEqual({
      value: 3,
      source: 'Fighting Style: Two-Weapon Fighting',
    });
    expect(styled.preview.damages[0].bonus).toBe(modifierTotal(styled.roll));
  });

  it('does not affect a non-Light pair, another off-hand attack, or normal main-hand damage', () => {
    expect(damageDelta(MECH_OFFHAND_ATTACK, CARD_LONGSWORD, CARD_DAGGER)).toBe(0);

    const otherOffhand: Dict = {
      ...MECH_OFFHAND_ATTACK,
      effects: [{
        ...(MECH_OFFHAND_ATTACK.effects as Dict[])[0],
        tags: ['off_hand'],
      }],
    };
    expect(damageDelta(otherOffhand, CARD_DAGGER, SCIMITAR)).toBe(0);

    const mainCharacter = characterWithCards([CARD_DAGGER, SCIMITAR], dualWielderMods);
    const mainEquipment = { main_hand: CARD_DAGGER.id, off_hand: SCIMITAR.id };
    const styled = damageRoll(executeAttack(
      MECH_WEAPON_ATTACK,
      stateWithEquipment(mainEquipment),
      mainCharacter,
      [twoWeaponFighting],
    ));
    const baseline = damageRoll(executeAttack(
      MECH_WEAPON_ATTACK,
      stateWithEquipment(mainEquipment),
      mainCharacter,
    ));
    expect(styled.total - baseline.total).toBe(0);
  });

  it('never adds a second ability modifier when the damage payload already includes one', () => {
    const alreadyIncluded: Dict = {
      ...MECH_OFFHAND_ATTACK,
      effects: [{
        ...(MECH_OFFHAND_ATTACK.effects as Dict[])[0],
        on_hit: [{ ability: 'auto', dice: 'weapon', kind: 'damage', type: 'weapon' }],
      }],
    };
    const styled = runOffhand(
      alreadyIncluded, CARD_DAGGER, SCIMITAR, [twoWeaponFighting],
    );
    const baseline = runOffhand(alreadyIncluded, CARD_DAGGER, SCIMITAR);

    expect(styled.roll.total - baseline.roll.total).toBe(0);
    expect(styled.preview.damages[0].bonus).toBe(3);
    expect(styled.roll.modifiers.filter(
      (modifier) => modifier.source === 'Fighting Style: Two-Weapon Fighting',
    )).toEqual([]);
  });
});
