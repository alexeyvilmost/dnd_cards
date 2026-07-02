import { describe, expect, it } from 'vitest';
import {
  damageEvent,
  deserializeEngineEvent,
  deserializeStoredEvent,
  narrativeEvent,
  rollEvent,
  serializeEngineEvent,
  serializeStoredEvent,
} from './events';
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
});
