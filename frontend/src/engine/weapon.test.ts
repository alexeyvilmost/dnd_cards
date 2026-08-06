import { describe, expect, it } from 'vitest';
import { collectRollModifiers, executeAction, type CharacterContext, type ActiveEffectEntry } from '../mvp/contracts';
import {
  CARD_DAGGER, CARD_LONGSWORD, equippedFighterState, FIGHTER_CTX, FIGHTER_CTX_EQUIPPED,
  freshFighterState, MECH_DODGE, MECH_WEAPON_ATTACK, seededRng,
} from '../mvp/fixtures';
import { weaponContext, weaponAttackPreview } from './weapon';
import { projectedAgainst } from './execute';
import type { Card } from '../types';
import {
  withDeclaredTestWeaponProfile,
  type DeclaredTestWeaponProfile,
} from '../testing/weaponProfileFixtures';

describe('weaponContext slots (R3)', () => {
  it('основная рука по слоту, не по порядку карточек в массиве', () => {
    const ctx = {
      ...FIGHTER_CTX,
      equippedCards: [CARD_DAGGER, CARD_LONGSWORD],
    };
    const equipment = { main_hand: CARD_LONGSWORD.id, off_hand: CARD_DAGGER.id };
    expect(weaponContext(ctx, 'main', equipment)?.dice).toBe('1d8');
    expect(weaponContext(ctx, 'off', equipment)?.dice).toBe('1d4');
  });
});

describe('C11: способность атаки берётся из mechanics.weapon_profile', () => {
  // Силач: СИЛ > ЛВК — чтобы явно отличить dex-профиль от finesse.
  const strChar: CharacterContext = { ...FIGHTER_CTX, abilityMods: { str: 5, dex: 1, con: 2, int: 0, wis: 1, cha: 0 } };
  const mkWeapon = (profile: Partial<DeclaredTestWeaponProfile> = {}): Card => (
    withDeclaredTestWeaponProfile({
      ...CARD_LONGSWORD,
      id: 'w',
      name: 'Тест-оружие',
      bonus_value: '1d8',
    }, {
      weaponType: 'longsword',
      proficiencyCategory: 'martial',
      attackAbility: 'str',
      damageLines: [{ dice: '1d8', type: 'slashing' }],
      defaultAttackMode: 'melee',
      attackModes: [{ kind: 'melee', reach_ft: 5 }],
      properties: [],
      masteryEffectId: 'mastery:test',
      ...profile,
    })
  );
  const abilityOf = (card: Card) =>
    weaponContext({ ...strChar, equippedCards: [card] }, 'main', { main_hand: card.id })?.ability;

  it('явно объявленный дальнобойный профиль использует ЛВК, несмотря на большую СИЛ', () => {
    expect(abilityOf(mkWeapon({
      weaponType: 'longbow',
      attackAbility: 'dex',
      damageLines: [{ dice: '1d8', type: 'piercing' }],
      defaultAttackMode: 'ranged',
      attackModes: [{ kind: 'ranged', normal_ft: 150, long_ft: 600 }],
      properties: ['ammunition', 'heavy', 'two_handed'],
      ammo: { card_id: 'card:arrow', name: 'Стрела' },
    }))).toBe('dex');
  });

  it('не выводит правила из отображаемых properties/tags без weapon_profile', () => {
    const undeclared = {
      ...CARD_LONGSWORD,
      id: 'legacy-display-only',
      name: 'Лук только по отображаемым полям',
      mechanics: {},
      properties: ['ammunition', 'two_handed'] as unknown as Card['properties'],
      tags: ['Воинское', 'Дальнобойное'] as unknown as Card['tags'],
    };
    expect(abilityOf(undeclared)).toBeUndefined();
  });

  it('рукопашное без finesse — СИЛ', () => {
    expect(abilityOf(mkWeapon({ properties: ['heavy'] }))).toBe('str');
  });

  it('finesse (не дальнобойное) — лучший из СИЛ/ЛВК = СИЛ у силача', () => {
    expect(abilityOf(mkWeapon({
      weaponType: 'rapier',
      attackAbility: 'finesse',
      properties: ['finesse'],
    }))).toBe('str');
  });
});

