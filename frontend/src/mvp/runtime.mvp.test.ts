/**
 * Фаза D — runtime: ресурсы, стоимость, ход, отдыхи, активные эффекты (D1–D4).
 * Зелёный набор = «система ресурсов, смена хода, короткий и долгий отдых».
 */
import { describe, expect, it } from 'vitest';
import {
  canPay, collectRollModifiers, executeAction, initResources, longRest, pay, shortRest, startTurn,
} from './contracts';
import {
  FIGHTER_CTX, freshFighterState, MECH_DODGE, MECH_RESOURCEFUL, seededRng,
} from './fixtures';

describe('D1: инициализация ресурсов', () => {
  it('ресурсы класса по формуле + гранты (heroic_inspiration от Находчивого)', () => {
    const classResources = { second_wind: { count: 2, per: 'short_rest' } };
    const grants = [{ kind: 'resource', op: 'grant', id: 'heroic_inspiration', amount: 1 }];
    const { resources, maxResources } = initResources(FIGHTER_CTX, classResources, grants);
    expect(maxResources.second_wind).toBe(2);
    expect(resources.second_wind).toBe(2);
    expect(maxResources.heroic_inspiration).toBe(1);
    // базовые экшен-ресурсы всегда присутствуют
    expect(maxResources.action).toBe(1);
    expect(maxResources.bonus_action).toBe(1);
    expect(maxResources.reaction).toBe(1);
  });
});

describe('D2: стоимость (мультиресурс)', () => {
  const COST = [{ resource: 'bonus_action' }, { resource: 'second_wind', amount: 1 }];

  it('canPay: хватает — ok; после траты бонусного действия — нет', () => {
    const state = freshFighterState();
    expect(canPay(state, COST).ok).toBe(true);
    const spent = { ...state, resources: { ...state.resources, bonus_action: 0 } };
    const res = canPay(spent, COST);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('bonus_action');
  });

  it('pay списывает все ресурсы и генерирует события resource_spent', () => {
    const { state, events } = pay(freshFighterState(), COST);
    expect(state.resources.bonus_action).toBe(0);
    expect(state.resources.second_wind).toBe(1);
    const spentEvents = events.filter((e) => e.type === 'resource_spent');
    expect(spentEvents).toHaveLength(2);
  });
});

describe('D3: ход и отдыхи', () => {
  it('startTurn восстанавливает action/bonus/reaction, но НЕ second_wind', () => {
    const state = freshFighterState();
    state.resources = { ...state.resources, action: 0, bonus_action: 0, reaction: 0, second_wind: 0 };
    const { state: next, events } = startTurn(state);
    expect(next.resources.action).toBe(1);
    expect(next.resources.bonus_action).toBe(1);
    expect(next.resources.reaction).toBe(1);
    expect(next.resources.second_wind).toBe(0);
    expect(events.some((e) => e.type === 'turn_started')).toBe(true);
  });

  it('shortRest восстанавливает ресурсы per:short_rest', () => {
    const state = freshFighterState();
    state.resources = { ...state.resources, second_wind: 0 };
    state.maxResources = { ...state.maxResources };
    const { state: next } = shortRest(state, FIGHTER_CTX);
    expect(next.resources.second_wind).toBe(state.maxResources.second_wind);
  });

  it('longRest: HP до максимума, все ресурсы, активные эффекты сняты', () => {
    const state = freshFighterState();
    state.hp = { current: 3, max: 11, temp: 0 };
    state.resources = { ...state.resources, second_wind: 0, heroic_inspiration: 0 };
    state.activeEffects = [{ id: 'x', name: 'Бафф', mechanics: {}, source: 'тест' }];
    const { state: next, events } = longRest(state, FIGHTER_CTX);
    expect(next.hp.current).toBe(11);
    expect(next.resources.second_wind).toBe(2);
    expect(next.activeEffects).toHaveLength(0);
    expect(events.some((e) => e.type === 'long_rest')).toBe(true);
  });

  it('триггер after long_rest (Находчивый) выдаёт ресурс при длинном отдыхе', () => {
    const state = freshFighterState();
    state.resources = { ...state.resources, heroic_inspiration: 0 };
    // passives персонажа передаются через ctx — реализация решает как,
    // но события восстановления должны появиться
    const ctxWithPassives = { ...FIGHTER_CTX, passives: [MECH_RESOURCEFUL] } as typeof FIGHTER_CTX;
    const { state: next } = longRest(state, ctxWithPassives);
    expect(next.resources.heroic_inspiration).toBe(1);
  });
});

describe('D4: активные эффекты и модификаторы бросков', () => {
  it('Уклонение вешает активный эффект; атаки по себе получают помеху', () => {
    const { state, events } = executeAction(freshFighterState(), MECH_DODGE, {
      character: FIGHTER_CTX, rng: seededRng(1),
    });
    expect(events.some((e) => e.type === 'effect_applied')).toBe(true);
    expect(state.activeEffects.length).toBeGreaterThan(0);

    const incoming = collectRollModifiers(state, [], { roll: 'attack', filter: { against: 'self' } });
    expect(incoming.advantage).toBe('disadvantage');

    const dexSave = collectRollModifiers(state, [], { roll: 'saving_throw', filter: { ability: 'dex' } });
    expect(dexSave.advantage).toBe('advantage');
  });

  it('эффект until_start_of_next_turn истекает на startTurn', () => {
    const { state } = executeAction(freshFighterState(), MECH_DODGE, {
      character: FIGHTER_CTX, rng: seededRng(1),
    });
    const { state: next, events } = startTurn(state);
    expect(next.activeEffects).toHaveLength(0);
    expect(events.some((e) => e.type === 'effect_expired')).toBe(true);
  });
});
