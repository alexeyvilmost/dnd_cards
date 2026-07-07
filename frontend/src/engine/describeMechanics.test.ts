import { describe, expect, it } from 'vitest';
import { describeMechanics, describeMechanicsLine } from './describeMechanics';

const smite = {
  activation: { mode: 'triggered', cost: [{ resource: 'spell_slot', level: 1 }] },
  effects: [{ resolution: 'auto', result: [{ kind: 'damage', dice: '2d8', type: 'radiant' }] }],
};
const fireball = {
  activation: { mode: 'active', cost: [{ resource: 'action' }] },
  effects: [{ resolution: 'save', ability: 'dex', dc: 'spell_dc', on_fail: [{ kind: 'damage', dice: '8d6', type: 'fire' }], on_success: [{ kind: 'damage', dice: '8d6', type: 'fire', on_success: 'half' }] }],
  duration: { type: 'instantaneous' },
};
const stunningStrike = {
  activation: { mode: 'triggered', cost: [{ resource: 'focus', amount: 1 }] },
  effects: [{ resolution: 'save', who: 'target', ability: 'con', dc: '8+prof+wis', on_fail: [{ kind: 'condition', value: 'stunned', op: 'apply' }] }],
  uses: { count: 'prof_bonus', per: 'long_rest' },
};
const rage = {
  activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'rage', amount: 1 }] },
  effects: [{ resolution: 'auto', result: [
    { kind: 'modifier', applies_to: { roll: 'damage' }, op: 'add', value: '+2' },
    { kind: 'resistance', damage_type: 'bludgeoning', value: 'resistance' },
  ] }],
  duration: { type: 'minutes', amount: 10, concentration: false },
};
const proneEffect = {
  effects: [{ resolution: 'auto', result: [
    { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage' },
    { kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target' },
  ] }],
};

describe('describeMechanics (фаза F)', () => {
  it('урон + стоимость слота', () => {
    const d = describeMechanics(smite);
    expect(d.summary).toContain('[radiant]2к8');
    expect(d.details).toContain('Стоит: слот 1 круга');
  });

  it('спасбросок с полуроном и цветным уроном', () => {
    const d = describeMechanics(fireball);
    expect(d.summary).toContain('спасбросок ЛВК');
    expect(d.summary).toContain('[fire]8к6 огонь[/fire]');
    expect(d.summary).toContain('полурон при успехе');
  });

  it('состояние + фокус + использования', () => {
    const d = describeMechanics(stunningStrike);
    expect(d.summary).toContain('накладывает **Ошеломлён**');
    expect(d.details).toContain('Стоит: 1 фокус');
    expect(d.details.some((s) => s.includes('Использования'))).toBe(true);
  });

  it('модификатор + сопротивление + длительность + иконка ресурса', () => {
    const d = describeMechanics(rage);
    expect(d.summary).toContain('к урон');
    expect(d.summary).toContain('сопротивление');
    expect(d.details.some((s) => s.includes('10 мин'))).toBe(true);
    expect(d.details.some((s) => s.includes(':bonus_action:'))).toBe(true);
  });

  it('scope:target — «атакующим по вам»', () => {
    expect(describeMechanics(proneEffect).summary).toContain('атакующим по вам — преимущество на атаку');
  });

  it('пустая механика и однострочник', () => {
    expect(describeMechanics(null)).toEqual({ summary: '', details: [] });
    expect(describeMechanicsLine(smite)).toContain('·');
  });
});
