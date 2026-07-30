import { describe, expect, it } from 'vitest';
import { calculatePlannedRollTotals, extractDiceFromEvents, plannedD20BonusDice } from './dicePlan';
import type { EngineEvent } from '../mvp/contracts';

describe('полный итог в панели 3D-кубиков', () => {
  it('складывает кость и числовые модификаторы', () => {
    const plan = [{ sides: 20, label: 'Проверка', resultGroup: 'check', modifier: 5 }] as const;
    expect(calculatePlannedRollTotals([...plan], [13])).toEqual([{
      key: 'check',
      label: 'Проверка',
      diceTotal: 13,
      modifier: 5,
      total: 18,
    }]);
  });

  it('при преимуществе считает только оставляемую к20 и добавляет бонусную кость', () => {
    const plan = [
      { sides: 20, label: 'Спасбросок', resultGroup: 'save', modifier: 2, advantage: 'advantage' as const },
      { sides: 20, label: 'Спасбросок', resultGroup: 'save', advantage: 'advantage' as const },
      { sides: 4, label: 'Спасбросок', resultGroup: 'save' },
    ];
    expect(calculatePlannedRollTotals(plan, [7, 16, 3])[0]).toMatchObject({
      diceTotal: 19,
      modifier: 2,
      total: 21,
    });
  });

  it('переносит модификатор из события движка в план броска', () => {
    const events: EngineEvent[] = [{
      type: 'roll',
      label: 'Инициатива',
      roll: {
        kind: 'd20',
        dice: [{ sides: 20, result: 12 }],
        advantage: 'none',
        modifiers: [
          { value: 2, source: 'ЛВК' },
          { value: 2, source: 'Бонус мастерства' },
        ],
        total: 16,
        text: 'к20: 12 +2 +2 = 16',
      },
    }];
    expect(extractDiceFromEvents(events)).toEqual([{
      sides: 20,
      label: 'Инициатива',
      resultGroup: 'event-0',
      modifier: 4,
    }]);
  });

  it('добавляет физическую бонусную кость из правила Наставления/Благословения', () => {
    expect(plannedD20BonusDice(
      [{ op: 'bonus_die', faces: 4, source: 'Наставление' }],
      'Спасбросок',
      'save',
    )).toEqual([{ sides: 4, label: 'Наставление', resultGroup: 'save' }]);
  });

  it('показывает источник бонусной кости из события, сохраняя общий итог броска', () => {
    const dice = [
      { sides: 20, result: 10 },
      { sides: 4, result: 3, source: 'Благословение' },
    ];
    const events: EngineEvent[] = [{
      type: 'roll',
      label: 'Проверка (Восприятие)',
      roll: {
        kind: 'd20',
        dice,
        advantage: 'none',
        modifiers: [{ value: 2, source: 'МДР' }],
        total: 15,
        text: 'к20: 10 + к4: 3 (Благословение) +2 МДР = 15',
      },
    }];
    const plan = extractDiceFromEvents(events);
    expect(plan.map((die) => die.label)).toEqual(['Проверка (Восприятие)', 'Благословение']);
    expect(calculatePlannedRollTotals(plan, [10, 3])[0]).toMatchObject({
      diceTotal: 13,
      modifier: 2,
      total: 15,
    });
  });
});
