import { describe, expect, it } from 'vitest';
import {
  damageEvent,
  describeEngineEvent,
  deserializeEngineEvent,
  deserializeStoredEvent,
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

  it('source-атрибуция: журнал цели показывает «кто» (для боя)', () => {
    const withSrc: EngineEvent = { type: 'damage', amount: 6, damageType: 'яд', source: 'Тест' };
    expect(describeEngineEvent(withSrc)).toBe('Тест: Урон 6 (яд)');
    // без source — как раньше (журнал кастующего)
    expect(describeEngineEvent({ type: 'damage', amount: 6, damageType: 'яд' })).toBe('Урон 6 (яд)');
    expect(describeEngineEvent({ type: 'condition_applied', condition: 'Отравлен', source: 'Тест' })).toBe('Тест: Состояние: Отравлен');
  });
});
