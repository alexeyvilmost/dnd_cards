import { describe, expect, it } from 'vitest';
import { actionCostResourceIds } from './resources';

describe('actionCostResourceIds — стоимость из activation.cost (единый источник)', () => {
  it('берёт ресурсы из mechanics.activation.cost', () => {
    const action = {
      resources: ['action'], // легаси-поле игнорируется, если есть cost
      mechanics: { activation: { mode: 'active', cost: [{ resource: 'magic_recovery_charge' }, { resource: 'action' }] } },
    };
    expect(actionCostResourceIds(action)).toEqual(['magic_recovery_charge', 'action']);
  });

  it('spell_slot с уровнем → ключ ячейки конкретного круга', () => {
    const action = { mechanics: { activation: { cost: [{ resource: 'spell_slot', level: 3 }] } } };
    expect(actionCostResourceIds(action)).toEqual(['spell_slot_3']);
  });

  it('нет стоимости в механике → откат на resources[]', () => {
    const action = { resources: ['action', 'bonus_action'], mechanics: { activation: { mode: 'active' } } };
    expect(actionCostResourceIds(action)).toEqual(['action', 'bonus_action']);
  });

  it('нет ни cost, ни resources → устаревший resource', () => {
    expect(actionCostResourceIds({ resource: 'action' })).toEqual(['action']);
    expect(actionCostResourceIds({})).toEqual([]);
  });
});
