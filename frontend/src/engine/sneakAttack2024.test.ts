import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';

type Dict = Record<string, unknown>;

const DAGGER = withDeclaredTestWeaponProfile({
  id: 'item:dagger', name: 'Кинжал', type: 'weapon', weapon_type: 'dagger',
  bonus_value: '1d4', damage_type: 'piercing', properties: ['finesse', 'light'],
} as unknown as Card, {
  weaponType: 'dagger', proficiencyCategory: 'simple', attackAbility: 'finesse',
  damageLines: [{ dice: '1d4', type: 'piercing' }],
  defaultAttackMode: 'melee', attackModes: [
    { kind: 'melee', reach_ft: 5 },
    { kind: 'ranged', normal_ft: 20, long_ft: 60 },
  ],
  properties: ['finesse', 'light', 'thrown'], masteryEffectId: 'effect:test:nick',
});

const LONGSWORD = withDeclaredTestWeaponProfile({
  id: 'item:longsword', name: 'Длинный меч', type: 'weapon', weapon_type: 'longsword',
  bonus_value: '1d8', damage_type: 'slashing', properties: ['versatile'],
} as unknown as Card, {
  weaponType: 'longsword', proficiencyCategory: 'martial', attackAbility: 'str',
  damageLines: [{ dice: '1d8', type: 'slashing' }],
  defaultAttackMode: 'melee', attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: [], masteryEffectId: 'effect:test:sap',
});

const SNEAK_ATTACK: Dict = {
  id: 'EFF-sneak-attack',
  name: 'Скрытая атака',
  activation: {
    mode: 'triggered',
    trigger: {
      event: 'hit',
      timing: 'during',
      circumstances: [{
        kind: 'all_of',
        of: [
          { kind: 'any_of', of: [
            { kind: 'attack_weapon_property', value: 'finesse' },
            { kind: 'attack_range', value: 'ranged' },
          ] },
          { kind: 'any_of', of: [
            { kind: 'attack_advantage_state', value: 'advantage' },
            { kind: 'all_of', of: [
              { kind: 'nearby_eligible_ally_to_target' },
              { kind: 'not', of: { kind: 'attack_advantage_state', value: 'disadvantage' } },
            ] },
          ] },
        ],
      }],
    },
  },
  uses: { count: 1, per: 'turn' },
  effects: [{
    resolution: 'auto', who: 'target',
    result: [{ kind: 'damage', dice: '1d6', type: 'weapon', ability: 'none' }],
  }],
};

const ATTACK: Dict = {
  name: 'Атака оружием',
  effects: [{
    resolution: 'attack_roll', ability: 'auto',
    on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
  }],
};

const targetCharacter: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

function runtime(weapon: Card, rollState: 'none' | 'advantage' | 'disadvantage' = 'none'): RuntimeState {
  return {
    hp: { current: 20, max: 20, temp: 0 },
    resources: { action: 1 },
    maxResources: { action: 1 },
    equipment: { main_hand: weapon.id },
    inventory: [],
    activeEffects: rollState === 'none' ? [] : [{
      id: `roll:${rollState}`,
      name: rollState,
      source: 'test',
      mechanics: { kind: 'modifier', applies_to: { roll: 'attack' }, op: rollState },
    }],
  };
}

function targetRuntime(): RuntimeState {
  return {
    hp: { current: 40, max: 40, temp: 0 },
    resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [],
  };
}

function sequence(values: number[]): () => number {
  let cursor = 0;
  return () => values[cursor++] ?? 0.5;
}

function context(
  weapon: Card,
  source: RuntimeState,
  target: RuntimeState,
  values: number[],
  nearbyEligibleAllyToTarget = false,
): ExecuteContext {
  return {
    character: {
      abilityMods: { str: 1, dex: 3, con: 1, int: 0, wis: 1, cha: 0 },
      profBonus: 2,
      level: 1,
      equippedCards: [weapon],
      knownCards: [weapon],
    },
    selfRuntime: source,
    passives: [SNEAK_ATTACK],
    target: { ac: 10, characterContext: targetCharacter, runtimeState: target },
    attackFacts: { nearbyEligibleAllyToTarget },
    rng: sequence(values),
  };
}

function damages(events: EngineEvent[]) {
  return events.filter((event): event is Extract<EngineEvent, { type: 'damage' }> => event.type === 'damage');
}

describe('Sneak Attack (PHB 2024)', () => {
  it('requires a Finesse/Ranged weapon and Advantage, then fires only once per turn', () => {
    const source = runtime(DAGGER, 'advantage');
    const target = targetRuntime();
    const first = executeAction(source, ATTACK, context(DAGGER, source, target, [0.4, 0.8, 0.3, 0.4]));
    expect(damages(first.events)).toHaveLength(2);
    expect(first.state.firedThisTurn).toContain('EFF-sneak-attack');
    expect(first.events).toContainEqual({ type: 'narrative', text: 'Сработало: Скрытая атака' });

    const secondTarget = first.targetState ?? target;
    const second = executeAction(
      first.state,
      ATTACK,
      context(DAGGER, first.state, secondTarget, [0.4, 0.8, 0.3]),
    );
    expect(damages(second.events)).toHaveLength(1);
    expect(second.events).not.toContainEqual({ type: 'narrative', text: 'Сработало: Скрытая атака' });

    const swordSource = runtime(LONGSWORD, 'advantage');
    const sword = executeAction(
      swordSource,
      ATTACK,
      context(LONGSWORD, swordSource, targetRuntime(), [0.4, 0.8, 0.3]),
    );
    expect(damages(sword.events)).toHaveLength(1);
  });

  it('accepts an explicit nearby eligible ally fact, but not while the roll has Disadvantage', () => {
    const ordinary = runtime(DAGGER);
    const withAlly = executeAction(
      ordinary,
      ATTACK,
      context(DAGGER, ordinary, targetRuntime(), [0.7, 0.3, 0.4], true),
    );
    expect(damages(withAlly.events)).toHaveLength(2);

    const disadvantaged = runtime(DAGGER, 'disadvantage');
    const blocked = executeAction(
      disadvantaged,
      ATTACK,
      context(DAGGER, disadvantaged, targetRuntime(), [0.8, 0.7, 0.3], true),
    );
    expect(damages(blocked.events)).toHaveLength(1);
  });

  it('rolls Sneak Attack dice twice on a critical hit', () => {
    const source = runtime(DAGGER);
    const result = executeAction(
      source,
      ATTACK,
      context(DAGGER, source, targetRuntime(), [0.999, 0.2, 0.3, 0.4, 0.5], true),
    );
    const damage = damages(result.events);
    expect(damage).toHaveLength(2);
    expect(damage[0].roll?.dice).toHaveLength(2);
    expect(damage[1].roll?.dice).toHaveLength(2);
  });
});
