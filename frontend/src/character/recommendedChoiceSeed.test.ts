import { describe, expect, it } from 'vitest';
import { recommendedChoiceSeed } from './components';
import type { PendingChoice } from '../mechanics/collectChoices';

const origin = { kind: 'class' as const, id: 'c1', name: 'Тест' };
function choice(p: Partial<PendingChoice> & { id: string }): PendingChoice {
  return { prompt: 'Выбор', count: 1, source: 'spell', origin, ...p };
}

describe('recommendedChoiceSeed — авто-выбор рекомендованного', () => {
  it('предзаполняет рекомендованные для невыбранного choice', () => {
    const choices = [choice({ id: 'x', count: 2, recommended: ['a', 'b'] })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({ x: ['a', 'b'] });
  });

  it('обрезает рекомендованные по count', () => {
    const choices = [choice({ id: 'x', count: 1, recommended: ['a', 'b', 'c'] })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({ x: ['a'] });
  });

  it('не перетирает уже сделанный выбор', () => {
    const choices = [choice({ id: 'x', count: 2, recommended: ['a', 'b'] })];
    expect(recommendedChoiceSeed(choices, { x: ['z'] }, new Set())).toEqual({});
  });

  it('игнорирует выбор без recommended', () => {
    const choices = [choice({ id: 'x', count: 2 })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({});
  });

  it('пропускает уже обработанные (applied) — очистка не триггерит повтор', () => {
    const choices = [choice({ id: 'x', recommended: ['a'] })];
    expect(recommendedChoiceSeed(choices, {}, new Set(['x']))).toEqual({});
  });

  it('не трогает выборы контекста in_play (диалог в момент действия)', () => {
    const choices = [choice({ id: 'x', recommended: ['a'], context: 'in_play' })];
    expect(recommendedChoiceSeed(choices, {}, new Set())).toEqual({});
  });

  it('обрабатывает несколько выборов независимо', () => {
    const choices = [
      choice({ id: 'a', recommended: ['a1'] }),
      choice({ id: 'b', count: 2, recommended: ['b1', 'b2'] }),
      choice({ id: 'c' }),                      // без recommended
      choice({ id: 'd', recommended: ['d1'] }), // уже выбран
    ];
    expect(recommendedChoiceSeed(choices, { d: ['dx'] }, new Set())).toEqual({
      a: ['a1'],
      b: ['b1', 'b2'],
    });
  });
});
