import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import { dropConcentration, startConcentration } from './concentration';
import { removeActiveEffect } from './effects';

function stateWithBless(id = 'bless-old'): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: {},
    maxResources: {},
    equipment: {},
    inventory: [],
    activeEffects: [{
      id,
      name: 'Благословение',
      source: 'Благословение',
      roundsLeft: 10,
      mechanics: {
        kind: 'modifier',
        op: 'bonus_die',
        faces: 4,
        duration: { type: 'rounds', amount: 10, concentration: true },
      },
    }],
  };
}

describe('жизненный цикл концентрации', () => {
  it('связывает эффект с концентрацией, переносит 10 ходов и снимает всю группу', () => {
    const started = startConcentration(stateWithBless(), 'Благословение', ['bless-old']);
    const marker = started.state.activeEffects.find((effect) =>
      (effect.mechanics as Record<string, unknown>).kind === 'concentration');
    expect(marker?.roundsLeft).toBe(10);

    const dropped = dropConcentration(started.state, 'провал проверки');
    expect(dropped.state.activeEffects).toHaveLength(0);
    expect(dropped.events.filter((event) => event.type === 'effect_expired')).toHaveLength(2);
  });

  it('ручное снятие записи концентрации также снимает связанный эффект', () => {
    const started = startConcentration(stateWithBless(), 'Благословение', ['bless-old']);
    const marker = started.state.activeEffects.find((effect) =>
      (effect.mechanics as Record<string, unknown>).kind === 'concentration')!;
    expect(removeActiveEffect(started.state, marker.id).state.activeEffects).toHaveLength(0);
  });

  it('повторный каст того же заклинания удаляет старый эффект, но сохраняет новый', () => {
    const first = startConcentration(stateWithBless(), 'Благословение', ['bless-old']);
    const withNew = {
      ...first.state,
      activeEffects: [
        ...first.state.activeEffects,
        stateWithBless('bless-new').activeEffects[0],
      ],
    };
    const second = startConcentration(withNew, 'Благословение', ['bless-new']);
    expect(second.state.activeEffects.some((effect) => effect.id === 'bless-old')).toBe(false);
    expect(second.state.activeEffects.some((effect) => effect.id === 'bless-new')).toBe(true);
  });
});
