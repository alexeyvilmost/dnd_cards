import { describe, expect, it } from 'vitest';
import {
  damageEvent,
  describeEngineEvent,
  deserializeEngineEvent,
  deserializeStoredEvent,
  formatRollBreakdown,
  narrativeEvent,
  rollEvent,
  serializeEngineEvent,
  serializeStoredEvent,
} from './events';
import type { EngineEvent } from '../mvp/contracts';
import { rollD20 } from './roll';
import { seededRng } from '../mvp/fixtures';

describe('events serialization', () => {
  it('round-trip EngineEvent roll', () => {
    const roll = rollD20({ rng: seededRng(42), modifiers: [{ value: 2, source: 'ЛВК' }] });
    const event = rollEvent('Атака', roll);
    const restored = deserializeEngineEvent(serializeEngineEvent(event));
    expect(restored).toEqual(event);
  });

  it('round-trip damage + stored row', () => {
    const event = damageEvent(5, 'fire');
    const row = { id: 'e1', type: 'damage', payload: event, ts: '2026-01-01T00:00:00Z' };
    const json = serializeStoredEvent(row);
    const restored = deserializeStoredEvent(json);
    expect(restored.payload).toEqual(event);
    expect(restored.ts).toBe(row.ts);
  });

  it('narrative event', () => {
    const e = narrativeEvent('Тест');
    expect(deserializeEngineEvent(serializeEngineEvent(e))).toEqual(e);
  });

  it('round-trips and describes a structured forced-movement event', () => {
    const event: EngineEvent = { type: 'movement', mode: 'push', distanceFt: 10 };
    expect(deserializeEngineEvent(serializeEngineEvent(event))).toEqual(event);
    expect(describeEngineEvent(event)).toBe('отталкивание 10 фт.');
    expect(describeEngineEvent({ type: 'movement', mode: 'teleport', distanceFt: 30 }))
      .toBe('телепортация 30 фт.');
  });

  it('localizes combat resources without exposing internal identifiers', () => {
    expect(describeEngineEvent({
      type: 'resource_spent', resource: 'giant_legacy', amount: 1, remaining: 1,
    })).toBe('Потрачено Наследие великанов: 1 (осталось 1)');
    expect(describeEngineEvent({
      type: 'resource_spent', resource: 'uses_ACT-breath-lightning', amount: 1, remaining: 0,
    })).toBe('Потрачено Заряд способности: 1 (осталось 0)');
  });

  it('source-атрибуция: журнал цели показывает «кто» (для боя)', () => {
    const withSrc: EngineEvent = { type: 'damage', amount: 6, damageType: 'яд', source: 'Тест' };
    expect(describeEngineEvent(withSrc)).toBe('Тест: Урон 6 (яд)');
    // без source — как раньше (журнал кастующего)
    expect(describeEngineEvent({ type: 'damage', amount: 6, damageType: 'яд' })).toBe('Урон 6 (яд)');
    expect(describeEngineEvent({ type: 'condition_applied', condition: 'Отравлен', source: 'Тест' })).toBe('Тест: Состояние: Отравлен');
  });

  it('localizes canonical damage and condition ids for the player journal', () => {
    expect(describeEngineEvent({ type: 'damage', amount: 8, damageType: 'poison' }))
      .toBe('Урон 8 (яд)');
    expect(describeEngineEvent({ type: 'condition_applied', condition: 'poisoned' }))
      .toBe('Состояние: Отравлен');
    expect(describeEngineEvent({
      type: 'condition_immune',
      condition: 'poisoned',
      sourceEntityIds: ['species:test'],
    }))
      .toBe('Иммунитет к состоянию: Отравлен');
  });

  it('labels non-d20 journal dice with their actual die size', () => {
    expect(formatRollBreakdown({
      kind: 'damage',
      dice: [{ sides: 4, result: 3 }],
      advantage: 'none',
      modifiers: [],
      total: 3,
      text: 'к4: 3 = 3',
    })).toBe('к4: 3');
    expect(formatRollBreakdown({
      kind: 'other',
      dice: [{ sides: 4, result: 2 }, { sides: 6, result: 5 }],
      advantage: 'none',
      modifiers: [],
      total: 7,
      text: 'к4: 2 + к6: 5 = 7',
    })).toBe('к4: 2, к6: 5');
  });
});
