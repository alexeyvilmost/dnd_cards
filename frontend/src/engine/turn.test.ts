import { describe, expect, it } from 'vitest';
import { freshFighterState, FIGHTER_CTX } from '../mvp/fixtures';
import { resourcesRestoredOnShortRest } from './resources';
import { endTurn, shortRest, startTurn } from './turn';
import type { EngineEvent } from '../mvp/contracts';

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

  it('endTurn эмитит turn_end → будит triggered-слушателя', () => {
    const { events } = endTurn(freshFighterState(), { ...FIGHTER_CTX, passives: [listener('Тикающий яд', 'turn_end')] } as typeof FIGHTER_CTX);
    expect(narratives(events)).toContain('Сработало: Тикающий яд');
  });

  it('startTurn с ctx эмитит turn_start → будит слушателя; startTurn(state) — нет (обр. совм.)', () => {
    const withCtx = startTurn(freshFighterState(), { ...FIGHTER_CTX, passives: [listener('Регенерация', 'turn_start')] } as typeof FIGHTER_CTX);
    expect(narratives(withCtx.events)).toContain('Сработало: Регенерация');
    const noCtx = startTurn(freshFighterState());
    expect(narratives(noCtx.events)).not.toContain('Сработало: Регенерация');
  });
});
