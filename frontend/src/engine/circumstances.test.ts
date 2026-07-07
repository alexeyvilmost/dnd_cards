import { describe, expect, it } from 'vitest';
import { activeConditionsOf, evaluateCondition, matchesWhen, type EvalContext } from './circumstances';
import type { ActiveEffectEntry, RuntimeState } from '../mvp/contracts';

function stateWith(activeEffects: ActiveEffectEntry[]): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects,
  };
}

function conditionEffect(value: string): ActiveEffectEntry {
  return { id: `c-${value}`, name: value, mechanics: { kind: 'condition', value }, source: 'test' };
}

describe('circumstances', () => {
  it('matchesWhen: пусто → true', () => {
    expect(matchesWhen(undefined)).toBe(true);
    expect(matchesWhen([])).toBe(true);
  });

  it('matchesWhen без контекста не блокирует (обратная совместимость)', () => {
    expect(matchesWhen([{ kind: 'you_have_condition', value: 'raging' }])).toBe(true);
  });

  it('you_have_condition по активным состояниям', () => {
    const ctx: EvalContext = { activeConditions: activeConditionsOf(stateWith([conditionEffect('prone')])) };
    expect(evaluateCondition({ kind: 'you_have_condition', value: 'prone' }, ctx)).toBe(true);
    expect(evaluateCondition({ kind: 'you_have_condition', value: 'stunned' }, ctx)).toBe(false);
  });

  it('target_has_condition: нет данных цели → false', () => {
    expect(evaluateCondition({ kind: 'target_has_condition', value: 'prone' }, {})).toBe(false);
    expect(evaluateCondition({ kind: 'target_has_condition', value: 'prone' }, { targetConditions: new Set(['prone']) })).toBe(true);
  });

  it('any_of / all_of / not', () => {
    const ctx: EvalContext = { activeConditions: new Set(['raging']) };
    const has = { kind: 'you_have_condition', value: 'raging' };
    const hasnt = { kind: 'you_have_condition', value: 'x' };
    expect(evaluateCondition({ kind: 'any_of', of: [has, hasnt] }, ctx)).toBe(true);
    expect(evaluateCondition({ kind: 'all_of', of: [has, hasnt] }, ctx)).toBe(false);
    expect(evaluateCondition({ kind: 'not', of: hasnt }, ctx)).toBe(true);
  });

  it('неизвестный/текстовый предикат → true (мягкая деградация)', () => {
    expect(evaluateCondition({ kind: 'totally_unknown' }, {})).toBe(true);
    expect(evaluateCondition({ kind: 'narrative', description: '...' }, {})).toBe(true);
  });
});
