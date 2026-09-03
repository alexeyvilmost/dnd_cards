import { describe, expect, it } from 'vitest';
import { freshFighterState, FIGHTER_CTX } from '../mvp/fixtures';
import { resourcesRestoredOnShortRest } from './resources';
import { endTurn, nextTurn, nextTurnWithReactions, shortRest, startTurn } from './turn';
import type { EngineEvent } from '../mvp/contracts';
import { MechanicsExecutionError } from './execute';

type Dict = Record<string, unknown>;
const narratives = (events: EngineEvent[]) => events
  .filter((e): e is Extract<EngineEvent, { type: 'narrative' }> => e.type === 'narrative')
  .map((e) => e.text);
const listener = (name: string, event: string): Dict => ({
  name, activation: { mode: 'triggered', trigger: { event } },
  effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }],
});

describe('resource recharge (R4)', () => {
  it('second_wind на short_rest, rage_charge только на long_rest', () => {
    const recharge = { second_wind: 'short_rest', rage_charge: 'long_rest' };
    expect(resourcesRestoredOnShortRest({ second_wind: 2, rage_charge: 2 }, recharge))
      .toEqual(['second_wind']);

    const state = freshFighterState();
    state.resources = { ...state.resources, second_wind: 0, rage_charge: 0 };
    state.maxResources = { ...state.maxResources, rage_charge: 2 };
    const { state: next } = shortRest(state, { ...FIGHTER_CTX, resourceRecharge: recharge });
    expect(next.resources.second_wind).toBe(2);
    expect(next.resources.rage_charge).toBe(0);
  });

  it('Sorcerous Restoration restores half the Sorcerer level once per long rest', () => {
    const restoration: Dict = {
      id: 'EFF-sorcerous-restoration',
      name: 'Чародейское восстановление',
      activation: { mode: 'triggered', trigger: { event: 'short_rest', timing: 'during' } },
      uses: { count: 1, per: 'long_rest' },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'resource', op: 'restore', id: 'sorcery_points',
          amount: 'floor(class_level:sorcerer/2)',
        }],
      }],
    };
    const state = freshFighterState();
    state.resources.sorcery_points = 1;
    state.maxResources.sorcery_points = 5;
    const ctx = {
      ...FIGHTER_CTX,
      classLevels: { sorcerer: 5 },
      resourceRecharge: { sorcery_points: 'long_rest' },
      passives: [restoration],
    } as typeof FIGHTER_CTX;

    const first = shortRest(state, ctx);
    expect(first.state.resources.sorcery_points).toBe(3);
    expect(first.events).toContainEqual({
      type: 'resource_restored', resource: 'sorcery_points', amount: 2, current: 3,
    });
    expect(first.state.firedThisRest).toContain('EFF-sorcerous-restoration');

    const second = shortRest(first.state, ctx);
    expect(second.state.resources.sorcery_points).toBe(3);
    expect(second.events.some((event) => event.type === 'resource_restored'
      && event.resource === 'sorcery_points')).toBe(false);
  });
});

