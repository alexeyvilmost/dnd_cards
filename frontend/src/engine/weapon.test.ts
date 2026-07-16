import { describe, expect, it } from 'vitest';
import { collectRollModifiers, executeAction, type CharacterContext, type ActiveEffectEntry } from '../mvp/contracts';
import {
  CARD_DAGGER, CARD_LONGSWORD, equippedFighterState, FIGHTER_CTX, FIGHTER_CTX_EQUIPPED,
  freshFighterState, MECH_DODGE, MECH_WEAPON_ATTACK, seededRng,
} from '../mvp/fixtures';
import { weaponContext, weaponAttackPreview } from './weapon';
import { projectedAgainst } from './execute';
import type { Card } from '../types';

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

describe('C11: дальнобойное оружие атакует от ЛВК', () => {
  // Силач: СИЛ > ЛВК — чтобы «дальнобойное→ЛВК» не спуталось с finesse «лучший из двух».
  const strChar: CharacterContext = { ...FIGHTER_CTX, abilityMods: { str: 5, dex: 1, con: 2, int: 0, wis: 1, cha: 0 } };
  const mkWeapon = (props: string[], tags: string[] = []): Card => ({
    ...CARD_LONGSWORD, id: 'w', name: 'Тест-оружие', bonus_value: '1d8',
    properties: props as unknown as Card['properties'],
    tags: tags as unknown as Card['tags'],
  });
  const abilityOf = (card: Card) =>
    weaponContext({ ...strChar, equippedCards: [card] }, 'main', { main_hand: card.id })?.ability;

  it('лук (свойство ammunition) — ЛВК, несмотря на бОльшую СИЛ', () => {
    expect(abilityOf(mkWeapon(['ammunition', 'two_handed']))).toBe('dex');
  });
  it('тег «Дальнобойное» — ЛВК (фолбэк без свойства ammunition)', () => {
    expect(abilityOf(mkWeapon([], ['Воинское', 'Дальнобойное']))).toBe('dex');
  });
  it('рукопашное без finesse — СИЛ', () => {
    expect(abilityOf(mkWeapon(['heavy']))).toBe('str');
  });
  it('finesse (не дальнобойное) — лучший из СИЛ/ЛВК = СИЛ у силача', () => {
    expect(abilityOf(mkWeapon(['finesse', 'light']))).toBe('str');
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