describe('Уклонение (R2 / KB-025): помеха проецируется на атакующего', () => {
  it('после Уклонения: свои броски атаки без помехи, атака ПО уклоняющемуся — с помехой', () => {
    const { state } = executeAction(freshFighterState(), MECH_DODGE, {
      character: FIGHTER_CTX,
      rng: seededRng(1),
    });

    // Свои броски атаки уклоняющегося — без помехи: scope:'target' не применяется к себе
    // (modifiers.ts:93 исключает его из self-коллектора).
    const own = collectRollModifiers(state, [], { roll: 'attack' });
    expect(own.advantage).toBe('none');

    // Входящая атака: враг атакует уклоняющегося (ctx.target = уклоняющийся) → projectedAgainst
    // читает scope:'target' помеху. Это РЕАЛЬНЫЙ путь движка (execute.ts:976), а не мёртвый
    // запрос collectRollModifiers(filter:{against:'self'}), которого в проде не делает никто.
    const projected = projectedAgainst({ runtimeState: state }, 'attack');
    expect(projected.advantage).toBe('disadvantage');
    expect(projected.hasDisadvantage).toBe(true);
  });
});

// C1: golden — модификаторы урона из эффектов (Ярость) доходят до броска урона.
describe('C1: модификаторы урона из эффектов (Ярость)', () => {
  const RAGE: ActiveEffectEntry = {
    id: 'rage', name: 'Ярость', source: 'Ярость',
    mechanics: {
      effects: [{
        result: [{
          kind: 'modifier',
          applies_to: { roll: 'damage', filter: { ability: 'str' } },
          op: 'add', value: 'rage_damage_modifier',
        }],
      }],
    },
  };
  const character: CharacterContext = { ...FIGHTER_CTX_EQUIPPED, variables: { rage_damage_modifier: 2 } };

  const damageTotal = (effects: ActiveEffectEntry[]) => {
    const state = equippedFighterState();
    state.activeEffects = effects;
    const { events } = executeAction(state, MECH_WEAPON_ATTACK, {
      character, target: { ac: 1 }, rng: seededRng(30),
    });
    const dmg = events.find((e) => e.type === 'damage');
    expect(dmg).toBeTruthy(); // атака по КЗ 1 обязана попасть — иначе нет строки урона
    return dmg && dmg.type === 'damage' ? dmg.roll?.total ?? 0 : 0;
  };

  it('активна → урон оружием (СИЛ) выше ровно на rage_damage_modifier', () => {
    // Тот же seed → те же кости; разница = только модификатор Ярости.
    expect(damageTotal([RAGE]) - damageTotal([])).toBe(2);
  });

  it('фильтр по ability работает: dex-модификатор не падает на str-атаку', () => {
    const dexMod: ActiveEffectEntry = {
      ...RAGE,
      mechanics: {
        effects: [{
          result: [{
            kind: 'modifier',
            applies_to: { roll: 'damage', filter: { ability: 'dex' } },
            op: 'add', value: 'rage_damage_modifier',
          }],
        }],
      },
    };
    expect(damageTotal([dexMod]) - damageTotal([])).toBe(0);
  });

  it('превью урона отражает модификатор эффекта (парадигма №2: превью = исполнение)', () => {
    const base = equippedFighterState();
    const withoutRage = weaponAttackPreview(MECH_WEAPON_ATTACK, character, base.equipment, base, []);
    const raging = equippedFighterState();
    raging.activeEffects = [RAGE];
    const withRage = weaponAttackPreview(MECH_WEAPON_ATTACK, character, raging.equipment, raging, []);
    expect(withRage!.damages[0].bonus - withoutRage!.damages[0].bonus).toBe(2);
  });
});