describe('C3 слайс 2 — endTurn / turn-события через шину', () => {
  it('endTurn истекает эффекты expiry:end_of_turn и кладёт лог «Конец хода»', () => {
    const state = freshFighterState();
    state.activeEffects = [{ id: 'x', name: 'Мерцание', mechanics: {}, expiry: 'end_of_turn', source: 'тест' }];
    const { state: next, events } = endTurn(state, FIGHTER_CTX);
    expect(events.some((e) => e.type === 'turn_ended')).toBe(true);
    expect(next.activeEffects.find((e) => e.name === 'Мерцание')).toBeFalsy();
    expect(events.some((e) => e.type === 'effect_expired' && e.name === 'Мерцание')).toBe(true);
  });

  it('endTurn save_ends: успех снимает состояние (низкая СЛ), провал сохраняет (высокая)', () => {
    const rng = () => 0.5; // натуральная 11
    const mk = (dc: string) => {
      const s = freshFighterState();
      s.activeEffects = [{ id: 'psn', name: 'Отравление', source: 'яд',
        mechanics: { kind: 'condition', value: 'poisoned', save_ends: { ability: 'con', dc } } }];
      return endTurn(s, { ...FIGHTER_CTX, rng } as typeof FIGHTER_CTX);
    };
    const win = mk('1');
    expect(win.state.activeEffects.find((e) => e.name === 'Отравление')).toBeFalsy();
    const lose = mk('99');
    expect(lose.state.activeEffects.find((e) => e.name === 'Отравление')).toBeTruthy();
  });

  it('endTurn save_ends can transition one condition on the single failed repeat save', () => {
    const state = freshFighterState();
    state.activeEffects = [{
      id: 'sleep',
      name: 'Недееспособен',
      source: 'Усыпление',
      roundsLeft: 9,
      mechanics: {
        kind: 'condition', value: 'incapacitated',
        save_ends: {
          ability: 'wis', dc: 99, timing: 'end_of_turn',
          on_failure_condition: 'unconscious',
        },
      },
    }];
    const result = endTurn(
      state,
      { ...FIGHTER_CTX, rng: () => 0 } as typeof FIGHTER_CTX,
      { advanceRoundDurations: false },
    );
    expect(result.state.activeEffects).toEqual([
      expect.objectContaining({
        id: 'sleep', roundsLeft: 9,
        mechanics: expect.objectContaining({ value: 'unconscious' }),
      }),
    ]);
    expect((result.state.activeEffects[0].mechanics as Dict).save_ends).toBeUndefined();
  });

  it.each([
    {
      label: 'ability',
      saveEnds: { dc: '10' },
      path: 'runtime.activeEffects[1].mechanics.save_ends.ability',
    },
    {
      label: 'DC',
      saveEnds: { ability: 'con' },
      path: 'runtime.activeEffects[1].mechanics.save_ends.dc',
    },
  ])('endTurn rejects save_ends without explicit $label before every roll or transition', ({ saveEnds, path }) => {
    const state = freshFighterState();
    state.activeEffects = [
      {
        id: 'valid-first',
        name: 'Явный спасбросок',
        source: 'test',
        mechanics: { kind: 'condition', value: 'poisoned', save_ends: { ability: 'con', dc: '10' } },
      },
      {
        id: 'invalid-second',
        name: 'Неполный спасбросок',
        source: 'test',
        mechanics: { kind: 'condition', value: 'poisoned', save_ends: saveEnds },
      },
    ];
    const before = structuredClone(state);
    let rngCalls = 0;
    try {
      endTurn(state, { ...FIGHTER_CTX, rng: () => { rngCalls += 1; return 0.5; } } as typeof FIGHTER_CTX);
      throw new Error('Expected fail-closed save_ends error');
    } catch (error) {
      expect(error).toBeInstanceOf(MechanicsExecutionError);
      expect((error as MechanicsExecutionError).code).toBe('INVALID_PAYLOAD');
      expect((error as MechanicsExecutionError).path).toBe(path);
    }
    expect(state).toEqual(before);
    expect(rngCalls).toBe(0);
  });

  it('endTurn эмитит turn_end → будит triggered-слушателя', () => {
    const { events } = endTurn(freshFighterState(), { ...FIGHTER_CTX, passives: [listener('Тикающий яд', 'turn_end')] } as typeof FIGHTER_CTX);
    expect(narratives(events)).toContain('Сработало: Тикающий яд');
  });

  it('Новый ход и Конец хода уменьшают длительность в ходах; на нуле эффект снимается', () => {
    const makeState = () => {
      const state = freshFighterState();
      state.activeEffects = [{
        id: 'bless',
        name: 'Благословение',
        source: 'Благословение',
        roundsLeft: 2,
        mechanics: { kind: 'modifier', duration: { type: 'rounds', amount: 2, concentration: true } },
      }];
      return state;
    };

    const afterStart = startTurn(makeState()).state;
    expect(afterStart.activeEffects[0]?.roundsLeft).toBe(1);
    expect(startTurn(afterStart).state.activeEffects).toHaveLength(0);

    const afterEnd = endTurn(makeState(), FIGHTER_CTX).state;
    expect(afterEnd.activeEffects[0]?.roundsLeft).toBe(1);
    expect(endTurn(afterEnd, FIGHTER_CTX).state.activeEffects).toHaveLength(0);
  });

  it('Конец хода не снимает эффект «до начала следующего хода» преждевременно', () => {
    const state = freshFighterState();
    state.activeEffects = [{
      id: 'until-start',
      name: 'До начала',
      source: 'тест',
      expiry: 'start_of_next_turn',
      mechanics: {},
    }];
    const afterEnd = endTurn(state, FIGHTER_CTX).state;
    expect(afterEnd.activeEffects).toHaveLength(1);
    expect(startTurn(afterEnd).state.activeEffects).toHaveLength(0);
  });

  it('nextTurn проходит обе границы и уменьшает длительность ровно один раз', () => {
    const state = freshFighterState();
    state.activeEffects = [
      {
        id: 'rounds', name: 'Два хода', source: 'тест', roundsLeft: 2, mechanics: {},
      },
      {
        id: 'until-start', name: 'До начала', source: 'тест',
        expiry: 'start_of_next_turn', mechanics: {},
      },
    ];
    const result = nextTurn(state, {
      ...FIGHTER_CTX,
      passives: [listener('Конец', 'turn_end'), listener('Начало', 'turn_start')],
    } as typeof FIGHTER_CTX);
    expect(result.events.some((event) => event.type === 'turn_ended')).toBe(true);
    expect(result.events.some((event) => event.type === 'turn_started')).toBe(true);
    expect(narratives(result.events)).toEqual(expect.arrayContaining(['Сработало: Конец', 'Сработало: Начало']));
    expect(result.state.activeEffects.find((effect) => effect.id === 'rounds')?.roundsLeft).toBe(1);
    expect(result.state.activeEffects.some((effect) => effect.id === 'until-start')).toBe(false);
  });

  it('resolves end-turn offers before applying the next start boundary', async () => {
    const state = freshFighterState();
    state.resources.action = 0;
    const optionalEnd: Dict = {
      id: 'optional-end', name: 'Решение конца хода',
      activation: { mode: 'triggered', optional: true, trigger: { event: 'turn_end' } },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'решено' }] }],
    };
    const ctx = { ...FIGHTER_CTX, passives: [optionalEnd] } as typeof FIGHTER_CTX;
    expect(() => nextTurn(state, ctx)).toThrow(/reaction resolver/);

    const observedAction: number[] = [];
    const result = await nextTurnWithReactions(state, ctx, async (current, offer) => {
      observedAction.push(current.resources.action);
      expect(offer.listenerId).toBe('optional-end');
      return {
        state: current,
        events: [{ type: 'narrative', text: 'Решение принято' }],
      };
    });
    expect(observedAction).toEqual([0]);
    expect(result.state.resources.action).toBe(result.state.maxResources.action);
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'turn_ended', 'narrative', 'turn_started',
    ]));
    expect(result.events.findIndex((event) => event.type === 'narrative'))
      .toBeLessThan(result.events.findIndex((event) => event.type === 'turn_started'));
  });

  it('startTurn с ctx эмитит turn_start → будит слушателя; startTurn(state) — нет (обр. совм.)', () => {
    const withCtx = startTurn(freshFighterState(), { ...FIGHTER_CTX, passives: [listener('Регенерация', 'turn_start')] } as typeof FIGHTER_CTX);
    expect(narratives(withCtx.events)).toContain('Сработало: Регенерация');
    const noCtx = startTurn(freshFighterState());
    expect(narratives(noCtx.events)).not.toContain('Сработало: Регенерация');
  });
});
