import { describe, expect, it } from 'vitest';
import { MECH_ATTACK_BONUS_2, MECH_DODGE, MECH_NEXT_ATTACK_ADVANTAGE } from '../mvp/fixtures';
import { payloadsOf } from './mechanicsView';

describe('payloadsOf (R1)', () => {
  it('голый payload modifier', () => {
    const payload = {
      kind: 'modifier',
      applies_to: { roll: 'attack' },
      op: 'add',
      value: '+2',
    };
    expect(payloadsOf(payload)).toHaveLength(1);
    expect(payloadsOf(payload)[0].kind).toBe('modifier');
  });

  it('полная пассивная механика с effects[]', () => {
    const fromPassive = payloadsOf(MECH_NEXT_ATTACK_ADVANTAGE);
    expect(fromPassive.some((p) => p.op === 'advantage')).toBe(true);

    const fromBonus = payloadsOf(MECH_ATTACK_BONUS_2);
    expect(fromBonus.some((p) => p.op === 'add' && p.value === '+2')).toBe(true);
  });

  it('механика действия Уклонения — два modifier payload', () => {
    const payloads = payloadsOf(MECH_DODGE);
    expect(payloads.filter((p) => p.kind === 'modifier')).toHaveLength(2);
  });
});
